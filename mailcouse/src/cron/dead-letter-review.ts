// Dead letter queue alert

import { query } from '../db/connection';
import { CronJobResult } from './types';
import { sendAlert, createAlert } from '../monitoring/alert-dispatcher';

/**
 * Check dead letter queue and alert if non-empty
 */
export async function checkDeadLetterQueue(): Promise<CronJobResult> {
  const startTime = new Date();

  try {
    const result = await query<{ count: number }>(
      "SELECT COUNT(*) as count FROM send_jobs WHERE status = 'failed'"
    );

    const count = parseInt(String(result.rows[0]?.count || '0'));

    if (count > 0) {
      const alert = createAlert(
        'warning',
        'Dead Letter Queue',
        count,
        0,
        `Dead letter queue has ${count} failed jobs requiring review`
      );
      await sendAlert(alert);
    }

    const completedAt = new Date();

    return {
      job_name: 'dead_letter_review',
      started_at: startTime,
      completed_at: completedAt,
      success: true,
      duration_ms: completedAt.getTime() - startTime.getTime(),
      message: `Dead letter check: ${count} failed jobs`,
    };
  } catch (error) {
    return {
      job_name: 'dead_letter_review',
      started_at: startTime,
      completed_at: new Date(),
      success: false,
      duration_ms: Date.now() - startTime.getTime(),
      message: error instanceof Error ? error.message : 'Check failed',
    };
  }
}
