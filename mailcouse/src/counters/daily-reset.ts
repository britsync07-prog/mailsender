// Midnight UTC reset cron job

import { query } from '../db/connection';

/**
 * Run daily counter reset
 */
export async function runDailyReset(): Promise<{
  subdomains_reset: number;
  ips_reset: number;
  duration_ms: number;
}> {
  const startTime = Date.now();

  // Reset subdomain daily counters
  const subdomainResult = await query(
    'UPDATE subdomains SET emails_sent_today = 0'
  );

  // Reset IP daily counters
  const ipResult = await query(
    'UPDATE ip_pool SET emails_today = 0'
  );

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
    // Redis not available
  }

  const duration = Date.now() - startTime;

  return {
    subdomains_reset: subdomainResult.rowCount || 0,
    ips_reset: ipResult.rowCount || 0,
    duration_ms: duration,
  };
}

/**
 * Archive daily counters before reset
 */
export async function archiveDailyCounters(): Promise<{
  archived: boolean;
  date: string;
}> {
  const today = new Date().toISOString().split('T')[0];

  // Get current day's stats
  const stats = await query<{
    total: number;
  }>(
    `SELECT COUNT(*) as total FROM send_jobs
     WHERE sent_at >= CURRENT_DATE AND sent_at < CURRENT_DATE + INTERVAL '1 day'`
  );

  const totalSent = parseInt(String(stats.rows[0]?.total || '0'));

  // Archive to daily_stats table
  await query(
    `INSERT INTO daily_stats (date, total_sent, archived_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (date) DO UPDATE SET total_sent = $2, archived_at = NOW()`,
    [today, totalSent]
  );

  return { archived: true, date: today };
}
