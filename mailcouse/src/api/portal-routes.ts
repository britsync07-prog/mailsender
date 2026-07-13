import { Router, Request, Response } from 'express';
import { query } from '../db/connection';
import { authenticate, requireOrg } from './auth-middleware';
import { generateKeyPair, extractPublicKeyBase64 } from '../dkim/key-generator';
import { encryptPrivateKey, getDomainDKIMPrivateKey } from '../dkim/key-store';
import crypto from 'crypto';
import * as dns from 'dns';
import * as net from 'net';

const router = Router();
router.use(authenticate);
router.use(requireOrg);

// ─── Dashboard ────────────────────────────────────────────

router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const orgId = req.user!.orgId!;

    const domainCount = await query<{ cnt: string }>(
      'SELECT COUNT(*) as cnt FROM customer_domains WHERE organization_id = $1',
      [orgId]
    );

    const credentialCount = await query<{ cnt: string }>(
      'SELECT COUNT(*) as cnt FROM smtp_credentials WHERE organization_id = $1',
      [orgId]
    );

    const sentCount = await query<{ cnt: string }>(
      "SELECT COUNT(*) as cnt FROM sent_messages WHERE organization_id = $1 AND status = 'sent'",
      [orgId]
    );

    const recentMessages = await query(
      `SELECT id, mail_from, rcpt_to, subject, status, created_at
       FROM sent_messages
       WHERE organization_id = $1
       ORDER BY created_at DESC LIMIT 10`,
      [orgId]
    );

    res.json({
      stats: {
        domains: parseInt(domainCount.rows[0].cnt),
        credentials: parseInt(credentialCount.rows[0].cnt),
        messagesSent: parseInt(sentCount.rows[0].cnt),
      },
      recentMessages: recentMessages.rows,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// ─── Send Message ─────────────────────────────────────────

function getLastCode(response: string): { code: number; msg: string; isFinal: boolean } | null {
  const lines = response.trim().split('\r\n');
  const lastLine = lines[lines.length - 1];
  const m = lastLine.match(/^(\d{3})([ -])(.*)/);
  if (!m) return null;
  return { code: parseInt(m[1]), msg: m[3], isFinal: m[2] === ' ' };
}

async function deliverToMX(mxHost: string, port: number, envelopeFrom: string, to: string, message: string): Promise<{ success: boolean; code: number; message: string }> {
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

    s.on('data', (data: Buffer) => { buf += data.toString(); tryProcess(); });
    s.on('error', (err) => done(err));
    s.on('timeout', () => done(new Error('SMTP idle timeout')));
    s.setTimeout(15000);
    s.connect(port, mxHost);
  });
}

async function deliverToRecipients(envelopeFrom: string, recipients: string[], rawMessage: string): Promise<{ to: string; success: boolean; code: number; message: string }[]> {
  const results: { to: string; success: boolean; code: number; message: string }[] = [];
  for (const recipient of recipients) {
    try {
      const domain = recipient.split('@')[1];
      if (!domain) { results.push({ to: recipient, success: false, code: 0, message: 'Invalid recipient' }); continue; }
      const mxRecords = await dns.promises.resolveMx(domain);
      if (!mxRecords || mxRecords.length === 0) {
        results.push({ to: recipient, success: false, code: 0, message: 'No MX records found' });
        continue;
      }
      mxRecords.sort((a, b) => a.priority - b.priority);
      let delivered = false;
      for (const mx of mxRecords) {
        const result = await deliverToMX(mx.exchange, 25, envelopeFrom, recipient, rawMessage);
        if (result.success) {
          results.push({ to: recipient, success: true, code: result.code, message: result.message });
          delivered = true;
          break;
        }
      }
      if (!delivered) results.push({ to: recipient, success: false, code: 0, message: 'All MX servers failed' });
    } catch (err: any) {
      results.push({ to: recipient, success: false, code: 0, message: err.message });
    }
  }
  return results;
}

