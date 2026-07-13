import { Router, Request, Response } from 'express';
import { query } from '../db/connection';
import { authenticate, requireOrg } from './auth-middleware';
import { generateKeyPair, extractPublicKeyBase64 } from '../dkim/key-generator';
import { encryptPrivateKey } from '../dkim/key-store';
import crypto from 'crypto';

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

    let where = 'WHERE sm.organization_id = $1';
    const params: any[] = [req.user!.orgId!];
    let paramIdx = 2;

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
      `SELECT sm.id, sm.mail_from, sm.rcpt_to, sm.subject, sm.status, sm.bounce, sm.size, sm.created_at,
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
      `SELECT sm.*, sc.name as credential_name, cd.domain as domain_name, s.subdomain
       FROM sent_messages sm
       LEFT JOIN smtp_credentials sc ON sc.id = sm.credential_id
       LEFT JOIN customer_domains cd ON cd.id = sm.customer_domain_id
       LEFT JOIN subdomains s ON s.id = sm.subdomain_id
       WHERE sm.id = $1 AND sm.organization_id = $2`,
      [req.params.id, req.user!.orgId!]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }
    res.json({ message: result.rows[0] });
  } catch {
    res.status(500).json({ error: 'Failed to get message' });
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

    res.json({ organization: orgResult.rows[0], members: memberResult.rows });
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
    const { domain, matchType, matchValue, actionType, actionValue, priority } = req.body;
    const result = await query<{ id: string }>(
      `INSERT INTO routes (organization_id, domain, match_type, match_value, action_type, action_value, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [req.user!.orgId!, domain || null, matchType || 'catch_all', matchValue || '', actionType || 'webhook', actionValue || '', priority || 10]
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
    const { endpointUrl, events } = req.body;
    if (!endpointUrl) return res.status(400).json({ error: 'Endpoint URL required' });
    const result = await query<{ id: string }>(
      `INSERT INTO webhooks (organization_id, endpoint_url, events) VALUES ($1, $2, $3) RETURNING id`,
      [req.user!.orgId!, endpointUrl, events || []]
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

router.delete('/track-domains/:id', async (req: Request, res: Response) => {
  try {
    await query('DELETE FROM track_domains WHERE id = $1 AND organization_id = $2', [req.params.id, req.user!.orgId!]);
    res.json({ message: 'Track domain removed' });
  } catch {
    res.status(500).json({ error: 'Failed to delete track domain' });
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
