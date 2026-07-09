// Postmaster score monitoring

import { query } from '../db/connection';
import { WARMUP_CRITERIA } from './types';

/**
 * Check Gmail Postmaster score for a domain
 */
export async function checkPostmasterScore(
  domainId: string
): Promise<{
  score: number | null;
  checked_at: Date;
  is_healthy: boolean;
}> {
  const result = await query<{ postmaster_score: number | null; last_checked: Date }>(
    'SELECT postmaster_score, last_checked FROM domains WHERE id = $1',
    [domainId]
  );

  if (result.rows.length === 0) {
    return { score: null, checked_at: new Date(), is_healthy: false };
  }

  const domain = result.rows[0];
  const score = domain.postmaster_score;
  const isHealthy = (score || 0) >= WARMUP_CRITERIA.postmaster_score_threshold;

  return {
    score,
    checked_at: domain.last_checked || new Date(),
    is_healthy: isHealthy,
  };
}

/**
 * Update Postmaster score for a domain
 */
export async function updatePostmasterScore(
  domainId: string,
  score: number
): Promise<void> {
  await query(
    'UPDATE domains SET postmaster_score = $1, last_checked = NOW() WHERE id = $2',
    [score, domainId]
  );
}

/**
 * Check all domains and flag those with low scores
 */
export async function checkAllDomains(): Promise<{
  total: number;
  healthy: number;
  unhealthy: number;
  flagged: { domain: string; score: number }[];
}> {
  const result = await query<{ id: string; domain: string; postmaster_score: number | null }>(
    'SELECT id, domain, postmaster_score FROM domains WHERE status != \'retired\''
  );

  let healthy = 0;
  let unhealthy = 0;
  const flagged: { domain: string; score: number }[] = [];

  for (const domain of result.rows) {
    const score = domain.postmaster_score || 0;
    if (score >= WARMUP_CRITERIA.postmaster_score_threshold) {
      healthy++;
    } else {
      unhealthy++;
      flagged.push({ domain: domain.domain, score });
    }
  }

  return {
    total: result.rows.length,
    healthy,
    unhealthy,
    flagged,
  };
}

/**
 * Get domains needing warmup extension
 */
export async function getDomainsNeedingExtension(): Promise<{
  domain_id: string;
  domain: string;
  score: number;
  subdomains_affected: number;
}[]> {
  const result = await query<{
    domain_id: string;
    domain: string;
    postmaster_score: number;
    subdomains_affected: number;
  }>(
    `SELECT d.id as domain_id, d.domain, d.postmaster_score,
            COUNT(s.id) as subdomains_affected
     FROM domains d
     JOIN subdomains s ON d.id = s.domain_id
     WHERE s.status = 'warming'
       AND d.postmaster_score < $1
     GROUP BY d.id, d.domain, d.postmaster_score`,
    [WARMUP_CRITERIA.postmaster_score_extend]
  );

  return result.rows.map((r) => ({
    domain_id: r.domain_id,
    domain: r.domain,
    score: r.postmaster_score,
    subdomains_affected: parseInt(String(r.subdomains_affected)),
  }));
}

/**
 * Get Postmaster score history
 */
export async function getScoreHistory(
  domainId: string,
  days: number = 30
): Promise<{ date: string; score: number }[]> {
  // This would query historical scores if stored
  // For now, return current score as single data point
  const result = await query<{ postmaster_score: number | null }>(
    'SELECT postmaster_score FROM domains WHERE id = $1',
    [domainId]
  );

  if (result.rows.length === 0 || !result.rows[0].postmaster_score) {
    return [];
  }

  return [{
    date: new Date().toISOString().split('T')[0],
    score: result.rows[0].postmaster_score,
  }];
}
