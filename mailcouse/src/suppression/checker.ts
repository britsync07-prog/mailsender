// Redis-based suppression lookup

import { query } from '../db/connection';
import { isInCache, batchCheckCache } from './cache';
import { SuppressionCheckResult, BatchSuppressionCheckResult, SuppressionReason } from './types';

/**
 * Check if a single email is suppressed
 */
export async function checkSuppression(email: string): Promise<SuppressionCheckResult> {
  const startTime = Date.now();
  const normalizedEmail = email.toLowerCase().trim();

  // Check Redis cache first (O(1))
  const isSuppressed = await isInCache(normalizedEmail);

  if (!isSuppressed) {
    return {
      email: normalizedEmail,
      is_suppressed: false,
    };
  }

  // Get details from database
  const result = await query<{ reason: string; suppressed_at: Date }>(
    'SELECT reason, suppressed_at FROM suppression_list WHERE email = $1 LIMIT 1',
    [normalizedEmail]
  );

  if (result.rows.length > 0) {
    return {
      email: normalizedEmail,
      is_suppressed: true,
      reason: result.rows[0].reason as SuppressionReason,
      suppressed_at: result.rows[0].suppressed_at,
    };
  }

  // In cache but not in DB (shouldn't happen, but handle gracefully)
  return {
    email: normalizedEmail,
    is_suppressed: true,
  };
}

/**
 * Batch check multiple emails against suppression list
 */
export async function batchCheckSuppression(
  emails: string[]
): Promise<BatchSuppressionCheckResult> {
  const startTime = Date.now();
  const normalizedEmails = emails.map((e) => e.toLowerCase().trim());

  // Batch check Redis cache
  const cacheResults = await batchCheckCache(normalizedEmails);

  // Collect suppressed emails for DB lookup
  const suppressedEmails = normalizedEmails.filter((e) => cacheResults.get(e));

  // Get details for suppressed emails
  let suppressedDetails = new Map<string, { reason: string; suppressed_at: Date }>();
  if (suppressedEmails.length > 0) {
    const placeholders = suppressedEmails.map((_, i) => `$${i + 1}`).join(', ');
    const dbResult = await query<{ email: string; reason: string; suppressed_at: Date }>(
      `SELECT email, reason, suppressed_at FROM suppression_list WHERE email IN (${placeholders})`,
      suppressedEmails
    );

    for (const row of dbResult.rows) {
      suppressedDetails.set(row.email, {
        reason: row.reason,
        suppressed_at: row.suppressed_at,
      });
    }
  }

  // Build results
  const results: SuppressionCheckResult[] = normalizedEmails.map((email) => {
    const isSuppressed = cacheResults.get(email) || false;
    const details = suppressedDetails.get(email);

    return {
      email,
      is_suppressed: isSuppressed,
      reason: details?.reason as SuppressionReason | undefined,
      suppressed_at: details?.suppressed_at,
    };
  });

  return {
    total: emails.length,
    suppressed: suppressedEmails.length,
    not_suppressed: emails.length - suppressedEmails.length,
    results,
    duration_ms: Date.now() - startTime,
  };
}

/**
 * Check suppression for leads and update their status
 */
export async function checkAndUpdateLeads(
  leads: { id: string; email: string }[]
): Promise<{
  total: number;
  suppressed: number;
  allowed: number;
}> {
  const emails = leads.map((l) => l.email);
  const batchResult = await batchCheckSuppression(emails);

  let suppressed = 0;
  let allowed = 0;

  for (const lead of leads) {
    const checkResult = batchResult.results.find(
      (r) => r.email === lead.email.toLowerCase().trim()
    );

    if (checkResult?.is_suppressed) {
      // Update lead status to suppressed
      await query(
        `UPDATE leads SET status = 'suppressed' WHERE id = $1 AND status != 'suppressed'`,
        [lead.id]
      );
      suppressed++;
    } else {
      allowed++;
    }
  }

  return {
    total: leads.length,
    suppressed,
    allowed,
  };
}
