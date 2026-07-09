// Warmup schedule management

import { query } from '../db/connection';
import { WARMUP_SCHEDULE, WarmupSchedule } from './types';

export { WARMUP_SCHEDULE } from './types';

/**
 * Get warmup schedule for a week
 */
export function getScheduleForWeek(week: number): WarmupSchedule | null {
  return WARMUP_SCHEDULE.find((s) => s.week === week) || null;
}

/**
 * Calculate current warmup week for a subdomain
 */
export function calculateWarmupWeek(warmupStartedAt: Date): number {
  const now = new Date();
  const weeksSinceStart = Math.floor(
    (now.getTime() - warmupStartedAt.getTime()) / (7 * 24 * 60 * 60 * 1000)
  );
  return Math.min(weeksSinceStart + 1, 4); // Cap at week 4
}

/**
 * Get recommended daily limit for warmup phase
 */
export function getWarmupDailyLimit(warmupWeek: number): number {
  const schedule = getScheduleForWeek(warmupWeek);
  if (!schedule) return 3; // Default warmup limit
  return Math.ceil(schedule.emails_per_smtp_per_day * 200 / 200); // Per SMTP
}

/**
 * Start warmup for a subdomain
 */
export async function startWarmup(subdomainId: string): Promise<void> {
  await query(
    `UPDATE subdomains
     SET status = 'warming',
         warmup_started_at = NOW(),
         daily_limit = 3
     WHERE id = $1 AND status = 'provisioning'`,
    [subdomainId]
  );
}

/**
 * Update warmup progress
 */
export async function updateWarmupProgress(
  subdomainId: string,
  week: number
): Promise<void> {
  const schedule = getScheduleForWeek(week);
  if (!schedule) return;

  const newDailyLimit = getWarmupDailyLimit(week);

  await query(
    'UPDATE subdomains SET daily_limit = $1 WHERE id = $2',
    [newDailyLimit, subdomainId]
  );
}

/**
 * Complete warmup for a subdomain
 */
export async function completeWarmup(subdomainId: string): Promise<void> {
  await query(
    `UPDATE subdomains
     SET warmup_complete = true,
         daily_limit = 10
     WHERE id = $1`,
    [subdomainId]
  );
}

/**
 * Extend warmup period
 */
export async function extendWarmup(
  subdomainId: string,
  reason: string
): Promise<void> {
  // Reset warmup start to extend by 2 weeks
  await query(
    `UPDATE subdomains
     SET warmup_started_at = warmup_started_at + INTERVAL '2 weeks'
     WHERE id = $1`,
    [subdomainId]
  );

  console.log(`Extended warmup for ${subdomainId}: ${reason}`);
}

/**
 * Get warmup statistics
 */
export async function getWarmupStats(): Promise<{
  total: number;
  by_week: { week: number; count: number }[];
  ready_for_activation: number;
}> {
  const totalResult = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM subdomains WHERE status = 'warming'"
  );

  // Get count by warmup week
  const weekResult = await query<{ week: number; count: number }>(
    `SELECT
       CASE
         WHEN warmup_started_at > NOW() - INTERVAL '1 week' THEN 1
         WHEN warmup_started_at > NOW() - INTERVAL '2 weeks' THEN 2
         WHEN warmup_started_at > NOW() - INTERVAL '3 weeks' THEN 3
         ELSE 4
       END as week,
       COUNT(*) as count
     FROM subdomains
     WHERE status = 'warming'
     GROUP BY week
     ORDER BY week`
  );

  const readyResult = await query<{ count: number }>(
    `SELECT COUNT(*) as count FROM subdomains
     WHERE status = 'warming' AND warmup_complete = true`
  );

  return {
    total: parseInt(String(totalResult.rows[0]?.count || '0')),
    by_week: weekResult.rows.map((r) => ({
      week: r.week,
      count: parseInt(String(r.count)),
    })),
    ready_for_activation: parseInt(String(readyResult.rows[0]?.count || '0')),
  };
}
