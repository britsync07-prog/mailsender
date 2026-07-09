// Industry domain pool management

import { query } from '../db/connection';
import { Industry, DomainPool, INDUSTRY_CLUSTERS } from './types';

/**
 * Create a domain pool entry
 */
export async function createDomainPool(
  industry: Industry,
  domain: string
): Promise<DomainPool> {
  const result = await query<DomainPool>(
    `INSERT INTO industry_domain_pools (id, industry, domain, status, assigned_at)
     VALUES (uuid_generate_v4(), $1, $2, 'warming', NOW())
     RETURNING *`,
    [industry, domain]
  );

  return result.rows[0];
}

/**
 * Get all domains for an industry
 */
export async function getIndustryDomains(
  industry: Industry
): Promise<DomainPool[]> {
  const result = await query<DomainPool>(
    'SELECT * FROM industry_domain_pools WHERE industry = $1 ORDER BY assigned_at',
    [industry]
  );

  return result.rows;
}

/**
 * Get active domains for an industry
 */
export async function getActiveIndustryDomains(
  industry: Industry
): Promise<DomainPool[]> {
  const result = await query<DomainPool>(
    "SELECT * FROM industry_domain_pools WHERE industry = $1 AND status = 'active' ORDER BY assigned_at",
    [industry]
  );

  return result.rows;
}

/**
 * Update domain status
 */
export async function updateDomainStatus(
  domainId: string,
  status: DomainPool['status']
): Promise<void> {
  await query(
    'UPDATE industry_domain_pools SET status = $1 WHERE id = $2',
    [status, domainId]
  );
}

/**
 * Check if domain belongs to industry
 */
export async function isDomainInIndustry(
  domain: string,
  industry: Industry
): Promise<boolean> {
  const result = await query<{ id: string }>(
    'SELECT id FROM industry_domain_pools WHERE domain = $1 AND industry = $2',
    [domain, industry]
  );

  return result.rows.length > 0;
}

/**
 * Get domain's industry
 */
export async function getDomainIndustry(
  domain: string
): Promise<Industry | null> {
  const result = await query<{ industry: Industry }>(
    'SELECT industry FROM industry_domain_pools WHERE domain = $1',
    [domain]
  );

  return result.rows[0]?.industry || null;
}

/**
 * Get industry domain pool statistics
 */
export async function getDomainPoolStats(): Promise<{
  by_industry: {
    industry: Industry;
    total: number;
    active: number;
    warming: number;
    paused: number;
    retired: number;
  }[];
  total_domains: number;
}> {
  const result = await query<{
    industry: Industry;
    status: string;
    count: number;
  }>(
    'SELECT industry, status, COUNT(*) as count FROM industry_domain_pools GROUP BY industry, status'
  );

  // Aggregate by industry
  const statsMap = new Map<Industry, {
    total: number;
    active: number;
    warming: number;
    paused: number;
    retired: number;
  }>();

  for (const row of result.rows) {
    if (!statsMap.has(row.industry)) {
      statsMap.set(row.industry, { total: 0, active: 0, warming: 0, paused: 0, retired: 0 });
    }
    const stats = statsMap.get(row.industry)!;
    const count = parseInt(String(row.count));
    stats.total += count;
    stats[row.status as keyof typeof stats] += count;
  }

  const byIndustry = Array.from(statsMap.entries()).map(([industry, stats]) => ({
    industry,
    ...stats,
  }));

  const totalDomains = byIndustry.reduce((sum, s) => sum + s.total, 0);

  return { by_industry: byIndustry, total_domains: totalDomains };
}

/**
 * Initialize default domain pools from config
 */
export async function initializeDomainPools(): Promise<{
  created: number;
  by_industry: Record<Industry, number>;
}> {
  const byIndustry: Record<Industry, number> = {
    smart_homes: 0,
    mortgage: 0,
    cybersecurity: 0,
  };

  // Check if pools already exist
  const existing = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM industry_domain_pools'
  );

  if (parseInt(String(existing.rows[0]?.count || '0')) > 0) {
    return { created: 0, by_industry: byIndustry };
  }

  // Create placeholder entries for each industry
  for (const [industry, cluster] of Object.entries(INDUSTRY_CLUSTERS)) {
    for (let i = 0; i < cluster.targetDomains; i++) {
      // In production, these would be actual domains
      // For now, create placeholder entries
      await createDomainPool(
        industry as Industry,
        `placeholder-${industry}-${i + 1}.example.com`
      );
      byIndustry[industry as Industry]++;
    }
  }

  return { created: Object.values(byIndustry).reduce((a, b) => a + b, 0), by_industry: byIndustry };
}
