import { SMTPServer, SMTPServerSession, SMTPServerDataStream, SMTPServerAuthentication, SMTPServerAuthenticationResponse } from 'smtp-server';
import { simpleParser, ParsedMail } from 'mailparser';
import bcrypt from 'bcryptjs';
import * as dns from 'dns';
import * as nodemailer from 'nodemailer';
import crypto from 'crypto';
import fs from 'fs';
import { query } from './db/connection';
import { config } from './config';
import { getDomainDKIMPrivateKey } from './dkim/key-store';
import { findVerifiedDomainForAddress } from './api/domain-logic';

type SmtpCredentialUser = {
  credentialId: string | null;
  mailboxId?: string | null;
  organizationId: string;
  customerDomainId: string | null;
  allowedFromEmail: string | null;
  defaultFromName: string | null;
};

async function resolveMxIpv4(mxHost: string): Promise<string> {
  try {
    const addrs = await dns.promises.resolve4(mxHost);
    if (addrs.length > 0) return addrs[0];
  } catch {}
  return mxHost;
}

function formatAddressHeader(name: string | null | undefined, address: string): string {
  const cleanName = String(name || '').trim();
  if (!cleanName) return address;
  const escaped = cleanName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}" <${address}>`;
}

// Permanent recipient-level rejections worth suppressing (not policy/IP blocks)
function isHardBounce(code: number, message: string): boolean {
  if (code < 550 || code > 599) return false;
  return /invalid recipient|recipient address rejected|access denied|unknown user|user unknown|no such (user|mailbox|recipient|domain)|does not exist|mailbox not found|no mailbox here|recipient not found|address rejected/i.test(message);
}