router.post('/send', async (req: Request, res: Response) => {
  try {
    const { direction, message: msgData } = req.body;
    if (!msgData) return res.status(400).json({ error: 'Message data required' });

    const orgId = req.user!.orgId!;
    const ip = req.ip || '127.0.0.1';
    const serverResult = await query('SELECT * FROM servers WHERE organization_id = $1', [orgId]);
    const server = serverResult.rows[0];

    if (direction === 'incoming') {
      // Incoming message prototype — send to routes
      const from = msgData.from || 'test@example.com';
      const to = msgData.to || '';
      const subject = msgData.subject || 'Test Message';
      const plainBody = msgData.plain_body || '';
      const msgId = `<${crypto.randomUUID()}@mailcouse>`;
      const receivedHeader = `Received: from web-ui (${ip}) by mailcouse with HTTP; ${new Date().toUTCString()}\r\n`;

      let raw = `${receivedHeader}From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nDate: ${new Date().toUTCString()}\r\nMessage-ID: ${msgId}\r\n\r\n${plainBody}`;

      const msgResult = await query(
        `INSERT INTO sent_messages (organization_id, mail_from, rcpt_to, subject, body_text, raw_headers, size, status, message_id, scope)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'incoming')
         RETURNING id`,
        [orgId, from, to, subject, plainBody, '', raw.length, 'sent', msgId]
      );

      return res.json({ id: msgResult.rows[0].id, token: msgId });
    }

    // Outgoing message
    const from = msgData.from;
    const to = msgData.to;
    const subject = msgData.subject || 'Test Message';
    const plainBody = msgData.plain_body || '';

    if (!from) return res.status(400).json({ error: 'From address is required' });
    if (!to) return res.status(400).json({ error: 'Recipient is required' });

    const domainPart = from.split('@')[1]?.toLowerCase();
    if (!domainPart) return res.status(400).json({ error: 'Invalid from address' });

    const domainResult = await query(
      `SELECT id, domain FROM customer_domains WHERE LOWER(domain) = $1 AND organization_id = $2 AND verified = true`,
      [domainPart, orgId]
    );
    if (domainResult.rows.length === 0) {
      return res.status(400).json({ error: `From domain ${domainPart} is not verified for this account` });
    }
    const customerDomain = domainResult.rows[0];

    const msgId = `<${crypto.randomUUID()}@${customerDomain.domain}>`;
    const recipients = to.split(/,\s*/).filter(Boolean);
    if (recipients.length === 0) return res.status(400).json({ error: 'No recipients' });

    const envelopeFrom = `bounce+${orgId.slice(0, 8)}@live.noblecircle.online`;
    const receivedHeader = `Received: from web-ui (${ip}) by mailcouse with HTTP; ${new Date().toUTCString()}\r\n`;

    let rawMessage = `${receivedHeader}From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nDate: ${new Date().toUTCString()}\r\nMessage-ID: ${msgId}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${plainBody}`;

    // DKIM sign
    try {
      const keyData = await getDomainDKIMPrivateKey(customerDomain.id);
      if (keyData) {
        const signHdrs = ['from', 'to', 'subject', 'date', 'message-id'];
        const hdrList = signHdrs.join(':');
        const bodyHash = crypto.createHash('sha256').update(plainBody).digest('base64');
        const sign = crypto.createSign('sha256');
        sign.update(signHdrs.map(h => `${h}:${(req.body as any)[h] || ''}`).join('\r\n'));
        const b = sign.sign(keyData.privateKey, 'base64');
        const dkimSig = `DKIM-Signature: v=1; a=rsa-sha256; d=${customerDomain.domain}; s=${keyData.selector}; h=${hdrList}; bh=${bodyHash}; b=${b}\r\n`;
        rawMessage = dkimSig + rawMessage;
      }
    } catch {}

    // Deliver to all recipients
    const deliveryResults = await deliverToRecipients(envelopeFrom, recipients, rawMessage);
    const allSuccess = deliveryResults.every(r => r.success);

    // Record in sent_messages
    const msgResult = await query(
      `INSERT INTO sent_messages (organization_id, customer_domain_id, mail_from, rcpt_to, subject, body_text, raw_headers, size, status, message_id, scope)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'outgoing')
       RETURNING id`,
      [orgId, customerDomain.id, from, to, subject, plainBody, '', rawMessage.length, allSuccess ? 'sent' : 'failed', msgId]
    );

    const messageId = msgResult.rows[0].id;

    // Record delivery attempts
    for (const dr of deliveryResults) {
      await query(
        `INSERT INTO delivery_attempts (sent_message_id, organization_id, rcpt_to, status, smtp_code, details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [messageId, orgId, dr.to, dr.success ? 'delivered' : 'failed', dr.code, dr.message]
      );
    }

    res.json({ id: messageId, token: msgId, deliveries: deliveryResults });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// ─── Domains ──────────────────────────────────────────────

router.get('/domains', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, domain, verified, verified_at, spf_status, dkim_status, mx_status, return_path_status, outgoing, created_at
       FROM customer_domains WHERE organization_id = $1 ORDER BY created_at DESC`,
      [req.user!.orgId!]
    );
    res.json({ domains: result.rows });
  } catch {
    res.status(500).json({ error: 'Failed to list domains' });
  }
});

router.post('/domains', async (req: Request, res: Response) => {
  try {
    const { domain } = req.body;
    if (!domain) return res.status(400).json({ error: 'Domain name required' });

    const orgId = req.user!.orgId!;
    const verificationToken = crypto.randomBytes(32).toString('hex');

    const key = generateKeyPair();
    const pubKeyBase64 = extractPublicKeyBase64(key.publicKey);
    const encryptedPrivKey = encryptPrivateKey(key.privateKey);

    const result = await query<{ id: string }>(
      `INSERT INTO customer_domains
       (organization_id, domain, verification_token, dkim_selector, dkim_private_key, dkim_public_key, outgoing)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING id`,
      [orgId, domain.toLowerCase(), verificationToken, key.selector, encryptedPrivKey, pubKeyBase64]
    );

    res.status(201).json({
      id: result.rows[0].id,
      domain: domain.toLowerCase(),
      verificationToken,
      dkimSelector: key.selector,
      dkimPublicKey: pubKeyBase64,
      dnsRecords: {
        spf: `v=spf1 include:${req.hostname} ~all`,
        dkim: `${key.selector}._domainkey.${domain.toLowerCase()}  IN TXT  "v=DKIM1; k=rsa; p=${pubKeyBase64}"`,
        mx: `${domain.toLowerCase()}  IN MX  10 live.noblecircle.online`,
      },
    });
  } catch (err: any) {
    if (err?.constraint === 'customer_domains_domain_key') {
      return res.status(409).json({ error: 'Domain already added' });
    }
    console.error('Add domain error:', err);
    res.status(500).json({ error: 'Failed to add domain' });
  }
});

router.get('/domains/:id/verify', async (req: Request, res: Response) => {
  try {
    const domainResult = await query<{ id: string; domain: string }>(
      'SELECT id, domain FROM customer_domains WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user!.orgId!]
    );
    if (domainResult.rows.length === 0) {
      return res.status(404).json({ error: 'Domain not found' });
    }

    const { domain } = domainResult.rows[0];
    const dns = require('dns').promises;
    const statuses: Record<string, string> = { spf: 'missing', dkim: 'missing', mx: 'missing', return_path: 'missing' };

    try {
      const txtRecords = await dns.resolveTxt(domain);
      const spfRecord = txtRecords.flat().find((r: string) => r.startsWith('v=spf1'));
      statuses.spf = spfRecord ? 'ok' : 'missing';
    } catch { statuses.spf = 'missing'; }

    try {
      const dmarcRecords = await dns.resolveTxt(`_dmarc.${domain}`);
      const dmarc = dmarcRecords.flat().find((r: string) => r.startsWith('v=DMARC1'));
      statuses.return_path = dmarc ? 'ok' : 'missing';
    } catch { statuses.return_path = 'missing'; }

    try {
      const mxRecords = await dns.resolveMx(domain);
      statuses.mx = mxRecords.some((r: any) => r.exchange === 'live.noblecircle.online') ? 'ok' : 'missing';
    } catch { statuses.mx = 'missing'; }

    try {
      const dkimRow = await query<{ dkim_selector: string }>(
        'SELECT dkim_selector FROM customer_domains WHERE id = $1',
        [req.params.id]
      );
      if (dkimRow.rows[0]?.dkim_selector) {
        const dkimRecords = await dns.resolveTxt(`${dkimRow.rows[0].dkim_selector}._domainkey.${domain}`);
        statuses.dkim = dkimRecords.length > 0 ? 'ok' : 'missing';
      }
    } catch { statuses.dkim = 'missing'; }

    const allOk = Object.values(statuses).every((s) => s === 'ok');
    if (allOk) {
      await query(
        'UPDATE customer_domains SET verified = true, verified_at = NOW(), spf_status = $1, dkim_status = $2, mx_status = $3, return_path_status = $4 WHERE id = $5',
        [statuses.spf, statuses.dkim, statuses.mx, statuses.return_path, req.params.id]
      );
    } else {
      await query(
        'UPDATE customer_domains SET spf_status = $1, dkim_status = $2, mx_status = $3, return_path_status = $4 WHERE id = $5',
        [statuses.spf, statuses.dkim, statuses.mx, statuses.return_path, req.params.id]
      );
    }

    res.json({ domain, verified: allOk, checks: statuses });
  } catch (err) {
    console.error('Verify domain error:', err);
    res.status(500).json({ error: 'Failed to verify domain' });
  }
});

router.delete('/domains/:id', async (req: Request, res: Response) => {
  try {
    await query(
      'DELETE FROM customer_domains WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user!.orgId!]
    );
    res.json({ message: 'Domain removed' });
  } catch {
    res.status(500).json({ error: 'Failed to delete domain' });
  }
});

// ─── SMTP Credentials ────────────────────────────────────

router.get('/credentials', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT sc.id, sc.name, sc.username, sc.type, sc.hold, sc.last_used_at, sc.created_at,
              cd.domain as domain_name
       FROM smtp_credentials sc
       LEFT JOIN customer_domains cd ON cd.id = sc.customer_domain_id
       WHERE sc.organization_id = $1
       ORDER BY sc.created_at DESC`,
      [req.user!.orgId!]
    );
    res.json({ credentials: result.rows });
  } catch {
    res.status(500).json({ error: 'Failed to list credentials' });
  }
});

router.post('/credentials', async (req: Request, res: Response) => {
  try {
    const { name, domainId } = req.body;
    if (!name) return res.status(400).json({ error: 'Credential name required' });

    const username = `u_${crypto.randomBytes(12).toString('hex')}`;
    const password = crypto.randomBytes(24).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
    const hash = await require('bcryptjs').hash(password, 10);

    const result = await query<{ id: string }>(
      `INSERT INTO smtp_credentials (organization_id, customer_domain_id, name, username, password_hash, type)
       VALUES ($1, $2, $3, $4, $5, 'smtp')
       RETURNING id`,
      [req.user!.orgId!, domainId || null, name, username, hash]
    );

    res.status(201).json({
      id: result.rows[0].id,
      name,
      username,
      password,
      type: 'smtp',
    });
  } catch (err) {
    console.error('Create credential error:', err);
    res.status(500).json({ error: 'Failed to create credential' });
  }
});

router.delete('/credentials/:id', async (req: Request, res: Response) => {
  try {
    await query(
      'DELETE FROM smtp_credentials WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user!.orgId!]
    );
    res.json({ message: 'Credential revoked' });
  } catch {
    res.status(500).json({ error: 'Failed to delete credential' });
  }
});

// ─── Sent Messages ────────────────────────────────────────

router.get('/messages', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;
    const status = req.query.status as string;
    const search = req.query.search as string;
    const scope = (req.query.scope as string) || 'outgoing';

    let where = 'WHERE sm.organization_id = $1';
    const params: any[] = [req.user!.orgId!];
    let paramIdx = 2;

    if (scope === 'held') {
      where += ` AND sm.status = 'held'`;
    } else {
      where += ` AND sm.scope = $${paramIdx++}`;
      params.push(scope);
      where += ` AND (sm.status IS DISTINCT FROM 'held')`;
    }

    if (status) {
      where += ` AND sm.status = $${paramIdx++}`;
      params.push(status);
    }
    if (search) {
      where += ` AND (sm.rcpt_to ILIKE $${paramIdx} OR sm.mail_from ILIKE $${paramIdx} OR sm.subject ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }

    const countResult = await query<{ cnt: string }>(
      `SELECT COUNT(*) as cnt FROM sent_messages sm ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].cnt);

    params.push(limit, offset);
    const messages = await query(
      `SELECT sm.id, sm.mail_from, sm.rcpt_to, sm.subject, sm.status, sm.bounce, sm.size, sm.scope, sm.created_at,
              sc.name as credential_name
       FROM sent_messages sm
       LEFT JOIN smtp_credentials sc ON sc.id = sm.credential_id
       ${where}
       ORDER BY sm.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      params
    );

    res.json({
      messages: messages.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('Messages error:', err);
    res.status(500).json({ error: 'Failed to list messages' });
  }
});

router.get('/messages/:id', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT sm.*, sc.name as credential_name, cd.domain as domain_name
       FROM sent_messages sm
       LEFT JOIN smtp_credentials sc ON sc.id = sm.credential_id
       LEFT JOIN customer_domains cd ON cd.id = sm.customer_domain_id
       WHERE sm.id = $1 AND sm.organization_id = $2`,
      [req.params.id, req.user!.orgId!]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }
    const message = result.rows[0];

    const deliveriesResult = await query(
      `SELECT * FROM delivery_attempts WHERE sent_message_id = $1 ORDER BY timestamp DESC`,
      [req.params.id]
    );
    message.deliveries = deliveriesResult.rows;

    res.json({ message });
  } catch {
    res.status(500).json({ error: 'Failed to get message' });
  }
});

// ─── Message Deliveries ───────────────────────────────────

router.get('/messages/:id/deliveries', async (req: Request, res: Response) => {
  try {
    const deliveriesResult = await query(
      `SELECT * FROM delivery_attempts WHERE sent_message_id = $1 AND organization_id = $2 ORDER BY timestamp DESC`,
      [req.params.id, req.user!.orgId!]
    );
    res.json({ deliveries: deliveriesResult.rows });
  } catch {
    res.status(500).json({ error: 'Failed to load deliveries' });
  }
});

// ─── Webhook History ─────────────────────────────────────

router.get('/webhooks/history', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;

    const countResult = await query<{ cnt: string }>(
      'SELECT COUNT(*) as cnt FROM webhook_requests WHERE organization_id = $1',
      [req.user!.orgId!]
    );
    const total = parseInt(countResult.rows[0].cnt);

    const result = await query(
      `SELECT * FROM webhook_requests WHERE organization_id = $1 ORDER BY timestamp DESC LIMIT $2 OFFSET $3`,
      [req.user!.orgId!, limit, offset]
    );

    res.json({
      requests: result.rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch {
    res.status(500).json({ error: 'Failed to load webhook history' });
  }
});

router.get('/webhooks/history/:uuid', async (req: Request, res: Response) => {
  try {
    const result = await query(
      'SELECT * FROM webhook_requests WHERE uuid = $1 AND organization_id = $2',
      [req.params.uuid, req.user!.orgId!]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    res.json({ request: result.rows[0] });
  } catch {
    res.status(500).json({ error: 'Failed to load request' });
  }
});

// ─── Advanced Settings ────────────────────────────────────

router.post('/settings/advanced', async (req: Request, res: Response) => {
  try {
    const { send_limit, allow_sender, privacy_mode, message_retention_days, raw_message_retention_days, raw_message_retention_size } = req.body;
    await query(
      `UPDATE servers SET
       send_limit = $1, allow_sender = $2, privacy_mode = $3,
       message_retention_days = $4, raw_message_retention_days = $5, raw_message_retention_size = $6
       WHERE organization_id = $7`,
      [
        send_limit ? parseInt(send_limit) : null,
        allow_sender === 'true',
        privacy_mode === 'true',
        message_retention_days ? parseInt(message_retention_days) : null,
        raw_message_retention_days ? parseInt(raw_message_retention_days) : null,
        raw_message_retention_size ? parseInt(raw_message_retention_size) : null,
        req.user!.orgId!,
      ]
    );
    res.json({ message: 'Settings saved' });
  } catch {
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

router.post('/settings/suspend', async (req: Request, res: Response) => {
  try {
    const { reason } = req.body;
    await query(
      `UPDATE servers SET suspended_at = NOW(), suspension_reason = $1 WHERE organization_id = $2`,
      [reason || 'No reason given', req.user!.orgId!]
    );
    res.json({ message: 'Server suspended' });
  } catch {
    res.status(500).json({ error: 'Failed to suspend server' });
  }
});

router.post('/settings/unsuspend', async (req: Request, res: Response) => {
  try {
    await query(
      `UPDATE servers SET suspended_at = NULL, suspension_reason = NULL WHERE organization_id = $1`,
      [req.user!.orgId!]
    );
    res.json({ message: 'Server unsuspended' });
  } catch {
    res.status(500).json({ error: 'Failed to unsuspend server' });
  }
});

// ─── Organization Settings ────────────────────────────────

router.get('/settings', async (req: Request, res: Response) => {
  try {
    const orgResult = await query<{ id: string; name: string; created_at: Date }>(
      'SELECT id, name, created_at FROM organizations WHERE id = $1',
      [req.user!.orgId!]
    );
    if (orgResult.rows.length === 0) return res.status(404).json({ error: 'Organization not found' });

    const memberResult = await query(
      `SELECT u.id, u.email, u.name, om.role
       FROM organization_members om
       JOIN users u ON u.id = om.user_id
       WHERE om.organization_id = $1`,
      [req.user!.orgId!]
    );

    const serverResult = await query(
      `SELECT * FROM servers WHERE organization_id = $1`,
      [req.user!.orgId!]
    );

    const credentialResult = await query(
      `SELECT name, username FROM smtp_credentials WHERE organization_id = $1 AND type = 'smtp' ORDER BY created_at DESC LIMIT 1`,
      [req.user!.orgId!]
    );

    res.json({
      organization: orgResult.rows[0],
      members: memberResult.rows,
      server: serverResult.rows[0] || null,
      credentials: credentialResult.rows,
    });
  } catch {
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

// ─── Servers ────────────────────────────────────────────────

router.get('/servers', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT s.*, cd.domain as return_path_domain
       FROM servers s
       LEFT JOIN customer_domains cd ON cd.id = s.return_path_domain_id
       WHERE s.organization_id = $1`,
      [_req.user!.orgId!]
    );
    res.json({ servers: result.rows });
  } catch {
    res.status(500).json({ error: 'Failed to list servers' });
  }
});

