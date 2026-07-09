// Counter increment logic

import { query } from '../db/connection';
import { CounterUpdate } from './types';

/**
 * Increment all counters for a successful send
 */
export async function incrementCounters(update: CounterUpdate): Promise<void> {
  // Increment subdomain counters
  if (update.subdomain_id) {
    await query(
      `UPDATE subdomains
       SET emails_sent_today = emails_sent_today + 1,
           total_sent = total_sent + 1
       WHERE id = $1`,
      [update.subdomain_id]
    );
  }

  // Increment IP counters
  if (update.ip_id) {
    await query(
      `UPDATE ip_pool
       SET emails_today = emails_today + 1
       WHERE id = $1`,
      [update.ip_id]
    );
  }

  // Increment lead counter
  if (update.lead_id) {
    await query(
      `UPDATE leads
       SET send_count = send_count + 1,
           last_sent_at = $1,
           status = CASE WHEN send_count = 0 THEN 'sent' ELSE status END
       WHERE id = $2`,
      [update.timestamp, update.lead_id]
    );
  }

  // Update send job
  await query(
    `UPDATE send_jobs
     SET status = 'sent',
         sent_at = $1
     WHERE id = $2`,
    [update.timestamp, update.job_id]
  );
}

/**
 * Increment Redis counters
 */
export async function incrementRedisCounters(update: CounterUpdate): Promise<void> {
  try {
    const Redis = require('ioredis');
    const redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    });

    if (update.subdomain_id) {
      await redis.incr(`subdomain:${update.subdomain_id}:sent_today`);
    }

    if (update.ip_id) {
      await redis.incr(`ip:${update.ip_id}:sent_today`);
    }

    await redis.incr('daily:total');

    await redis.quit();
  } catch (error) {
    // Redis not available, continue without cache
  }
}

/**
 * Batch increment counters
 */
export async function batchIncrementCounters(
  updates: CounterUpdate[]
): Promise<{ processed: number; duration_ms: number }> {
  const startTime = Date.now();

  for (const update of updates) {
    await incrementCounters(update);
    await incrementRedisCounters(update);
  }

  return {
    processed: updates.length,
    duration_ms: Date.now() - startTime,
  };
}

/**
 * Get current counter values
 */
export async function getCounterValues(
  subdomainId: string
): Promise<{
  emails_sent_today: number;
  total_sent: number;
} | null> {
  const result = await query<{
    emails_sent_today: number;
    total_sent: number;
  }>(
    'SELECT emails_sent_today, total_sent FROM subdomains WHERE id = $1',
    [subdomainId]
  );

  return result.rows[0] || null;
}
