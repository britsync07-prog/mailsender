// Dispatch priority based on score

import { query } from '../db/connection';

/**
 * Get subdomains ordered by engagement priority
 */
export async function getPrioritizedSubdomains(
  industry?: string
): Promise<{
  subdomain_id: string;
  subdomain: string;
  engagement_score: number;
  priority: 'high' | 'medium' | 'low';
  emails_sent_today: number;
  daily_limit: number;
}[]> {
  let whereClause = "WHERE s.status = 'active' AND s.warmup_complete = true";
  const params: any[] = [];

  if (industry) {
    whereClause += ' AND d.industry = $1';
    params.push(industry);
  }

  const result = await query<{
    id: string;
    subdomain: string;
    engagement_score: number;
    emails_sent_today: number;
    daily_limit: number;
  }>(
    `SELECT s.id, s.subdomain, s.engagement_score, s.emails_sent_today, s.daily_limit
     FROM subdomains s
     JOIN domains d ON s.domain_id = d.id
     ${whereClause}
     ORDER BY s.engagement_score DESC, s.emails_sent_today ASC`,
    params
  );

  return result.rows.map((r) => ({
    subdomain_id: r.id,
    subdomain: r.subdomain,
    engagement_score: r.engagement_score,
    priority: getPriority(r.engagement_score),
    emails_sent_today: r.emails_sent_today,
    daily_limit: r.daily_limit,
  }));
}

/**
 * Get priority from score
 */
function getPriority(score: number): 'high' | 'medium' | 'low' {
  if (score > 50) return 'high';
  if (score >= 20) return 'medium';
  return 'low';
}

/**
 * Get top performing subdomains
 */
export async function getTopPerformers(
  limit: number = 10
): Promise<{
  subdomain_id: string;
  subdomain: string;
  engagement_score: number;
  reply_rate: number;
}[]> {
  const result = await query<{
    id: string;
    subdomain: string;
    engagement_score: number;
    reply_rate: number;
  }>(
    `SELECT s.id, s.subdomain, s.engagement_score,
            CASE WHEN COUNT(sj.id) > 0
                 THEN COUNT(*) FILTER (WHERE EXISTS (
                   SELECT 1 FROM reply_events re WHERE re.subdomain_id = s.id
                 ))::float / COUNT(sj.id)
                 ELSE 0
            END as reply_rate
     FROM subdomains s
     LEFT JOIN send_jobs sj ON s.id = sj.subdomain_id
       AND sj.sent_at >= NOW() - INTERVAL '14 days'
     WHERE s.status = 'active'
     GROUP BY s.id, s.subdomain, s.engagement_score
     ORDER BY s.engagement_score DESC
     LIMIT $1`,
    [limit]
  );

  return result.rows.map((r) => ({
    subdomain_id: r.id,
    subdomain: r.subdomain,
    engagement_score: r.engagement_score,
    reply_rate: parseFloat(String(r.reply_rate)),
  }));
}

/**
 * Get low performing subdomains
 */
export async function getLowPerformers(
  threshold: number = 20
): Promise<{
  subdomain_id: string;
  subdomain: string;
  engagement_score: number;
  reply_rate: number;
  days_below_threshold: number;
}[]> {
  const result = await query<{
    id: string;
    subdomain: string;
    engagement_score: number;
    reply_rate: number;
    days_below: number;
  }>(
    `SELECT s.id, s.subdomain, s.engagement_score,
            CASE WHEN COUNT(sj.id) > 0
                 THEN COUNT(*) FILTER (WHERE EXISTS (
                   SELECT 1 FROM reply_events re WHERE re.subdomain_id = s.id
                 ))::float / COUNT(sj.id)
                 ELSE 0
            END as reply_rate,
            EXTRACT(DAY FROM NOW() - MIN(sj.sent_at)) as days_below
     FROM subdomains s
     LEFT JOIN send_jobs sj ON s.id = sj.subdomain_id
       AND sj.sent_at >= NOW() - INTERVAL '30 days'
     WHERE s.status = 'active'
       AND s.engagement_score < $1
     GROUP BY s.id, s.subdomain, s.engagement_score
     ORDER BY s.engagement_score ASC`,
    [threshold]
  );

  return result.rows.map((r) => ({
    subdomain_id: r.id,
    subdomain: r.subdomain,
    engagement_score: r.engagement_score,
    reply_rate: parseFloat(String(r.reply_rate)),
    days_below_threshold: parseInt(String(r.days_below)),
  }));
}

/**
 * Update dispatch priority for all subdomains
 */
export async function updateAllPriorities(): Promise<{
  updated: number;
  high: number;
  medium: number;
  low: number;
}> {
  const subdomains = await query<{ id: string; engagement_score: number }>(
    "SELECT id, engagement_score FROM subdomains WHERE status = 'active'"
  );

  let high = 0;
  let medium = 0;
  let low = 0;

  for (const subdomain of subdomains.rows) {
    const priority = getPriority(subdomain.engagement_score);
    switch (priority) {
      case 'high': high++; break;
      case 'medium': medium++; break;
      case 'low': low++; break;
    }
  }

  return {
    updated: subdomains.rows.length,
    high,
    medium,
    low,
  };
}
