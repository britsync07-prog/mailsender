import { Router, Request, Response } from 'express';
import { query } from '../db/connection';
import { authenticate, requireOrg } from './auth-middleware';
import { generateKeyPair, extractPublicKeyBase64 } from '../dkim/key-generator';
import { encryptPrivateKey, getDomainDKIMPrivateKey } from '../dkim/key-store';
import { activateSubdomainBatch, provisionSubdomainBatch } from '../segmentation/subdomain-provisioner';
import { config } from '../config';
import {
  VERIFICATION_METHODS,
  verificationEmailAddresses,
  generateVerificationToken,
  generateDKIMIdentifierString,
  spfRecord,
  dkimRecord,
  dkimRecordName,
  dkimSelectorRecordName,
  dkimIdentifier,
  returnPathDomain,
  dnsVerificationString,
  resolveTxt,
  checkDomainDNS,
  findVerifiedDomainForAddress,
  DomainDNSChecks,
} from './domain-logic';
import crypto from 'crypto';
import * as dns from 'dns';
import nodemailer from 'nodemailer';
import {
  createMailboxAccount,
  ensureDefaultFolders,
  isValidMailboxEmail,
  listFolders,
  listMessages,
  normalizeMailboxEmail,
  updateMailboxAccount,
} from '../imap/mailbox-store';

const router = Router();
router.use(authenticate);
router.use(requireOrg);
const DEFAULT_SUBDOMAIN_COUNT = 24;
const MAX_PORTAL_SUBDOMAIN_COUNT = 500;
const DEFAULT_INDUSTRY = 'general';
const DEFAULT_REGISTRAR = 'manual';
const VALID_CREDENTIAL_TIERS = ['mass_mail', 'personal', 'transactional'] as const;
type CredentialTier = typeof VALID_CREDENTIAL_TIERS[number];

function parseSubdomainCount(value: unknown): number {
  const parsed = parseInt(String(value ?? 0), 10);
  if (Number.isNaN(parsed)) return 0;
  return Math.min(MAX_PORTAL_SUBDOMAIN_COUNT, Math.max(0, parsed));
}

function normalizeNamingScheme(value: unknown): 'smtp' | 'mail' | 'outbound' | 'custom' {
  return ['smtp', 'mail', 'outbound', 'custom'].includes(String(value)) ? String(value) as any : 'smtp';
}

function normalizeCredentialTier(value: unknown): CredentialTier {
  const raw = String(value || 'mass_mail').toLowerCase().replace(/-/g, '_');
  return (VALID_CREDENTIAL_TIERS as readonly string[]).includes(raw) ? raw as CredentialTier : 'mass_mail';
}

function normalizeOptionalEmail(value: unknown): string | null {
  const email = String(value || '').trim().toLowerCase();
  if (!email) return null;
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) return '';
  return email;
}

function normalizeOptionalName(value: unknown): string | null {
  const name = String(value || '').trim();
  return name ? name.substring(0, 255) : null;
}

async function getVerifiedCredentialDomain(domainId: unknown, orgId: string): Promise<{ id: string; domain: string } | null> {
  if (!domainId) return null;
  const result = await query<{ id: string; domain: string }>(
    'SELECT id, domain FROM customer_domains WHERE id = $1 AND organization_id = $2 AND verified = true',
    [domainId, orgId]
  );
  return result.rows[0] || null;
}

function smtpPortForTier(tier: CredentialTier): number {
  return config.platform.smtpPorts[tier] || config.platform.smtpPort;
}

function normalizeAliasList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[\n,]/);
  return Array.from(new Set(raw.map((item) => normalizeMailboxEmail(String(item))).filter(Boolean)));
}

async function validateMailboxAddresses(addresses: string[], orgId: string): Promise<string | null> {
  for (const address of addresses) {
    if (!isValidMailboxEmail(address)) return `${address} is not a valid email address`;
    const domainPart = address.split('@')[1];
    const domain = await findVerifiedDomainForAddress(domainPart, orgId);
    if (!domain || domain.domain.toLowerCase() !== domainPart) return `Domain ${domainPart} must be verified before using ${address}`;
  }
  return null;
}

async function syncMailboxAliases(mailboxId: string, orgId: string, aliases: string[]): Promise<void> {
  await query('DELETE FROM mailbox_aliases WHERE mailbox_id = $1 AND organization_id = $2', [mailboxId, orgId]);
  for (const alias of aliases) {
    await query(
      `INSERT INTO mailbox_aliases (organization_id, mailbox_id, address, active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (organization_id, address) DO UPDATE SET mailbox_id = EXCLUDED.mailbox_id, active = true`,
      [orgId, mailboxId, alias]
    );
  }
}

async function ensurePoolDomain(rootDomain: string): Promise<{ id: string; domain: string; cloudflare_zone_id: string | null }> {
  const existing = await query<{ id: string; domain: string; cloudflare_zone_id: string | null }>(
    'SELECT id, domain, cloudflare_zone_id FROM domains WHERE LOWER(domain) = $1',
    [rootDomain.toLowerCase()]
  );
  if (existing.rows[0]) return existing.rows[0];

  const created = await query<{ id: string; domain: string; cloudflare_zone_id: string | null }>(
    `INSERT INTO domains (domain, registrar, cloudflare_zone_id, dns_provisioned, status, industry, activated_at)
     VALUES ($1, $2, '', false, 'active', $3, NOW())
     RETURNING id, domain, cloudflare_zone_id`,
    [rootDomain.toLowerCase(), DEFAULT_REGISTRAR, DEFAULT_INDUSTRY]
  );
  return created.rows[0];
}

async function getOwnedPoolDomainIds(orgId: string): Promise<string[]> {
  const owned = await query<{ id: string }>(
    `SELECT d.id
     FROM domains d
     JOIN customer_domains cd ON LOWER(cd.domain) = LOWER(d.domain)
     WHERE cd.organization_id = $1`,
    [orgId]
  );
  return owned.rows.map((r) => r.id);
}

async function provisionDomainSubdomains(input: {
  orgId: string;
  domain: string;
  count: number;
  startIndex?: number;
  namingScheme?: 'smtp' | 'mail' | 'outbound' | 'custom';
  customPrefix?: string;
}): Promise<{ domainId: string; created: number; skipped: number; errors: string[]; subdomains: string[] }> {
  const poolDomain = await ensurePoolDomain(input.domain);
  const result = await provisionSubdomainBatch({
    domainId: poolDomain.id,
    rootDomain: poolDomain.domain,
    cloudflareZoneId: poolDomain.cloudflare_zone_id || undefined,
    count: input.count,
    startIndex: input.startIndex || 1,
    namingScheme: input.namingScheme || 'smtp',
    customPrefix: input.customPrefix,
    createDNS: false,
  });
  return { domainId: poolDomain.id, created: result.created, skipped: result.skipped, errors: result.errors, subdomains: result.subdomains };
}

async function markSubdomainsDnsReady(rootDomain: string): Promise<void> {
  const poolDomain = await ensurePoolDomain(rootDomain);
  await query(
    `UPDATE subdomains
     SET dns_verified = true,
         status = CASE WHEN status IN ('provisioning', 'inactive') THEN 'warming' ELSE status END,
         warmup_started_at = COALESCE(warmup_started_at, NOW())
     WHERE domain_id = $1`,
    [poolDomain.id]
  );
}

// ─── Dashboard ────────────────────────────────────────────

export const ACCEPTED_DELIVERY_LABEL = 'Accepted by recipient server';

type DashboardAlert = {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  cause: string;
  fix: string;
  last_checked_at: Date | string | null;
  domain_id?: string;
  domain?: string;
  setup_url?: string;
};

type CheckableDomain = {
  id: string;
  domain: string;
  dkim_selector: string | null;
  dkim_public_key: string | null;
};

function needsAuthRefresh(details: string | null): boolean {
  return /5\.7\.26|dkim|spf|unauthenticated|starttls/i.test(details || '');
}

