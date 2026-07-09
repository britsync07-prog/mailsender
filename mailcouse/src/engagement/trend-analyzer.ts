// Trend analysis and early warning

import { query } from '../db/connection';

/**
 * Analyze engagement trends for a subdomain
 */
export async function analyzeTrend(
  subdomainId: string,
  days: number = 30
): Promise<{
  subdomain_id: string;
  current_score: number;
  trend: 'improving' | 'declining' | 'stable';
  avg_score_7d: number;
  avg_score_14d: number;
  avg_score_30d: number;
  recommendation: string;
}> {
  // Get current score
  const currentResult = await query<{ engagement_score: number }>(
    'SELECT engagement_score FROM subdomains WHERE id = $1',
    [subdomainId]
  );

  const currentScore = currentResult.rows[0]?.engagement_score || 0;

  // Get 7-day average
  const avg7Result = await query<{ avg: number }>(
    `SELECT AVG(sj.sent_at::date) as avg
     FROM send_jobs sj
     WHERE sj.subdomain_id = $1
       AND sj.sent_at >= NOW() - INTERVAL '7 days'`,
    [subdomainId]
  );

  // Get 14-day average
  const avg14Result = await query<{ avg: number }>(
    `SELECT AVG(sj.sent_at::date) as avg
     FROM send_jobs sj
     WHERE sj.subdomain_id = $1
       AND sj.sent_at >= NOW() - INTERVAL '14 days'`,
    [subdomainId]
  );

  // Get 30-day average
  const avg30Result = await query<{ avg: number }>(
    `SELECT AVG(sj.sent_at::date) as avg
     FROM send_jobs sj
     WHERE sj.subdomain_id = $1
       AND sj.sent_at >= NOW() - INTERVAL '30 days'`,
    [subdomainId]
  );

  const avg7d = parseFloat(String(avg7Result.rows[0]?.avg)) || 0;
  const avg14d = parseFloat(String(avg14Result.rows[0]?.avg)) || 0;
  const avg30d = parseFloat(String(avg30Result.rows[0]?.avg)) || 0;

  // Determine trend
  let trend: 'improving' | 'declining' | 'stable' = 'stable';
  if (currentScore > avg7d * 1.1) trend = 'improving';
  else if (currentScore < avg7d * 0.9) trend = 'declining';

  // Generate recommendation
  let recommendation = '';
  if (trend === 'declining') {
    recommendation = 'Engagement is declining. Review content and list quality.';
  } else if (trend === 'improving') {
    recommendation = 'Engagement is improving. Consider increasing volume.';
  } else {
    recommendation = 'Engagement is stable. Continue current strategy.';
  }

  return {
    subdomain_id: subdomainId,
    current_score: currentScore,
    trend,
    avg_score_7d: avg7d,
    avg_score_14d: avg14d,
    avg_score_30d: avg30d,
    recommendation,
  };
}

/**
 * Get early warning for declining engagement
 */
export async function getEarlyWarnings(): Promise<{
  subdomain_id: string;
  subdomain: string;
  current_score: number;
  trend: string;
  days_declining: number;
}[]> {
  const result = await query<{
    id: string;
    subdomain: string;
    engagement_score: number;
    days_declining: number;
  }>(
    `SELECT s.id, s.subdomain, s.engagement_score,
            EXTRACT(DAY FROM NOW() - MIN(sj.sent_at)) as days_declining
     FROM subdomains s
     JOIN send_jobs sj ON s.id = sj.subdomain_id
     WHERE s.status = 'active'
       AND s.engagement_score < 20
       AND sj.sent_at >= NOW() - INTERVAL '30 days'
     GROUP BY s.id, s.subdomain, s.engagement_score
     HAVING EXTRACT(DAY FROM NOW() - MIN(sj.sent_at)) >= 7
     ORDER BY s.engagement_score ASC`
  );

  return result.rows.map((r) => ({
    subdomain_id: r.id,
    subdomain: r.subdomain,
    current_score: r.engagement_score,
    trend: 'declining',
    days_declining: parseInt(String(r.days_declining)),
  }));
}

/**
 * Get overall engagement health
 */
export async function getEngagementHealth(): Promise<{
  overall_score: number;
  health_status: 'healthy' | 'warning' | 'critical';
  subdomains_above_target: number;
  subdomains_below_target: number;
  target_score: number;
  recommendations: string[];
}> {
  // Get current averages
  const result = await query<{
    avg_score: number;
    above: number;
    below: number;
  }>(
    `SELECT
       AVG(engagement_score) as avg_score,
       COUNT(*) FILTER (WHERE engagement_score >= 20) as above,
       COUNT(*) FILTER (WHERE engagement_score < 20) as below
     FROM subdomains
     WHERE status = 'active'`
  );

  const stats = result.rows[0] || { avg_score: 0, above: 0, below: 0 };
  const avgScore = parseFloat(String(stats.avg_score)) || 0;
  const above = parseInt(String(stats.above));
  const below = parseInt(String(stats.below));

  // Determine health status
  let healthStatus: 'healthy' | 'warning' | 'critical' = 'healthy';
  if (avgScore < 20) healthStatus = 'critical';
  else if (avgScore < 40) healthStatus = 'warning';

  // Generate recommendations
  const recommendations: string[] = [];
  if (below > 0) {
    recommendations.push(`${below} subdomains below target score - review content and list quality`);
  }
  if (avgScore < 30) {
    recommendations.push('Overall engagement is low - consider pausing underperformers');
  }
  if (avgScore > 60) {
    recommendations.push('Strong engagement - consider scaling volume');
  }

  return {
    overall_score: Math.round(avgScore),
    health_status: healthStatus,
    subdomains_above_target: above,
    subdomains_below_target: below,
    target_score: 20,
    recommendations,
  };
}