// ─── Routes ─────────────────────────────────────────────────

router.get('/routes', async (req: Request, res: Response) => {
  try {
    const result = await query(
      'SELECT * FROM routes WHERE organization_id = $1 ORDER BY priority ASC',
      [req.user!.orgId!]
    );
    res.json({ routes: result.rows });
  } catch {
    res.status(500).json({ error: 'Failed to list routes' });
  }
});

router.post('/routes', async (req: Request, res: Response) => {
  try {
    const { name, domain, matchType, matchValue, actionType, actionValue, priority } = req.body;
    const result = await query<{ id: string }>(
      `INSERT INTO routes (organization_id, name, domain, match_type, match_value, action_type, action_value, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [req.user!.orgId!, name || 'Unnamed Route', domain || null, matchType || 'catch_all', matchValue || '', actionType || 'webhook', actionValue || '', priority || 10]
    );
    res.status(201).json({ id: result.rows[0].id });
  } catch {
    res.status(500).json({ error: 'Failed to create route' });
  }
});

router.delete('/routes/:id', async (req: Request, res: Response) => {
  try {
    await query('DELETE FROM routes WHERE id = $1 AND organization_id = $2', [req.params.id, req.user!.orgId!]);
    res.json({ message: 'Route removed' });
  } catch {
    res.status(500).json({ error: 'Failed to delete route' });
  }
});

// ─── Webhooks ───────────────────────────────────────────────

router.get('/webhooks', async (req: Request, res: Response) => {
  try {
    const result = await query(
      'SELECT * FROM webhooks WHERE organization_id = $1 ORDER BY created_at DESC',
      [req.user!.orgId!]
    );
    res.json({ webhooks: result.rows });
  } catch {
    res.status(500).json({ error: 'Failed to list webhooks' });
  }
});

router.post('/webhooks', async (req: Request, res: Response) => {
  try {
    const { name, endpointUrl, events } = req.body;
    if (!endpointUrl) return res.status(400).json({ error: 'Endpoint URL required' });
    const result = await query<{ id: string }>(
      `INSERT INTO webhooks (organization_id, name, endpoint_url, events) VALUES ($1, $2, $3, $4) RETURNING id`,
      [req.user!.orgId!, name || 'Unnamed Webhook', endpointUrl, events || []]
    );
    res.status(201).json({ id: result.rows[0].id });
  } catch {
    res.status(500).json({ error: 'Failed to create webhook' });
  }
});

router.delete('/webhooks/:id', async (req: Request, res: Response) => {
  try {
    await query('DELETE FROM webhooks WHERE id = $1 AND organization_id = $2', [req.params.id, req.user!.orgId!]);
    res.json({ message: 'Webhook removed' });
  } catch {
    res.status(500).json({ error: 'Failed to delete webhook' });
  }
});

// ─── Track Domains ──────────────────────────────────────────

router.get('/track-domains', async (req: Request, res: Response) => {
  try {
    const result = await query(
      'SELECT * FROM track_domains WHERE organization_id = $1 ORDER BY created_at DESC',
      [req.user!.orgId!]
    );
    res.json({ trackDomains: result.rows });
  } catch {
    res.status(500).json({ error: 'Failed to list track domains' });
  }
});

router.post('/track-domains', async (req: Request, res: Response) => {
  try {
    const { domain } = req.body;
    if (!domain) return res.status(400).json({ error: 'Domain required' });
    const result = await query<{ id: string }>(
      'INSERT INTO track_domains (organization_id, domain) VALUES ($1, $2) RETURNING id',
      [req.user!.orgId!, domain.toLowerCase()]
    );
    res.status(201).json({ id: result.rows[0].id, domain: domain.toLowerCase() });
  } catch {
    res.status(500).json({ error: 'Failed to add track domain' });
  }
});

router.post('/track-domains/:id/toggle-ssl', async (req: Request, res: Response) => {
  try {
    const result = await query<{ ssl_enabled: boolean }>(
      'SELECT ssl_enabled FROM track_domains WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user!.orgId!]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Track domain not found' });
    const current = result.rows[0].ssl_enabled;
    await query(
      'UPDATE track_domains SET ssl_enabled = $1 WHERE id = $2',
      [!current, req.params.id]
    );
    res.json({ ssl_enabled: !current });
  } catch {
    res.status(500).json({ error: 'Failed to toggle SSL' });
  }
});

router.post('/track-domains/:id/check', async (req: Request, res: Response) => {
  try {
    const result = await query<{ id: string; domain: string }>(
      'SELECT id, domain FROM track_domains WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user!.orgId!]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Track domain not found' });
    const { domain } = result.rows[0];
    const dns = require('dns').promises;
    let dnsStatus = 'missing';
    let dnsError = '';
    try {
      const cnameRecords = await dns.resolveCname(domain);
      if (cnameRecords.some((r: string) => r.includes('mailcouse') || r.includes('noblecircle'))) {
        dnsStatus = 'OK';
      } else {
        dnsError = 'CNAME does not point to the expected target';
      }
    } catch (err: any) {
      dnsError = err.message;
    }
    await query(
      'UPDATE track_domains SET dns_verified = $1, dns_status = $2, dns_error = $3 WHERE id = $4',
      [dnsStatus === 'OK', dnsStatus, dnsError, req.params.id]
    );
    res.json({ dns_status: dnsStatus, message: dnsStatus === 'OK' ? 'DNS looks good!' : 'DNS check failed: ' + dnsError });
  } catch {
    res.status(500).json({ error: 'Failed to check DNS' });
  }
});

router.delete('/track-domains/:id', async (req: Request, res: Response) => {
  try {
    await query('DELETE FROM track_domains WHERE id = $1 AND organization_id = $2', [req.params.id, req.user!.orgId!]);
    res.json({ message: 'Track domain removed' });
  } catch {
    res.status(500).json({ error: 'Failed to delete track domain' });
  }
});

// ─── Suppressions ────────────────────────────────────────────

router.get('/suppressions', async (req: Request, res: Response) => {
  try {
    const result = await query(
      'SELECT * FROM suppression_list ORDER BY suppressed_at DESC LIMIT 100'
    );
    res.json({ suppressions: result.rows });
  } catch {
    res.status(500).json({ error: 'Failed to list suppressions' });
  }
});

// ─── Subdomain Pool ─────────────────────────────────────────

router.get('/pool', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT s.subdomain, d.domain as root_domain, s.status, s.emails_sent_today, s.daily_limit,
              s.total_sent, s.engagement_score, s.sender_name,
              spt.last_used_at, spt.total_assigned
       FROM subdomains s
       JOIN domains d ON d.id = s.domain_id
       LEFT JOIN subdomain_pool_tracking spt ON spt.subdomain_id = s.id AND spt.organization_id = $1
       ORDER BY spt.last_used_at DESC NULLS LAST`,
      [req.user!.orgId!]
    );
    res.json({ pool: result.rows });
  } catch {
    res.status(500).json({ error: 'Failed to list pool' });
  }
});

export default router;
