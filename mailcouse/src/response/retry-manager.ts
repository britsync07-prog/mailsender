// Exponential backoff and retry logic

import { query } from '../db/connection';
import { DEFAULT_RETRY_POLICY, RetryPolicy } from './types';

/**
 * Calculate next retry time with exponential backoff
 */
export function calculateBackoff(
  attempt: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY
): Date {
  const delayIndex = Math.min(attempt - 1, policy.backoff_delays_ms.length - 1);
  const delayMs = policy.backoff_delays_ms[delayIndex];
  return new Date(Date.now() + delayMs);
}

/**
 * Check if job can be retried
 */
export async function canRetry(jobId: string): Promise<boolean> {
  const result = await query<{ attempt_count: number }>(
    'SELECT attempt_count FROM send_jobs WHERE id = $1',
    [jobId]
  );

  if (result.rows.length === 0) return false;

  return result.rows[0].attempt_count < DEFAULT_RETRY_POLICY.max_attempts;
}

/**
 * Requeue job for retry
 */
export async function requeueForRetry(
  jobId: string,
  responseCode: number,
  responseMessage: string
): Promise<{ success: boolean; retry_at: Date }> {
  const result = await query<{ attempt_count: number }>(
    'SELECT attempt_count FROM send_jobs WHERE id = $1',
    [jobId]
  );

  if (result.rows.length === 0) {
    return { success: false, retry_at: new Date() };
  }

  const currentAttempt = result.rows[0].attempt_count;
  const retryAt = calculateBackoff(currentAttempt);

  await query(
    `UPDATE send_jobs
     SET status = 'queued',
         scheduled_at = $1,
         attempt_count = attempt_count + 1,
         smtp_response = $2
     WHERE id = $3`,
    [retryAt, `${responseCode} ${responseMessage}`, jobId]
  );

  return { success: true, retry_at: retryAt };
}

/**
 * Get jobs eligible for retry
 */
export async function getRetryableJobs(): Promise<{
  job_id: string;
  attempt_count: number;
  scheduled_at: Date;
}[]> {
  const result = await query<{
    id: string;
    attempt_count: number;
    scheduled_at: Date;
  }>(
    `SELECT id, attempt_count, scheduled_at
     FROM send_jobs
     WHERE status = 'queued'
       AND attempt_count > 1
       AND scheduled_at <= NOW()
     ORDER BY scheduled_at
     LIMIT 100`
  );

  return result.rows.map((r) => ({
    job_id: r.id,
    attempt_count: r.attempt_count,
    scheduled_at: r.scheduled_at,
  }));
}

/**
 * Get retry statistics
 */
export async function getRetryStatistics(): Promise<{
  total_retried: number;
  avg_attempts: number;
  max_attempts_reached: number;
}> {
  const result = await query<{
    retried: number;
    avg_attempts: number;
    max_reached: number;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE attempt_count > 1) as retried,
       AVG(attempt_count) as avg_attempts,
       COUNT(*) FILTER (WHERE attempt_count >= $1) as max_reached
     FROM send_jobs`,
    [DEFAULT_RETRY_POLICY.max_attempts]
  );

  const stats = result.rows[0] || { retried: 0, avg_attempts: 0, max_reached: 0 };

  return {
    total_retried: parseInt(String(stats.retried)),
    avg_attempts: parseFloat(String(stats.avg_attempts)) || 0,
    max_attempts_reached: parseInt(String(stats.max_reached)),
  };
}
