// Email header construction with DKIM

import { randomUUID } from 'crypto';
import { signEmail } from './signer';
import { EmailHeaders, DKIMSignResult } from './types';

/**
 * Build complete email headers with DKIM signature
 */
export async function buildEmailHeaders(
  subdomainId: string,
  from: string,
  to: string,
  subject: string,
  domain: string
): Promise<{ headers: Record<string, string>; dkimResult: DKIMSignResult }> {
  // Build base headers
  const headers: Record<string, string> = {
    from,
    to,
    subject,
    date: new Date().toUTCString(),
    'message-id': `<${randomUUID()}@${domain}>`,
    'list-unsubscribe': `<mailto:unsubscribe@${domain}>`,
    'list-unsubscribe-post': 'List-Unsubscribe=One-Click',
    precedence: 'bulk',
  };

  // Sign with DKIM
  const dkimResult = await signEmail(subdomainId, headers, '');

  if (dkimResult.success && dkimResult.signature) {
    headers['dkim-signature'] = dkimResult.signature;
  }

  // Note: X-Mailer is intentionally NOT added (TSD §8.6)

  return { headers, dkimResult };
}

/**
 * Format headers for SMTP transmission
 */
export function formatHeadersForSMTP(headers: Record<string, string>): string {
  const headerLines: string[] = [];

  // Add DKIM-Signature first (if present)
  if (headers['dkim-signature']) {
    headerLines.push(`DKIM-Signature: ${headers['dkim-signature']}`);
    delete headers['dkim-signature'];
  }

  // Add remaining headers
  for (const [key, value] of Object.entries(headers)) {
    headerLines.push(`${key}: ${value}`);
  }

  return headerLines.join('\r\n') + '\r\n';
}

/**
 * Verify required headers are present
 */
export function verifyRequiredHeaders(headers: Record<string, string>): {
  valid: boolean;
  missing: string[];
} {
  const required = ['from', 'to', 'subject', 'date', 'message-id'];
  const missing = required.filter((h) => !headers[h]);

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Check that X-Mailer is NOT present
 */
export function verifyNoXMailer(headers: Record<string, string>): boolean {
  return !headers['x-mailer'] && !headers['X-Mailer'];
}
