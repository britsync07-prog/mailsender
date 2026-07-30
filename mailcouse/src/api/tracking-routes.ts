import { Router, Request, Response } from 'express';
import { query } from '../db/connection';

const router = Router();

const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

router.get('/open/:leadId.png', async (req: Request, res: Response) => {
  const { leadId } = req.params;
  try {
    await query(
      `INSERT INTO engagement_events (lead_id, event_type, event_data)
       VALUES ($1, 'open', $2)`,
      [leadId, JSON.stringify({
        ip: req.ip,
        ua: req.headers['user-agent'] || '',
        time: new Date().toISOString(),
      })]
    );
    await query(
      'UPDATE leads SET open_count = open_count + 1 WHERE id = $1',
      [leadId]
    );
  } catch {}
  res.writeHead(200, {
    'Content-Type': 'image/gif',
    'Content-Length': PIXEL.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
  });
  res.end(PIXEL);
});

router.get('/click/:leadId', async (req: Request, res: Response) => {
  const { leadId } = req.params;
  const url = req.query.url as string || '/';
  try {
    await query(
      `INSERT INTO engagement_events (lead_id, event_type, event_data)
       VALUES ($1, 'click', $2)`,
      [leadId, JSON.stringify({
        ip: req.ip,
        ua: req.headers['user-agent'] || '',
        url,
        time: new Date().toISOString(),
      })]
    );
    await query(
      'UPDATE leads SET click_count = click_count + 1 WHERE id = $1',
      [leadId]
    );
  } catch {}
  res.redirect(302, url);
});

router.get('/unsubscribe/:leadId', async (req: Request, res: Response) => {
  const { leadId } = req.params;
  try {
    const lead = await query('SELECT email FROM leads WHERE id = $1', [leadId]);
    if (lead.rows.length > 0) {
      await query(
        `INSERT INTO suppression_list (email, reason)
         VALUES ($1, 'unsubscribe') ON CONFLICT (email) DO NOTHING`,
        [lead.rows[0].email]
      );
      await query(
        "UPDATE leads SET status = 'unsubscribed', unsubscribed_at = NOW() WHERE id = $1",
        [leadId]
      );
    }
  } catch {}
  res.type('html').send('<h1>Unsubscribed</h1><p>You have been unsubscribed from future emails.</p>');
});

router.post('/reply', async (req: Request, res: Response) => {
  const { from, subject, body, message_id, to } = req.body;
  if (!from) return res.status(400).json({ error: 'from required' });
  try {
    const lead = await query(
      'SELECT id FROM leads WHERE email = $1 LIMIT 1',
      [from.toLowerCase()]
    );
    if (lead.rows.length === 0) return res.status(404).json({ error: 'lead not found' });

    let subId = null;
    if (message_id) {
      const msg = await query(
        'SELECT subdomain_id FROM sent_messages WHERE message_id = $1 LIMIT 1',
        [message_id]
      );
      if (msg.rows.length > 0) subId = msg.rows[0].subdomain_id;
    }

    let classification = 'reply';
    const lowerSubj = (subject || '').toLowerCase();
    if (lowerSubj.includes('out of office') || lowerSubj.includes('automatic reply') ||
        lowerSubj.includes('vacation') || lowerSubj.includes('away from')) {
      classification = 'auto_reply';
    } else if (lowerSubj.startsWith('re:')) {
      classification = 'human_reply';
    }

    await query(
      `INSERT INTO reply_events (lead_id, subdomain_id, message_id, subject, body, from_address, classification)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [lead.rows[0].id, subId, message_id || null, subject || '', body || '', from, classification]
    );

    if (classification === 'human_reply') {
      await query(
        'UPDATE leads SET reply_count = reply_count + 1, replied_at = NOW() WHERE id = $1',
        [lead.rows[0].id]
      );
      await query(
        'UPDATE subdomains SET reply_count = reply_count + 1 WHERE id = $1',
        [subId]
      );
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/unsubscribe/:leadId', async (req: Request, res: Response) => {
  const { leadId } = req.params;
  try {
    const lead = await query('SELECT email FROM leads WHERE id = $1', [leadId]);
    if (lead.rows.length > 0) {
      await query(
        `INSERT INTO suppression_list (email, reason)
         VALUES ($1, 'unsubscribe') ON CONFLICT (email) DO NOTHING`,
        [lead.rows[0].email]
      );
      await query(
        "UPDATE leads SET status = 'unsubscribed', unsubscribed_at = NOW() WHERE id = $1",
        [leadId]
      );
    }
  } catch {}
  res.status(200).send('OK');
});

export default router;
