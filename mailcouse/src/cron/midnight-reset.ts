// Daily counter reset cron job

import { query } from '../db/connection';
import { CronJobResult } from './types';

/**
 * Run midnight UTC reset
 */
export async function runMidnightReset(): Promise<CronJobResult> {
  const startTime = new Date();

  try {
    // Reset subdomain daily counters
    await query('UPDATE subdomains SET emails_sent_today = 0');

    // Reset IP daily counters
    await query('UPDATE ip_pool SET emails_today = 0');

    // Reset Redis counters
    try {
      const Redis = require('ioredis');
      const redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      });

      // Clear all subdomain counters
      const subdomainKeys = await redis.keys('subdomain:*:sent_today');
      if (subdomainKeys.length > 0) {
        await redis.del(...subdomainKeys);
      }

      // Clear all IP counters
      const ipKeys = await redis.keys('ip:*:sent_today');
      if (ipKeys.length > 0) {
        await redis.del(...ipKeys);
      }

      // Reset daily total
      await redis.set('daily:total', '0');

      await redis.quit();
    } catch (error) {
      // Redis not available, continue
    }

    // Archive previous day's counters
    await archivePreviousDay();

    const completedAt = new Date();

    return {
      job_name: 'midnight_reset',
      started_at: startTime,
      completed_at: completedAt,
      success: true,
      duration_ms: completedAt.getTime() - startTime.getTime(),
      message: 'Midnight reset completed successfully',
    };
  } catch (error) {
    return {
      job_name: 'midnight_reset',
      started_at: startTime,
      completed_at: new Date(),
      success: false,
      duration_ms: Date.now() - startTime.getTime(),
      message: error instanceof Error ? error.message : 'Reset failed',
    };
  }
}

/**
 * Archive previous day's counters
 */
async function archivePreviousDay(): Promise<void> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];

  // Get yesterday's stats
  const stats = await query<{ count: number }>(
    `SELECT COUNT(*) as count FROM send_jobs
     WHERE sent_at >= $1::date AND sent_at < ($1::date + INTERVAL '1 day')`,
    [dateStr]
  );

  const totalSent = parseInt(String(stats.rows[0]?.count || '0'));

  // Archive
  await query(
    `INSERT INTO daily_stats (date, total_sent, archived_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (date) DO UPDATE SET total_sent = $2, archived_at = NOW()`,
    [dateStr, totalSent]
  );
}

/**
 * Format reset result for logging
 */
export function formatResetResult(result: CronJobResult): string {
  return [
    `=== Midnight Reset Report ===`,
    `Job: ${result.job_name}`,
    `Status: ${result.success ? 'SUCCESS' : 'FAILED'}`,
    `Duration: ${result.duration_ms}ms`,
    `Message: ${result.message}`,
    `============================`,
  ].join('\n');
}
