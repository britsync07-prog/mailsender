// Daily volume report generation

import { query } from '../db/connection';
import { CronJobResult, DailyReportData } from './types';
import { sendAlert } from '../monitoring/alert-dispatcher';
import { createAlert } from '../monitoring/alert-dispatcher';

/**
 * Generate daily volume report
 */
export async function generateDailyReport(): Promise<CronJobResult> {
  const startTime = new Date();

  try {
    const dateStr = new Date().toISOString().split('T')[0];

    // Get total sent today
    const totalResult = await query<{ count: number }>(
      "SELECT COUNT(*) as count FROM send_jobs WHERE status = 'sent' AND sent_at >= CURRENT_DATE"
    );
    const totalSent = parseInt(String(totalResult.rows[0]?.count || '0'));

    // Get by domain
    const domainResult = await query<{ domain: string; sent: number }>(
      `SELECT d.domain, COUNT(*) as sent
       FROM send_jobs sj
       JOIN subdomains s ON sj.subdomain_id = s.id
        JOIN domains d ON s.domain_id = d.id
       WHERE sj.status = 'sent' AND sj.sent_at >= CURRENT_DATE
       GROUP BY d.domain
       ORDER BY sent DESC`
    );

    // Get by IP
    const ipResult = await query<{ ip: string; sent: number }>(
      `SELECT ip.ip_address as ip, COUNT(*) as sent
       FROM send_jobs sj
       JOIN ip_pool ip ON sj.ip_id = ip.id
       WHERE sj.status = 'sent' AND sj.sent_at >= CURRENT_DATE
       GROUP BY ip.ip_address
       ORDER BY sent DESC`
    );

    // Get by industry
    const industryResult = await query<{ industry: string; sent: number }>(
      `SELECT l.industry, COUNT(*) as sent
       FROM send_jobs sj
       JOIN leads l ON sj.lead_id = l.id
       WHERE sj.status = 'sent' AND sj.sent_at >= CURRENT_DATE
       GROUP BY l.industry
       ORDER BY sent DESC`
    );

    // Get bounce rate
    const bounceResult = await query<{ total: number; bounced: number }>(
      `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE status = 'bounced') as bounced
       FROM send_jobs
       WHERE sent_at >= CURRENT_DATE`
    );
    const bounceStats = bounceResult.rows[0] || { total: 0, bounced: 0 };
    const bounceRate = bounceStats.total > 0 ? bounceStats.bounced / bounceStats.total : 0;

    // Get complaint rate
    const complaintResult = await query<{ count: number }>(
      "SELECT COUNT(*) as count FROM complaint_events WHERE timestamp >= CURRENT_DATE"
    );
    const complaints = parseInt(String(complaintResult.rows[0]?.count || '0'));
    const complaintRate = totalSent > 0 ? complaints / totalSent : 0;

    // Get reply rate
    const replyResult = await query<{ count: number }>(
      "SELECT COUNT(*) as count FROM reply_events WHERE timestamp >= CURRENT_DATE"
    );
    const replies = parseInt(String(replyResult.rows[0]?.count || '0'));
    const replyRate = totalSent > 0 ? replies / totalSent : 0;

    // Get suppression additions
    const suppressionResult = await query<{ count: number }>(
      "SELECT COUNT(*) as count FROM suppression_list WHERE suppressed_at >= CURRENT_DATE"
    );
    const suppressionAdditions = parseInt(String(suppressionResult.rows[0]?.count || '0'));

    // Get blacklisted IPs
    const blacklistResult = await query<{ count: number }>(
      "SELECT COUNT(*) as count FROM ip_pool WHERE blacklisted = true AND last_blacklist_check >= CURRENT_DATE"
    );
    const blacklistedIPs = parseInt(String(blacklistResult.rows[0]?.count || '0'));

    // Get retired domains
    const retiredResult = await query<{ count: number }>(
      "SELECT COUNT(*) as count FROM domains WHERE retired_at >= CURRENT_DATE"
    );
    const retiredDomains = parseInt(String(retiredResult.rows[0]?.count || '0'));

    // Get dead letter count
    const deadLetterResult = await query<{ count: number }>(
      "SELECT COUNT(*) as count FROM send_jobs WHERE status = 'failed'"
    );
    const deadLetterCount = parseInt(String(deadLetterResult.rows[0]?.count || '0'));

    // Build report data
    const reportData: DailyReportData = {
      date: dateStr,
      total_sent: totalSent,
      target: 100000,
      percentage: Math.round((totalSent / 100000) * 100),
      by_domain: domainResult.rows.map((r) => ({ domain: r.domain, sent: parseInt(String(r.sent)) })),
      by_ip: ipResult.rows.map((r) => ({ ip: r.ip, sent: parseInt(String(r.sent)) })),
      by_industry: industryResult.rows.map((r) => ({ industry: r.industry, sent: parseInt(String(r.sent)) })),
      bounce_rate: bounceRate,
      complaint_rate: complaintRate,
      reply_rate: replyRate,
      suppression_additions: suppressionAdditions,
      blacklisted_ips: blacklistedIPs,
      retired_domains: retiredDomains,
      dead_letter_count: deadLetterCount,
    };

    // Store report
    await query(
      `INSERT INTO report_logs (id, report_type, report_date, report_data, created_at)
       VALUES ($1, 'daily', $2, $3, NOW())
       ON CONFLICT (report_date) DO UPDATE SET report_data = $3`,
      [randomUUID(), dateStr, JSON.stringify(reportData)]
    );

    // Send alert with summary
    const alert = createAlert(
      totalSent < 80000 ? 'warning' : 'info',
      'Daily Report',
      totalSent,
      100000,
      `Daily volume: ${totalSent.toLocaleString()} (${reportData.percentage}% of target)`,
      undefined,
      undefined
    );
    await sendAlert(alert);

    const completedAt = new Date();

    return {
      job_name: 'daily_report',
      started_at: startTime,
      completed_at: completedAt,
      success: true,
      duration_ms: completedAt.getTime() - startTime.getTime(),
      message: `Daily report generated: ${totalSent.toLocaleString()} emails sent`,
    };
  } catch (error) {
    return {
      job_name: 'daily_report',
      started_at: startTime,
      completed_at: new Date(),
      success: false,
      duration_ms: Date.now() - startTime.getTime(),
      message: error instanceof Error ? error.message : 'Report generation failed',
    };
  }
}

