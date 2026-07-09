// Warmup gate check before dispatch

import { query } from '../db/connection';
import { WarmupGateCheck, WarmupCriteria, WARMUP_CRITERIA } from './types';

/**
 * Check if a subdomain passes the warmup gate
 */
export async function checkWarmupGate(
  subdomainId: string
): Promise<WarmupGateCheck> {
  // Get subdomain warmup state
  const result = await query<{
    id: string;
    warmup_complete: boolean;
    status: string;
    postmaster_score: number | null;
    complaint_count: number;
    bounce_rate: number;
    daily_limit: number;
  }>(
    `SELECT s.id, s.warmup_complete, s.status,
            d.postmaster_score, s.complaint_count, s.bounce_rate, s.daily_limit
     FROM subdomains s
     JOIN domains d ON s.domain_id = d.id
     WHERE s.id = $1`,
    [subdomainId]
  );

  if (result.rows.length === 0) {
    return {
      subdomain_id: subdomainId,
      passed: false,
      criteria: {
        warmup_complete: false,
        postmaster_score_ok: false,
        no_complaints: false,
        bounce_rate_ok: false,
      },
      reason: 'Subdomain not found',
    };
  }

  const subdomain = result.rows[0];

  // Check each criterion
  const criteria: WarmupCriteria = {
    warmup_complete: subdomain.warmup_complete,
    postmaster_score_ok: (subdomain.postmaster_score || 0) >= WARMUP_CRITERIA.postmaster_score_threshold,
    no_complaints: subdomain.complaint_count <= WARMUP_CRITERIA.max_complaints,
    bounce_rate_ok: subdomain.bounce_rate <= WARMUP_CRITERIA.max_bounce_rate,
  };

  const passed = Object.values(criteria).every(Boolean);

  let reason: string | undefined;
  if (!passed) {
    const failures: string[] = [];
    if (!criteria.warmup_complete) failures.push('warmup not complete');
    if (!criteria.postmaster_score_ok) failures.push(`postmaster score ${subdomain.postmaster_score} < ${WARMUP_CRITERIA.postmaster_score_threshold}`);
    if (!criteria.no_complaints) failures.push(`${subdomain.complaint_count} complaints`);
    if (!criteria.bounce_rate_ok) failures.push(`bounce rate ${(subdomain.bounce_rate * 100).toFixed(1)}% > ${WARMUP_CRITERIA.max_bounce_rate * 100}%`);
    reason = failures.join(', ');
  }

  return {
    subdomain_id: subdomainId,
    passed,
    criteria,
    reason,
  };
}

/**
 * Check if a subdomain can be activated for cold email
 */
export async function canActivateColdEmail(
  subdomainId: string
): Promise<{ can_activate: boolean; reason?: string }> {
  const gateCheck = await checkWarmupGate(subdomainId);

  if (!gateCheck.passed) {
    return {
      can_activate: false,
      reason: gateCheck.reason,
    };
  }

  // Additional check: warmup must have run for minimum duration
  const result = await query<{ warmup_started_at: Date | null }>(
    'SELECT warmup_started_at FROM subdomains WHERE id = $1',
    [subdomainId]
  );

  if (result.rows.length === 0 || !result.rows[0].warmup_started_at) {
    return {
      can_activate: false,
      reason: 'Warmup not started',
    };
  }

  const warmupStarted = new Date(result.rows[0].warmup_started_at);
  const weeksSinceStart = (Date.now() - warmupStarted.getTime()) / (7 * 24 * 60 * 60 * 1000);

  if (weeksSinceStart < WARMUP_CRITERIA.min_warmup_weeks) {
    return {
      can_activate: false,
      reason: `Warmup only ${weeksSinceStart.toFixed(1)} weeks old, need ${WARMUP_CRITERIA.min_warmup_weeks} weeks`,
    };
  }

  return { can_activate: true };
}

/**
 * Get warmup gate statistics
 */
export async function getWarmupGateStats(): Promise<{
  total_subdomains: number;
  warming: number;
  active: number;
  paused: number;
  awaiting_activation: number;
}> {
  const result = await query<{ status: string; count: number }>(
    'SELECT status, COUNT(*) as count FROM subdomains GROUP BY status'
  );

  const stats = {
    total_subdomains: 0,
    warming: 0,
    active: 0,
    paused: 0,
    awaiting_activation: 0,
  };

  for (const row of result.rows) {
    const count = parseInt(String(row.count));
    stats.total_subdomains += count;
    if (row.status === 'warming') stats.warming = count;
    if (row.status === 'active') stats.active = count;
    if (row.status === 'paused') stats.paused = count;
  }

  // Count subdomains that are warming and ready for activation
  const readyResult = await query<{ count: number }>(
    `SELECT COUNT(*) as count FROM subdomains
     WHERE status = 'warming'
       AND warmup_complete = true`
  );

  stats.awaiting_activation = parseInt(String(readyResult.rows[0]?.count || '0'));

  return stats;
}
