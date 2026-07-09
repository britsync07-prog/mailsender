// Domain expiry monitoring

import { query } from '../db/connection';
import { CronJobResult } from './types';
import { sendAlert, createAlert } from '../monitoring/alert-dispatcher';

/**
 * Check domain expiry dates
 */
export async function checkDomainExpiry(): Promise<CronJobResult> {
  const startTime = new Date();

  try {
    const result = await query<{ domain: string; days_until_expiry: number }>(
      `SELECT domain,
              EXTRACT(DAY FROM expires_at - NOW()) as days_until_expiry
       FROM domains
       WHERE status != 'retired'
         AND expires_at IS NOT NULL
         AND expires_at < NOW() + INTERVAL '30 days'
       ORDER BY expires_at`
    );

    for (const domain of result.rows) {
      const alert = createAlert(
        'warning',
        'Domain Expiry',
        domain.days_until_expiry,
        30,
        `Domain ${domain.domain} expires in ${Math.round(domain.days_until_expiry)} days`,
        domain.domain
      );
      await sendAlert(alert);
    }

    const completedAt = new Date();

    return {
      job_name: 'domain_expiry_check',
      started_at: startTime,
      completed_at: completedAt,
      success: true,
      duration_ms: completedAt.getTime() - startTime.getTime(),
      message: `Domain expiry check: ${result.rows.length} domains expiring soon`,
    };
  } catch (error) {
    return {
      job_name: 'domain_expiry_check',
      started_at: startTime,
      completed_at: new Date(),
      success: false,
      duration_ms: Date.now() - startTime.getTime(),
      message: error instanceof Error ? error.message : 'Check failed',
    };
  }
}
