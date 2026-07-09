// Statistical aggregation

import { query } from '../db/connection';
import { DailyStats, HourlyRollup } from './types';

/**
 * Get daily statistics
 */
export async function getDailyStats(
  date?: string
): Promise<DailyStats> {
  const targetDate = date || new Date().toISOString().split('T')[0];

  // Total sent today
  const totalResult = await query<{ count: number }>(
    `SELECT COUNT(*) as count FROM send_jobs
     WHERE sent_at >= $1::date AND sent_at < ($1::date + INTERVAL '1 day')`,
    [targetDate]
  );

  // By domain
  const domainResult = await query<{ domain: string; count: number }>(
    `SELECT d.domain, COUNT(*) as count
     FROM send_jobs sj
     JOIN subdomains s ON sj.subdomain_id = s.id
     JOIN domains d ON s.domain_id = d.id
     WHERE sj.sent_at >= $1::date AND sj.sent_at < ($1::date + INTERVAL '1 day')
     GROUP BY d.domain
     ORDER BY count DESC`,
    [targetDate]
  );

  // By IP
  const ipResult = await query<{ ip: string; count: number }>(
    `SELECT ip_address as ip, COUNT(*) as count
     FROM send_jobs sj
     JOIN ip_pool ip ON sj.ip_id = ip.id
     WHERE sj.sent_at >= $1::date AND sj.sent_at < ($1::date + INTERVAL '1 day')
     GROUP BY ip_address
     ORDER BY count DESC`,
    [targetDate]
  );

  // By industry
  const industryResult = await query<{ industry: string; count: number }>(
    `SELECT l.industry, COUNT(*) as count
     FROM send_jobs sj
     JOIN leads l ON sj.lead_id = l.id
     WHERE sj.sent_at >= $1::date AND sj.sent_at < ($1::date + INTERVAL '1 day')
     GROUP BY l.industry
     ORDER BY count DESC`,
    [targetDate]
  );

  return {
    date: targetDate,
    total_sent: parseInt(String(totalResult.rows[0]?.count || '0')),
    by_domain: domainResult.rows.map((r) => ({
      domain: r.domain,
      count: parseInt(String(r.count)),
    })),
    by_ip: ipResult.rows.map((r) => ({
      ip: r.ip,
      count: parseInt(String(r.count)),
    })),
    by_industry: industryResult.rows.map((r) => ({
      industry: r.industry,
      count: parseInt(String(r.count)),
    })),
  };
}

/**
 * Get hourly rollup for a day
 */
export async function getHourlyRollup(
  date?: string
): Promise<HourlyRollup[]> {
  const targetDate = date || new Date().toISOString().split('T')[0];

  const result = await query<{ hour: number; count: number }>(
    `SELECT EXTRACT(HOUR FROM sent_at) as hour, COUNT(*) as count
     FROM send_jobs
     WHERE sent_at >= $1::date AND sent_at < ($1::date + INTERVAL '1 day')
     GROUP BY hour
     ORDER BY hour`,
    [targetDate]
  );

  return result.rows.map((r) => ({
    hour: parseInt(String(r.hour)),
    count: parseInt(String(r.count)),
  }));
}

/**
 * Get weekly trend data
 */
export async function getWeeklyTrend(): Promise<{
  dates: string[];
  totals: number[];
  avg_daily: number;
}> {
  const result = await query<{ date: string; count: number }>(
    `SELECT sent_at::date as date, COUNT(*) as count
     FROM send_jobs
     WHERE sent_at >= NOW() - INTERVAL '7 days'
     GROUP BY date
     ORDER BY date`
  );

  const dates = result.rows.map((r) => r.date);
  const totals = result.rows.map((r) => parseInt(String(r.count)));
  const avgDaily = totals.length > 0
    ? Math.round(totals.reduce((a, b) => a + b, 0) / totals.length)
    : 0;

  return { dates, totals, avg_daily: avgDaily };
}

/**
 * Get volume vs target comparison
 */
export async function getVolumeComparison(): Promise<{
  today: number;
  target: number;
  percentage: number;
  status: 'below' | 'on_track' | 'above';
}> {
  const todayResult = await query<{ count: number }>(
    `SELECT COUNT(*) as count FROM send_jobs
     WHERE sent_at >= CURRENT_DATE`
  );

  const today = parseInt(String(todayResult.rows[0]?.count || '0'));
  const target = 100000; // Phase 1 target
  const percentage = Math.round((today / target) * 100);

  let status: 'below' | 'on_track' | 'above' = 'on_track';
  if (percentage < 80) status = 'below';
  else if (percentage > 110) status = 'above';

  return { today, target, percentage, status };
}
