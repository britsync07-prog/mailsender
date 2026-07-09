// Complaint rate calculation and retirement

import { query } from '../db/connection';
import { COMPLAINT_THRESHOLDS } from './types';

/**
 * Calculate domain complaint rate
 */
export async function calculateComplaintRate(
  domainId: string
): Promise<{
  complaint_rate: number;
  complaints_7d: number;
  emails_sent_7d: number;
}> {
  const result = await query<{ complaints: number; sent: number }>(
    `SELECT
       COUNT(*) FILTER (WHERE sj.status = 'bounced' AND sj.smtp_response ILIKE '%complaint%') as complaints,
       COUNT(*) as sent
     FROM send_jobs sj
     JOIN subdomains s ON sj.subdomain_id = s.id
     JOIN domains d ON s.domain_id = d.id
     WHERE d.id = $1
       AND sj.sent_at >= NOW() - INTERVAL '7 days'`,
    [domainId]
  );

  const stats = result.rows[0] || { complaints: 0, sent: 0 };
  const complaintRate = stats.sent > 0 ? stats.complaints / stats.sent : 0;

  return {
    complaint_rate: complaintRate,
    complaints_7d: parseInt(String(stats.complaints)),
    emails_sent_7d: parseInt(String(stats.sent)),
  };
}

/**
 * Update domain complaint rate
 */
export async function updateDomainComplaintRate(domainId: string): Promise<void> {
  const { complaint_rate } = await calculateComplaintRate(domainId);

  await query(
    'UPDATE domains SET complaint_rate_7d = $1 WHERE id = $2',
    [complaint_rate, domainId]
  );
}

/**
 * Check if domain should be retired due to complaint rate
 */
export async function shouldRetireDomain(
  domainId: string
): Promise<{
  should_retire: boolean;
  complaint_rate: number;
  threshold: number;
}> {
  const { complaint_rate } = await calculateComplaintRate(domainId);

  return {
    should_retire: complaint_rate > COMPLAINT_THRESHOLDS.domain_retirement_threshold,
    complaint_rate,
    threshold: COMPLAINT_THRESHOLDS.domain_retirement_threshold,
  };
}

/**
 * Retire domain due to complaint rate
 */
export async function retireDomain(
  domainId: string,
  reason: string
): Promise<void> {
  await query(
    `UPDATE domains
     SET status = 'retired',
         retirement_reason = $1
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
}

/**
 * Get domain complaint statistics
 */
export async function getComplaintStats(): Promise<{
  total_complaints: number;
  by_domain: { domain: string; complaints: number; rate: number }[];
  domains_at_risk: { domain: string; complaint_rate: number }[];
}> {
  const totalResult = await query<{ count: number }>(
    `SELECT COUNT(*) as count FROM complaint_events`
  );

  const domainResult = await query<{ domain: string; complaints: number; sent: number }>(
    `SELECT d.domain,
            COUNT(*) FILTER (WHERE ce.complaint_type = 'spam_complaint') as complaints,
            COUNT(sj.id) as sent
     FROM domains d
     JOIN subdomains s ON d.id = s.domain_id
     JOIN send_jobs sj ON s.id = sj.subdomain_id
     LEFT JOIN complaint_events ce ON ce.subdomain_id = s.id
       AND ce.timestamp >= NOW() - INTERVAL '7 days'
     WHERE sj.sent_at >= NOW() - INTERVAL '7 days'
     GROUP BY d.id, d.domain`
  );

  const domainsAtRisk = domainResult.rows
    .map((r) => ({
      domain: r.domain,
      complaint_rate: r.sent > 0 ? r.complaints / r.sent : 0,
    }))
    .filter((r) => r.complaint_rate > COMPLAINT_THRESHOLDS.complaint_rate_threshold);

  return {
    total_complaints: parseInt(String(totalResult.rows[0]?.count || '0')),
    by_domain: domainResult.rows.map((r) => ({
      domain: r.domain,
      complaints: parseInt(String(r.complaints)),
      rate: r.sent > 0 ? r.complaints / r.sent : 0,
    })),
    domains_at_risk: domainsAtRisk,
  };
}
