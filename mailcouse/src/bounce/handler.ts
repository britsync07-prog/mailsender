import { SMTPServer } from 'smtp-server';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { query, getPool } from '../db/connection';
import { appendMessage, normalizeMailboxEmail } from '../imap/mailbox-store';

const WARMUP_STORE = '/tmp/warmup_mail_store';

async function deliverToLocalMailboxes(recipients: string[], rawEmail: string): Promise<number> {
  let delivered = 0;
  for (const recipient of recipients.map(normalizeMailboxEmail).filter(Boolean)) {
    const result = await query<{ id: string }>(
      `SELECT ma.id
       FROM mailbox_accounts ma
       WHERE LOWER(ma.email) = $1 AND ma.active = true
       UNION
       SELECT ma.id
       FROM mailbox_aliases a
       JOIN mailbox_accounts ma ON ma.id = a.mailbox_id
       WHERE LOWER(a.address) = $1 AND a.active = true AND ma.active = true`,
      [recipient]
    );
    for (const row of result.rows) {
      await appendMessage({ mailboxId: row.id, folderName: 'INBOX', rawSource: rawEmail, flags: [] });
      delivered++;
    }
  }
  return delivered;
}

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
      const envelopeRecipients = (session.envelope.rcptTo || [])
        .map((r: any) => typeof r === 'object' ? r.address : String(r || ''))
        .filter(Boolean);
      const localRecipients = envelopeRecipients.length > 0 ? envelopeRecipients : [recipient].filter(Boolean);

      try {
        const localDelivered = await deliverToLocalMailboxes(localRecipients, rawEmail);
        if (localDelivered > 0) {
          callback();
          return;
        }
      } catch (err) {
        console.error('Local mailbox delivery failed:', err);
      }

      const isWarmup = await query(
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
          const subRes = await query(
            'SELECT id FROM subdomains WHERE subdomain = $1 LIMIT 1',
            [senderDomain]
          );
          if (subRes.rows.length > 0) subdomainId = subRes.rows[0].id;
        }

        await query(
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
        await query(
          `INSERT INTO bounce_events (recipient, bounce_type, smtp_code, diagnostic_code, message)
           VALUES ($1, $2, $3, $4, $5)`,
          [rcpt, bounceType, smtpCode, diagnostic || subject, rawEmail.slice(0, 1000)]
        );

        if (bounceType === 'hard_bounce' || bounceType === 'policy_block' || bounceType === 'mailbox_full') {
          await query(
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
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
      console.error(`Bounce handler error on port ${port}: ${err.code}`);
      return;
    }
    console.error('Bounce handler error:', err);
  });
  server.listen(port, '0.0.0.0', () => {
    console.log(`Bounce handler listening on port ${port}`);
  });
}

export function stopBounceHandler(): void {
  server.close();
}

// ─── Exported API (for tests and programmatic use) ───

interface BounceResult {
  processed: boolean;
  bounce_type?: string;
  suppressed?: boolean;
  error?: string;
}

interface BatchResult {
  total: number;
  processed: number;
  suppressed: number;
  results: BounceResult[];
}

interface BounceStats {
  total_bounces: number;
  bounce_rate_7d: number;
  types: { bounce_type: string; count: string }[];
  recent: any[];
}

export async function processBounce(rawEmail: string): Promise<BounceResult> {
  try {
    const rawLower = rawEmail.toLowerCase();

    const statusMatch = rawEmail.match(/Status:\s*(\d+\.\d+\.\d+)/);
    const diagMatch = rawEmail.match(/Diagnostic-Code:\s*([^\r\n]+)/i);
    const rcptMatch = rawEmail.match(/Original-Recipient:\s*(?:rfc822;)?\s*(\S+)/i);
    const toMatch = rawEmail.match(/^To:\s*(.+)$/im);

    let smtpCode = 0;
    let diagnostic = '';
    let originalRcpt = '';

    if (diagMatch) {
      diagnostic = diagMatch[1].trim();
      const diagCodeMatch = diagnostic.match(/\b(\d{3})\b/);
      if (diagCodeMatch) smtpCode = parseInt(diagCodeMatch[1]);
    }
    if (!smtpCode && statusMatch) smtpCode = parseInt(statusMatch[1].split('.')[0]);
    if (rcptMatch) originalRcpt = rcptMatch[1];

    const recipient = originalRcpt || (toMatch ? toMatch[1].trim().replace(/<|>/g, '').toLowerCase() : '');

    if (!recipient) {
      return { processed: false, error: 'Failed to parse - no recipient found' };
    }

    if (!smtpCode) {
      for (const code of ['550', '551', '552', '553', '554', '450', '451', '452', '421']) {
        if (rawLower.includes(` ${code} `) || rawLower.includes(`${code} 5.`)) {
          smtpCode = parseInt(code);
          break;
        }
      }
    }

    const bounceType = classifyBounce(smtpCode, diagnostic || rawLower);
    const rcpt = recipient.toLowerCase();

    await query(
      `INSERT INTO bounce_events (recipient, bounce_type, smtp_code, diagnostic_code, message)
       VALUES ($1, $2, $3, $4, $5)`,
      [rcpt, bounceType, smtpCode, diagnostic || '', rawEmail.slice(0, 1000)]
    );

    const shouldSuppress = bounceType === 'hard_bounce' || bounceType === 'policy_block' || bounceType === 'mailbox_full';
    if (shouldSuppress) {
      await query(
        `INSERT INTO suppression_list (email, reason) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING`,
        [rcpt, bounceType]
      );
    }

    return { processed: true, bounce_type: bounceType, suppressed: shouldSuppress };
  } catch (err: any) {
    return { processed: false, error: err.message || 'Failed to parse bounce' };
  }
}

export async function processBounceBatch(batch: { message: string }[]): Promise<BatchResult> {
  const results = await Promise.all(batch.map(b => processBounce(b.message)));
  return {
    total: batch.length,
    processed: results.filter(r => r.processed).length,
    suppressed: results.filter(r => r.suppressed).length,
    results,
  };
}

export async function getBounceStats(): Promise<BounceStats> {
  const totalResult = await query('SELECT COUNT(*) as count FROM bounce_events');
  const typesResult = await query(
    'SELECT bounce_type, COUNT(*)::text as count FROM bounce_events GROUP BY bounce_type'
  );
  const rateResult = await query(
    `SELECT COUNT(*)::int as total,
            SUM(CASE WHEN bounce_type IN ('hard_bounce','soft_bounce') THEN 1 ELSE 0 END)::int as bounced
     FROM bounce_events WHERE timestamp > NOW() - INTERVAL '7 days'`
  );
  const recentResult = await query(
    'SELECT * FROM bounce_events ORDER BY timestamp DESC LIMIT 20'
  );

  const total = parseInt(totalResult.rows[0]?.count || '0');
  const rateRow = rateResult.rows[0] || { total: 0, bounced: 0 };
  const bounceRate = rateRow.total > 0 ? rateRow.bounced / rateRow.total : 0;

  return {
    total_bounces: total,
    bounce_rate_7d: parseFloat(bounceRate.toFixed(4)),
    types: typesResult.rows,
    recent: recentResult.rows,
  };
}

export async function getBounceHandlerPool() {
  return getPool();
}

export { classifyBounce };
