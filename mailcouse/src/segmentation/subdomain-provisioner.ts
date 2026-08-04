import { query } from '../db/connection';
import { generateKeyPair, extractPublicKeyBase64 } from '../dkim/key-generator';
import { encryptPrivateKey } from '../dkim/key-store';
import { CloudflareClient } from '../cloudflare/client';

export interface BulkProvisionResult {
  success: boolean;
  total: number;
  created: number;
  skipped: number;
  errors: string[];
  subdomains: string[];
}

export interface SubdomainConfig {
  domainId: string;
  rootDomain: string;
  cloudflareZoneId?: string;
  count: number;
  startIndex?: number;
  namingScheme?: 'smtp' | 'mail' | 'outbound' | 'custom';
  customPrefix?: string;
  targetIp?: string;
  createDNS?: boolean;
}

export async function provisionSubdomainBatch(
  config: SubdomainConfig
): Promise<BulkProvisionResult> {
  const {
    domainId,
    rootDomain,
    cloudflareZoneId,
    count,
    startIndex = 1,
    namingScheme = 'smtp',
    customPrefix,
    targetIp,
    createDNS = false,
  } = config;

  const result: BulkProvisionResult = {
    success: true,
    total: count,
    created: 0,
    skipped: 0,
    errors: [],
    subdomains: [],
  };

  const cf = createDNS && cloudflareZoneId ? new CloudflareClient() : null;

  if (cf) {
    try {
      await cf.getZone(cloudflareZoneId!);
    } catch {
      result.errors.push(`Cloudflare zone ${cloudflareZoneId} not accessible`);
      result.success = false;
      return result;
    }
  }

  const existingResult = await query<{ subdomain: string }>(
    'SELECT subdomain FROM subdomains WHERE subdomain LIKE $1',
    [`${getPrefix(namingScheme, customPrefix)}%.${rootDomain}`]
  );
  const existingSet = new Set(existingResult.rows.map(r => r.subdomain));

  for (let i = startIndex; i < startIndex + count; i++) {
    const prefix = getPrefix(namingScheme, customPrefix);
    const sub = `${prefix}${padNum(i, 3)}`;
    const fullSubdomain = `${sub}.${rootDomain}`;

    if (existingSet.has(fullSubdomain)) {
      result.skipped++;
      continue;
    }

    const keyPair = generateKeyPair();
    const pubKeyBase64 = extractPublicKeyBase64(keyPair.publicKey);
    const encryptedPrivKey = encryptPrivateKey(keyPair.privateKey);

    try {
      await query(
        `INSERT INTO subdomains
         (domain_id, subdomain, dkim_selector, dkim_private_key, sender_name,
          daily_limit, emails_sent_today, status, total_sent,
          bounce_rate, engagement_score, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 0, 'inactive', 0, 0, 0, NOW())`,
        [domainId, fullSubdomain, keyPair.selector, encryptedPrivKey, sub,
         10, 0, 'inactive', 0, 0, 0]
      );
      existingSet.add(fullSubdomain);
      result.subdomains.push(fullSubdomain);

      if (cf && targetIp) {
        try {
          await cf.createDNSRecord(cloudflareZoneId!, {
            type: 'A',
            name: fullSubdomain,
            content: targetIp,
            proxied: false,
            ttl: 120,
          });
          await cf.createDNSRecord(cloudflareZoneId!, {
            type: 'TXT',
            name: fullSubdomain,
            content: `v=spf1 ip4:${targetIp} ~all`,
            proxied: false,
            ttl: 120,
          });
        } catch (e: any) {
          result.errors.push(`DNS failed for ${fullSubdomain}: ${e.message}`);
        }
      }

      result.created++;
    } catch (e: any) {
      if (e?.constraint === 'subdomains_subdomain_key') {
        result.skipped++;
      } else {
        result.errors.push(`Failed to create ${fullSubdomain}: ${e.message}`);
      }
    }
  }

  result.success = result.errors.length === 0 || result.created > 0;
  return result;
}

function getPrefix(scheme: string, customPrefix?: string): string {
  if (customPrefix) return customPrefix;
  switch (scheme) {
    case 'mail': return 'mail';
    case 'outbound': return 'out';
    case 'custom': return customPrefix || 'smtp';
    case 'smtp':
    default: return 'smtp';
  }
}

function padNum(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

export async function activateSubdomainBatch(subdomainIds: string[]): Promise<{
  activated: number;
  errors: string[];
}> {
  let activated = 0;
  const errors: string[] = [];

  for (const id of subdomainIds) {
    try {
      await query(
        `UPDATE subdomains SET status = 'active', warmup_complete = false, warmup_started_at = NOW()
         WHERE id = $1 AND status = 'inactive'`,
        [id]
      );
      activated++;
    } catch (e: any) {
      errors.push(`Failed to activate ${id}: ${e.message}`);
    }
  }

  return { activated, errors };
}

export async function getDomainSubdomainStats(domainId?: string): Promise<{
  total: number;
  active: number;
  inactive: number;
  warming: number;
  activeByDomain: { domain: string; total: number; active: number }[];
}> {
  let domainWhere = '';
  const params: any[] = [];
  if (domainId) {
    domainWhere = 'WHERE s.domain_id = $1';
    params.push(domainId);
  }
  const withStatus = (statusClause: string): string =>
    domainWhere ? `${domainWhere} AND ${statusClause}` : `WHERE ${statusClause}`;

  const totalResult = await query<{ cnt: string }>(
    `SELECT COUNT(*) as cnt FROM subdomains s ${domainWhere}`, params
  );

  const activeResult = await query<{ cnt: string }>(
    `SELECT COUNT(*) as cnt FROM subdomains s ${withStatus("s.status = 'active'")}`, params
  );

  const inactiveResult = await query<{ cnt: string }>(
    `SELECT COUNT(*) as cnt FROM subdomains s ${withStatus("s.status = 'inactive'")}`, params
  );

  const warmingResult = await query<{ cnt: string }>(
    `SELECT COUNT(*) as cnt FROM subdomains s ${withStatus("s.status = 'warming' AND s.warmup_complete = false")}`, params
  );

  const byDomain = await query<{ domain: string; total: string; active: string }>(
    `SELECT d.domain, COUNT(*)::text as total,
            SUM(CASE WHEN s.status = 'active' THEN 1 ELSE 0 END)::text as active
     FROM subdomains s JOIN domains d ON d.id = s.domain_id
     ${domainWhere}
     GROUP BY d.domain ORDER BY d.domain`,
    params
  );

  return {
    total: parseInt(totalResult.rows[0]?.cnt || '0'),
    active: parseInt(activeResult.rows[0]?.cnt || '0'),
    inactive: parseInt(inactiveResult.rows[0]?.cnt || '0'),
    warming: parseInt(warmingResult.rows[0]?.cnt || '0'),
    activeByDomain: byDomain.rows.map(r => ({
      domain: r.domain,
      total: parseInt(r.total),
      active: parseInt(r.active),
    })),
  };
}