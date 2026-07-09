// Subdomain activation logic

import { query } from '../db/connection';
import { checkWarmupGate, canActivateColdEmail } from './gate';
import { completeWarmup } from './scheduler';

/**
 * Activate a subdomain for cold email sending
 */
export async function activateSubdomain(
  subdomainId: string
): Promise<{
  success: boolean;
  message: string;
  new_status?: string;
  new_daily_limit?: number;
}> {
  // Check if activation is allowed
  const activationCheck = await canActivateColdEmail(subdomainId);

  if (!activationCheck.can_activate) {
    return {
      success: false,
      message: activationCheck.reason || 'Cannot activate',
    };
  }

  // Complete warmup
  await completeWarmup(subdomainId);

  // Update status to active
  await query(
    "UPDATE subdomains SET status = 'active' WHERE id = $1",
    [subdomainId]
  );

  return {
    success: true,
    message: 'Subdomain activated for cold email',
    new_status: 'active',
    new_daily_limit: 10,
  };
}

/**
 * Pause a subdomain (engagement drop or other issues)
 */
export async function pauseSubdomain(
  subdomainId: string,
  reason: string
): Promise<{ success: boolean; message: string }> {
  await query(
    "UPDATE subdomains SET status = 'paused' WHERE id = $1 AND status = 'active'",
    [subdomainId]
  );

  console.log(`Paused subdomain ${subdomainId}: ${reason}`);

  return {
    success: true,
    message: `Subdomain paused: ${reason}`,
  };
}

/**
 * Resume a paused subdomain
 */
export async function resumeSubdomain(
  subdomainId: string
): Promise<{ success: boolean; message: string }> {
  // First check if warmup gate still passes
  const gateCheck = await checkWarmupGate(subdomainId);

  if (!gateCheck.passed) {
    return {
      success: false,
      message: `Cannot resume: ${gateCheck.reason}`,
    };
  }

  await query(
    "UPDATE subdomains SET status = 'active' WHERE id = $1 AND status = 'paused'",
    [subdomainId]
  );

  return {
    success: true,
    message: 'Subdomain resumed',
  };
}

/**
 * Batch activate all ready subdomains
 */
export async function batchActivate(): Promise<{
  total: number;
  activated: number;
  failed: number;
  errors: { subdomain_id: string; error: string }[];
}> {
  // Find all subdomains ready for activation
  const result = await query<{ id: string }>(
    `SELECT s.id FROM subdomains s
     WHERE s.status = 'warming'
       AND s.warmup_complete = true`
  );

  let activated = 0;
  let failed = 0;
  const errors: { subdomain_id: string; error: string }[] = [];

  for (const subdomain of result.rows) {
    try {
      const activationResult = await activateSubdomain(subdomain.id);
      if (activationResult.success) {
        activated++;
      } else {
        failed++;
        errors.push({ subdomain_id: subdomain.id, error: activationResult.message });
      }
    } catch (error) {
      failed++;
      errors.push({
        subdomain_id: subdomain.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return {
    total: result.rows.length,
    activated,
    failed,
    errors,
  };
}

/**
 * Get activation statistics
 */
export async function getActivationStats(): Promise<{
  ready_to_activate: number;
  recently_activated: number;
  paused: number;
  total_active: number;
}> {
  const readyResult = await query<{ count: number }>(
    `SELECT COUNT(*) as count FROM subdomains
     WHERE status = 'warming' AND warmup_complete = true`
  );

  const activatedResult = await query<{ count: number }>(
    `SELECT COUNT(*) as count FROM subdomains
     WHERE status = 'active' AND warmup_complete = true`
  );

  const pausedResult = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM subdomains WHERE status = 'paused'"
  );

  const totalActiveResult = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM subdomains WHERE status = 'active'"
  );

  return {
    ready_to_activate: parseInt(String(readyResult.rows[0]?.count || '0')),
    recently_activated: parseInt(String(activatedResult.rows[0]?.count || '0')),
    paused: parseInt(String(pausedResult.rows[0]?.count || '0')),
    total_active: parseInt(String(totalActiveResult.rows[0]?.count || '0')),
  };
}
