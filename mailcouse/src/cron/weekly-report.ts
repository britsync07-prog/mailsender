// Weekly engagement report

import { randomUUID } from 'crypto';
import { query } from '../db/connection';
import { CronJobResult } from './types';
import { sendAlert, createAlert } from '../monitoring/alert-dispatcher';

/**
 * Generate weekly engagement report
 */
export async function generateWeeklyReport(): Promise<CronJobResult> {
  const startTime = new Date();

  try {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Get weekly stats
    const statsResult = await query<{
      total_sent: number;
      total_replies: number;
      total_opens: number;
      total_bounced: number;
      total_complaints: number;
    }>(
      `SELECT
         COUNT(*) as total_sent,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM reply_events re WHERE re.subdomain_id = sj.subdomain_id
         )) as total_replies,
         COUNT(*) FILTER (WHERE sj.status = 'sent') as total_opens,
         COUNT(*) FILTER (WHERE sj.status = 'bounced') as total_bounced,
         COUNT(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM complaint_events ce WHERE ce.subdomain_id = sj.subdomain_id
         )) as total_complaints
       FROM send_jobs sj
       WHERE sj.sent_at >= $1`,
      [weekAgo]
    );

    const stats = statsResult.rows[0] || {
      total_sent: 0,
      total_replies: 0,
      total_opens: 0,
      total_bounced: 0,
      total_complaints: 0,
    };

    // Get top performers
    const topResult = await query<{
      subdomain: string;
      engagement_score: number;
      reply_count: number;
    }>(
      `SELECT s.subdomain, s.engagement_score,
              COUNT(*) as reply_count
       FROM subdomains s
       JOIN reply_events re ON s.id = re.subdomain_id
       WHERE re.timestamp >= $1
       GROUP BY s.id, s.subdomain, s.engagement_score
       ORDER BY reply_count DESC
       LIMIT 10`,
      [weekAgo]
    );

    // Get low performers
    const lowResult = await query<{
      subdomain: string;
      engagement_score: number;
      reply_count: number;
    }>(
      `SELECT s.subdomain, s.engagement_score,
              COUNT(*) as reply_count
       FROM subdomains s
       LEFT JOIN reply_events re ON s.id = re.subdomain_id AND re.timestamp >= $1
       WHERE s.status = 'active' AND s.engagement_score < 20
       GROUP BY s.id, s.subdomain, s.engagement_score
       ORDER BY s.engagement_score ASC
       LIMIT 10`,
      [weekAgo]
    );

    // Build report
    const report = [
      `# Weekly Engagement Report`,
      `Period: ${weekAgo.toISOString().split('T')[0]} to ${now.toISOString().split('T')[0]}`,
      '',
      '## Summary',
      `- Total sent: ${stats.total_sent.toLocaleString()}`,
      `- Total replies: ${stats.total_replies.toLocaleString()}`,
      `- Reply rate: ${stats.total_sent > 0 ? ((stats.total_replies / stats.total_sent) * 100).toFixed(2) : 0}%`,
      `- Bounce rate: ${stats.total_sent > 0 ? ((stats.total_bounced / stats.total_sent) * 100).toFixed(2) : 0}%`,
      `- Complaint rate: ${stats.total_sent > 0 ? ((stats.total_complaints / stats.total_sent) * 100).toFixed(2) : 0}%`,
      '',
      '## Top Performers',
      ...topResult.rows.map((r) => `- ${r.subdomain}: ${r.reply_count} replies (score: ${r.engagement_score})`),
      '',
      '## Low Performers',
      ...lowResult.rows.map((r) => `- ${r.subdomain}: ${r.reply_count} replies (score: ${r.engagement_score})`),
    ].join('\n');

    // Store report
    const weekStr = `${now.getFullYear()}-W${String(Math.ceil((now.getDate() + new Date(now.getFullYear(), 0, 1).getDay()) / 7)).padStart(2, '0')}`;
    await query(
      `INSERT INTO report_logs (id, report_type, report_date, report_data, created_at)
       VALUES ($1, 'weekly', $2, $3, NOW())`,
      [randomUUID(), weekStr, report]
    );

    // Send alert
    const alert = createAlert(
      'info',
      'Weekly Report',
      stats.total_sent,
      700000,
      `Weekly: ${stats.total_sent.toLocaleString()} sent, ${(stats.total_replies / Math.max(stats.total_sent, 1) * 100).toFixed(2)}% reply rate`
    );
    await sendAlert(alert);

    const completedAt = new Date();

    return {
      job_name: 'weekly_report',
      started_at: startTime,
      completed_at: completedAt,
      success: true,
      duration_ms: completedAt.getTime() - startTime.getTime(),
      message: `Weekly report generated: ${stats.total_sent.toLocaleString()} emails sent`,
    };
  } catch (error) {
    return {
      job_name: 'weekly_report',
      started_at: startTime,
      completed_at: new Date(),
      success: false,
      duration_ms: Date.now() - startTime.getTime(),
      message: error instanceof Error ? error.message : 'Report generation failed',
    };
  }
}
