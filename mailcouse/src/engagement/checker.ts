// Non-engager detection and suppression

import { query } from '../db/connection';
import { addSuppression } from '../suppression/manager';
import { NonEngagerCheckResult } from './types';

/**
 * Check for non-engagers and suppress them
 * Non-engager: send_count >= 2 AND no replies AND no opens AND engagement_score = 0
 */
export async function checkNonEngagers(): Promise<NonEngagerCheckResult> {
  const startTime = Date.now();

  // Find non-engagers
  const nonEngagersResult = await query<{ id: string; email: string; send_count: number }>(
    `SELECT id, email, send_count
     FROM leads
     WHERE send_count >= 2
       AND replied_at IS NULL
       AND open_count = 0
       AND engagement_score = 0
       AND status != 'suppressed'
       AND status != 'replied'
     ORDER BY send_count DESC`
  );

  const nonEngagers = nonEngagersResult.rows;
  let suppressed = 0;
  let skipped = 0;

  for (const lead of nonEngagers) {
    try {
      // Add to suppression list
      await addSuppression({
        email: lead.email,
        reason: 'non_engager',
      });

      // Update lead status
      await query(
        `UPDATE leads SET status = 'suppressed' WHERE id = $1`,
        [lead.id]
      );

      suppressed++;
    } catch (error) {
      console.error(`Failed to suppress non-engager ${lead.email}:`, error);
      skipped++;
    }
  }

  return {
    total_checked: nonEngagers.length + suppressed + skipped,
    non_engagers_found: nonEngagers.length,
    non_engagers_suppressed: suppressed,
    leads_skipped: skipped,
    duration_ms: Date.now() - startTime,
  };
}

/**
 * Check if a specific lead is a non-engager
 */
export async function isNonEngager(leadId: string): Promise<boolean> {
  const result = await query<{
    send_count: number;
    replied_at: Date | null;
    open_count: number;
    engagement_score: number;
    status: string;
  }>(
    `SELECT send_count, replied_at, open_count, engagement_score, status
     FROM leads WHERE id = $1`,
    [leadId]
  );

  if (result.rows.length === 0) return false;

  const lead = result.rows[0];

  // Already suppressed or replied - skip
  if (lead.status === 'suppressed' || lead.status === 'replied') return false;

  // Check non-engager criteria
  return (
    lead.send_count >= 2 &&
    lead.replied_at === null &&
    lead.open_count === 0 &&
    lead.engagement_score === 0
  );
}

/**
 * Get non-engager statistics
 */
export async function getNonEngagerStats(): Promise<{
  total_leads: number;
  total_senders: number;
  non_engagers: number;
  engaged: number;
  suppressed: number;
}> {
  const totalResult = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM leads'
  );

  const sendersResult = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM leads WHERE send_count > 0'
  );

  const nonEngagersResult = await query<{ count: number }>(
    `SELECT COUNT(*) as count FROM leads
     WHERE send_count >= 2
       AND replied_at IS NULL
       AND open_count = 0
       AND engagement_score = 0
       AND status != 'suppressed'`
  );

  const engagedResult = await query<{ count: number }>(
    `SELECT COUNT(*) as count FROM leads
     WHERE send_count > 0
       AND (reply_count > 0 OR open_count > 0 OR engagement_score > 0)`
  );

  const suppressedResult = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM leads WHERE status = 'suppressed'"
  );

  return {
    total_leads: parseInt(String(totalResult.rows[0]?.count || '0')),
    total_senders: parseInt(String(sendersResult.rows[0]?.count || '0')),
    non_engagers: parseInt(String(nonEngagersResult.rows[0]?.count || '0')),
    engaged: parseInt(String(engagedResult.rows[0]?.count || '0')),
    suppressed: parseInt(String(suppressedResult.rows[0]?.count || '0')),
  };
}