export function createSmtpRelay(tier: string = 'mass_mail'): SMTPServer {
  let tlsOpts: { key: Buffer; cert: Buffer } | undefined;
  try {
    if (config.dns.tlsCert && config.dns.tlsKey) {
      tlsOpts = {
        key: fs.readFileSync(config.dns.tlsKey),
        cert: fs.readFileSync(config.dns.tlsCert),
      };
    }
  } catch (err: any) {
    console.error(`[smtp-relay:${tier}] Failed to load TLS cert for STARTTLS, falling back to plaintext:`, err.message);
  }

  const server = new SMTPServer({
    name: config.dns.heloHostname,
    banner: `Mailcouse SMTP - ${tier}`,
    authMethods: ['PLAIN', 'LOGIN'],
    allowInsecureAuth: !tlsOpts,
    disabledCommands: tlsOpts ? [] : ['STARTTLS'],
    ...(tlsOpts ? { key: tlsOpts.key, cert: tlsOpts.cert } : {}),

    async onAuth(auth: SMTPServerAuthentication, session: SMTPServerSession, callback: (err: Error | null | undefined, response?: SMTPServerAuthenticationResponse) => void) {
      try {
        if (!auth.username) return callback(new Error('Authentication failed'));
        const result = await query<{ id: string; password_hash: string; organization_id: string; customer_domain_id: string | null; hold: boolean; tier: string; allowed_from_email: string | null; default_from_name: string | null }>(
          `SELECT id, password_hash, organization_id, customer_domain_id, hold, tier, allowed_from_email, default_from_name
           FROM smtp_credentials WHERE username = $1`,
          [auth.username]
        );

        if (result.rows.length > 0) {
          const cred = result.rows[0];
          if (cred.hold) return callback(new Error('Credential is on hold'));

          if (cred.tier && cred.tier !== tier) return callback(new Error(`Credential not allowed on this port (requires ${cred.tier} port)`));

          const valid = await bcrypt.compare(auth.password || '', cred.password_hash);
          if (!valid) return callback(new Error('Authentication failed'));

          await query('UPDATE smtp_credentials SET last_used_at = NOW() WHERE id = $1', [cred.id]);
          return callback(null, {
            user: {
              credentialId: cred.id,
              mailboxId: null,
              organizationId: cred.organization_id,
              customerDomainId: cred.customer_domain_id,
              allowedFromEmail: cred.allowed_from_email,
              defaultFromName: cred.default_from_name,
            } as SmtpCredentialUser,
          });
        }

        const mailboxResult = await query<{ id: string; password_hash: string; organization_id: string; customer_domain_id: string | null; email: string; display_name: string | null; active: boolean; smtp_enabled: boolean; smtp_tier: string }>(
          `SELECT id, password_hash, organization_id, customer_domain_id, email, display_name, active, smtp_enabled, smtp_tier
           FROM mailbox_accounts WHERE LOWER(email) = LOWER($1)`,
          [auth.username]
        );
        if (mailboxResult.rows.length === 0) return callback(new Error('Authentication failed'));
        const mailbox = mailboxResult.rows[0];
        if (!mailbox.active || !mailbox.smtp_enabled) {
          await query(
            `INSERT INTO mailbox_auth_logs (mailbox_id, email, protocol, remote_addr, success, details)
             VALUES ($1, $2, 'smtp', $3, false, $4)`,
            [mailbox.id, mailbox.email, session.remoteAddress || null, 'Mailbox SMTP access is disabled']
          );
          return callback(new Error('Mailbox SMTP access is disabled'));
        }
        if (mailbox.smtp_tier && mailbox.smtp_tier !== tier) {
          await query(
            `INSERT INTO mailbox_auth_logs (mailbox_id, email, protocol, remote_addr, success, details)
             VALUES ($1, $2, 'smtp', $3, false, $4)`,
            [mailbox.id, mailbox.email, session.remoteAddress || null, `Wrong SMTP port for mailbox; requires ${mailbox.smtp_tier}`]
          );
          return callback(new Error(`Mailbox not allowed on this port (requires ${mailbox.smtp_tier} port)`));
        }

        const validMailbox = await bcrypt.compare(auth.password || '', mailbox.password_hash);
        if (!validMailbox) {
          await query(
            `INSERT INTO mailbox_auth_logs (mailbox_id, email, protocol, remote_addr, success, details)
             VALUES ($1, $2, 'smtp', $3, false, $4)`,
            [mailbox.id, mailbox.email, session.remoteAddress || null, 'Invalid SMTP password']
          );
          return callback(new Error('Authentication failed'));
        }

        await query('UPDATE mailbox_accounts SET last_login_at = NOW() WHERE id = $1', [mailbox.id]);
        await query(
          `INSERT INTO mailbox_auth_logs (mailbox_id, email, protocol, remote_addr, success, details)
           VALUES ($1, $2, 'smtp', $3, true, $4)`,
          [mailbox.id, mailbox.email, session.remoteAddress || null, `SMTP login accepted on ${tier}`]
        );
        return callback(null, {
          user: {
            credentialId: null,
            mailboxId: mailbox.id,
            organizationId: mailbox.organization_id,
            customerDomainId: mailbox.customer_domain_id,
            allowedFromEmail: mailbox.email,
            defaultFromName: mailbox.display_name,
          } as SmtpCredentialUser,
        });
      } catch {
        callback(new Error('Authentication failed'));
      }
    },

    async onData(stream: SMTPServerDataStream, session: SMTPServerSession, callback: (err?: Error | null) => void) {
      try {
        const authUser = (session as any).user as SmtpCredentialUser | undefined;
        if (!authUser) return callback(new Error('Not authenticated'));

        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk);
        const raw = Buffer.concat(chunks);
        const parsed = await simpleParser(raw);

        const fromAddr = parsed.from?.value?.[0]?.address;
        if (!fromAddr) return callback(new Error('No From address'));
        const domainPart = fromAddr.split('@')[1]?.toLowerCase();
        if (!domainPart) return callback(new Error('Invalid From address'));

        const customerDomain = await findVerifiedDomainForAddress(domainPart, authUser.organizationId);
        if (!customerDomain) {
          return callback(new Error(`530 From domain ${domainPart} is not verified for this account`));
        }
        if (authUser.customerDomainId && customerDomain.id !== authUser.customerDomainId) {
          return callback(new Error(`530 Credential is not allowed to send from ${domainPart}`));
        }
        if (authUser.allowedFromEmail && fromAddr.toLowerCase() !== authUser.allowedFromEmail.toLowerCase()) {
          return callback(new Error(`530 Credential is only allowed to send from ${authUser.allowedFromEmail}`));
        }
        const subject = parsed.subject || '(no subject)';
        const size = raw.length;
        const headerFrom = parsed.from?.value?.[0]?.name
          ? (parsed.from?.text || fromAddr)
          : formatAddressHeader(authUser.defaultFromName, fromAddr);

        const sdResult = await query<{ id: string; subdomain: string; root_domain: string; sender_name: string }>(
          `SELECT s.id, s.subdomain, d.domain as root_domain, s.sender_name
           FROM subdomains s JOIN domains d ON s.domain_id = d.id
           WHERE s.status = 'active' AND s.tier = $1 AND s.emails_sent_today < s.daily_limit
           ORDER BY RANDOM() LIMIT 1`,
          [tier]
        );
        if (sdResult.rows.length === 0) return callback(new Error('No available sending subdomains'));
        const sub = sdResult.rows[0];

        const rcptTo: string[] = [];
        if (session.envelope.rcptTo) {
          for (const r of session.envelope.rcptTo) {
            if (r && typeof r === 'object' && 'address' in r) rcptTo.push(r.address);
          }
        }

        // Skip suppressed recipients before any delivery attempt
        const supRes = rcptTo.length > 0 ? await query<{ email: string; reason: string }>(
          'SELECT email, reason FROM suppression_list WHERE LOWER(email) = ANY($1)',
          [rcptTo.map(r => r.toLowerCase())]
        ) : { rows: [] as { email: string; reason: string }[] };
        const suppressed = new Map(supRes.rows.map(r => [r.email.toLowerCase(), r.reason]));
        const activeRcpts = rcptTo.filter(r => !suppressed.has(r.toLowerCase()));
        if (suppressed.size > 0) {
          console.log(`[smtp-relay:${tier}] Skipped ${suppressed.size} suppressed recipient(s) for ${fromAddr}`);
        }

        const msgId = parsed.messageId || `<${crypto.randomUUID()}@${customerDomain.domain}>`;
        const envFromAddr = session.envelope.mailFrom && typeof session.envelope.mailFrom === 'object' ? session.envelope.mailFrom.address : fromAddr;
        const envelopeFrom = envFromAddr;
        const ip = session.remoteAddress || 'unknown';
        const helo = session.hostNameAppearsAs || 'unknown';
        const receivedHeader = `Received: from ${helo} (${ip}) by ${config.dns.heloHostname} with SMTP; ${new Date().toUTCString()}\r\n`;

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

        // Deliver to all non-suppressed recipients
        const results: { to: string; success: boolean; code: number; message: string }[] = [];

        for (const recipient of activeRcpts) {
          try {
            const mxRecords = await dns.promises.resolveMx(recipient.split('@')[1]);
            if (!mxRecords || mxRecords.length === 0) {
              results.push({ to: recipient, success: false, code: 0, message: 'No MX records' });
              continue;
            }
            mxRecords.sort((a, b) => a.priority - b.priority);

            let delivered = false;
            let lastErr: { code: number; message: string; host: string } | null = null;
            for (const mx of mxRecords) {
              let transporter: nodemailer.Transporter | null = null;
              try {
                const keyData = await getDomainDKIMPrivateKey(customerDomain.id);
                transporter = nodemailer.createTransport({
                  host: await resolveMxIpv4(mx.exchange),
                  port: 25,
                  secure: false,
                  tls: { rejectUnauthorized: false, servername: mx.exchange },
                  dkim: keyData ? {
                    domainName: customerDomain.domain,
                    keySelector: keyData.selector,
                    privateKey: keyData.privateKey,
                  } : undefined,
                });

                const info = await transporter.sendMail({
                  from: headerFrom,
                  envelope: { from: envelopeFrom, to: [recipient] },
                  to: recipient,
                  subject,
                  text: parsed.text || '',
                  html: parsed.html || undefined,
                  messageId: msgId,
                });

                results.push({ to: recipient, success: true, code: 250, message: info.response || 'OK' });
                delivered = true;
                break;
              } catch (err: any) {
                const code = typeof err?.responseCode === 'number' ? err.responseCode : 0;
                const detail = String(err?.response || err?.message || 'unknown error').replace(/\s+/g, ' ').trim();
                lastErr = { code, message: `[${mx.exchange}] ${detail}`, host: mx.exchange };
                console.error(`[smtp-relay:${tier}] DELIVERY FAIL to=${recipient} host=${mx.exchange} code=${code} :: ${detail.slice(0, 300)}`);
              } finally {
                transporter?.close();
              }
            }
            if (!delivered && lastErr) {
              results.push({ to: recipient, success: false, code: lastErr.code, message: lastErr.message });
            }
            if (!delivered && !lastErr) {
              results.push({ to: recipient, success: false, code: 0, message: 'All MX servers failed' });
            }
          } catch (err: any) {
            const code = typeof err?.responseCode === 'number' ? err.responseCode : 0;
            const detail = String(err?.message || 'delivery error');
            console.error(`[smtp-relay:${tier}] DELIVERY ERROR to=${recipient} code=${code} :: ${detail.slice(0, 300)}`);
            results.push({ to: recipient, success: false, code, message: detail });
          }
        }

        // Record in database
        const attempted = results;
        const allSuccess = attempted.length > 0 && attempted.every(r => r.success);
        const failures = attempted.filter(r => !r.success)
          .map(r => `${r.to}: [${r.code}] ${r.message}`)
          .join(' | ')
          .slice(0, 4000);
        const suppressionNotes = Array.from(suppressed.entries())
          .map(([email, reason]) => `${email}: suppressed (${reason})`)
          .join(' | ')
          .slice(0, 2000);
        const finalStatus = attempted.length === 0 ? 'suppressed' : (allSuccess ? 'accepted' : 'failed');
        const bounceText = [
          failures,
          suppressionNotes ? `suppressed: ${suppressionNotes}` : '',
        ].filter(Boolean).join(' | ').slice(0, 4000);

        const smResult = await query<{ id: string }>(
          `INSERT INTO sent_messages (organization_id, credential_id, customer_domain_id, subdomain_id, mail_from, rcpt_to, subject, body_html, body_text, raw_headers, size, status, message_id, bounce)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
          [
            authUser.organizationId, authUser.credentialId, customerDomain.id, sub.id,
            fromAddr, rcptTo.join(', '), subject,
            parsed.html || '', parsed.text || '',
            JSON.stringify(parsed.headers || {}), size,
            finalStatus,
            msgId,
            bounceText,
          ]
        );
        const smId = smResult.rows[0].id;

        for (const r of results) {
          await query(
            `INSERT INTO delivery_attempts (sent_message_id, organization_id, rcpt_to, status, smtp_code, details)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [smId, authUser.organizationId, r.to, r.success ? 'accepted' : 'failed', r.code, r.message.slice(0, 1000)]
          );

          // Auto-suppress permanent recipient failures so future campaigns skip them
          if (!r.success && isHardBounce(r.code, r.message)) {
            console.warn(`[smtp-relay:${tier}] HARD BOUNCE — suppressing ${r.to} :: [${r.code}] ${r.message.slice(0, 150)}`);
            await query(
              `INSERT INTO suppression_list (email, reason)
               VALUES ($1, $2)
               ON CONFLICT (email) DO NOTHING`,
              [r.to.toLowerCase(), `hard_bounce: [${r.code}] ${r.message}`.slice(0, 50)]
            );
          }
        }

        for (const [email] of suppressed) {
          await query(
            `INSERT INTO delivery_attempts (sent_message_id, organization_id, rcpt_to, status, smtp_code, details)
             VALUES ($1, $2, $3, 'suppressed', 0, $4)`,
            [smId, authUser.organizationId, email, `Suppressed: ${suppressed.get(email) || 'listed'}`.slice(0, 1000)]
          );
        }

        // Count pool usage only when a real delivery attempt happened
        if (attempted.length > 0) {
          await query(
            'UPDATE subdomains SET emails_sent_today = emails_sent_today + 1, total_sent = total_sent + 1 WHERE id = $1',
            [sub.id]
          );

          await query(
            `INSERT INTO subdomain_pool_tracking (subdomain_id, organization_id, last_used_at, total_assigned)
             VALUES ($1, $2, NOW(), 1)
             ON CONFLICT (subdomain_id, organization_id)
             DO UPDATE SET last_used_at = NOW(), total_assigned = subdomain_pool_tracking.total_assigned + 1`,
            [sub.id, authUser.organizationId]
          );
        }

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
