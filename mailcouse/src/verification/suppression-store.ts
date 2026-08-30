import { query } from '../db/connection';
import { SuppressionRecord, SuppressionStatus } from './types';

let schemaEnsured = false;

/**
 * Ensures the suppression_list table has the required columns.
 * Non-destructive and safe for existing databases.
 */
export async function ensureSuppressionColumns(): Promise<void> {
  if (schemaEnsured) return;
  try {
    await query(`
      ALTER TABLE suppression_list ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'suppressed';
      ALTER TABLE suppression_list ADD COLUMN IF NOT EXISTS first_seen TIMESTAMP NOT NULL DEFAULT NOW();
      ALTER TABLE suppression_list ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP NOT NULL DEFAULT NOW();
      ALTER TABLE suppression_list ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;
      CREATE INDEX IF NOT EXISTS idx_suppression_status ON suppression_list(status);
      CREATE INDEX IF NOT EXISTS idx_suppression_expires_at ON suppression_list(expires_at);
    `);
    schemaEnsured = true;
  } catch (err: any) {
    // If DB is not available yet or query fails, allow caller to continue
  }
}

export function resetSchemaEnsuredForTesting(): void {
  schemaEnsured = false;
}

/**
 * Checks whether an email address is currently suppressed.
 * Returns true if permanent status (hard_bounce, invalid, suppressed) and not expired.
 */
export async function isSuppressed(email: string): Promise<{
  suppressed: boolean;
  reason?: string;
  status?: SuppressionStatus;
  record?: SuppressionRecord;
}> {
  const normalized = email.toLowerCase().trim();

  try {
    await ensureSuppressionColumns();

    const res = await query<SuppressionRecord>(
      `SELECT email, reason, COALESCE(status, 'suppressed') as status,
              COALESCE(first_seen, suppressed_at) as first_seen,
              COALESCE(last_seen, suppressed_at) as last_seen,
              expires_at, source_subdomain_id
       FROM suppression_list
       WHERE LOWER(email) = $1
       LIMIT 1`,
      [normalized]
    );

    if (res.rows.length === 0) {
      return { suppressed: false };
    }

    const row = res.rows[0];

    // Check expiration if expires_at is set
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return { suppressed: false };
    }

    // Active status is not suppressed
    if (row.status === 'active') {
      return { suppressed: false };
    }

    return {
      suppressed: true,
      reason: row.reason,
      status: row.status,
      record: row,
    };
  } catch (err: any) {
    // Graceful fallback on database error
    return { suppressed: false };
  }
}

import { isEntireFamousDomain } from './famous-domains';

/**
 * Records or updates a suppression entry in the database.
 */
export async function addSuppression(entry: {
  email: string;
  reason: string;
  status?: SuppressionStatus;
  sourceSubdomainId?: string;
  expiresAt?: Date | null;
}): Promise<void> {
  const normalized = entry.email.toLowerCase().trim();
  const status = entry.status || 'suppressed';

  // Do not add entire famous or most used domains (gmail.com, yahoo.com, outlook.com, etc.) to suppression_list
  if (isEntireFamousDomain(normalized)) {
    return;
  }

  try {
    await ensureSuppressionColumns();

    await query(
      `INSERT INTO suppression_list (email, reason, status, source_subdomain_id, first_seen, last_seen, expires_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW(), $5)
       ON CONFLICT (email)
       DO UPDATE SET
         reason = EXCLUDED.reason,
         status = EXCLUDED.status,
         last_seen = NOW(),
         expires_at = EXCLUDED.expires_at,
         source_subdomain_id = COALESCE(EXCLUDED.source_subdomain_id, suppression_list.source_subdomain_id)`,
      [normalized, entry.reason, status, entry.sourceSubdomainId || null, entry.expiresAt || null]
    );
  } catch (err: any) {
    // In fallback/offline mode, log and continue
    console.error(`Failed to record suppression for ${normalized}:`, err.message);
  }
}

/**
 * Removes an email from the suppression list.
 */
export async function removeSuppression(email: string): Promise<boolean> {
  const normalized = email.toLowerCase().trim();
  try {
    const res = await query('DELETE FROM suppression_list WHERE LOWER(email) = $1', [normalized]);
    return (res.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}
