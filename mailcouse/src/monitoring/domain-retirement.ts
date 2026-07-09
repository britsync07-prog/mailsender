// Automatic domain retirement

import { query } from '../db/connection';
import { createAlert, sendAlert } from './alert-dispatcher';
import { ALERT_THRESHOLDS } from './types';

/**
 * Check and retire domains based on health metrics
 */
export async function checkAndRetireDomains(): Promise<{
  checked: number;
  retired: number;
  alerts_sent: number;
}> {
  let checked = 0;
  let retired = 0;
  let alertsSent = 0;

  // Get all active domains
  const domains = await query<{ id: string; domain: string; postmaster_score: number | null; complaint_rate_7d: number; bounce_rate_7d: number }>(
    "SELECT id, domain, postmaster_score, complaint_rate_7d, bounce_rate_7d FROM domains WHERE status = 'active'"
  );

  for (const domain of domains.rows) {
    checked++;
    let shouldRetire = false;
    let reason = '';

    // Check Postmaster score (3 consecutive days below 70)
    if (domain.postmaster_score !== null && domain.postmaster_score < ALERT_THRESHOLDS.postmaster_score_warning) {
      // Check if this is the 3rd consecutive day
      const lowScoreDays = await query<{ count: number }>(
        `SELECT COUNT(*) as count FROM daily_stats
         WHERE domain = $1 AND postmaster_score < $2
         AND date >= CURRENT_DATE - INTERVAL '3 days'`,
        [domain.domain, ALERT_THRESHOLDS.postmaster_score_warning]
      );

      if (parseInt(String(lowScoreDays.rows[0]?.count || '0')) >= 3) {
        shouldRetire = true;
        reason = `Postmaster score below ${ALERT_THRESHOLDS.postmaster_score_warning} for 3 consecutive days`;
      }
    }

    // Check complaint rate
    if (domain.complaint_rate_7d > ALERT_THRESHOLDS.complaint_rate_threshold) {
      shouldRetire = true;
      reason = `Complaint rate ${(domain.complaint_rate_7d * 100).toFixed(2)}% exceeds ${ALERT_THRESHOLDS.complaint_rate_threshold * 100}% threshold`;
    }

    // Check bounce rate
    if (domain.bounce_rate_7d > ALERT_THRESHOLDS.bounce_rate_threshold) {
      shouldRetire = true;
      reason = `Bounce rate ${(domain.bounce_rate_7d * 100).toFixed(2)}% exceeds ${ALERT_THRESHOLDS.bounce_rate_threshold * 100}% threshold`;
    }

    // Retire domain if needed
    if (shouldRetire) {
      await retireDomain(domain.id, domain.domain, reason);
      retired++;

      // Send alert
      const alert = createAlert(
        'critical',
        'Domain Retirement',
        1,
        0,
        `Domain ${domain.domain} retired: ${reason}`,
        domain.domain
      );
      await sendAlert(alert);
      alertsSent++;
    }
  }

  return { checked, retired, alerts_sent: alertsSent };
}

/**
 * Retire a domain
 */
export async function retireDomain(
  domainId: string,
  domainName: string,
  reason: string
): Promise<void> {
  // Update domain status
  await query(
    `UPDATE domains
     SET status = 'retired',
         retirement_reason = $1,
         retired_at = NOW()
     WHERE id = $2`,
    [reason, domainId]
  );

  // Pause all subdomains on this domain
  await query(
    `UPDATE subdomains
     SET status = 'paused'
     WHERE domain_id = $1 AND status = 'active'`,
    [domainId]
  );

  console.log(`Domain retired: ${domainName} - ${reason}`);
}

/**
 * Get domains needing retirement check
 */
export async function getDomainsNeedingCheck(): Promise<{
  domain_id: string;
  domain: string;
  postmaster_score: number | null;
  complaint_rate_7d: number;
  bounce_rate_7d: number;
  days_since_check: number;
}[]> {
  const result = await query<{
    id: string;
    domain: string;
    postmaster_score: number | null;
    complaint_rate_7d: number;
    bounce_rate_7d: number;
    days_since_check: number;
  }>(
    `SELECT id, domain, postmaster_score, complaint_rate_7d, bounce_rate_7d,
            EXTRACT(DAY FROM NOW() - COALESCE(last_checked, created_at)) as days_since_check
     FROM domains
     WHERE status = 'active'
     ORDER BY last_checked ASC NULLS FIRST`
  );

  return result.rows.map((r) => ({
    domain_id: r.id,
    domain: r.domain,
    postmaster_score: r.postmaster_score,
    complaint_rate_7d: r.complaint_rate_7d,
    bounce_rate_7d: r.bounce_rate_7d,
    days_since_check: parseInt(String(r.days_since_check)),
  }));
}