async function updateDomainDnsStatus(domain: CheckableDomain, orgId: string): Promise<DomainDNSChecks> {
  const selector = domain.dkim_selector || '';
  const expectedDkim = dkimRecord(domain.dkim_public_key || '');
  const { checks } = await checkDomainDNS(domain.domain, selector, expectedDkim);
  await query(
    `UPDATE customer_domains SET spf_status = $1, spf_error = $2, dkim_status = $3, dkim_error = $4,
            mx_status = $5, mx_error = $6, return_path_status = $7, return_path_error = $8,
            dkim_observed_selector = $9, dkim_observed_name = $10, dkim_observed_value = $11,
            spf_observed_record = $12, dns_checked_at = NOW()
     WHERE id = $13 AND organization_id = $14`,
    [
      checks.spf.status, checks.spf.error,
      checks.dkim.status, checks.dkim.error,
      checks.mx.status, checks.mx.error,
      checks.return_path.status, checks.return_path.error,
      checks.dkim.selector || selector,
      checks.dkim.checked_name || `${selector}._domainkey.${domain.domain}`,
      checks.dkim.found || null,
      checks.spf.found || null,
      domain.id,
      orgId,
    ]
  );
  return checks;
}

async function refreshDashboardDomainChecks(orgId: string): Promise<void> {
  const result = await query<CheckableDomain>(
    `SELECT DISTINCT cd.id, cd.domain, cd.dkim_selector, cd.dkim_public_key
     FROM customer_domains cd
     LEFT JOIN sent_messages sm ON sm.customer_domain_id = cd.id AND sm.organization_id = cd.organization_id
     LEFT JOIN delivery_attempts da ON da.sent_message_id = sm.id
       AND da.status = 'failed'
       AND da.created_at > NOW() - INTERVAL '24 hours'
     WHERE cd.organization_id = $1
       AND cd.verified = true
       AND (
         cd.dns_checked_at IS NULL
         OR cd.dns_checked_at < NOW() - INTERVAL '10 minutes'
         OR da.details ~* '(5\\.7\\.26|dkim|spf|unauthenticated|starttls)'
       )`,
    [orgId]
  );

  for (const domain of result.rows) {
    try {
      await updateDomainDnsStatus(domain, orgId);
    } catch (err) {
      console.error(`Dashboard DNS refresh failed for ${domain.domain}:`, err);
    }
  }
}

function dnsAlert(domain: any, kind: 'spf' | 'dkim'): DashboardAlert | null {
  const status = domain[`${kind}_status`];
  const error = domain[`${kind}_error`];
  if (!status || status === 'OK') return null;
  const checked = kind === 'dkim' ? domain.dkim_observed_name : domain.domain;
  return {
    severity: kind === 'spf' || kind === 'dkim' ? 'critical' : 'warning',
    title: kind === 'dkim' ? `DKIM ${status} for ${domain.domain}` : `SPF ${status} for ${domain.domain}`,
    cause: error || `${kind.toUpperCase()} check is ${status}`,
    fix: kind === 'dkim'
      ? `Add or correct TXT ${checked || `${domain.dkim_selector}._domainkey.${domain.domain}`} with the public key shown on domain setup.`
      : `Update the SPF TXT record at ${domain.domain} so it authorizes the actual outbound IP addresses used by this server.`,
    last_checked_at: domain.dns_checked_at,
    domain_id: domain.id,
    domain: domain.domain,
    setup_url: `/portal/domains/${domain.id}/setup`,
  };
}

