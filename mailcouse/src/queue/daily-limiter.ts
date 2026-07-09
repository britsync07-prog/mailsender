// Limit check and enforcement

import { query } from '../db/connection';
import { getSubdomainCount, getIPCount, incrementSubdomainCount, incrementIPCount, incrementTotalDailyVolume } from './counter-store';
import { JobPayload } from './types';

// Default limits
const DEFAULT_SUBDOMAIN_DAILY_LIMIT = 10;
const WARMUP_SUBDOMAIN_DAILY_LIMIT = 3;
const IP_DAILY_LIMIT = 2000;

/**
 * Check if a job can be dispatched (within all limits)
 */
export async function canDispatch(job: JobPayload): Promise<{
  allowed: boolean;
  reason?: string;
  subdomain_count?: number;
  subdomain_limit?: number;
  ip_count?: number;
  ip_limit?: number;
}> {
  // Check subdomain limit
  const subdomainCount = await getSubdomainCount(job.subdomain_id);
  const subdomainLimit = await getSubdomainLimit(job.subdomain_id);

  if (subdomainCount >= subdomainLimit) {
    return {
      allowed: false,
      reason: `Subdomain at limit: ${subdomainCount}/${subdomainLimit}`,
      subdomain_count: subdomainCount,
      subdomain_limit: subdomainLimit,
    };
  }

  // Check IP limit
  const ipCount = await getIPCount(job.ip_id);
  const ipLimit = IP_DAILY_LIMIT;

  if (ipCount >= ipLimit) {
    return {
      allowed: false,
      reason: `IP at limit: ${ipCount}/${ipLimit}`,
      ip_count: ipCount,
      ip_limit: ipLimit,
    };
  }

  return {
    allowed: true,
    subdomain_count: subdomainCount,
    subdomain_limit: subdomainLimit,
    ip_count: ipCount,
    ip_limit: ipLimit,
  };
}

/**
 * Get subdomain's daily limit
 */
async function getSubdomainLimit(subdomainId: string): Promise<number> {
  const result = await query<{ daily_limit: number; warmup_complete: boolean }>(
    'SELECT daily_limit, warmup_complete FROM subdomains WHERE id = $1',
    [subdomainId]
  );

  if (result.rows.length === 0) {
    return WARMUP_SUBDOMAIN_DAILY_LIMIT;
  }

  const subdomain = result.rows[0];
  return subdomain.warmup_complete ? subdomain.daily_limit : WARMUP_SUBDOMAIN_DAILY_LIMIT;
}

/**
 * Record a successful send (increment counters)
 */
export async function recordSend(job: JobPayload): Promise<void> {
  // Increment subdomain counter
  await incrementSubdomainCount(job.subdomain_id);

  // Increment IP counter
  await incrementIPCount(job.ip_id);

  // Increment total daily volume
  await incrementTotalDailyVolume();

  // Update database counters
  await query(
    'UPDATE subdomains SET emails_sent_today = emails_sent_today + 1 WHERE id = $1',
    [job.subdomain_id]
  );

  await query(
    'UPDATE ip_pool SET emails_today = emails_today + 1 WHERE id = $1',
    [job.ip_id]
  );
}

/**
 * Requeue a job for tomorrow
 */
export async function requeueJob(jobId: string, reason: string): Promise<void> {
  // Calculate tomorrow's date
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(9, 0, 0, 0); // Start of send window

  await query(
    `UPDATE send_jobs
     SET status = 'queued',
         scheduled_at = $1,
         attempt_count = attempt_count + 1
     WHERE id = $2`,
    [tomorrow, jobId]
  );

  // Track in Redis
  try {
    const Redis = require('ioredis');
    const redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    });
    await redis.sadd('jobs:requeued', jobId);
    await redis.quit();
  } catch (error) {
    // Redis not available, continue
  }
}

/**
 * Get current volume statistics
 */
export async function getVolumeStats(): Promise<{
  total_today: number;
  target_daily: number;
  percentage: number;
  subdomains_at_limit: number;
  ips_at_limit: number;
}> {
  const totalResult = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM send_jobs WHERE status = 'sent' AND sent_at >= CURRENT_DATE"
  );

  const subdomainsAtLimit = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM subdomains WHERE emails_sent_today >= daily_limit'
  );

  const ipsAtLimit = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM ip_pool WHERE emails_today >= 2000'
  );

  const totalToday = parseInt(String(totalResult.rows[0]?.count || '0'));
  const targetDaily = 100000; // Phase 1 target

  return {
    total_today: totalToday,
    target_daily: targetDaily,
    percentage: Math.round((totalToday / targetDaily) * 100),
    subdomains_at_limit: parseInt(String(subdomainsAtLimit.rows[0]?.count || '0')),
    ips_at_limit: parseInt(String(ipsAtLimit.rows[0]?.count || '0')),
  };
}
