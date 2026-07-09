import { query } from '../db/connection';
import { JobProcessingResult } from './types';
import { JobPayload } from '../queue/types';
import { recordSend } from '../queue/daily-limiter';
import { sendEmailWithContent } from '../smtp/sender';
import { buildEmail } from '../smtp/email-builder';
import { DEFAULT_SMTP_CONFIG } from '../smtp/types';
import { decideTiming, shouldDelaySend, getCadenceStats } from '../fingerprint/pattern-diversifier';

export async function processJob(job: JobPayload): Promise<JobProcessingResult> {
  const startTime = Date.now();

  try {
    const delayMs = shouldDelaySend(job.scheduled_at);
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    const timing = decideTiming(job.subdomain_id, job.ip_id);
    if (timing.delayMs > 0) {
      await sleep(timing.delayMs);
    }

    const isSuppressed = await checkSuppression(job.email);
    if (isSuppressed) {
      await updateJobStatus(job.job_id, 'suppressed');
      return {
        job_id: job.job_id,
        success: false,
        action: 'suppressed',
        error: 'Lead is suppressed',
        duration_ms: Date.now() - startTime,
      };
    }

    const canSend = await checkDailyLimit(job.subdomain_id, job.ip_id);
    if (!canSend) {
      await requeueJob(job.job_id);
      return {
        job_id: job.job_id,
        success: false,
        action: 'requeued',
        error: 'Daily limit reached',
        duration_ms: Date.now() - startTime,
      };
    }

    const templateResult = await query<{ subject: string; body: string }>(
      'SELECT subject, body FROM templates WHERE id = $1',
      [job.template_id]
    );
    const template = templateResult.rows[0] || { subject: '', body: '' };

    const emailContent = await buildEmail(job, template.subject, template.body);

    const smtpResult = await sendViaSMTP(job, emailContent);

    if (smtpResult.success) {
      await recordSend(job);
      await updateJobStatus(job.job_id, 'sent', smtpResult.response);
      return {
        job_id: job.job_id,
        success: true,
        action: 'sent',
        smtp_response: smtpResult.response,
        duration_ms: Date.now() - startTime,
      };
    } else if (smtpResult.retry) {
      await requeueJob(job.job_id, smtpResult.backoff_seconds);
      return {
        job_id: job.job_id,
        success: false,
        action: 'requeued',
        error: smtpResult.error,
        smtp_response: smtpResult.response,
        duration_ms: Date.now() - startTime,
      };
    } else {
      await suppressEmail(job.email, 'hard_bounce');
      await updateJobStatus(job.job_id, 'failed', smtpResult.response);
      return {
        job_id: job.job_id,
        success: false,
        action: 'failed',
        error: smtpResult.error,
        smtp_response: smtpResult.response,
        duration_ms: Date.now() - startTime,
      };
    }
  } catch (error) {
    await updateJobStatus(job.job_id, 'failed');
    return {
      job_id: job.job_id,
      success: false,
      action: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      duration_ms: Date.now() - startTime,
    };
  }
}

async function checkSuppression(email: string): Promise<boolean> {
  const result = await query<{ id: string }>(
    'SELECT id FROM suppression_list WHERE email = $1',
    [email.toLowerCase().trim()]
  );
  return result.rows.length > 0;
}

async function checkDailyLimit(subdomainId: string, ipId: string): Promise<boolean> {
  const subdomainResult = await query<{ emails_sent_today: number; daily_limit: number }>(
    'SELECT emails_sent_today, daily_limit FROM subdomains WHERE id = $1',
    [subdomainId]
  );

  if (subdomainResult.rows.length > 0) {
    const subdomain = subdomainResult.rows[0];
    if (subdomain.emails_sent_today >= subdomain.daily_limit) {
      return false;
    }
  }

  const ipResult = await query<{ emails_today: number }>(
    'SELECT emails_today FROM ip_pool WHERE id = $1',
    [ipId]
  );

  if (ipResult.rows.length > 0) {
    if (ipResult.rows[0].emails_today >= 2000) {
      return false;
    }
  }

  return true;
}

async function sendViaSMTP(
  job: JobPayload,
  emailContent: any
): Promise<{
  success: boolean;
  response?: string;
  error?: string;
  retry: boolean;
  backoff_seconds?: number;
}> {
  try {
    const result = await sendEmailWithContent(DEFAULT_SMTP_CONFIG, {
      from: emailContent.from,
      to: emailContent.to,
      subdomain: job.subdomain,
      ip_id: job.ip_id,
      ip_address: job.sending_ip,
      job_id: job.job_id,
      content: emailContent.body,
    }, emailContent);

    return {
      success: result.success,
      response: result.success ? `${result.response_code} ${result.response_message}` : undefined,
      error: result.error,
      retry: result.retry,
      backoff_seconds: result.backoff_seconds,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'SMTP send failed',
      retry: true,
    };
  }
}

async function requeueJob(jobId: string, backoffSeconds: number = 300): Promise<void> {
  const scheduledAt = new Date(Date.now() + backoffSeconds * 1000);
  await query(
    `UPDATE send_jobs
     SET status = 'queued',
         scheduled_at = $1,
         attempt_count = attempt_count + 1
     WHERE id = $2`,
    [scheduledAt, jobId]
  );
}

async function updateJobStatus(
  jobId: string,
  status: string,
  smtpResponse?: string
): Promise<void> {
  if (status === 'sent') {
    await query(
      "UPDATE send_jobs SET status = 'sent', sent_at = NOW(), smtp_response = $1 WHERE id = $2",
      [smtpResponse || null, jobId]
    );
  } else if (status === 'failed') {
    await query(
      "UPDATE send_jobs SET status = 'failed', failed_at = NOW(), smtp_response = $1 WHERE id = $2",
      [smtpResponse || null, jobId]
    );
  } else if (status === 'suppressed') {
    await query(
      "UPDATE send_jobs SET status = 'suppressed' WHERE id = $1",
      [jobId]
    );
  }
}

async function suppressEmail(email: string, reason: string): Promise<void> {
  await query(
    `INSERT INTO suppression_list (id, email, reason, suppressed_at)
     VALUES (uuid_generate_v4(), $1, $2, NOW())
     ON CONFLICT (email) DO NOTHING`,
    [email.toLowerCase().trim(), reason]
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { getCadenceStats };