export async function buildDashboardAlerts(orgId: string): Promise<DashboardAlert[]> {
  const alerts: DashboardAlert[] = [];
  const domains = await query(
    `SELECT id, domain, dns_checked_at, spf_status, spf_error, dkim_status, dkim_error,
            dkim_selector, dkim_observed_name, dkim_observed_value, spf_observed_record
     FROM customer_domains
     WHERE organization_id = $1
     ORDER BY domain ASC`,
    [orgId]
  );

  for (const domain of domains.rows) {
    const spf = dnsAlert(domain, 'spf');
    const dkim = dnsAlert(domain, 'dkim');
    if (spf) alerts.push(spf);
    if (dkim) alerts.push(dkim);
  }

  const failures = await query(
    `SELECT cd.id as domain_id, COALESCE(cd.domain, split_part(sm.mail_from, '@', 2)) as domain,
            da.smtp_code, da.details, COUNT(*)::int as copies, MAX(da.created_at) as last_checked_at
     FROM delivery_attempts da
     JOIN sent_messages sm ON sm.id = da.sent_message_id
     LEFT JOIN customer_domains cd ON cd.id = sm.customer_domain_id
     WHERE sm.organization_id = $1
       AND da.status = 'failed'
       AND da.created_at > NOW() - INTERVAL '24 hours'
     GROUP BY cd.id, cd.domain, split_part(sm.mail_from, '@', 2), da.smtp_code, da.details
     ORDER BY
       CASE WHEN da.details ~* '5\\.7\\.26|unauthenticated|dkim|spf' THEN 0
            WHEN da.details ~* 'starttls' THEN 1
            WHEN da.smtp_code BETWEEN 400 AND 499 THEN 2
            ELSE 3 END,
       MAX(da.created_at) DESC
     LIMIT 10`,
    [orgId]
  );

  for (const failure of failures.rows) {
    const detail = failure.details || 'SMTP delivery failed';
    const auth = needsAuthRefresh(detail);
    alerts.push({
      severity: auth ? 'critical' : 'warning',
      title: auth ? `Authentication failure for ${failure.domain || 'domain'}` : `Delivery failure for ${failure.domain || 'domain'}`,
      cause: detail,
      fix: auth ? 'Fix SPF/DKIM for this sending domain and run domain checks again.' : 'Review the recipient MX response and retry after correcting the delivery issue.',
      last_checked_at: failure.last_checked_at,
      domain_id: failure.domain_id || undefined,
      domain: failure.domain || undefined,
      setup_url: failure.domain_id ? `/portal/domains/${failure.domain_id}/setup` : undefined,
    });
  }

  const duplicates = await query(
    `SELECT message_id, COUNT(*)::int as copies, MAX(created_at) as last_checked_at
     FROM sent_messages
     WHERE organization_id = $1
       AND created_at > NOW() - INTERVAL '24 hours'
       AND message_id IS NOT NULL
     GROUP BY message_id
     HAVING COUNT(*) > 1
     ORDER BY COUNT(*) DESC, MAX(created_at) DESC
     LIMIT 10`,
    [orgId]
  );

  for (const row of duplicates.rows) {
    alerts.push({
      severity: 'warning',
      title: 'Duplicate Message-ID detected',
      cause: `${row.copies} messages reused ${row.message_id}; Gmail may thread or suppress obvious duplicates.`,
      fix: 'Generate a new Message-ID for every new outbound send. Redelivery can intentionally reuse an ID only when replaying the same message.',
      last_checked_at: row.last_checked_at,
    });
  }

  return alerts;
}
router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const orgId = req.user!.orgId!;
    await refreshDashboardDomainChecks(orgId);

    const domainCount = await query<{ cnt: string }>(
      'SELECT COUNT(*) as cnt FROM customer_domains WHERE organization_id = $1',
      [orgId]
    );

    const credentialCount = await query<{ cnt: string }>(
      'SELECT COUNT(*) as cnt FROM smtp_credentials WHERE organization_id = $1',
      [orgId]
    );

    const sentCount = await query<{ cnt: string }>(
      "SELECT COUNT(*) as cnt FROM sent_messages WHERE organization_id = $1 AND status IN ('accepted', 'sent')",
      [orgId]
    );

    const heldCount = await query<{ cnt: string }>(
      "SELECT COUNT(*) as cnt FROM sent_messages WHERE organization_id = $1 AND status = 'held'",
      [orgId]
    );

    const queuedCount = await query<{ cnt: string }>(
      "SELECT COUNT(*) as cnt FROM sent_messages WHERE organization_id = $1 AND status = 'queued'",
      [orgId]
    );

    const bounceCount = await query<{ cnt: string }>(
      "SELECT COUNT(*) as cnt FROM sent_messages WHERE organization_id = $1 AND status = 'failed'",
      [orgId]
    );

    const recentMessages = await query(
      `SELECT id, mail_from, rcpt_to, subject, status, created_at
       FROM sent_messages
       WHERE organization_id = $1
       ORDER BY created_at DESC LIMIT 10`,
      [orgId]
    );

    const dailyStats = await query<{ date: string; sent: string; bounced: string }>(
      `SELECT d.date::text, COALESCE(d.total_sent, 0)::text as sent, COALESCE(d.total_bounces, 0)::text as bounced
       FROM daily_stats d ORDER BY d.date DESC LIMIT 7`
    );

    const today = new Date().toISOString().split('T')[0];
    const todaySent = await query<{ cnt: string }>(
      "SELECT COUNT(*)::text as cnt FROM sent_messages WHERE organization_id = $1 AND created_at::date = CURRENT_DATE",
      [orgId]
    );

    const domainStats = await query<{ total: string; unverified: string; bad_dns: string }>(
      `SELECT COUNT(*)::text as total,
              COUNT(*) FILTER (WHERE verified = false)::text as unverified,
              COUNT(*) FILTER (WHERE verified = true AND NOT (
                spf_status = 'OK' AND dkim_status = 'OK'
                AND (mx_status = 'OK' OR mx_status = 'Missing')
                AND (return_path_status = 'OK' OR return_path_status = 'Missing')
              ))::text as bad_dns
       FROM customer_domains WHERE organization_id = $1`,
      [orgId]
    );

    const domainAlerts = await buildDashboardAlerts(orgId);

    let server: { mode: string; suspended: boolean; send_limit: number | null } = { mode: 'live', suspended: false, send_limit: null };
    try {
      const serverResult = await query<{ mode: string; suspended_at: Date | null; send_limit: number | null }>(
        'SELECT mode, suspended_at, send_limit FROM servers WHERE organization_id = $1',
        [orgId]
      );
      if (serverResult.rows[0]) {
        const s = serverResult.rows[0];
        server = { mode: s.mode, suspended: !!s.suspended_at, send_limit: s.send_limit };
      }
    } catch {
      // servers table may lack these columns in older schemas — use defaults
    }

    res.json({
      stats: {
        domains: parseInt(domainCount.rows[0].cnt),
        credentials: parseInt(credentialCount.rows[0].cnt),
        messagesSent: parseInt(sentCount.rows[0].cnt),
        held: parseInt(heldCount.rows[0].cnt),
        queued: parseInt(queuedCount.rows[0].cnt),
        bounces: parseInt(bounceCount.rows[0].cnt),
        todaySent: parseInt(todaySent.rows[0]?.cnt || '0'),
        sendLimit: server.send_limit,
        graphOutgoing: dailyStats.rows.map(r => r.sent).reverse().join(','),
        graphIncoming: dailyStats.rows.map(r => r.bounced).reverse().join(','),
        dailyAverage: Math.round(
          dailyStats.rows.reduce((sum, r) => sum + parseInt(r.sent), 0) / Math.max(dailyStats.rows.length, 1)
        ),
      },
      recentMessages: recentMessages.rows,
      domain_alerts: domainAlerts,
      delivery_label: ACCEPTED_DELIVERY_LABEL,
      server: { mode: server.mode, suspended: server.suspended },
      domain_stats: {
        total: parseInt(domainStats.rows[0].total),
        unverified: parseInt(domainStats.rows[0].unverified),
        bad_dns: parseInt(domainStats.rows[0].bad_dns),
      },
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// ─── Send Message ─────────────────────────────────────────

async function resolveMxIpv4(mxHost: string): Promise<string> {
  try {
    const addrs = await dns.promises.resolve4(mxHost);
    if (addrs.length > 0) return addrs[0];
  } catch {}
  return mxHost;
}

function parseSender(input: string): { address: string; headerFrom: string } {
  const match = input.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match && match[2]) {
    const name = match[1].trim();
    const address = match[2].trim();
    return { address, headerFrom: name ? `${name} <${address}>` : address };
  }
  return { address: input.trim(), headerFrom: input.trim() };
}

async function deliverToMX(mxHost: string, port: number, envelopeFrom: string, to: string, message: string): Promise<{ success: boolean; code: number; message: string }> {
  // Resolve to IPv4 explicitly (SPF records do not cover this host's IPv6) and
  // use nodemailer so the connection upgrades with STARTTLS (encrypted).
  const ipv4Host = await resolveMxIpv4(mxHost);

  const transporter = nodemailer.createTransport({
    host: ipv4Host,
    port,
    secure: false,
    tls: { rejectUnauthorized: false, servername: mxHost },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 15000,
  });

  try {
    const info = await transporter.sendMail({ raw: message, envelope: { from: envelopeFrom, to: [to] } });
    transporter.close();
    const code = parseInt(String(info.response).split(' ')[0]) || 0;
    return { success: code >= 200 && code < 300, code, message: info.response };
  } catch (err: any) {
    transporter.close();
    return { success: false, code: err.responseCode || 0, message: err.message || String(err) };
  }
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
      const msgId = `<${crypto.randomUUID()}@${config.dns.returnPathDomain}>`;
      const receivedHeader = `Received: from web-ui (${ip}) by ${config.dns.heloHostname} with HTTP; ${new Date().toUTCString()}\r\n`;

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

    const customerDomain = await findVerifiedDomainForAddress(domainPart, orgId);
    if (!customerDomain) {
      return res.status(400).json({ error: `From domain ${domainPart} is not verified for this account` });
    }

    const msgId = `<${crypto.randomUUID()}@${customerDomain.domain}>`;
    const recipients = to.split(/,\s*/).filter(Boolean);
    if (recipients.length === 0) return res.status(400).json({ error: 'No recipients' });

    const sender = parseSender(from);
    const headerFrom = sender.headerFrom;
    const envelopeFrom = `bounce+${orgId.slice(0, 8)}@${config.dns.returnPathDomain}`;
    const receivedHeader = `Received: from web-ui (${ip}) by ${config.dns.heloHostname} with HTTP; ${new Date().toUTCString()}\r\n`;

    let rawMessage = `${receivedHeader}From: ${headerFrom}\r\nTo: ${to}\r\nSubject: ${subject}\r\nDate: ${new Date().toUTCString()}\r\nMessage-ID: ${msgId}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${plainBody}`;

    // DKIM sign (proper canonicalization via nodemailer)
    try {
      const keyData = await getDomainDKIMPrivateKey(customerDomain.id);
      if (keyData) {
        const capture = nodemailer.createTransport({
          streamTransport: true,
          buffer: true,
          newline: '\r\n',
          dkim: { domainName: customerDomain.domain, keySelector: keyData.selector, privateKey: keyData.privateKey },
        });
        const info = await capture.sendMail({
          from: headerFrom, to, subject,
          text: plainBody,
          messageId: msgId,
          date: new Date(),
        });
        rawMessage = receivedHeader + (info.message as Buffer).toString('utf-8');
        capture.close();
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
      [orgId, customerDomain.id, from, to, subject, plainBody, '', rawMessage.length, allSuccess ? 'accepted' : 'failed', msgId]
    );

    const messageId = msgResult.rows[0].id;

    // Record delivery attempts
    for (const dr of deliveryResults) {
      await query(
        `INSERT INTO delivery_attempts (sent_message_id, organization_id, rcpt_to, status, smtp_code, details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [messageId, orgId, dr.to, dr.success ? 'accepted' : 'failed', dr.code, dr.message]
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
      `SELECT id, domain, verified, verified_at, verification_method, dns_checked_at,
              spf_status, spf_error, dkim_status, dkim_error,
              mx_status, mx_error, return_path_status, return_path_error,
              dkim_identifier_string, outgoing, use_for_any, created_at
       FROM customer_domains WHERE organization_id = $1 ORDER BY domain ASC`,
      [req.user!.orgId!]
    );
    res.json({ domains: result.rows });
  } catch {
    res.status(500).json({ error: 'Failed to list domains' });
  }
});

router.get('/domains/:id/setup', async (req: Request, res: Response) => {
  try {
    const domainResult = await query<{
      id: string; domain: string; dkim_identifier_string: string; dkim_selector: string;
      dkim_public_key: string; verification_token: string;
      verified: boolean; dns_checked_at: Date | null;
      spf_status: string | null; spf_error: string | null;
      dkim_status: string | null; dkim_error: string | null;
      mx_status: string | null; mx_error: string | null;
      return_path_status: string | null; return_path_error: string | null;
    }>(
      `SELECT id, domain, dkim_identifier_string, dkim_selector, dkim_public_key, verification_token,
              verified, dns_checked_at, spf_status, spf_error, dkim_status, dkim_error,
              mx_status, mx_error, return_path_status, return_path_error
       FROM customer_domains WHERE id = $1 AND organization_id = $2`,
      [req.params.id, req.user!.orgId!]
    );
    if (domainResult.rows.length === 0) {
      return res.status(404).json({ error: 'Domain not found' });
    }
    const d = domainResult.rows[0];
    await ensurePoolDomain(d.domain);
    if (!d.verified) {
      return res.json({
        redirect: `/portal/domains/${d.id}/verify`,
        flash: { alert: `You can't set up DNS for this domain until it has been verified.` },
      });
    }
    const identifierString = d.dkim_identifier_string || '';
    const subdomainStats = await query<{
      total: string; active: string; warming: string; inactive: string; dns_ready: string;
    }>(
      `SELECT COUNT(s.id)::text as total,
              COUNT(*) FILTER (WHERE s.status = 'active')::text as active,
              COUNT(*) FILTER (WHERE s.status = 'warming')::text as warming,
              COUNT(*) FILTER (WHERE s.status = 'inactive')::text as inactive,
              COUNT(*) FILTER (WHERE s.dns_verified = true)::text as dns_ready
       FROM subdomains s
       JOIN domains pd ON pd.id = s.domain_id
       WHERE LOWER(pd.domain) = LOWER($1)`,
      [d.domain]
    );
    res.json({
      id: d.id,
      name: d.domain,
      verified: d.verified,
      dns_checked_at: d.dns_checked_at,
      spf_record: spfRecord(),
      dkim_record_name: dkimSelectorRecordName(d.dkim_selector || identifierString),
      dkim_record: dkimRecord(d.dkim_public_key || ''),
      return_path_domain: returnPathDomain(d.domain),
      return_path_target: config.dns.returnPathDomain,
      mx_records: config.dns.mxRecords,
      subdomain_pool: {
        total: parseInt(subdomainStats.rows[0]?.total || '0'),
        active: parseInt(subdomainStats.rows[0]?.active || '0'),
        warming: parseInt(subdomainStats.rows[0]?.warming || '0'),
        inactive: parseInt(subdomainStats.rows[0]?.inactive || '0'),
        dns_ready: parseInt(subdomainStats.rows[0]?.dns_ready || '0'),
      },
      checks: {
        spf: { status: d.spf_status, error: d.spf_error },
        dkim: { status: d.dkim_status, error: d.dkim_error },
        mx: { status: d.mx_status, error: d.mx_error },
        return_path: { status: d.return_path_status, error: d.return_path_error },
      },
    });
  } catch (err) {
    console.error('Domain setup error:', err);
    res.status(500).json({ error: 'Failed to get domain setup info' });
  }
});