/**
 * Format daily report as markdown
 */
export function formatDailyReport(data: DailyReportData): string {
  const lines: string[] = [];

  lines.push(`# Daily Report - ${data.date}`);
  lines.push('');
  lines.push('## Summary');
  lines.push(`- Total sent: ${data.total_sent.toLocaleString()} / ${data.target.toLocaleString()} (${data.percentage}%)`);
  lines.push(`- Bounce rate: ${(data.bounce_rate * 100).toFixed(2)}%`);
  lines.push(`- Complaint rate: ${(data.complaint_rate * 100).toFixed(2)}%`);
  lines.push(`- Reply rate: ${(data.reply_rate * 100).toFixed(2)}%`);
  lines.push(`- Suppression additions: ${data.suppression_additions}`);
  lines.push(`- Blacklisted IPs: ${data.blacklisted_ips}`);
  lines.push(`- Retired domains: ${data.retired_domains}`);
  lines.push(`- Dead letter queue: ${data.dead_letter_count}`);
  lines.push('');

  lines.push('## By Industry');
  for (const industry of data.by_industry) {
    lines.push(`- ${industry.industry}: ${industry.sent.toLocaleString()}`);
  }
  lines.push('');

  lines.push('## Top Domains');
  for (const domain of data.by_domain.slice(0, 10)) {
    lines.push(`- ${domain.domain}: ${domain.sent.toLocaleString()}`);
  }

  return lines.join('\n');
}

function randomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
