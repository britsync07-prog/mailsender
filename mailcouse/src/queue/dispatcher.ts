// Main dispatch orchestrator

import { query } from '../db/connection';
import { canDispatch, recordSend, requeueJob } from './daily-limiter';
import { JobPayload } from './types';

// Redis client
let redisClient: any = null;
const QUEUE_NAME = 'email-send-queue';

/**
 * Get or create Redis client
 */
async function getRedisClient(): Promise<any> {
  if (redisClient) return redisClient;

  try {
    const Redis = require('ioredis');
    redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD || undefined,
    });
    await redisClient.ping();
    return redisClient;
  } catch (error) {
    console.warn('Redis not available for dispatch');
    return null;
  }
}

export interface DispatchResult {
  dispatched: number;
  requeued: number;
  failed: number;
  errors: { job_id: string; error: string }[];
  duration_ms: number;
}

/**
 * Dispatch jobs from queue
 */
export async function dispatchJobs(
  maxJobs: number = 100
): Promise<DispatchResult> {
  const startTime = Date.now();
  let dispatched = 0;
  let requeued = 0;
  let failed = 0;
  const errors: { job_id: string; error: string }[] = [];

  const redis = await getRedisClient();
  if (!redis) {
    return {
      dispatched: 0,
      requeued: 0,
      failed: 0,
      errors: [{ job_id: 'none', error: 'Redis not available' }],
      duration_ms: Date.now() - startTime,
    };
  }

  // Get jobs from queue (sorted by priority)
  const jobDataList = await redis.zrange(QUEUE_NAME, 0, maxJobs - 1, 'WITHSCORES');

  for (let i = 0; i < jobDataList.length; i += 2) {
    const jobData = jobDataList[i];
    const priority = jobDataList[i + 1];

    try {
      const job: JobPayload = JSON.parse(jobData);

      // Check if job can be dispatched
      const check = await canDispatch(job);

      if (check.allowed) {
        // Remove from queue
        await redis.zrem(QUEUE_NAME, jobData);

        // Mark as processing in database
        await query(
          "UPDATE send_jobs SET status = 'processing' WHERE id = $1",
          [job.job_id]
        );

        // Record successful send
        await recordSend(job);

        // Mark as sent
        await query(
          "UPDATE send_jobs SET status = 'sent', sent_at = NOW() WHERE id = $1",
          [job.job_id]
        );

        dispatched++;
      } else {
        // Requeue for tomorrow
        await redis.zrem(QUEUE_NAME, jobData);
        await requeueJob(job.job_id, check.reason || 'At limit');
        requeued++;
      }
    } catch (error) {
      failed++;
      errors.push({
        job_id: 'unknown',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return {
    dispatched,
    requeued,
    failed,
    errors,
    duration_ms: Date.now() - startTime,
  };
}

/**
 * Get queue depth
 */
export async function getQueueDepth(): Promise<number> {
  const redis = await getRedisClient();
  if (!redis) {
    const result = await query<{ count: number }>(
      "SELECT COUNT(*) as count FROM send_jobs WHERE status = 'queued'"
    );
    return parseInt(String(result.rows[0]?.count || '0'));
  }
  return await redis.zcard(QUEUE_NAME);
}
