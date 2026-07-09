// Round-robin subdomain assignment

import { query } from '../db/connection';
import { SubdomainAssignment } from './types';
import { Industry } from '../segmentation/types';

// Round-robin state per industry
const roundRobinCounters = new Map<Industry, number>();

/**
 * Get next available subdomain for an industry (round-robin)
 */
export async function assignSubdomain(
  industry: Industry
): Promise<SubdomainAssignment | null> {
  // Get active subdomains for industry that are warmed up and under daily limit
  const result = await query<SubdomainAssignment>(
    `SELECT s.id, s.domain_id, s.subdomain, s.sender_name,
            s.warmup_complete, s.daily_limit, s.emails_sent_today
     FROM subdomains s
     JOIN domains d ON s.domain_id = d.id
     WHERE d.industry = $1
       AND s.status = 'active'
       AND s.warmup_complete = true
       AND s.emails_sent_today < s.daily_limit
     ORDER BY s.id`,
    [industry]
  );

  if (result.rows.length === 0) {
    return null; // No available subdomains
  }

  // Round-robin selection
  const counter = roundRobinCounters.get(industry) || 0;
  const index = counter % result.rows.length;
  roundRobinCounters.set(industry, counter + 1);

  return result.rows[index];
}

/**
 * Get available subdomains count for an industry
 */
export async function getAvailableSubdomainCount(
  industry: Industry
): Promise<number> {
  const result = await query<{ count: number }>(
    `SELECT COUNT(*) as count
     FROM subdomains s
      JOIN domains d ON s.domain_id = d.id
      WHERE d.industry = $1
        AND s.status = 'active'
        AND s.warmup_complete = true
        AND s.emails_sent_today < s.daily_limit`,
     [industry]
   );

   return parseInt(String(result.rows[0]?.count || '0'));
 }

 /**
  * Get subdomain statistics for an industry
  */
 export async function getSubdomainStats(
   industry: Industry
 ): Promise<{
   total: number;
   active: number;
   available: number;
   at_limit: number;
 }> {
   const totalResult = await query<{ count: number }>(
     `SELECT COUNT(*) as count
      FROM subdomains s
      JOIN domains d ON s.domain_id = d.id
      WHERE d.industry = $1`,
    [industry]
  );

  const activeResult = await query<{ count: number }>(
    `SELECT COUNT(*) as count
     FROM subdomains s
     JOIN domains d ON s.domain_id = d.id
      WHERE d.industry = $1 AND s.status = 'active'`,
    [industry]
  );

  const availableResult = await query<{ count: number }>(
    `SELECT COUNT(*) as count
     FROM subdomains s
     JOIN domains d ON s.domain_id = d.id
      WHERE d.industry = $1
        AND s.status = 'active'
        AND s.warmup_complete = true
        AND s.emails_sent_today < s.daily_limit`,
    [industry]
  );

  const total = parseInt(String(totalResult.rows[0]?.count || '0'));
  const active = parseInt(String(activeResult.rows[0]?.count || '0'));
  const available = parseInt(String(availableResult.rows[0]?.count || '0'));

  return {
    total,
    active,
    available,
    at_limit: active - available,
  };
}

/**
 * Reset round-robin counters (call at midnight UTC)
 */
export function resetRoundRobin(): void {
  roundRobinCounters.clear();
}
