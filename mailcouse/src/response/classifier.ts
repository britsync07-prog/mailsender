// Response code classification

import { query } from '../db/connection';
import { classifyCode, parseRawResponse } from './code-parser';
import { ResponseCategory, DEFAULT_RETRY_POLICY } from './types';

/**
 * Classify and route SMTP response
 */
export async function classifyAndRoute(
  jobId: string,
  responseCode: number,
  responseMessage: string
): Promise<{
  action: 'sent' | 'retry' | 'suppress' | 'unknown';
  reason: string;
}> {
  const category = classifyCode(responseCode);

  switch (category) {
    case 'success':
      await handleSuccess(jobId, responseCode, responseMessage);
      return { action: 'sent', reason: `Accepted: ${responseMessage}` };

    case 'soft_fail':
      const canRetry = await handleSoftFail(jobId, responseCode, responseMessage);
      return {
        action: canRetry ? 'retry' : 'suppress',
        reason: canRetry ? `Soft fail, will retry: ${responseMessage}` : `Max retries exceeded: ${responseMessage}`,
      };

    case 'hard_fail':
      await handleHardFail(jobId, responseCode, responseMessage);
      return { action: 'suppress', reason: `Hard fail: ${responseMessage}` };

    default:
      return { action: 'unknown', reason: `Unknown response: ${responseMessage}` };
  }
}

/**
 * Handle successful response
 */
async function handleSuccess(
  jobId: string,
  code: number,
  message: string
): Promise<void> {
  await query(
    `UPDATE send_jobs
     SET status = 'sent',
         sent_at = NOW(),
         smtp_response = $1
     WHERE id = $2`,
    [`${code} ${message}`, jobId]
  );
}

/**
 * Handle soft failure (retry)
 */
async function handleSoftFail(
  jobId: string,
  code: number,
  message: string
): Promise<boolean> {
  // Get current attempt count
  const result = await query<{ attempt_count: number }>(
    'SELECT attempt_count FROM send_jobs WHERE id = $1',
    [jobId]
  );

  if (result.rows.length === 0) return false;

  const currentAttempt = result.rows[0].attempt_count;

  if (currentAttempt >= DEFAULT_RETRY_POLICY.max_attempts) {
    // Max retries exceeded, move to dead letter
    await moveToDeadLetter(jobId, `Max retries exceeded after ${currentAttempt} attempts`);
    return false;
  }

  // Calculate backoff delay
  const delayMs = DEFAULT_RETRY_POLICY.backoff_delays_ms[
    Math.min(currentAttempt - 1, DEFAULT_RETRY_POLICY.backoff_delays_ms.length - 1)
  ];
  const retryAt = new Date(Date.now() + delayMs);

  // Requeue for retry
  await query(
    `UPDATE send_jobs
     SET status = 'queued',
         scheduled_at = $1,
         attempt_count = attempt_count + 1,
         smtp_response = $2
     WHERE id = $3`,
    [retryAt, `${code} ${message}`, jobId]
  );

  return true;
}

/**
 * Handle hard failure (suppress)
 */
async function handleHardFail(
  jobId: string,
  code: number,
  message: string
): Promise<void> {
  // Get lead email from job
  const jobResult = await query<{ lead_id: string }>(
    'SELECT lead_id FROM send_jobs WHERE id = $1',
    [jobId]
  );

  if (jobResult.rows.length > 0) {
    const leadResult = await query<{ email: string }>(
      'SELECT email FROM leads WHERE id = $1',
      [jobResult.rows[0].lead_id]
    );

    if (leadResult.rows.length > 0) {
      // Add to suppression list
      await query(
        `INSERT INTO suppression_list (id, email, reason, suppressed_at)
         VALUES (uuid_generate_v4(), $1, 'hard_bounce', NOW())
         ON CONFLICT (email) DO NOTHING`,
        [leadResult.rows[0].email.toLowerCase()]
      );
    }
  }

  // Mark job as failed
  await query(
    `UPDATE send_jobs
     SET status = 'failed',
         failed_at = NOW(),
         smtp_response = $1
     WHERE id = $2`,
    [`${code} ${message}`, jobId]
  );
}

/**
 * Move job to dead letter queue
 */
async function moveToDeadLetter(jobId: string, reason: string): Promise<void> {
  // Get job details
  const result = await query<{
    lead_id: string;
    attempt_count: number;
    smtp_response: string;
  }>(
    'SELECT lead_id, attempt_count, smtp_response FROM send_jobs WHERE id = $1',
    [jobId]
  );

  if (result.rows.length === 0) return;

  const job = result.rows[0];

  // Insert into dead letter table
  await query(
    `INSERT INTO dead_letter (id, job_id, lead_id, last_response_code, last_response_message, attempt_count, moved_at, reason)
     VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, NOW(), $6)`,
    [jobId, job.lead_id, 0, job.smtp_response || '', job.attempt_count, reason]
  );

  // Mark original job as failed
  await query(
    `UPDATE send_jobs SET status = 'failed', failed_at = NOW() WHERE id = $1`,
    [jobId]
  );
}

/**
 * Get classification statistics
 */
export async function getClassificationStats(): Promise<{
  total_processed: number;
  by_category: { category: string; count: number }[];
}> {
  const result = await query<{ status: string; count: number }>(
    `SELECT status, COUNT(*) as count FROM send_jobs
     WHERE status IN ('sent', 'failed', 'queued', 'suppressed')
     GROUP BY status`
  );

  return {
    total_processed: result.rows.reduce((sum, r) => sum + parseInt(String(r.count)), 0),
    by_category: result.rows.map((r) => ({
      category: r.status,
      count: parseInt(String(r.count)),
    })),
  };
}
