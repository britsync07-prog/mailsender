// Add/remove suppression entries

import { randomUUID } from 'crypto';
import { query } from '../db/connection';
import { addToCache, removeFromCache } from './cache';
import { AddSuppressionRequest, SuppressionEntry, SuppressionReason, SuppressionStats } from './types';

/**
 * Add email to suppression list
 */
export async function addSuppression(
  request: AddSuppressionRequest
): Promise<SuppressionEntry> {
  const { email, reason, source_subdomain_id } = request;
  const normalizedEmail = email.toLowerCase().trim();

  // Check if already suppressed
  const existing = await query<{ id: string }>(
    'SELECT id FROM suppression_list WHERE email = $1',
    [normalizedEmail]
  );

  if (existing.rows.length > 0) {
    // Already suppressed, return existing entry
    const entry = await query<SuppressionEntry>(
      'SELECT * FROM suppression_list WHERE email = $1',
      [normalizedEmail]
    );
    return entry.rows[0];
  }

  // Insert into database
  const id = randomUUID();
  const result = await query<SuppressionEntry>(
    `INSERT INTO suppression_list (id, email, reason, suppressed_at, source_subdomain_id)
     VALUES ($1, $2, $3, NOW(), $4)
     RETURNING *`,
    [id, normalizedEmail, reason, source_subdomain_id || null]
  );

  // Add to Redis cache
  await addToCache(normalizedEmail);

  return result.rows[0];
}

/**
 * Remove email from suppression list (manual override)
 */
export async function removeSuppression(
  email: string,
  operatorId?: string
): Promise<boolean> {
  const normalizedEmail = email.toLowerCase().trim();

  // Remove from database
  const result = await query(
    'DELETE FROM suppression_list WHERE email = $1',
    [normalizedEmail]
  );

  if (result.rowCount === 0) {
    return false; // Email was not suppressed
  }

  // Remove from Redis cache
  await removeFromCache(normalizedEmail);

  // Log removal for audit trail
  await query(
    `INSERT INTO suppression_removals (email, removed_by, removed_at)
     VALUES ($1, $2, NOW())`,
    [normalizedEmail, operatorId || 'system']
  );

  return true;
}

/**
 * Add multiple emails to suppression list (bulk)
 */
export async function bulkAddSuppression(
  requests: AddSuppressionRequest[]
): Promise<{
  added: number;
  already_suppressed: number;
  errors: { email: string; error: string }[];
}> {
  let added = 0;
  let alreadySuppressed = 0;
  const errors: { email: string; error: string }[] = [];

  for (const request of requests) {
    try {
      const normalizedEmail = request.email.toLowerCase().trim();

      // Check if already suppressed
      const existing = await query<{ id: string }>(
        'SELECT id FROM suppression_list WHERE email = $1',
        [normalizedEmail]
      );

      if (existing.rows.length > 0) {
        alreadySuppressed++;
        continue;
      }

      await addSuppression(request);
      added++;
    } catch (error) {
      errors.push({
        email: request.email,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return { added, already_suppressed: alreadySuppressed, errors };
}

/**
 * Get suppression statistics
 */
export async function getSuppressionStats(): Promise<SuppressionStats> {
  const totalResult = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM suppression_list'
  );

  const reasonResult = await query<{ reason: string; count: number }>(
    'SELECT reason, COUNT(*) as count FROM suppression_list GROUP BY reason ORDER BY count DESC'
  );

  const recentResult = await query<SuppressionEntry>(
    'SELECT * FROM suppression_list ORDER BY suppressed_at DESC LIMIT 10'
  );

  return {
    total_suppressed: parseInt(String(totalResult.rows[0]?.count || '0')),
    by_reason: reasonResult.rows,
    recent_additions: recentResult.rows,
  };
}

/**
 * Check if email is suppressed
 */
export async function isSuppressed(email: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase().trim();
  const result = await query<{ id: string }>(
    'SELECT id FROM suppression_list WHERE email = $1',
    [normalizedEmail]
  );
  return result.rows.length > 0;
}
