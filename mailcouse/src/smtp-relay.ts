import { SMTPServer, SMTPServerSession, SMTPServerDataStream, SMTPServerAuthentication, SMTPServerAuthenticationResponse } from 'smtp-server';
import { simpleParser, ParsedMail } from 'mailparser';
import bcrypt from 'bcryptjs';
import * as dns from 'dns';
import * as net from 'net';
import crypto from 'crypto';
import { query } from './db/connection';
import { config } from './config';
import { getDKIMPrivateKey } from './dkim/key-store';

function getLastCode(response: string): { code: number; msg: string; isFinal: boolean } | null {
  const lines = response.trim().split('\r\n');
  const lastLine = lines[lines.length - 1];
  const m = lastLine.match(/^(\d{3})([ -])(.*)/);
  if (!m) return null;
  return { code: parseInt(m[1]), msg: m[3], isFinal: m[2] === ' ' };
}

async function deliverEmail(mxHost: string, port: number, envelopeFrom: string, to: string, message: string): Promise<{ success: boolean; code: number; message: string }> {
  return new Promise((resolve, reject) => {
    const s = new net.Socket();
    let buf = '';
    let step = 0;
    let settled = false;

    const done = (err?: any, result?: { success: boolean; code: number; message: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      s.destroy();
      if (err) reject(err);
      else if (result) resolve(result);
    };

    const timer = setTimeout(() => done(new Error('SMTP total timeout')), 15000);

    const tryProcess = () => {
      const parsed = getLastCode(buf);
      if (!parsed || !parsed.isFinal) return;
      const { code, msg } = parsed;
      try {
        switch (step) {
          case 0:
            if (code === 220) { step = 1; s.write(`EHLO mailcouse\r\n`); buf = ''; }
            else done(null, { success: false, code, message: msg });
            break;
          case 1: step = 2; s.write(`MAIL FROM:<${envelopeFrom}>\r\n`); buf = ''; break;
          case 2:
            if (code === 250) { step = 3; s.write(`RCPT TO:<${to}>\r\n`); buf = ''; }
            else done(null, { success: false, code, message: msg });
            break;
          case 3:
            if (code === 250) { step = 4; s.write(`DATA\r\n`); buf = ''; }
            else done(null, { success: false, code, message: msg });
            break;
          case 4:
            if (code === 354) { s.write(`${message}\r\n.\r\n`); step = 5; buf = ''; }
            else done(null, { success: false, code, message: msg });
            break;
          case 5: done(null, { success: code >= 200 && code < 300, code, message: msg }); break;
        }
      } catch (e: any) { done(e); }
    };

    s.on('connect', () => {});
    s.on('data', (data: Buffer) => { buf += data.toString(); tryProcess(); });
    s.on('error', (err) => done(err));
    s.on('timeout', () => done(new Error('SMTP idle timeout')));
    s.connect(port, mxHost);
  });
}

export function createSmtpRelay(): SMTPServer {
  const server = new SMTPServer({
    name: 'mailcouse',
    banner: 'Mailcouse SMTP Relay',
    authMethods: ['PLAIN', 'LOGIN'],
    allowInsecureAuth: true,
    disabledCommands: ['STARTTLS'],

    async onAuth(auth: SMTPServerAuthentication, session: SMTPServerSession, callback: (err: Error | null | undefined, response?: SMTPServerAuthenticationResponse) => void) {
      try {
        if (!auth.username) return callback(new Error('Authentication failed'));
        const result = await query<{ id: string; password_hash: string; organization_id: string; customer_domain_id: string; hold: boolean }>(
          `SELECT id, password_hash, organization_id, customer_domain_id, hold
           FROM smtp_credentials WHERE username = $1`,
          [auth.username]
        );

        if (result.rows.length === 0) return callback(new Error('Authentication failed'));
        const cred = result.rows[0];
        if (cred.hold) return callback(new Error('Credential is on hold'));

        const valid = await bcrypt.compare(auth.password || '', cred.password_hash);
        if (!valid) return callback(new Error('Authentication failed'));

        await query('UPDATE smtp_credentials SET last_used_at = NOW() WHERE id = $1', [cred.id]);
        callback(null, { user: { credentialId: cred.id, organizationId: cred.organization_id, customerDomainId: cred.customer_domain_id } });
      } catch {
        callback(new Error('Authentication failed'));
      }
    },

    async onData(stream: SMTPServerDataStream, session: SMTPServerSession, callback: (err?: Error | null) => void) {
      try {
        const authUser = (session as any).user;
        if (!authUser) return callback(new Error('Not authenticated'));

        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk);
        const raw = Buffer.concat(chunks);
        const parsed = await simpleParser(raw);

        const envFrom = session.envelope.mailFrom;
        const mailFrom = parsed.from?.text || (envFrom && typeof envFrom === 'object' ? envFrom.address : 'unknown');
        const subject = parsed.subject || '(no subject)';
        const size = raw.length;

        // Find customer domain from the mail from address
        const domainPart = mailFrom.split('@')[1];
        let customerDomainId = authUser.customerDomainId;
        if (!customerDomainId && domainPart) {
          const domResult = await query<{ id: string }>(
            'SELECT id FROM customer_domains WHERE domain = $1 AND organization_id = $2 AND verified = true',
            [domainPart, authUser.organizationId]
          );
          if (domResult.rows.length > 0) customerDomainId = domResult.rows[0].id;
        }

        // Pick a random available subdomain from the pool
        const sdResult = await query<{ id: string; subdomain: string; root_domain: string; sender_name: string }>(
          `SELECT s.id, s.subdomain, d.domain as root_domain, s.sender_name
           FROM subdomains s JOIN domains d ON s.domain_id = d.id
           WHERE s.status = 'active' AND s.emails_sent_today < s.daily_limit
           ORDER BY RANDOM() LIMIT 1`
        );
        if (sdResult.rows.length === 0) return callback(new Error('No available sending subdomains'));

        const sub = sdResult.rows[0];
        const localPart = sub.sender_name.replace(/\s+/g, '.').toLowerCase();
        const envelopeFrom = `${localPart}@${sub.root_domain}`;
        const headerFrom = `${sub.sender_name} <${localPart}@${sub.subdomain}>`;
        const msgId = `<${crypto.randomUUID()}@${sub.subdomain}>`;
        const toText = parsed.to && typeof parsed.to === 'object' && 'text' in parsed.to ? (parsed.to as any).text : '';

        // Build MIME message
        const hdrs: Record<string, string> = {
          'From': headerFrom,
          'To': toText,
          'Subject': subject,
          'Date': new Date().toUTCString(),
          'Message-ID': msgId,
        };

        // DKIM sign if available
        try {
          const keyData = await getDKIMPrivateKey(sub.id);
          if (keyData) {
            const signHdrs = ['from', 'to', 'subject', 'date', 'message-id'];
            const hdrList = signHdrs.join(':');
            const hdrStr = signHdrs.map(h => `${h}:${hdrs[h[0].toUpperCase() + h.slice(1)] || ''}`).join('\r\n');
            const bodyHash = crypto.createHash('sha256').update(parsed.text || parsed.html || '').digest('base64');
            const sign = crypto.createSign('sha256');
            sign.update(hdrStr);
            const b = sign.sign(keyData.privateKey, 'base64');
            hdrs['DKIM-Signature'] = [
              'v=1', `a=rsa-sha256`, `d=${sub.root_domain}`, `s=${keyData.selector}`,
              `h=${hdrList}`, `bh=${bodyHash}`, `b=${b}`,
            ].join('; ');
          }
        } catch {}

        const mimeMessage = Object.entries(hdrs).map(([k, v]) => `${k}: ${v}`).join('\r\n')
          + '\r\n\r\n' + (parsed.html || parsed.text || '');

        // Deliver to all recipients
        const rcptTo: string[] = [];
        if (session.envelope.rcptTo) {
          for (const r of session.envelope.rcptTo) {
            if (r && typeof r === 'object' && 'address' in r) rcptTo.push(r.address);
          }
        }
        const results: { to: string; success: boolean; message: string }[] = [];

        for (const recipient of rcptTo) {
          try {
            const mxRecords = await dns.promises.resolveMx(recipient.split('@')[1]);
            if (!mxRecords || mxRecords.length === 0) {
              results.push({ to: recipient, success: false, message: 'No MX records' });
              continue;
            }
            mxRecords.sort((a, b) => a.priority - b.priority);

            let delivered = false;
            for (const mx of mxRecords) {
              const result = await deliverEmail(mx.exchange, 25, envelopeFrom, recipient, mimeMessage);
              if (result.success) {
                results.push({ to: recipient, success: true, message: result.message });
                delivered = true;
                break;
              }
            }
            if (!delivered) results.push({ to: recipient, success: false, message: 'All MX servers failed' });
          } catch (err: any) {
            results.push({ to: recipient, success: false, message: err.message });
          }
        }

        // Record in database
        const allSuccess = results.every(r => r.success);
        await query(
          `INSERT INTO sent_messages (organization_id, credential_id, customer_domain_id, subdomain_id, mail_from, rcpt_to, subject, body_html, body_text, raw_headers, size, status, message_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            authUser.organizationId, authUser.credentialId, customerDomainId, sub.id,
            mailFrom, rcptTo.join(', '), subject, parsed.html || '', parsed.text || '',
            JSON.stringify(parsed.headers || {}), size,
            allSuccess ? 'sent' : 'failed',
            msgId,
          ]
        );

        // Update subdomain counter
        await query(
          'UPDATE subdomains SET emails_sent_today = emails_sent_today + 1, total_sent = total_sent + 1 WHERE id = $1',
          [sub.id]
        );

        // Track subdomain pool usage
        await query(
          `INSERT INTO subdomain_pool_tracking (subdomain_id, organization_id, last_used_at, total_assigned)
           VALUES ($1, $2, NOW(), 1)
           ON CONFLICT (subdomain_id, organization_id)
           DO UPDATE SET last_used_at = NOW(), total_assigned = subdomain_pool_tracking.total_assigned + 1`,
          [sub.id, authUser.organizationId]
        );

        callback();
      } catch (err: any) {
        console.error('SMTP data error:', err);
        callback(new Error('Failed to process message'));
      }
    },
  });

  server.on('error', (err) => {
    console.error('SMTP server error:', err);
  });

  return server;
}