router.get('/domains/:id/verify', async (req: Request, res: Response) => {
  try {
    const domainResult = await query<{
      id: string; domain: string; verification_method: string;
      verification_token: string; verified: boolean;
    }>(
      'SELECT id, domain, verification_method, verification_token, verified FROM customer_domains WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user!.orgId!]
    );
    if (domainResult.rows.length === 0) {
      return res.status(404).json({ error: 'Domain not found' });
    }
    const d = domainResult.rows[0];
    if (d.verified) {
      return res.json({ verified: true, redirect: '/portal/domains', flash: { alert: `${d.domain} has already been verified.` } });
    }
    res.json({
      id: d.id,
      name: d.domain,
      verification_method: d.verification_method || 'DNS',
      dns_verification_string: dnsVerificationString(d.verification_token),
      verification_email_addresses: verificationEmailAddresses(d.domain),
      verification_token: d.verification_token,
      email_address: (req.query as any).email_address || '',
    });
  } catch {
    res.status(500).json({ error: 'Failed to get domain verification info' });
  }
});

router.post('/domains/:id/verify', async (req: Request, res: Response) => {
  try {
    const domainResult = await query<{
      id: string; domain: string; verification_method: string;
      verification_token: string; verified: boolean;
    }>(
      'SELECT id, domain, verification_method, verification_token, verified FROM customer_domains WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user!.orgId!]
    );
    if (domainResult.rows.length === 0) {
      return res.status(404).json({ error: 'Domain not found' });
    }
    const d = domainResult.rows[0];
    if (d.verified) {
      return res.json({ verified: true, redirect: '/portal/domains', flash: { alert: `${d.domain} has already been verified.` } });
    }

    const method = d.verification_method || 'DNS';
    const { code, email_address } = req.body;

    if (method === 'DNS') {
      const matches = await verifyWithDNS(d.domain, d.verification_token);
      if (matches) {
        await markVerified(d.id);
        await markSubdomainsDnsReady(d.domain);
        return res.json({
          verified: true,
          redirect: `/portal/domains/${d.id}/setup`,
          flash: { notice: `${d.domain} has been verified successfully. You now need to configure your DNS records.` },
        });
      }
      return res.json({
        verified: false,
        flash: { alert: `We couldn't verify your domain. Please double check you've added the TXT record correctly.` },
      });
    }

    // Email verification
    if (code) {
      if (d.verification_token === String(code).trim()) {
        await markVerified(d.id);
        await markSubdomainsDnsReady(d.domain);
        return res.json({
          verified: true,
          redirect: `/portal/domains/${d.id}/setup`,
          flash: { notice: `${d.domain} has been verified successfully. You now need to configure your DNS records.` },
        });
      }
      return res.json({ verified: false, flash: { alert: 'Invalid verification code. Please check and try again.' } });
    }

    if (email_address) {
      const allowed = verificationEmailAddresses(d.domain);
      if (!allowed.includes(email_address)) {
        return res.status(400).json({ error: 'Invalid email address' });
      }
      const msgId = `<${crypto.randomUUID()}@${d.domain}>`;
      const codeText = `Your verification code is: ${d.verification_token}\n\nPlease enter this code to verify your domain.`;
      await query(
        `INSERT INTO sent_messages (organization_id, mail_from, rcpt_to, subject, body_text, raw_headers, size, status, message_id, scope)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'outgoing')`,
        [req.user!.orgId!, `noreply@${d.domain}`, email_address, 'Domain Verification',
         codeText,
         '', 100, 'sent', msgId]
      );
      deliverVerificationEmail(d.domain, email_address, codeText).catch(() => {});
      return res.json({
        email_address,
        verification_code: d.verification_token,
        redirect: `/portal/domains/${d.id}/verify?email_address=${encodeURIComponent(email_address)}`,
      });
    }

    res.status(400).json({ error: 'Missing verification input' });
  } catch (err) {
    console.error('Verify domain error:', err);
    res.status(500).json({ error: 'Failed to verify domain' });
  }
});

router.post('/domains/:id/check', async (req: Request, res: Response) => {
  try {
    const domainResult = await query<{
      id: string; domain: string; dkim_identifier_string: string; dkim_selector: string; dkim_public_key: string;
    }>(
      'SELECT id, domain, dkim_identifier_string, dkim_selector, dkim_public_key FROM customer_domains WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user!.orgId!]
    );
    if (domainResult.rows.length === 0) return res.status(404).json({ error: 'Domain not found' });

    const d = domainResult.rows[0];
    const selector = d.dkim_selector || d.dkim_identifier_string || '';
    const { checks, ok } = await checkDomainDNS(d.domain, selector, dkimRecord(d.dkim_public_key || ''));

    await query(
      `UPDATE customer_domains SET spf_status = $1, spf_error = $2, dkim_status = $3, dkim_error = $4,
              mx_status = $5, mx_error = $6, return_path_status = $7, return_path_error = $8,
              dkim_observed_selector = $9, dkim_observed_name = $10, dkim_observed_value = $11,
              spf_observed_record = $12, dns_checked_at = NOW()
       WHERE id = $13 AND organization_id = $14`,
      [
        checks.spf.status, checks.spf.error,
        checks.dkim.status, checks.dkim.error,
        checks.mx.status, checks.mx.error,
        checks.return_path.status, checks.return_path.error,
        checks.dkim.selector || selector,
        checks.dkim.checked_name || `${selector}._domainkey.${d.domain}`,
        checks.dkim.found || null,
        checks.spf.found || null,
        req.params.id,
        req.user!.orgId!,
      ]
    );

    if (ok) {
      await markSubdomainsDnsReady(d.domain);
      return res.json({ dns_ok: true, ok, checks, passed: Object.entries(checks).filter(([, c]: any) => c.status === 'OK'), failed: Object.entries(checks).filter(([, c]: any) => c.status !== 'OK'), redirect: '/portal/domains', flash: { notice: `Your DNS records for ${d.domain} look good! Subdomains are ready for warmup.` } });
    }
    return res.json({
      dns_ok: false,
      ok,
      checks,
      passed: Object.entries(checks).filter(([, c]: any) => c.status === 'OK'),
      failed: Object.entries(checks).filter(([, c]: any) => c.status !== 'OK'),
      redirect: `/portal/domains/${d.id}/setup`,
      flash: { alert: 'There seems to be something wrong with your DNS records. Check below for information.' },
    });
  } catch (err) {
    console.error('Check DNS error:', err);
    res.status(500).json({ error: 'Failed to check DNS' });
  }
});

