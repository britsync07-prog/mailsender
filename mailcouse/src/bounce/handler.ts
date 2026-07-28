import { SMTPServer } from 'smtp-server';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

const pool = new Pool({
  host: 'localhost', port: 5433, database: 'mailcouse',
  user: 'mailcouse', password: 'postgres', max: 5,
});

const WARMUP_STORE = '/tmp/warmup_mail_store';

function classifyBounce(status: number | undefined, diagnostic: string | undefined): string {
  if (!status && !diagnostic) return 'unknown';
  const msg = (diagnostic || '').toLowerCase() + String(status || '');
  if (status === 550 || msg.includes('user unknown') || msg.includes('does not exist') ||
      msg.includes('no such user') || msg.includes('invalid recipient') ||
      msg.includes('mailbox not found') || msg.includes('address rejected') ||
      msg.includes('550 5.1.1') || msg.includes('551') || msg.includes('553') || msg.includes('554'))
    return 'hard_bounce';
  if (status === 552 || msg.includes('mailbox full') || msg.includes('452 4.2.2') ||
      msg.includes('over quota'))
    return 'mailbox_full';
  if (msg.includes('spam') || msg.includes('blocked') || msg.includes('rejected') ||
      msg.includes('5.7.1') || msg.includes('5.7.26'))
    return 'policy_block';
  if (status === 421 || status === 450 || status === 451 || status === 452 ||
      msg.includes('try again') || msg.includes('temporarily'))
    return 'soft_bounce';
  return 'hard_bounce';
}

const server = new SMTPServer({
  name: 'bounce-handler',
  banner: 'Bounce Handler Ready',
  disabledCommands: ['STARTTLS', 'AUTH'],
  onData(stream, session, callback) {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', async () => {
      const rawEmail = Buffer.concat(chunks).toString('utf8');
      const rawLower = rawEmail.toLowerCase();
      const toMatch = rawEmail.match(/^To:\s*(.+)$/im);
      const recipient = toMatch ? toMatch[1].trim().replace(/<|>/g, '').toLowerCase() : '';

      const isWarmup = await pool.query(
        'SELECT id, mailbox_name FROM warmup_partners WHERE LOWER(email) = $1 AND status = $2',
        [recipient, 'active']
      );

      if (isWarmup.rows.length > 0) {
        const partner = isWarmup.rows[0];
        const mailFrom = session.envelope.mailFrom;
        const fromAddr = typeof mailFrom === 'object' ? mailFrom.address?.toLowerCase() : '';

        const msgId = randomUUID();
        const storeDir = path.join(WARMUP_STORE, partner.mailbox_name);
        fs.mkdirSync(storeDir, { recursive: true });
        fs.writeFileSync(path.join(storeDir, `${msgId}.eml`), rawEmail);

        const senderDomain = fromAddr ? fromAddr.split('@')[1] : '';
        let subdomainId: string | null = null;
        if (senderDomain) {
          const subRes = await pool.query(
            'SELECT id FROM subdomains WHERE subdomain = $1 LIMIT 1',
            [senderDomain]
          );
          if (subRes.rows.length > 0) subdomainId = subRes.rows[0].id;
        }

        await pool.query(
          `INSERT INTO warmup_conversations
           (partner_id, subdomain_id, direction, subject, message_id, sent_at, delivered)
           VALUES ($1, $2, 'inbound', $3, $4, NOW(), true)`,
          [partner.id, subdomainId, '', msgId]
        );

        callback();
        return;
      }

      let bounceType = 'unknown';
      let smtpCode = 0;
      let diagnostic = '';
      let originalRcpt = '';

      const statusMatch = rawEmail.match(/Status:\s*(\d+\.\d+\.\d+)/);
      const diagMatch = rawEmail.match(/Diagnostic-Code:\s*([^\r\n]+)/i);
      const rcptMatch = rawEmail.match(/Original-Recipient:\s*(?:rfc822;)?\s*(\S+)/i);
      if (diagMatch) {
        diagnostic = diagMatch[1].trim();
        const diagCodeMatch = diagnostic.match(/\b(\d{3})\b/);
        if (diagCodeMatch) smtpCode = parseInt(diagCodeMatch[1]);
      }
      if (!smtpCode && statusMatch) smtpCode = parseInt(statusMatch[1].split('.')[0]);
      if (rcptMatch) originalRcpt = rcptMatch[1];

      const mailFrom = session.envelope.mailFrom;
      let bounceRcpt = originalRcpt
        || (typeof mailFrom === 'object' ? mailFrom.address : '')
        || recipient
        || '';

      const subjMatch = rawEmail.match(/^Subject:\s*(.+)$/im);
      const subject = subjMatch ? subjMatch[1] : '';

      if (!smtpCode) {
        for (const code of ['550', '551', '552', '553', '554', '450', '451', '452', '421']) {
          if (rawLower.includes(` ${code} `) || rawLower.includes(`${code} 5.`)) {
            smtpCode = parseInt(code);
            break;
          }
        }
      }

      bounceType = classifyBounce(smtpCode, diagnostic || rawLower);
      const rcpt = bounceRcpt.toLowerCase();

      try {
        await pool.query(
          `INSERT INTO bounce_events (recipient, bounce_type, smtp_code, diagnostic_code, message)
           VALUES ($1, $2, $3, $4, $5)`,
          [rcpt, bounceType, smtpCode, diagnostic || subject, rawEmail.slice(0, 1000)]
        );

        if (bounceType === 'hard_bounce' || bounceType === 'policy_block' || bounceType === 'mailbox_full') {
          await pool.query(
            `INSERT INTO suppression_list (email, reason)
             VALUES ($1, $2) ON CONFLICT (email) DO NOTHING`,
            [rcpt, bounceType]
          );
        }
      } catch {}
      callback();
    });
  },
});

export function startBounceHandler(port: number = 2525): void {
  fs.mkdirSync(WARMUP_STORE, { recursive: true });
  server.listen(port, '0.0.0.0', () => {
    console.log(`Bounce handler listening on port ${port}`);
  });
}

export function stopBounceHandler(): void {
  server.close();
}