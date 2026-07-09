// Dead letter queue management

import { query } from '../db/connection';
import { DeadLetterJob } from './types';

/**
 * Get dead letter jobs
 */
export async function getDeadLetterJobs(
  limit: number = 100
): Promise<DeadLetterJob[]> {
  const result = await query<DeadLetterJob>(
    `SELECT * FROM dead_letter
     ORDER BY moved_at DESC
     LIMIT $1`,
    [limit]
  );

  return result.rows;
}

/**
 * Get dead letter count
 */
export async function getDeadLetterCount(): Promise<number> {
  const result = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM dead_letter'
  );

  return parseInt(String(result.rows[0]?.count || '0'));
}

/**
 * Retry dead letter job
 */
export async function retryDeadLetterJob(
  deadLetterId: string
): Promise<boolean> {
  // Get dead letter entry
  const dlResult = await query<{ job_id: string }>(
    'SELECT job_id FROM dead_letter WHERE id = $1',
    [deadLetterId]
  );

  if (dlResult.rows.length === 0) return false;

  const jobId = dlResult.rows[0].job_id;

  // Reset job for retry
  await query(
    `UPDATE send_jobs
     SET status = 'queued',
         attempt_count = 1,
         scheduled_at = NOW()
     WHERE id = $1`,
    [jobId]
  );

  // Remove from dead letter
  await query('DELETE FROM dead_letter WHERE id = $1', [deadLetterId]);

  return true;
}

/**
 * Delete dead letter entry
 */
export async function deleteDeadLetterEntry(deadLetterId: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM dead_letter WHERE id = $1',
    [deadLetterId]
  );

  return (result.rowCount || 0) > 0;
}

/**
 * Purge old dead letter entries
 */
export async function purgeOldDeadLetter(
  daysOld: number = 30
): Promise<number> {
  const result = await query(
    `DELETE FROM dead_letter
     WHERE moved_at < NOW() - INTERVAL '${daysOld} days'`
  );

  return result.rowCount || 0;
}

/**
 * Get dead letter statistics
 */
export async function getDeadLetterStats(): Promise<{
  total: number;
  by_reason: { reason: string; count: number }[];
  oldest_entry: Date | null;
  newest_entry: Date | null;
}> {
  const totalResult = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM dead_letter'
  );

  const reasonResult = await query<{ reason: string; count: number }>(
    'SELECT reason, COUNT(*) as count FROM dead_letter GROUP BY reason'
  );

  const dateResult = await query<{ oldest: Date; newest: Date }>(
    'SELECT MIN(moved_at) as oldest, MAX(moved_at) as newest FROM dead_letter'
  );

  return {
    total: parseInt(String(totalResult.rows[0]?.count || '0')),
    by_reason: reasonResult.rows.map((r) => ({
      reason: r.reason,
      count: parseInt(String(r.count)),
    })),
    oldest_entry: dateResult.rows[0]?.oldest || null,
    newest_entry: dateResult.rows[0]?.newest || null,
  };
}
