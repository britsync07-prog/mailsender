import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import * as dns from 'dns';
import * as nodemailer from 'nodemailer';
import { randomUUID } from 'crypto';
import { getDKIMPrivateKey } from '../dkim/key-store';
import { checkWarmupGate } from '../warmup/gate';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const { to, subject, body, from_name, tier } = req.body;
    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'to, subject, and body required' });
    }

    const pool = new Pool({
      host: 'localhost', port: 5433, database: 'mailcouse',
      user: 'mailcouse', password: 'postgres',
      max: 2, connectionTimeoutMillis: 5000,
    });

    const validTier = ['mass_mail', 'personal', 'transactional'].includes(tier) ? tier : 'mass_mail';

    const dbResult = await pool.query(
      `SELECT s.id, s.subdomain, s.sender_name, d.domain as root_domain
       FROM subdomains s JOIN domains d ON s.domain_id = d.id
       WHERE s.status = 'active' AND s.tier = $1 AND s.emails_sent_today < s.daily_limit
       ORDER BY s.emails_sent_today ASC LIMIT 1`,
      [validTier]
    );

    if (dbResult.rows.length === 0) {
      await pool.end();
      return res.status(503).json({ error: 'No available subdomains for tier ' + validTier });
    }

    const sub = dbResult.rows[0];

    const gate = await checkWarmupGate(sub.id);
    if (!gate.passed) {
      await pool.end();
      return res.status(503).json({ error: 'Subdomain not through warmup', reason: gate.reason });
    }

    const senderName = from_name || sub.sender_name;
    const localPart = senderName.replace(/\s+/g, '.').toLowerCase();

    const envelopeFrom = `${localPart}@${sub.root_domain}`;
    const headerFrom = `${senderName} <${localPart}@${sub.root_domain}>`;
    const msgId = `<${randomUUID()}@${sub.subdomain}>`;

    const mxRecords = await dns.promises.resolveMx(to.split('@')[1]);
    if (!mxRecords || mxRecords.length === 0) {
      await pool.end();
      return res.status(502).json({ error: 'No MX records' });
    }
    mxRecords.sort((a, b) => a.priority - b.priority);

    const keyData = await getDKIMPrivateKey(sub.id);

    const suppressPool = new Pool({
      host: 'localhost', port: 5433, database: 'mailcouse',
      user: 'mailcouse', password: 'postgres', max: 1,
    });
    const supCheck = await suppressPool.query(
      'SELECT reason FROM suppression_list WHERE email = $1',
      [to.toLowerCase()]
    );
    await suppressPool.end();
    if (supCheck.rows.length > 0) {
      await pool.end();
      return res.status(403).json({
        success: false, error: `Recipient suppressed: ${supCheck.rows[0].reason}`,
        from: headerFrom, envelope_from: envelopeFrom, subdomain: sub.subdomain,
        dkim: keyData ? 'signed' : 'unsigned', duration_ms: Date.now() - startTime,
      });
    }

    let lastError = '';

    for (const mx of mxRecords) {
      try {
        const transporter = nodemailer.createTransport({
          host: mx.exchange,
          port: 25,
          secure: false,
          tls: { rejectUnauthorized: false },
          dkim: keyData ? {
            domainName: sub.root_domain,
            keySelector: keyData.selector,
            privateKey: keyData.privateKey,
          } : undefined,
        });

        const leadPool = new Pool({
          host: 'localhost', port: 5433, database: 'mailcouse',
          user: 'mailcouse', password: 'postgres', max: 1,
        });
        const leadRes = await leadPool.query(
          `INSERT INTO leads (email, first_name) VALUES ($1, $2)
           ON CONFLICT (email) DO UPDATE SET send_count = leads.send_count + 1, last_sent_at = NOW()
           RETURNING id`,
          [to.toLowerCase(), (req.body.to_name || '').split(' ')[0]]
        );
        const leadId = leadRes.rows[0].id;
        await leadPool.query(
          `INSERT INTO sent_messages
           (organization_id, subdomain_id, mail_from, rcpt_to, subject, message_id, status, sent_at)
           VALUES ((SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1), $1, $2, $3, $4, $5, 'sent', NOW())`,
          [sub.id, envelopeFrom, to.toLowerCase(), subject, msgId]
        );
        await leadPool.query(
          'UPDATE leads SET send_count = send_count + 1 WHERE id = $1',
          [leadId]
        );
        await leadPool.end();

        const trackingUrl = `http://${req.hostname}`;
        const trackerGif = `${trackingUrl}/track/open/${leadId}.png`;
        const unsubscribeUrl = `${trackingUrl}/track/unsubscribe/${leadId}`;
        const htmlBody = `<html><body>
${body.replace(/\n/g, '<br>\n')}
<br><br>
<img src="${trackerGif}" width="1" height="1" alt="" style="display:none;">
<p style="font-size:12px;color:#999">
<a href="${unsubscribeUrl}">Unsubscribe</a>
</p>
</body></html>`;

        const info = await transporter.sendMail({
          from: headerFrom,
          envelope: { from: envelopeFrom, to: [to] },
          to,
          subject,
          text: body,
          html: htmlBody,
          messageId: msgId,
          headers: {
            'List-Unsubscribe': `<mailto:unsubscribe@${sub.root_domain}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        });

        transporter.close();

        await pool.query(
          `UPDATE subdomains SET emails_sent_today = emails_sent_today + 1, total_sent = total_sent + 1 WHERE id = $1`,
          [sub.id]
        );
        await pool.end();

        return res.json({
          success: true, response_message: info.response,
          from: headerFrom, envelope_from: envelopeFrom, subdomain: sub.subdomain,
          dkim: keyData ? 'signed' : 'unsigned',
          tier: validTier,
          via_mx: mx.exchange, duration_ms: Date.now() - startTime,
        });
      } catch (err: any) {
        lastError = err.message || err.code || String(err);
        if (lastError.includes('ENOTFOUND')) break;
      }
    }

    await pool.end();
    return res.status(502).json({
      success: false, error: lastError || 'All MX servers failed',
      from: headerFrom, envelope_from: envelopeFrom, subdomain: sub.subdomain,
      dkim: keyData ? 'signed' : 'unsigned',
      duration_ms: Date.now() - startTime,
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'Send failed', message: error.message || 'Unknown error',
      duration_ms: Date.now() - startTime,
    });
  }
});

export default router;