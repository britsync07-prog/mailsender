// Weekly report generation

import { query } from '../db/connection';

/**
 * Generate weekly engagement report
 */
export async function generateWeeklyReport(): Promise<{
  period: string;
  generated_at: Date;
  summary: {
    total_emails_sent: number;
    total_replies: number;
    total_opens: number;
    avg_engagement_score: number;
  };
  by_industry: {
    industry: string;
    emails_sent: number;
    replies: number;
    reply_rate: number;
    open_rate: number;
    complaints: number;
  }[];
  top_subdomains: {
    subdomain: string;
    engagement_score: number;
    reply_rate: number;
  }[];
  low_subdomains: {
    subdomain: string;
    engagement_score: number;
    reply_rate: number;
  }[];
}> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Summary stats
  const summaryResult = await query<{
    total_sent: number;
    total_replies: number;
    total_opens: number;
    avg_score: number;
  }>(
    `SELECT
       COUNT(*) as total_sent,
       COUNT(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM reply_events re WHERE re.subdomain_id = sj.subdomain_id
       )) as total_replies,
       COUNT(*) FILTER (WHERE sj.status = 'sent') as total_opens,
       AVG(s.engagement_score) as avg_score
     FROM send_jobs sj
     JOIN subdomains s ON sj.subdomain_id = s.id
     WHERE sj.sent_at >= $1`,
    [weekAgo]
  );

  const summary = summaryResult.rows[0] || {
    total_sent: 0,
    total_replies: 0,
    total_opens: 0,
    avg_score: 0,
  };

  // By industry
  const industryResult = await query<{
    industry: string;
    emails_sent: number;
    replies: number;
    complaints: number;
  }>(
    `SELECT l.industry,
            COUNT(*) as emails_sent,
            COUNT(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM reply_events re WHERE re.subdomain_id = sj.subdomain_id
            )) as replies,
            COUNT(*) FILTER (WHERE sj.status = 'bounced') as complaints
     FROM send_jobs sj
     JOIN leads l ON sj.lead_id = l.id
     WHERE sj.sent_at >= $1
     GROUP BY l.industry`,
    [weekAgo]
  );

  const byIndustry = industryResult.rows.map((r) => ({
    industry: r.industry,
    emails_sent: parseInt(String(r.emails_sent)),
    replies: parseInt(String(r.replies)),
    reply_rate: parseInt(String(r.emails_sent)) > 0
      ? Math.round((parseInt(String(r.replies)) / parseInt(String(r.emails_sent))) * 100)
      : 0,
    open_rate: 0, // Would need open tracking data
    complaints: parseInt(String(r.complaints)),
  }));

  // Top subdomains
  const topResult = await query<{
    subdomain: string;
    engagement_score: number;
    reply_rate: number;
  }>(
    `SELECT s.subdomain, s.engagement_score,
            CASE WHEN COUNT(sj.id) > 0
                 THEN COUNT(*) FILTER (WHERE EXISTS (
                   SELECT 1 FROM reply_events re WHERE re.subdomain_id = s.id
                 ))::float / COUNT(sj.id)
                 ELSE 0
            END as reply_rate
     FROM subdomains s
     LEFT JOIN send_jobs sj ON s.id = sj.subdomain_id
       AND sj.sent_at >= $1
     WHERE s.status = 'active'
     GROUP BY s.id, s.subdomain, s.engagement_score
     ORDER BY s.engagement_score DESC
     LIMIT 10`,
    [weekAgo]
  );

  // Low subdomains
  const lowResult = await query<{
    subdomain: string;
    engagement_score: number;
    reply_rate: number;
  }>(
    `SELECT s.subdomain, s.engagement_score,
            CASE WHEN COUNT(sj.id) > 0
                 THEN COUNT(*) FILTER (WHERE EXISTS (
                   SELECT 1 FROM reply_events re WHERE re.subdomain_id = s.id
                 ))::float / COUNT(sj.id)
                 ELSE 0
            END as reply_rate
     FROM subdomains s
     LEFT JOIN send_jobs sj ON s.id = sj.subdomain_id
       AND sj.sent_at >= $1
     WHERE s.status = 'active'
       AND s.engagement_score < 20
     GROUP BY s.id, s.subdomain, s.engagement_score
     ORDER BY s.engagement_score ASC
     LIMIT 10`,
    [weekAgo]
  );

  return {
    period: `${weekAgo.toISOString().split('T')[0]} to ${now.toISOString().split('T')[0]}`,
    generated_at: now,
    summary: {
      total_emails_sent: parseInt(String(summary.total_sent)),
      total_replies: parseInt(String(summary.total_replies)),
      total_opens: parseInt(String(summary.total_opens)),
      avg_engagement_score: Math.round(parseFloat(String(summary.avg_score)) || 0),
    },
    by_industry: byIndustry,
    top_subdomains: topResult.rows.map((r) => ({
      subdomain: r.subdomain,
      engagement_score: r.engagement_score,
      reply_rate: parseFloat(String(r.reply_rate)),
    })),
    low_subdomains: lowResult.rows.map((r) => ({
      subdomain: r.subdomain,
      engagement_score: r.engagement_score,
      reply_rate: parseFloat(String(r.reply_rate)),
    })),
  };
}

/**
 * Format report as markdown
 */
export function formatReportAsMarkdown(report: ReturnType<typeof generateWeeklyReport> extends Promise<infer T> ? T : never): string {
  const lines: string[] = [];

  lines.push('# Weekly Engagement Report');
  lines.push(`**Period:** ${report.period}`);
  lines.push(`**Generated:** ${report.generated_at.toISOString()}`);
  lines.push('');

  lines.push('## Summary');
  lines.push(`- Total emails sent: ${report.summary.total_emails_sent.toLocaleString()}`);
  lines.push(`- Total replies: ${report.summary.total_replies.toLocaleString()}`);
  lines.push(`- Total opens: ${report.summary.total_opens.toLocaleString()}`);
  lines.push(`- Average engagement score: ${report.summary.avg_engagement_score}`);
  lines.push('');

  lines.push('## By Industry');
  for (const industry of report.by_industry) {
    lines.push(`### ${industry.industry}`);
    lines.push(`- Emails sent: ${industry.emails_sent.toLocaleString()}`);
    lines.push(`- Replies: ${industry.replies.toLocaleString()}`);
    lines.push(`- Reply rate: ${industry.reply_rate}%`);
    lines.push(`- Complaints: ${industry.complaints}`);
    lines.push('');
  }

  lines.push('## Top Performing Subdomains');
  for (const sub of report.top_subdomains) {
    lines.push(`- **${sub.subdomain}** — Score: ${sub.engagement_score}, Reply rate: ${(sub.reply_rate * 100).toFixed(1)}%`);
  }
  lines.push('');

  lines.push('## Low Performing Subdomains');
  for (const sub of report.low_subdomains) {
    lines.push(`- **${sub.subdomain}** — Score: ${sub.engagement_score}, Reply rate: ${(sub.reply_rate * 100).toFixed(1)}%`);
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Get report history
 */
export async function getReportHistory(
  limit: number = 10
): Promise<{ date: string; summary: string }[]> {
  const result = await query<{ date: string; summary: string }>(
    `SELECT date, summary FROM weekly_reports ORDER BY date DESC LIMIT $1`,
    [limit]
  );

  return result.rows;
}
