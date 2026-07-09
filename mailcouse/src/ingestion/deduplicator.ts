// Email deduplication logic for Plan 1 — Lead Ingestion

import { query } from '../db/connection';
import { normalizeEmail } from './validators';
import { LeadDeduplicationResult } from './types';

/**
 * Check if an email already exists in the leads table
 */
export async function checkDuplicate(email: string): Promise<LeadDeduplicationResult> {
  const normalizedEmail = normalizeEmail(email);

  const result = await query<{ id: string }>(
    'SELECT id FROM leads WHERE email = $1 LIMIT 1',
    [normalizedEmail]
  );

  if (result.rows.length > 0) {
    return {
      is_duplicate: true,
      existing_lead_id: result.rows[0].id,
    };
  }

  return { is_duplicate: false };
}

/**
 * Batch check for duplicates
 */
export async function checkBatchDuplicates(
  emails: string[]
): Promise<Map<string, LeadDeduplicationResult>> {
  const results = new Map<string, LeadDeduplicationResult>();

  if (emails.length === 0) return results;

  // Normalize all emails
  const normalizedEmails = emails.map(normalizeEmail);

  // Batch query for existing emails
  const placeholders = normalizedEmails.map((_, i) => `$${i + 1}`).join(', ');
  const result = await query<{ email: string; id: string }>(
    `SELECT email, id FROM leads WHERE email IN (${placeholders})`,
    normalizedEmails
  );

  // Create map of existing emails
  const existingEmails = new Map<string, string>();
  for (const row of result.rows) {
    existingEmails.set(row.email, row.id);
  }

  // Build results for all emails
  for (let i = 0; i < emails.length; i++) {
    const normalizedEmail = normalizedEmails[i];
    const existingId = existingEmails.get(normalizedEmail);

    if (existingId) {
      results.set(emails[i], {
        is_duplicate: true,
        existing_lead_id: existingId,
      });
    } else {
      results.set(emails[i], {
        is_duplicate: false,
      });
    }
  }

  return results;
}

/**
 * Get duplicate statistics for a batch
 */
export async function getDuplicateStats(
  emails: string[]
): Promise<{ total: number; duplicates: number; unique: number }> {
  const duplicates = await checkBatchDuplicates(emails);

  let dupCount = 0;
  duplicates.forEach((result) => {
    if (result.is_duplicate) dupCount++;
  });

  return {
    total: emails.length,
    duplicates: dupCount,
    unique: emails.length - dupCount,
  };
}
