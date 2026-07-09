// Stage 2: MX Record Lookup

import { resolveMx, MxRecord } from 'dns';
import { promisify } from 'util';
import { StageResult, MXRecord } from '../types';

export type { MXRecord } from '../types';

const resolveMxAsync = promisify(resolveMx);

export async function validateMX(email: string): Promise<StageResult & { mx_records?: MXRecord[] }> {
  const startTime = Date.now();

  try {
    // Extract domain from email
    const parts = email.split('@');
    if (parts.length !== 2) {
      return {
        stage: 'mx',
        passed: false,
        error: 'Invalid email format',
        duration_ms: Date.now() - startTime,
      };
    }

    const domain = parts[1];

    // Query MX records
    const mxRecords = await resolveMxAsync(domain);

    if (!mxRecords || mxRecords.length === 0) {
      return {
        stage: 'mx',
        passed: false,
        error: `No MX records found for domain: ${domain}`,
        duration_ms: Date.now() - startTime,
      };
    }

    // Sort by priority (lower = higher priority)
    const sortedRecords: MXRecord[] = mxRecords
      .map((record: MxRecord) => ({
        priority: record.priority,
        exchange: record.exchange,
      }))
      .sort((a, b) => a.priority - b.priority);

    return {
      stage: 'mx',
      passed: true,
      mx_records: sortedRecords,
      duration_ms: Date.now() - startTime,
    };
  } catch (error: any) {
    // DNS error codes
    if (error.code === 'ENODATA' || error.code === 'ENOTFOUND') {
      return {
        stage: 'mx',
        passed: false,
        error: `No MX records found for domain: ${email.split('@')[1]}`,
        duration_ms: Date.now() - startTime,
      };
    }

    return {
      stage: 'mx',
      passed: false,
      error: `MX lookup error: ${error.message || 'Unknown DNS error'}`,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Get the best MX server (lowest priority)
 */
export function getBestMX(mxRecords: MXRecord[]): MXRecord | null {
  if (!mxRecords || mxRecords.length === 0) return null;
  // Sort by priority (lower = higher priority) and return first
  return [...mxRecords].sort((a, b) => a.priority - b.priority)[0];
}

/**
 * Check if domain has backup MX servers
 */
export function hasBackupMX(mxRecords: MXRecord[]): boolean {
  return mxRecords.length > 1;
}
