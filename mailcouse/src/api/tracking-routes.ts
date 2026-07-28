import { Router, Request, Response } from 'express';
import { Pool } from 'pg';

const router = Router();

const pool = new Pool({
  host: 'localhost', port: 5433, database: 'mailcouse',
  user: 'mailcouse', password: 'postgres', max: 5,
});

// 1x1 transparent GIF pixel
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

// Open tracking: GET /track/open/:leadId.png
router.get('/open/:leadId.png', async (req: Request, res: Response) => {
  const { leadId } = req.params;
  try {
    await pool.query(
      `INSERT INTO engagement_events (lead_id, event_type, event_data)
       VALUES ($1, 'open', $2)`,
      [leadId, JSON.stringify({
        ip: req.ip,
        ua: req.headers['user-agent'] || '',
        time: new Date().toISOString(),
      })]
    );
    await pool.query(
      'UPDATE leads SET open_count = open_count + 1 WHERE id = $1',
      [leadId]
    );
    await pool.query(
      `UPDATE subdomains s SET open_count = open_count + 1
       FROM engagement_events e
       WHERE e.lead_id = $1 AND e.subdomain_id = s.id`,
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

// Click tracking: GET /track/click/:leadId?url=...
router.get('/click/:leadId', async (req: Request, res: Response) => {
  const { leadId } = req.params;
  const url = req.query.url as string || '/';
  try {
    await pool.query(
      `INSERT INTO engagement_events (lead_id, event_type, event_data)
       VALUES ($1, 'click', $2)`,
      [leadId, JSON.stringify({
        ip: req.ip,
        ua: req.headers['user-agent'] || '',
        url,
        time: new Date().toISOString(),
      })]
    );
    await pool.query(
      'UPDATE leads SET click_count = click_count + 1 WHERE id = $1',
      [leadId]
    );
  } catch {}
  res.redirect(302, url);
});

// Unsubscribe: GET /track/unsubscribe/:leadId
router.get('/unsubscribe/:leadId', async (req: Request, res: Response) => {
  const { leadId } = req.params;
  try {
    const lead = await pool.query('SELECT email FROM leads WHERE id = $1', [leadId]);
    if (lead.rows.length > 0) {
      await pool.query(
        `INSERT INTO suppression_list (email, reason)
         VALUES ($1, 'unsubscribe') ON CONFLICT (email) DO NOTHING`,
        [lead.rows[0].email]
      );
      await pool.query(
        "UPDATE leads SET status = 'unsubscribed', unsubscribed_at = NOW() WHERE id = $1",
        [leadId]
      );
    }
  } catch {}
  res.type('html').send(`<h1>Unsubscribed</h1><p>You have been unsubscribed from future emails.</p>`);
});

// Reply webhook — POST /track/reply
// External services (e.g., Postal webhook, custom IMAP checker) POST reply data here
router.post('/reply', async (req: Request, res: Response) => {
  const { from, subject, body, message_id, to } = req.body;
  if (!from) return res.status(400).json({ error: 'from required' });
  try {
    // Find the lead by email
    const lead = await pool.query(
      'SELECT id FROM leads WHERE email = $1 LIMIT 1',
      [from.toLowerCase()]
    );
    if (lead.rows.length === 0) return res.status(404).json({ error: 'lead not found' });

    // Find the subdomain from the original sent message
    let subId = null;
    if (message_id) {
      const msg = await pool.query(
        'SELECT subdomain_id FROM sent_messages WHERE message_id = $1 LIMIT 1',
        [message_id]
      );
      if (msg.rows.length > 0) subId = msg.rows[0].subdomain_id;
    }

    // Auto-classify reply type
    let classification = 'reply';
    const lowerSubj = (subject || '').toLowerCase();
    if (lowerSubj.includes('out of office') || lowerSubj.includes('automatic reply') ||
        lowerSubj.includes('vacation') || lowerSubj.includes('away from')) {
      classification = 'auto_reply';
    } else if (lowerSubj.startsWith('re:')) {
      classification = 'human_reply';
    }

    await pool.query(
      `INSERT INTO reply_events (lead_id, subdomain_id, message_id, subject, body, from_address, classification)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [lead.rows[0].id, subId, message_id || null, subject || '', body || '', from, classification]
    );

    // Update lead reply count
    if (classification === 'human_reply') {
      await pool.query(
        'UPDATE leads SET reply_count = reply_count + 1, replied_at = NOW() WHERE id = $1',
        [lead.rows[0].id]
      );
      await pool.query(
        'UPDATE subdomains SET reply_count = reply_count + 1 WHERE id = $1',
        [subId]
      );
    }

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 1-click unsubscribe (RFC 8058): POST /track/unsubscribe/:leadId
router.post('/unsubscribe/:leadId', async (req: Request, res: Response) => {
  const { leadId } = req.params;
  try {
    const lead = await pool.query('SELECT email FROM leads WHERE id = $1', [leadId]);
    if (lead.rows.length > 0) {
      await pool.query(
        `INSERT INTO suppression_list (email, reason)
         VALUES ($1, 'unsubscribe') ON CONFLICT (email) DO NOTHING`,
        [lead.rows[0].email]
      );
      await pool.query(
        "UPDATE leads SET status = 'unsubscribed', unsubscribed_at = NOW() WHERE id = $1",
        [leadId]
      );
    }
  } catch {}
  res.status(200).send('OK');
});

export default router;
