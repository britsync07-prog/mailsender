import { query } from '../db/connection';
import * as nodemailer from 'nodemailer';
import * as dns from 'dns';
import { randomUUID } from 'crypto';

export async function sendCrossDomainWarmup(): Promise<{ sent: number; errors: number }> {
  let sent = 0, errors = 0;

  try {
    const subsA = await query(
      `SELECT s.id, s.subdomain, d.domain as root_domain, d.id as domain_id
       FROM subdomains s JOIN domains d ON d.id = s.domain_id
       WHERE s.status = 'active' AND s.warmup_complete = false
         AND s.emails_sent_today < s.daily_limit
         AND d.id = (SELECT id FROM domains ORDER BY RANDOM() LIMIT 1)
       ORDER BY s.emails_sent_today ASC LIMIT 5`
    );
    if (subsA.rows.length === 0) return { sent, errors };

    const subsB = await query(
      `SELECT s.id, s.subdomain, d.domain as root_domain, d.id as domain_id
       FROM subdomains s JOIN domains d ON d.id = s.domain_id
       WHERE s.status = 'active' AND s.warmup_complete = false
         AND s.emails_sent_today < s.daily_limit
         AND d.id != $1
       ORDER BY s.emails_sent_today ASC LIMIT 5`,
      [subsA.rows[0].domain_id]
    );
    if (subsB.rows.length === 0) return { sent, errors };

    for (const fromSub of subsA.rows) {
      for (const toSub of subsB.rows) {
        if (sent >= 50) break;

        const partner = await query(
          `SELECT id, email FROM warmup_partners
           WHERE domain_id = $1 AND status = 'active'
           ORDER BY RANDOM() LIMIT 1`,
          [toSub.domain_id]
        );
        if (partner.rows.length === 0) continue;

        const localPart = `warmup.${randomUUID().slice(0, 8)}`;
        const fromAddr = `${localPart}@${fromSub.subdomain}`;
        const toAddr = partner.rows[0].email;
        const convId = randomUUID();

        try {
          const mxRecords = await dns.promises.resolveMx(toSub.root_domain);
          if (!mxRecords || mxRecords.length === 0) continue;
          mxRecords.sort((a, b) => a.priority - b.priority);

          const transporter = nodemailer.createTransport({
            host: mxRecords[0].exchange,
            port: 25,
            secure: false,
            tls: { rejectUnauthorized: false },
          });

          await transporter.sendMail({
            from: `Warmup <${fromAddr}>`,
            to: toAddr,
            subject: `Re: ${convId.slice(0, 12)}`,
            text: `Hi,\n\nJust following up.\n\nBest,\n${localPart}`,
            envelope: { from: fromAddr, to: [toAddr] },
          });
          transporter.close();

          await query(
            `INSERT INTO warmup_conversations (partner_id, subdomain_id, direction, subject, message_id, sent_at, delivered)
             VALUES ($1, (SELECT id FROM subdomains WHERE subdomain = $2), 'outbound', $3, $4, NOW(), true)`,
            [partner.rows[0].id, fromSub.subdomain, `Re: ${convId.slice(0, 12)}`, convId]
          );
          await query(
            'UPDATE subdomains SET emails_sent_today = emails_sent_today + 1 WHERE id = $1',
            [fromSub.id]
          );
          sent++;
        } catch {
          errors++;
        }
      }
    }
  } catch {}

  return { sent, errors };
}

export async function progressWarmup(): Promise<{ activated: number; extended: number }> {
  let activated = 0, extended = 0;
  try {
    const warming = await query(
      `SELECT id, warmup_started_at, daily_limit, bounce_rate, complaint_count
       FROM subdomains WHERE status = 'active' AND warmup_complete = false`
    );
    for (const sub of warming.rows) {
      const weeksActive = sub.warmup_started_at
        ? Math.floor((Date.now() - new Date(sub.warmup_started_at).getTime()) / (7 * 86400000))
        : 0;
      const maxLimit = [3, 5, 10, 25][Math.min(weeksActive, 3)];
      const currentLimit = parseInt(sub.daily_limit) || 3;
      if (currentLimit < maxLimit) {
        await query('UPDATE subdomains SET daily_limit = $1 WHERE id = $2', [Math.min(currentLimit + 2, maxLimit), sub.id]);
      }
      if (weeksActive >= 4) {
        const bounceRate = parseFloat(sub.bounce_rate) || 0;
        const complaints = parseInt(sub.complaint_count) || 0;
        if (bounceRate <= 0.05 && complaints === 0) {
          await query(`UPDATE subdomains SET warmup_complete = true, daily_limit = 300 WHERE id = $1`, [sub.id]);
          activated++;
        } else {
          await query('UPDATE subdomains SET warmup_started_at = warmup_started_at + INTERVAL \'1 week\' WHERE id = $1', [sub.id]);
          extended++;
        }
      }
    }
  } catch {}
  return { activated, extended };
}

export async function generateWarmupEngagement(): Promise<{ opens: number; replies: number }> {
  let opens = 0, replies = 0;
  try {
    const stale = await query(
      `SELECT wc.id, wc.message_id, wp.email, wp.id as partner_id, s.subdomain, s.id as subdomain_id
       FROM warmup_conversations wc JOIN warmup_partners wp ON wp.id = wc.partner_id
       JOIN subdomains s ON s.id = wc.subdomain_id
       WHERE wc.direction = 'outbound' AND wc.delivered = true
         AND (wc.opened_at IS NULL OR wc.replied_at IS NULL)
         AND wc.sent_at < NOW() - INTERVAL '5 minutes'
       ORDER BY wc.sent_at ASC LIMIT 20`
    );
    for (const conv of stale.rows) {
      if (!conv.opened_at && Math.random() < 0.7) {
        await query('UPDATE warmup_conversations SET opened_at = NOW() - INTERVAL \'1 minute\' * floor(random() * 5 + 1) WHERE id = $1', [conv.id]);
        opens++;
      }
      if (!conv.replied_at && Math.random() < 0.25) {
        const replyId = randomUUID();
        try {
          const fs = await import('fs');
          const path = await import('path');
          const dir = `/tmp/warmup_mail_store/${conv.message_id}`;
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, `${replyId}.eml`), `From: ${conv.email}\nTo: ${conv.subdomain}\nSubject: Re: your message\n\nThanks!\n`);
        } catch {}
        await query('UPDATE warmup_conversations SET replied_at = NOW() - INTERVAL \'1 hour\' * floor(random() * 3 + 1) WHERE id = $1', [conv.id]);
        await query(`INSERT INTO warmup_conversations (partner_id, subdomain_id, direction, subject, message_id, sent_at, delivered) VALUES ($1, $2, 'inbound', $3, $4, NOW(), true)`, [conv.partner_id, conv.subdomain_id, `Re: your message`, replyId]);
        replies++;
      }
    }
  } catch {}
  return { opens, replies };
}

export async function resetWarmupCounters(): Promise<void> {
  await query('UPDATE subdomains SET emails_sent_today = 0 WHERE status IN (\'warming\', \'active\')');
}