router.post('/domains', async (req: Request, res: Response) => {
  try {
    let { domain, verification_method, subdomain_count, naming_scheme, custom_prefix } = req.body;
    if (!domain) return res.status(400).json({ error: 'Domain name required' });

    const orgId = req.user!.orgId!;
    domain = String(domain).toLowerCase().trim();
    if (!/^[a-z0-9][a-z0-9\-.]*[a-z0-9]$/.test(domain) || !domain.includes('.')) {
      return res.status(422).json({ error: 'Enter a valid domain name using lowercase letters, numbers, dashes and dots' });
    }

    const existing = await query('SELECT id FROM customer_domains WHERE LOWER(domain) = $1 AND organization_id = $2', [domain, orgId]);
    if (existing.rows.length > 0) {
      return res.status(422).json({ error: 'Domain is already added' });
    }

    const method = VERIFICATION_METHODS.includes(verification_method) ? verification_method : 'DNS';
    const verificationToken = generateVerificationToken(method);
    const dkimIdentifierString = generateDKIMIdentifierString();

    const key = generateKeyPair();
    const pubKeyBase64 = extractPublicKeyBase64(key.publicKey);
    const encryptedPrivKey = encryptPrivateKey(key.privateKey);

    const result = await query<{ id: string }>(
      `INSERT INTO customer_domains
       (organization_id, domain, verification_token, verification_method, dkim_identifier_string,
        dkim_selector, dkim_private_key, dkim_public_key, outgoing)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
       RETURNING id`,
      [orgId, domain, verificationToken, method, dkimIdentifierString, dkimIdentifier(dkimIdentifierString), encryptedPrivKey, pubKeyBase64]
    );

    const count = parseSubdomainCount(subdomain_count);
    const pool = count > 0 ? await provisionDomainSubdomains({
      orgId,
      domain,
      count,
      namingScheme: normalizeNamingScheme(naming_scheme),
      customPrefix: custom_prefix ? String(custom_prefix).toLowerCase().replace(/[^a-z0-9-]/g, '') : undefined,
    }) : { domainId: '', created: 0, skipped: 0, errors: [], subdomains: [] };

    res.status(201).json({
      id: result.rows[0].id,
      verified: false,
      verification_method: method,
      subdomain_pool: pool,
    });
  } catch (err: any) {
    console.error('Add domain error:', err);
    res.status(500).json({ error: 'Failed to add domain' });
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

async function verifyWithDNS(name: string, verificationToken: string): Promise<boolean> {
  const records = await resolveTxt(name);
  return records.includes(dnsVerificationString(verificationToken));
}

async function markVerified(id: string): Promise<void> {
  await query('UPDATE customer_domains SET verified = true, verified_at = NOW() WHERE id = $1', [id]);
}

async function deliverVerificationEmail(domain: string, to: string, body: string): Promise<void> {
  try {
    const nodemailer = await import('nodemailer');
    const mxRecords = await dns.promises.resolveMx(to.split('@')[1]);
    if (!mxRecords || mxRecords.length === 0) return;
    mxRecords.sort((a, b) => a.priority - b.priority);
    const transporter = nodemailer.createTransport({
      host: mxRecords[0].exchange,
      port: 25,
      secure: false,
      tls: { rejectUnauthorized: false },
    });
    await transporter.sendMail({
      from: `postmaster@${domain}`,
      envelope: { from: `postmaster@${domain}`, to: [to] },
      to,
      subject: 'Domain Verification',
      text: body,
    });
    transporter.close();
  } catch {
    // Delivery failures are tolerated; the record still exists in sent_messages.
  }
}

// ─── SMTP Credentials ────────────────────────────────────

router.get('/credentials', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT sc.id, sc.name, sc.username, sc.type, sc.tier, sc.hold,
              sc.allowed_from_email, sc.default_from_name, sc.last_used_at, sc.created_at,
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
    const { name, domainId, type, tier, hold, allowed_from_email, default_from_name } = req.body;
    if (!name) return res.status(400).json({ error: 'Credential name required' });

    const orgId = req.user!.orgId!;
    const credentialTier = normalizeCredentialTier(tier || type);
    const allowedFromEmail = normalizeOptionalEmail(allowed_from_email);
    const defaultFromName = normalizeOptionalName(default_from_name);
    if (allowedFromEmail === '') return res.status(400).json({ error: 'Allowed From address is not a valid email address' });

    const credentialDomain = await getVerifiedCredentialDomain(domainId, orgId);
    if (domainId && !credentialDomain) {
      return res.status(400).json({ error: 'Selected domain must be verified before it can be used for SMTP credentials' });
    }
    if (allowedFromEmail && credentialDomain && allowedFromEmail.split('@')[1] !== credentialDomain.domain.toLowerCase()) {
      return res.status(400).json({ error: `Allowed From address must use ${credentialDomain.domain}` });
    }

    const username = `u_${crypto.randomBytes(12).toString('hex')}`;
    const password = crypto.randomBytes(24).toString('base64').replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
    const hash = await require('bcryptjs').hash(password, 10);
    const credType = (type || 'smtp').toLowerCase();

    const result = await query<{ id: string }>(
      `INSERT INTO smtp_credentials (organization_id, customer_domain_id, name, username, password_hash, type, tier, allowed_from_email, default_from_name, hold)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [orgId, credentialDomain?.id || null, name, username, hash, credType, credentialTier, allowedFromEmail, defaultFromName, hold === 'true' || hold === true]
    );

    res.status(201).json({
      id: result.rows[0].id,
      name,
      username,
      password,
      type: credType,
      tier: credentialTier,
      smtp_host: config.dns.heloHostname,
      smtp_port: smtpPortForTier(credentialTier),
      domain_name: credentialDomain?.domain || null,
      allowed_from_email: allowedFromEmail,
      default_from_name: defaultFromName,
    });
  } catch (err) {
    console.error('Create credential error:', err);
    res.status(500).json({ error: 'Failed to create credential' });
  }
});

router.put('/credentials/:id', async (req: Request, res: Response) => {
  try {
    const { name, hold, domainId, tier, allowed_from_email, default_from_name } = req.body;
    if (!name) return res.status(400).json({ error: 'Credential name required' });
    const orgId = req.user!.orgId!;
    const credentialTier = normalizeCredentialTier(tier);
    const allowedFromEmail = normalizeOptionalEmail(allowed_from_email);
    const defaultFromName = normalizeOptionalName(default_from_name);
    if (allowedFromEmail === '') return res.status(400).json({ error: 'Allowed From address is not a valid email address' });

    const credentialDomain = await getVerifiedCredentialDomain(domainId, orgId);
    if (domainId && !credentialDomain) {
      return res.status(400).json({ error: 'Selected domain must be verified before it can be used for SMTP credentials' });
    }
    if (allowedFromEmail && credentialDomain && allowedFromEmail.split('@')[1] !== credentialDomain.domain.toLowerCase()) {
      return res.status(400).json({ error: `Allowed From address must use ${credentialDomain.domain}` });
    }

    await query(
      `UPDATE smtp_credentials
       SET name = $1, hold = $2, customer_domain_id = $3, tier = $4, allowed_from_email = $5, default_from_name = $6
       WHERE id = $7 AND organization_id = $8`,
      [name, hold === 'true' || hold === true, credentialDomain?.id || null, credentialTier, allowedFromEmail, defaultFromName, req.params.id, orgId]
    );
    res.json({ message: 'Credential saved' });
  } catch {
    res.status(500).json({ error: 'Failed to save credential' });
  }
});

router.get('/credentials/:id', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT sc.id, sc.name, sc.username, sc.type, sc.tier, sc.hold, sc.customer_domain_id,
              sc.allowed_from_email, sc.default_from_name, cd.domain as domain_name
       FROM smtp_credentials sc
       LEFT JOIN customer_domains cd ON cd.id = sc.customer_domain_id
       WHERE sc.id = $1 AND sc.organization_id = $2`,
      [req.params.id, req.user!.orgId!]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Credential not found' });
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Failed to load credential' });
  }
});

router.get('/credentials/:id/show', async (req: Request, res: Response) => {
  try {
    const result = await query(
      'SELECT id, name, username, password FROM smtp_credentials WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user!.orgId!]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Credential not found' });
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Failed to load credential' });
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

// ─── Subdomains ───────────────────────────────────────────

// IMAP Mailboxes

router.get('/mailboxes', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT ma.id, ma.email, ma.display_name, ma.quota_mb, ma.active, ma.imap_enabled,
              ma.smtp_enabled, ma.smtp_tier, ma.last_login_at, ma.created_at, cd.domain as domain_name,
              COALESCE(COUNT(mm.id), 0)::int as message_count,
              COALESCE(SUM(mm.size), 0)::int as storage_bytes,
              COALESCE(COUNT(mm.id) FILTER (WHERE NOT (mm.flags @> ARRAY['\\Seen']::TEXT[])), 0)::int as unread_count
       FROM mailbox_accounts ma
       LEFT JOIN customer_domains cd ON cd.id = ma.customer_domain_id
       LEFT JOIN mailbox_messages mm ON mm.mailbox_id = ma.id
       WHERE ma.organization_id = $1
       GROUP BY ma.id, cd.domain
       ORDER BY ma.created_at DESC`,
      [req.user!.orgId!]
    );
    res.json({ mailboxes: result.rows });
  } catch (err) {
    console.error('List mailboxes error:', err);
    res.status(500).json({ error: 'Failed to list mailboxes' });
  }
});

router.post('/mailboxes', async (req: Request, res: Response) => {
  try {
    const { email, display_name, password, quota_mb, active, imap_enabled, smtp_enabled, smtp_tier, aliases } = req.body;
    const normalizedEmail = normalizeMailboxEmail(email);
    if (!isValidMailboxEmail(normalizedEmail)) return res.status(400).json({ error: 'Valid mailbox email required' });
    if (!password || String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const domainPart = normalizedEmail.split('@')[1];
    const domain = await findVerifiedDomainForAddress(domainPart, req.user!.orgId!);
    if (!domain || domain.domain.toLowerCase() !== domainPart) {
      return res.status(400).json({ error: `Domain ${domainPart} must be verified before creating mailboxes` });
    }
    const aliasList = normalizeAliasList(aliases).filter((alias) => alias !== normalizedEmail);
    const aliasError = await validateMailboxAddresses(aliasList, req.user!.orgId!);
    if (aliasError) return res.status(400).json({ error: aliasError });

    const mailbox = await createMailboxAccount({
      orgId: req.user!.orgId!,
      customerDomainId: domain.id,
      email: normalizedEmail,
      displayName: display_name,
      password,
      quotaMb: quota_mb ? parseInt(String(quota_mb), 10) : 1024,
      active: active !== 'false' && active !== false,
      imapEnabled: imap_enabled !== 'false' && imap_enabled !== false,
      smtpEnabled: smtp_enabled !== 'false' && smtp_enabled !== false,
      smtpTier: normalizeCredentialTier(smtp_tier),
    });
    await syncMailboxAliases(mailbox.id, req.user!.orgId!, aliasList);
    res.status(201).json({ id: mailbox.id, email: normalizedEmail });
  } catch (err: any) {
    console.error('Create mailbox error:', err);
    res.status(500).json({ error: err?.code === '23505' ? 'Mailbox already exists' : 'Failed to create mailbox' });
  }
});

router.get('/mailboxes/:id', async (req: Request, res: Response) => {
  try {
    const mailboxId = String(req.params.id);
    const result = await query(
      `SELECT ma.id, ma.customer_domain_id, ma.email, ma.display_name, ma.quota_mb, ma.active, ma.imap_enabled,
              ma.smtp_enabled, ma.smtp_tier, ma.last_login_at, ma.created_at, cd.domain as domain_name
       FROM mailbox_accounts ma
       LEFT JOIN customer_domains cd ON cd.id = ma.customer_domain_id
       WHERE ma.id = $1 AND ma.organization_id = $2`,
      [mailboxId, req.user!.orgId!]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Mailbox not found' });
    await ensureDefaultFolders(mailboxId);
    const folders = await listFolders(mailboxId);
    const aliases = await query('SELECT id, address, active FROM mailbox_aliases WHERE mailbox_id = $1 AND organization_id = $2 ORDER BY address', [mailboxId, req.user!.orgId!]);
    res.json({ mailbox: result.rows[0], folders, aliases: aliases.rows });
  } catch {
    res.status(500).json({ error: 'Failed to load mailbox' });
  }
});

router.put('/mailboxes/:id', async (req: Request, res: Response) => {
  try {
    const mailboxId = String(req.params.id);
    const exists = await query('SELECT id FROM mailbox_accounts WHERE id = $1 AND organization_id = $2', [mailboxId, req.user!.orgId!]);
    if (exists.rows.length === 0) return res.status(404).json({ error: 'Mailbox not found' });
    const aliasList = normalizeAliasList(req.body.aliases).filter((alias) => alias !== normalizeMailboxEmail(req.body.email || ''));
    const aliasError = await validateMailboxAddresses(aliasList, req.user!.orgId!);
    if (aliasError) return res.status(400).json({ error: aliasError });
    await updateMailboxAccount({
      id: mailboxId,
      orgId: req.user!.orgId!,
      displayName: req.body.display_name,
      password: req.body.password || null,
      quotaMb: req.body.quota_mb ? parseInt(String(req.body.quota_mb), 10) : 1024,
      active: req.body.active !== 'false' && req.body.active !== false,
      imapEnabled: req.body.imap_enabled !== 'false' && req.body.imap_enabled !== false,
      smtpEnabled: req.body.smtp_enabled !== 'false' && req.body.smtp_enabled !== false,
      smtpTier: normalizeCredentialTier(req.body.smtp_tier),
    });
    await syncMailboxAliases(mailboxId, req.user!.orgId!, aliasList);
    res.json({ message: 'Mailbox saved' });
  } catch {
    res.status(500).json({ error: 'Failed to save mailbox' });
  }
});

router.delete('/mailboxes/:id', async (req: Request, res: Response) => {
  try {
    await query('DELETE FROM mailbox_accounts WHERE id = $1 AND organization_id = $2', [String(req.params.id), req.user!.orgId!]);
    res.json({ message: 'Mailbox deleted' });
  } catch {
    res.status(500).json({ error: 'Failed to delete mailbox' });
  }
});

router.get('/mailboxes/:id/messages', async (req: Request, res: Response) => {
  try {
    const mailboxId = String(req.params.id);
    const mailbox = await query('SELECT id FROM mailbox_accounts WHERE id = $1 AND organization_id = $2', [mailboxId, req.user!.orgId!]);
    if (mailbox.rows.length === 0) return res.status(404).json({ error: 'Mailbox not found' });
    const folders = await listFolders(mailboxId);
    const folder = folders.find((f) => f.name.toLowerCase() === String(req.query.folder || 'INBOX').toLowerCase()) || folders[0];
    const messages = folder ? await listMessages(folder.id, 100) : [];
    res.json({ folders, folder, messages });
  } catch {
    res.status(500).json({ error: 'Failed to list mailbox messages' });
  }
});

router.get('/mailboxes/:id/messages/:messageId/source', async (req: Request, res: Response) => {
  try {
    const result = await query<{ raw_source: string }>(
      `SELECT mm.raw_source
       FROM mailbox_messages mm
       JOIN mailbox_accounts ma ON ma.id = mm.mailbox_id
       WHERE ma.id = $1 AND ma.organization_id = $2 AND mm.id = $3`,
      [String(req.params.id), req.user!.orgId!, String(req.params.messageId)]
    );
    if (result.rows.length === 0) return res.status(404).send('Message not found');
    res.type('text/plain').send(result.rows[0].raw_source);
  } catch {
    res.status(500).send('Failed to load source');
  }
});

router.get('/subdomains', async (req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT s.id, s.subdomain, d.domain as root_domain, s.sender_name,
              s.total_sent, s.emails_sent_today, s.daily_limit,
              s.warmup_complete, s.dns_verified, s.status, s.bounce_rate,
              s.engagement_score, s.created_at
       FROM subdomains s
       JOIN domains d ON s.domain_id = d.id
       JOIN customer_domains cd ON LOWER(cd.domain) = LOWER(d.domain) AND cd.organization_id = $1
       ORDER BY d.domain, s.subdomain`,
      [req.user!.orgId!]
    );
    res.json({ subdomains: result.rows });
  } catch (err) {
    console.error('Subdomains error:', err);
    res.status(500).json({ error: 'Failed to list subdomains' });
  }
});

router.post('/subdomains', async (req: Request, res: Response) => {
  try {
    const { domain_id, count, start_index, naming_scheme, custom_prefix } = req.body;
    if (!domain_id) return res.status(400).json({ error: 'domain_id required' });

    const domainRow = await query<{ id: string; domain: string }>(
      'SELECT id, domain FROM customer_domains WHERE id = $1 AND organization_id = $2',
      [domain_id, req.user!.orgId!]
    );
    if (domainRow.rows.length === 0) return res.status(404).json({ error: 'Domain not found' });

    const result = await provisionDomainSubdomains({
      orgId: req.user!.orgId!,
      domain: domainRow.rows[0].domain,
      count: parseSubdomainCount(count),
      startIndex: start_index ? parseInt(start_index, 10) : 1,
      namingScheme: normalizeNamingScheme(naming_scheme),
      customPrefix: custom_prefix ? String(custom_prefix).toLowerCase().replace(/[^a-z0-9-]/g, '') : undefined,
    });
    res.json(result);
  } catch (err) {
    console.error('Provision subdomains error:', err);
    res.status(500).json({ error: 'Failed to provision subdomains' });
  }
});

router.post('/subdomains/activate', async (req: Request, res: Response) => {
  try {
    const { domain_id, ids } = req.body;
    const ownedDomainIds = await getOwnedPoolDomainIds(req.user!.orgId!);
    if (ownedDomainIds.length === 0) return res.status(404).json({ error: 'No domains available' });

    let idsToActivate: string[] = [];
    if (Array.isArray(ids) && ids.length > 0) {
      const result = await query<{ id: string }>(
        `SELECT id FROM subdomains WHERE id = ANY($1::uuid[]) AND domain_id = ANY($2::uuid[])`,
        [ids, ownedDomainIds]
      );
      idsToActivate = result.rows.map((r) => r.id);
    } else if (domain_id) {
      const customerDomain = await query<{ domain: string }>(
        'SELECT domain FROM customer_domains WHERE id = $1 AND organization_id = $2',
        [domain_id, req.user!.orgId!]
      );
      if (customerDomain.rows.length === 0) return res.status(404).json({ error: 'Domain not found' });
      const poolDomain = await ensurePoolDomain(customerDomain.rows[0].domain);
      const result = await query<{ id: string }>(
        "SELECT id FROM subdomains WHERE domain_id = $1 AND status IN ('inactive', 'warming', 'provisioning')",
        [poolDomain.id]
      );
      idsToActivate = result.rows.map((r) => r.id);
    } else {
      const result = await query<{ id: string }>(
        "SELECT id FROM subdomains WHERE domain_id = ANY($1::uuid[]) AND status IN ('inactive', 'warming', 'provisioning')",
        [ownedDomainIds]
      );
      idsToActivate = result.rows.map((r) => r.id);
    }

    const result = await activateSubdomainBatch(idsToActivate);
    res.json(result);
  } catch (err) {
    console.error('Activate subdomains error:', err);
    res.status(500).json({ error: 'Failed to activate subdomains' });
  }
});

router.put('/subdomains/:id/limit', async (req: Request, res: Response) => {
  try {
    const { daily_limit } = req.body;
    const limit = parseInt(daily_limit);
    if (isNaN(limit) || limit < 1 || limit > 1000) {
      return res.status(400).json({ error: 'daily_limit must be a number between 1 and 1000' });
    }
    const result = await query(
      `UPDATE subdomains s
       SET daily_limit = $1
       FROM domains d
       JOIN customer_domains cd ON LOWER(cd.domain) = LOWER(d.domain) AND cd.organization_id = $3
       WHERE s.id = $2 AND s.domain_id = d.id
       RETURNING s.id`,
      [limit, req.params.id, req.user!.orgId!]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Subdomain not found' });
    res.json({ success: true, daily_limit: limit });
  } catch (err) {
    console.error('Update limit error:', err);
    res.status(500).json({ error: 'Failed to update daily limit' });
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
    const { send_limit, allow_sender, privacy_mode, log_smtp_data, outbound_spam_threshold, message_retention_days, raw_message_retention_days, raw_message_retention_size } = req.body;
    await query(
      `UPDATE servers SET
       send_limit = $1, allow_sender = $2, privacy_mode = $3, log_smtp_data = $4, outbound_spam_threshold = $5,
       message_retention_days = $6, raw_message_retention_days = $7, raw_message_retention_size = $8
       WHERE organization_id = $9`,
      [
        send_limit !== undefined && send_limit !== '' ? parseInt(send_limit) : null,
        allow_sender === 'true',
        privacy_mode === 'true',
        log_smtp_data === 'true',
        outbound_spam_threshold !== undefined && outbound_spam_threshold !== '' ? parseFloat(outbound_spam_threshold) : null,
        message_retention_days !== undefined && message_retention_days !== '' ? parseInt(message_retention_days) : null,
        raw_message_retention_days !== undefined && raw_message_retention_days !== '' ? parseInt(raw_message_retention_days) : null,
        raw_message_retention_size !== undefined && raw_message_retention_size !== '' ? parseInt(raw_message_retention_size) : null,
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

// ─── Delete Server (Postal servers#destroy) ────────────────

router.post('/settings/delete', async (req: Request, res: Response) => {
  try {
    const { confirm_text } = req.body;
    const serverResult = await query(
      'SELECT name FROM servers WHERE organization_id = $1',
      [req.user!.orgId!]
    );
    const server = serverResult.rows[0];
    if (server && String(confirm_text || '').trim().toLowerCase() !== String(server.name).trim().toLowerCase()) {
      return res.json({
        alert: 'The text you entered does not match the server name. Please check and try again.',
      });
    }
    await query('DELETE FROM servers WHERE organization_id = $1', [req.user!.orgId!]);
    res.json({
      redirect: '/portal/dashboard',
      notice: server ? `${server.name} has been deleted successfully` : 'Server has been deleted successfully',
    });
  } catch {
    res.status(500).json({ error: 'Failed to delete server' });
  }
});

// ─── Spam Thresholds (Postal servers#update) ───────────────

router.post('/settings/spam', async (req: Request, res: Response) => {
  try {
    const { spam_threshold, spam_failure_threshold } = req.body;
    await query(
      `UPDATE servers SET spam_threshold = $1, spam_failure_threshold = $2 WHERE organization_id = $3`,
      [
        spam_threshold !== undefined ? parseFloat(spam_threshold) : 5,
        spam_failure_threshold !== undefined ? parseFloat(spam_failure_threshold) : 20,
        req.user!.orgId!,
      ]
    );
    res.json({ message: 'Spam thresholds saved' });
  } catch {
    res.status(500).json({ error: 'Failed to save spam thresholds' });
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
      `SELECT name, username FROM smtp_credentials WHERE organization_id = $1 AND type LIKE 'smtp%' ORDER BY created_at DESC LIMIT 1`,
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
      `SELECT r.*, cd.domain as route_domain
       FROM routes r
       LEFT JOIN customer_domains cd ON cd.domain = r.domain AND cd.organization_id = r.organization_id
       WHERE r.organization_id = $1 ORDER BY r.priority ASC`,
      [req.user!.orgId!]
    );
    const routes = result.rows.map((r: any) => {
      const endpointType = r.action_type === 'http' ? 'HTTP' : r.action_type === 'smtp' ? 'SMTP' : r.action_type === 'address' ? 'Address' : null;
      return {
        id: r.id,
        description: r.name || 'Unnamed Route',
        domain: r.domain,
        mode: r.mode || 'Endpoint',
        endpoint_type: endpointType,
        endpoint: r.action_value || '',
        spam_mode: r.spam_mode || 'Mark',
        action_type: r.action_type,
        action_value: r.action_value,
      };
    });
    res.json({
      routes,
      endpoint_counts: {
        http: routes.filter((r: any) => r.endpoint_type === 'HTTP').length,
        smtp: routes.filter((r: any) => r.endpoint_type === 'SMTP').length,
        address: routes.filter((r: any) => r.endpoint_type === 'Address').length,
        total: routes.length,
      },
    });
  } catch {
    res.status(500).json({ error: 'Failed to list routes' });
  }
});

router.post('/routes', async (req: Request, res: Response) => {
  try {
    const { name, domain, endpoint_type, http_url, smtp_host, smtp_port, address, spam_mode } = req.body;
    let actionValue = '';
    let actionType = 'webhook';
    if (endpoint_type === 'HTTP' && http_url) { actionType = 'http'; actionValue = http_url; }
    else if (endpoint_type === 'SMTP' && smtp_host) { actionType = 'smtp'; actionValue = `${smtp_host}:${smtp_port || 587}`; }
    else if (endpoint_type === 'Address' && address) { actionType = 'address'; actionValue = address; }
    const result = await query<{ id: string }>(
      `INSERT INTO routes (organization_id, name, domain, match_type, match_value, action_type, action_value, spam_mode, mode, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Endpoint', 10) RETURNING id`,
      [req.user!.orgId!, name || 'Unnamed Route', domain || null, 'catch_all', '', actionType, actionValue, spam_mode || 'Mark']
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

router.put('/routes/:id', async (req: Request, res: Response) => {
  try {
    const { name, domain, endpoint_type, http_url, smtp_host, smtp_port, address, spam_mode } = req.body;
    let actionValue = '';
    let actionType = 'webhook';
    if (endpoint_type === 'HTTP' && http_url) { actionType = 'http'; actionValue = http_url; }
    else if (endpoint_type === 'SMTP' && smtp_host) { actionType = 'smtp'; actionValue = `${smtp_host}:${smtp_port || 587}`; }
    else if (endpoint_type === 'Address' && address) { actionType = 'address'; actionValue = address; }
    await query(
      `UPDATE routes SET name = $1, domain = $2, action_type = $3, action_value = $4, spam_mode = $5 WHERE id = $6 AND organization_id = $7`,
      [name || 'Unnamed Route', domain || null, actionType, actionValue, spam_mode || 'Mark', req.params.id, req.user!.orgId!]
    );
    res.json({ message: 'Route updated' });
  } catch {
    res.status(500).json({ error: 'Failed to update route' });
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
    const { name, endpoint_url, events, enabled } = req.body;
    if (!endpoint_url) return res.status(400).json({ error: 'URL required' });
    const result = await query<{ id: string }>(
      `INSERT INTO webhooks (organization_id, name, endpoint_url, events, enabled)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [req.user!.orgId!, name || endpoint_url, endpoint_url, events || [], enabled === false ? false : true]
    );
    res.status(201).json({ id: result.rows[0].id });
  } catch {
    res.status(500).json({ error: 'Failed to create webhook' });
  }
});

router.get('/webhooks/:id', async (req: Request, res: Response) => {
  try {
    const result = await query(
      'SELECT id, name, endpoint_url, events, enabled, last_delivered_at FROM webhooks WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user!.orgId!]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Webhook not found' });
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Failed to load webhook' });
  }
});

router.put('/webhooks/:id', async (req: Request, res: Response) => {
  try {
    const { name, endpoint_url, events, enabled } = req.body;
    await query(
      `UPDATE webhooks SET name = $1, endpoint_url = $2, events = $3, enabled = $4 WHERE id = $5 AND organization_id = $6`,
      [name, endpoint_url, events || [], enabled === false ? false : true, req.params.id, req.user!.orgId!]
    );
    res.json({ message: 'Webhook saved' });
  } catch {
    res.status(500).json({ error: 'Failed to save webhook' });
  }
});

router.post('/webhooks/:id/toggle', async (req: Request, res: Response) => {
  try {
    const wh = await query<{ enabled: boolean }>(
      'SELECT enabled FROM webhooks WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user!.orgId!]
    );
    if (wh.rows.length === 0) return res.status(404).json({ error: 'Webhook not found' });
    await query(
      'UPDATE webhooks SET enabled = $1 WHERE id = $2 AND organization_id = $3',
      [!wh.rows[0].enabled, req.params.id, req.user!.orgId!]
    );
    res.json({ enabled: !wh.rows[0].enabled });
  } catch {
    res.status(500).json({ error: 'Failed to toggle webhook' });
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
    const { domain, ssl_enabled, track_loads, track_clicks, excluded_click_domains } = req.body;
    if (!domain) return res.status(400).json({ error: 'Domain required' });
    const result = await query<{ id: string }>(
      'INSERT INTO track_domains (organization_id, domain, ssl_enabled, track_loads, track_clicks, excluded_click_domains) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [req.user!.orgId!, domain.toLowerCase(), ssl_enabled !== false, track_loads !== false, track_clicks !== false, excluded_click_domains || '']
    );
    res.status(201).json({ id: result.rows[0].id, domain: domain.toLowerCase(), ssl_enabled: ssl_enabled !== false });
  } catch {
    res.status(500).json({ error: 'Failed to add track domain' });
  }
});

router.get('/track-domains/:id', async (req: Request, res: Response) => {
  try {
    const result = await query(
      'SELECT id, domain, ssl_enabled, track_loads, track_clicks, excluded_click_domains, dns_status, dns_error FROM track_domains WHERE id = $1 AND organization_id = $2',
      [req.params.id, req.user!.orgId!]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Track domain not found' });
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ error: 'Failed to load track domain' });
  }
});

router.put('/track-domains/:id', async (req: Request, res: Response) => {
  try {
    const { ssl_enabled, track_loads, track_clicks, excluded_click_domains } = req.body;
    await query(
      'UPDATE track_domains SET ssl_enabled = $1, track_loads = $2, track_clicks = $3, excluded_click_domains = $4 WHERE id = $5 AND organization_id = $6',
      [ssl_enabled !== false, track_loads !== false, track_clicks !== false, excluded_click_domains || '', req.params.id, req.user!.orgId!]
    );
    res.json({ message: 'Track domain saved' });
  } catch {
    res.status(500).json({ error: 'Failed to save track domain' });
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
      'UPDATE track_domains SET ssl_enabled = $1 WHERE id = $2 AND organization_id = $3',
      [!current, req.params.id, req.user!.orgId!]
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
      const expectedTarget = config.dns.trackDomain.toLowerCase().replace(/\.$/, '');
      if (cnameRecords.some((r: string) => r.toLowerCase().replace(/\.$/, '') === expectedTarget)) {
        dnsStatus = 'OK';
      } else {
        dnsError = `CNAME does not point to ${config.dns.trackDomain}`;
      }
    } catch (err: any) {
      dnsError = err.message;
    }
    await query(
      'UPDATE track_domains SET dns_verified = $1, dns_status = $2, dns_error = $3 WHERE id = $4 AND organization_id = $5',
      [dnsStatus === 'OK', dnsStatus, dnsError, req.params.id, req.user!.orgId!]
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
    const rows = result.rows.map((r: any) => ({
      ...r,
      keep_until: new Date(new Date(r.suppressed_at).getTime() + 30 * 24 * 3600 * 1000),
    }));
    res.json({ suppressions: rows });
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
       JOIN customer_domains cd ON LOWER(cd.domain) = LOWER(d.domain) AND cd.organization_id = $1
       LEFT JOIN subdomain_pool_tracking spt ON spt.subdomain_id = s.id AND spt.organization_id = $1
       ORDER BY spt.last_used_at DESC NULLS LAST`,
      [req.user!.orgId!]
    );
    res.json({ pool: result.rows });
  } catch {
    res.status(500).json({ error: 'Failed to list pool' });
  }
});

// ─── Organization Update ──────────────────────────────────

router.put('/settings', async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (name) {
      await query('UPDATE organizations SET name = $1 WHERE id = $2', [name, req.user!.orgId!]);
    }
    res.json({ message: 'Settings saved' });
  } catch {
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

export default router;
