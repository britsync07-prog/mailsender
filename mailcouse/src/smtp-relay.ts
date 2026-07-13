import { SMTPServer, SMTPServerSession, SMTPServerDataStream, SMTPServerAuthentication, SMTPServerAuthenticationResponse } from 'smtp-server';
import { simpleParser, ParsedMail } from 'mailparser';
import bcrypt from 'bcryptjs';
import * as dns from 'dns';
import * as net from 'net';
import crypto from 'crypto';
import { query } from './db/connection';
import { config } from './config';
import { getDomainDKIMPrivateKey } from './dkim/key-store';

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

        const fromAddr = parsed.from?.value?.[0]?.address;
        if (!fromAddr) return callback(new Error('No From address'));
        const domainPart = fromAddr.split('@')[1]?.toLowerCase();
        if (!domainPart) return callback(new Error('Invalid From address'));

        const domResult = await query<{ id: string; domain: string }>(
          `SELECT id, domain FROM customer_domains
           WHERE LOWER(domain) = $1 AND organization_id = $2 AND verified = true`,
          [domainPart, authUser.organizationId]
        );
        if (domResult.rows.length === 0) {
          return callback(new Error(`530 From domain ${domainPart} is not verified for this account`));
        }

        const customerDomain = domResult.rows[0];
        const subject = parsed.subject || '(no subject)';
        const size = raw.length;

        const rcptTo: string[] = [];
        if (session.envelope.rcptTo) {
          for (const r of session.envelope.rcptTo) {
            if (r && typeof r === 'object' && 'address' in r) rcptTo.push(r.address);
          }
        }

        const msgId = parsed.messageId || `<${crypto.randomUUID()}@${customerDomain.domain}>`;
        const envelopeFrom = `bounce+${authUser.organizationId.slice(0, 8)}@live.noblecircle.online`;
        const ip = session.remoteAddress || 'unknown';
        const helo = session.hostNameAppearsAs || 'unknown';
        const receivedHeader = `Received: from ${helo} (${ip}) by live.noblecircle.online with SMTP; ${new Date().toUTCString()}\r\n`;

        // Preserve original raw message, just prepend Received header
        let mimeMessage = receivedHeader + raw.toString('utf-8');

        // DKIM sign with the customer domain's key
        try {
          const keyData = await getDomainDKIMPrivateKey(customerDomain.id);
          if (keyData) {
            const signHdrs = ['from', 'to', 'subject', 'date', 'message-id'];
            const hdrList = signHdrs.join(':');
            const hdrStr = signHdrs.map(h => {
              const val = parsed.headers ? (parsed.headers as any)[h] : undefined;
              return `${h}:${val || ''}`;
            }).join('\r\n');
            const bodyHash = crypto.createHash('sha256').update(parsed.text || parsed.html || '').digest('base64');
            const sign = crypto.createSign('sha256');
            sign.update(hdrStr);
            const b = sign.sign(keyData.privateKey, 'base64');
            const dkimSignature = `DKIM-Signature: v=1; a=rsa-sha256; d=${customerDomain.domain}; s=${keyData.selector}; h=${hdrList}; bh=${bodyHash}; b=${b}\r\n`;
            mimeMessage = dkimSignature + mimeMessage;
          }
        } catch {}

        // Deliver to all recipients
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
          `INSERT INTO sent_messages (organization_id, credential_id, customer_domain_id, mail_from, rcpt_to, subject, body_html, body_text, raw_headers, size, status, message_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            authUser.organizationId, authUser.credentialId, customerDomain.id,
            fromAddr, rcptTo.join(', '), subject,
            parsed.html || '', parsed.text || '',
            JSON.stringify(parsed.headers || {}), size,
            allSuccess ? 'sent' : 'failed',
            msgId,
          ]
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
