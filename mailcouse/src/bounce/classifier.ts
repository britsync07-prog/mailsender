// Bounce type classification

import { BounceType, BounceClassification, BOUNCE_TYPE_MAP, BOUNCE_CLASSIFICATIONS } from './types';

/**
 * Classify bounce type based on SMTP code and message
 */
export function classifyBounce(
  smtpCode: number,
  diagnosticCode?: string,
  message?: string
): BounceClassification {
  let bounceType: BounceType = 'unknown';

  // Check for policy block (550 5.7.x)
  if (smtpCode === 550 && diagnosticCode?.startsWith('5.7.')) {
    bounceType = 'policy_block';
  }
  // Check for mailbox full (452 4.2.2)
  else if (smtpCode === 452 && diagnosticCode === '4.2.2') {
    bounceType = 'mailbox_full';
  }
  // Check for spam block
  else if (smtpCode === 521 || (smtpCode === 550 && message?.toLowerCase().includes('spam'))) {
    bounceType = 'spam_block';
  }
  // Standard bounce classification
  else {
    bounceType = BOUNCE_TYPE_MAP[smtpCode] || 'unknown';
  }

  return BOUNCE_CLASSIFICATIONS[bounceType];
}

/**
 * Get bounce type from classification
 */
export function getBounceType(
  smtpCode: number,
  diagnosticCode?: string,
  message?: string
): BounceType {
  const classification = classifyBounce(smtpCode, diagnosticCode, message);
  return classification.type;
}

/**
 * Should suppress address based on bounce
 */
export function shouldSuppress(smtpCode: number, diagnosticCode?: string, message?: string): boolean {
  const classification = classifyBounce(smtpCode, diagnosticCode, message);
  return classification.should_suppress;
}

/**
 * Should retry sending
 */
export function shouldRetry(smtpCode: number, diagnosticCode?: string, message?: string): boolean {
  const classification = classifyBounce(smtpCode, diagnosticCode, message);
  return classification.should_retry;
}

/**
 * Get retry delay in hours
 */
export function getRetryDelayHours(smtpCode: number, diagnosticCode?: string, message?: string): number {
  const classification = classifyBounce(smtpCode, diagnosticCode, message);
  return classification.retry_after_hours || 0;
}

/**
 * Get max retries for bounce type
 */
export function getMaxRetries(smtpCode: number, diagnosticCode?: string, message?: string): number {
  const classification = classifyBounce(smtpCode, diagnosticCode, message);
  return classification.max_retries || 0;
}

/**
 * Check if bounce rate exceeds threshold
 */
export function checkBounceRateThreshold(
  bounceCount: number,
  totalCount: number,
  threshold: number = 0.03 // 3%
): boolean {
  if (totalCount === 0) return false;
  return (bounceCount / totalCount) > threshold;
}
