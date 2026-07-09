// Daily score recalculation

import { query } from '../db/connection';
import { EngagementPriority } from './types';

/**
 * Recalculate engagement score for all subdomains
 */
export async function recalculateAllScores(): Promise<{
  total: number;
  high: number;
  medium: number;
  low: number;
  duration_ms: number;
}> {
  const startTime = Date.now();

  // Get all active subdomains
  const subdomains = await query<{ id: string }>(
    "SELECT id FROM subdomains WHERE status = 'active'"
  );

  let high = 0;
  let medium = 0;
  let low = 0;

  for (const subdomain of subdomains.rows) {
    const score = await calculateSubdomainScore(subdomain.id);
    if (score !== null) {
      const priority = getPriority(score);
      switch (priority) {
        case 'high': high++; break;
        case 'medium': medium++; break;
        case 'low': low++; break;
      }
    }
  }

  return {
    total: subdomains.rows.length,
    high,
    medium,
    low,
    duration_ms: Date.now() - startTime,
  };
}

/**
 * Calculate engagement score for a single subdomain
 */
export async function calculateSubdomainScore(
  subdomainId: string
): Promise<number | null> {
  const result = await query<{
    emails_sent: number;
    replies: number;
    opens: number;
  }>(
    `SELECT
       COUNT(*) as emails_sent,
       COUNT(*) FILTER (WHERE sj.status = 'sent' AND EXISTS (
         SELECT 1 FROM reply_events re WHERE re.subdomain_id = sj.subdomain_id
       )) as replies,
       COUNT(*) FILTER (WHERE sj.status = 'sent') as opens
     FROM send_jobs sj
     WHERE sj.subdomain_id = $1
       AND sj.sent_at >= NOW() - INTERVAL '14 days'`,
    [subdomainId]
  );

  if (result.rows.length === 0) return null;

  const { emails_sent, replies, opens } = result.rows[0];

  if (emails_sent === 0) return 0;

  const replyRate = replies / emails_sent;
  const openRate = opens / emails_sent;

  // Score formula: (reply_rate × 10) + (open_rate × 2)
  const rawScore = (replyRate * 10) + (openRate * 2);
  const score = Math.min(Math.round(rawScore * 10), 100);

  // Update subdomain score
  await query(
    'UPDATE subdomains SET engagement_score = $1 WHERE id = $2',
    [score, subdomainId]
  );

  return score;
}

/**
 * Get priority from score
 */
export function getPriority(score: number): EngagementPriority {
  if (score > 50) return 'high';
  if (score >= 20) return 'medium';
  return 'low';
}

/**
 * Get subdomain scores summary
 */
export async function getScoresSummary(): Promise<{
  total: number;
  avg_score: number;
  by_priority: { priority: string; count: number; avg_score: number }[];
}> {
  const result = await query<{ priority: string; count: number; avg_score: number }>(
    `SELECT
       CASE
         WHEN engagement_score > 50 THEN 'high'
         WHEN engagement_score >= 20 THEN 'medium'
         ELSE 'low'
       END as priority,
       COUNT(*) as count,
       AVG(engagement_score) as avg_score
     FROM subdomains
     WHERE status = 'active'
     GROUP BY priority`
  );

  const total = result.rows.reduce((sum, r) => sum + parseInt(String(r.count)), 0);
  const avgScore = result.rows.reduce((sum, r) => sum + parseFloat(String(r.avg_score)) * parseInt(String(r.count)), 0) / (total || 1);

  return {
    total,
    avg_score: Math.round(avgScore),
    by_priority: result.rows.map((r) => ({
      priority: r.priority,
      count: parseInt(String(r.count)),
      avg_score: Math.round(parseFloat(String(r.avg_score))),
    })),
  };
}
