// Exponential backoff retry logic

import { query } from '../db/connection';
import { getRetryDelay } from './response-handler';

/**
 * Calculate retry time for a job
 */
export function calculateRetryTime(attempt: number): Date {
  const delayMs = getRetryDelay(attempt);
  return new Date(Date.now() + delayMs);
}

/**
 * Requeue job for retry
 */
export async function requeueForRetry(jobId: string, attempt: number): Promise<void> {
  const retryTime = calculateRetryTime(attempt);

  await query(
    `UPDATE send_jobs
     SET status = 'queued',
         scheduled_at = $1,
         attempt_count = attempt_count + 1
     WHERE id = $2`,
    [retryTime, jobId]
  );
}

/**
 * Move job to dead letter queue
 */
export async function moveToDeadLetter(jobId: string, reason: string): Promise<void> {
  await query(
    `UPDATE send_jobs
     SET status = 'failed',
         failed_at = NOW(),
         smtp_response = $1
     WHERE id = $2`,
    [reason, jobId]
  );
}

/**
 * Get retry statistics
 */
export async function getRetryStats(): Promise<{
  total_retried: number;
  total_dead_letter: number;
  avg_attempts: number;
}> {
  const result = await query<{
    total_retried: number;
    total_dead_letter: number;
    avg_attempts: number;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE attempt_count > 1 AND status = 'queued') as total_retried,
       COUNT(*) FILTER (WHERE status = 'failed') as total_dead_letter,
       AVG(attempt_count) as avg_attempts
     FROM send_jobs`
  );

  return result.rows[0] || { total_retried: 0, total_dead_letter: 0, avg_attempts: 0 };
}
