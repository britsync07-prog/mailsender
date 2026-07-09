// Automatic suppression on bounce

import { query } from '../db/connection';
import { BounceData, BounceType } from './types';

/**
 * Suppress bounced address
 */
export async function suppressBouncedAddress(
  bounce: BounceData
): Promise<{ suppressed: boolean; reason: string }> {
  try {
    // Add to suppression list
    await query(
      `INSERT INTO suppression_list (id, email, reason, suppressed_at, source_subdomain_id)
       VALUES (uuid_generate_v4(), $1, $2, NOW(), $3)
       ON CONFLICT (email) DO NOTHING`,
      [bounce.recipient.toLowerCase(), bounce.bounce_type, bounce.subdomain_id || null]
    );

    // Update subdomain bounce count
    if (bounce.subdomain_id) {
      await query(
        'UPDATE subdomains SET bounce_count = bounce_count + 1 WHERE id = $1',
        [bounce.subdomain_id]
      );
    }

    // Update send job status if job_id is known
    if (bounce.job_id) {
      await query(
        `UPDATE send_jobs SET status = 'bounced', smtp_response = $1 WHERE id = $2`,
        [`${bounce.smtp_code} ${bounce.message}`, bounce.job_id]
      );
    }

    return {
      suppressed: true,
      reason: `Suppressed due to ${bounce.bounce_type}: ${bounce.message}`,
    };
  } catch (error) {
    return {
      suppressed: false,
      reason: error instanceof Error ? error.message : 'Suppression failed',
    };
  }
}

/**
 * Batch suppress bounced addresses
 */
export async function batchSuppress(
  bounces: BounceData[]
): Promise<{
  suppressed: number;
  failed: number;
  errors: { email: string; error: string }[];
}> {
  let suppressed = 0;
  let failed = 0;
  const errors: { email: string; error: string }[] = [];

  for (const bounce of bounces) {
    const result = await suppressBouncedAddress(bounce);
    if (result.suppressed) {
      suppressed++;
    } else {
      failed++;
      errors.push({ email: bounce.recipient, error: result.reason });
    }
  }

  return { suppressed, failed, errors };
}

/**
 * Update domain bounce rate
 */
export async function updateDomainBounceRate(domainId: string): Promise<void> {
  // Calculate 7-day rolling bounce rate
  const result = await query<{ bounce_count: number; total_sent: number }>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'bounced') as bounce_count,
       COUNT(*) as total_sent
     FROM send_jobs sj
     JOIN subdomains s ON sj.subdomain_id = s.id
     JOIN domains d ON s.domain_id = d.id
     WHERE d.id = $1
       AND sj.sent_at >= NOW() - INTERVAL '7 days'`,
    [domainId]
  );

  if (result.rows.length > 0) {
    const { bounce_count, total_sent } = result.rows[0];
    const bounceRate = total_sent > 0 ? bounce_count / total_sent : 0;

    await query(
      'UPDATE domains SET bounce_rate_7d = $1 WHERE id = $2',
      [bounceRate, domainId]
    );
  }
}

/**
 * Get suppression statistics
 */
export async function getSuppressionStats(): Promise<{
  total_suppressed: number;
  by_reason: { reason: string; count: number }[];
  recent_suppressions: { email: string; reason: string; suppressed_at: Date }[];
}> {
  const totalResult = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM suppression_list'
  );

  const reasonResult = await query<{ reason: string; count: number }>(
    'SELECT reason, COUNT(*) as count FROM suppression_list GROUP BY reason'
  );

  const recentResult = await query<{ email: string; reason: string; suppressed_at: Date }>(
    'SELECT email, reason, suppressed_at FROM suppression_list ORDER BY suppressed_at DESC LIMIT 10'
  );

  return {
    total_suppressed: parseInt(String(totalResult.rows[0]?.count || '0')),
    by_reason: reasonResult.rows.map((r) => ({
      reason: r.reason,
      count: parseInt(String(r.count)),
    })),
    recent_suppressions: recentResult.rows,
  };
}
