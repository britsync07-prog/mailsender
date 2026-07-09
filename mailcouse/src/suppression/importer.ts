// Bulk import from CSV/external systems

import { query } from '../db/connection';
import { addToCache } from './cache';
import { SuppressionReason, SuppressionImportResult } from './types';

/**
 * Import suppressions from CSV data
 */
export async function importFromCSV(
  csvData: string,
  defaultReason: SuppressionReason = 'manual'
): Promise<SuppressionImportResult> {
  const lines = csvData.trim().split('\n');
  const errors: { email: string; error: string }[] = [];
  let totalImported = 0;
  let totalDuplicates = 0;

  // Skip header if present
  const startIndex = lines[0].toLowerCase().includes('email') ? 1 : 0;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse CSV line (handle quoted values)
    const values = parseCSVLine(line);
    const email = values[0]?.toLowerCase().trim();

    if (!email || !email.includes('@')) {
      errors.push({ email: email || 'empty', error: 'Invalid email format' });
      continue;
    }

    // Get reason from CSV or use default
    const reason = (values[1]?.trim() as SuppressionReason) || defaultReason;

    try {
      // Check if already suppressed
      const existing = await query<{ id: string }>(
        'SELECT id FROM suppression_list WHERE email = $1',
        [email]
      );

      if (existing.rows.length > 0) {
        totalDuplicates++;
        continue;
      }

      // Insert into database
      await query(
        `INSERT INTO suppression_list (id, email, reason, suppressed_at)
         VALUES (uuid_generate_v4(), $1, $2, NOW())
         ON CONFLICT (email) DO NOTHING`,
        [email, reason]
      );

      // Add to Redis cache
      await addToCache(email);

      totalImported++;
    } catch (error) {
      errors.push({
        email,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return {
    total_imported: totalImported,
    total_duplicates: totalDuplicates,
    errors,
  };
}

/**
 * Import suppressions from listmonk format
 */
export async function importFromListmonk(
  blocklist: { email: string; timestamp?: string }[]
): Promise<SuppressionImportResult> {
  const errors: { email: string; error: string }[] = [];
  let totalImported = 0;
  let totalDuplicates = 0;

  for (const entry of blocklist) {
    const email = entry.email.toLowerCase().trim();
    if (!email || !email.includes('@')) {
      errors.push({ email: entry.email, error: 'Invalid email format' });
      continue;
    }

    try {
      const existing = await query<{ id: string }>(
        'SELECT id FROM suppression_list WHERE email = $1',
        [email]
      );

      if (existing.rows.length > 0) {
        totalDuplicates++;
        continue;
      }

      await query(
        `INSERT INTO suppression_list (id, email, reason, suppressed_at)
         VALUES (uuid_generate_v4(), $1, 'manual', $2)
         ON CONFLICT (email) DO NOTHING`,
        [email, entry.timestamp || new Date().toISOString()]
      );

      await addToCache(email);
      totalImported++;
    } catch (error) {
      errors.push({
        email,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return {
    total_imported: totalImported,
    total_duplicates: totalDuplicates,
    errors,
  };
}

/**
 * Import suppressions from postal format
 */
export async function importFromPostal(
  suppressions: { address: string; timestamp?: string }[]
): Promise<SuppressionImportResult> {
  const errors: { email: string; error: string }[] = [];
  let totalImported = 0;
  let totalDuplicates = 0;

  for (const entry of suppressions) {
    const email = entry.address.toLowerCase().trim();
    if (!email || !email.includes('@')) {
      errors.push({ email: entry.address, error: 'Invalid email format' });
      continue;
    }

    try {
      const existing = await query<{ id: string }>(
        'SELECT id FROM suppression_list WHERE email = $1',
        [email]
      );

      if (existing.rows.length > 0) {
        totalDuplicates++;
        continue;
      }

      await query(
        `INSERT INTO suppression_list (id, email, reason, suppressed_at)
         VALUES (uuid_generate_v4(), $1, 'manual', $2)
         ON CONFLICT (email) DO NOTHING`,
        [email, entry.timestamp || new Date().toISOString()]
      );

      await addToCache(email);
      totalImported++;
    } catch (error) {
      errors.push({
        email,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return {
    total_imported: totalImported,
    total_duplicates: totalDuplicates,
    errors,
  };
}

/**
 * Parse a CSV line, handling quoted values
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}
