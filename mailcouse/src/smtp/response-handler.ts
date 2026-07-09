// SMTP response capture and classification

import { SMTP_RESPONSE_CODES } from './types';

export type BounceReason =
  | 'success'
  | 'userunknown'
  | 'mailboxfull'
  | 'spamdetected'
  | 'rejected'
  | 'blocked'
  | 'expired'
  | 'filtered'
  | 'norelaying'
  | 'suspend'
  | 'systemerror'
  | 'toomanyconns'
  | 'timeout'
  | 'auth_required'
  | 'unknown';

export interface ClassifiedResponse {
  type: 'success' | 'soft_fail' | 'hard_fail' | 'auth_required' | 'unknown';
  reason: BounceReason;
  should_retry: boolean;
  should_suppress: boolean;
}

function detectBounceReason(code: number, message: string): BounceReason {
  const lower = message.toLowerCase();

  if (code === 550 && (lower.includes('user unknown') || lower.includes('no such') || lower.includes('does not exist') || lower.includes('not found') || lower.includes('invalid recipient') || lower.includes('invalid address') || lower.includes('undeliverable'))) {
    return 'userunknown';
  }
  if (lower.includes('mailbox full') || lower.includes('quota') || lower.includes('over quota') || lower.includes('storage')) {
    return 'mailboxfull';
  }
  if (lower.includes('spam') || lower.includes('blocked') || lower.includes('blacklist') || lower.includes('denied') || (code === 550 && lower.includes('rejected'))) {
    return 'spamdetected';
  }
  if (lower.includes('blocked') || lower.includes('not allowed') || lower.includes('policy') || lower.includes('banned')) {
    return 'blocked';
  }
  if (lower.includes('filtered') || lower.includes('message filtered')) {
    return 'filtered';
  }
  if (lower.includes('relay') || lower.includes('relaying') || lower.includes('relay denied')) {
    return 'norelaying';
  }
  if (lower.includes('suspended') || lower.includes('disabled') || lower.includes('deactivated')) {
    return 'suspend';
  }
  if (lower.includes('temporarily') || lower.includes('try again') || lower.includes('try later')) {
    return 'expired';
  }
  if (code === 450 || code === 451 || code === 452) {
    if (lower.includes('too many') || lower.includes('connections') || lower.includes('rate limit') || lower.includes('exceeded')) {
      return 'toomanyconns';
    }
    return 'expired';
  }
  if (code >= 500 && code < 600 && lower.includes('auth') || lower.includes('authentication')) {
    return 'auth_required';
  }
  if (code === 421 || lower.includes('temporarily unavailable') || lower.includes('service unavailable') || lower.includes('try again later')) {
    return 'timeout';
  }
  if (code >= 500 && code < 600) {
    if (lower.includes('system') || lower.includes('error') || lower.includes('unexpected')) {
      return 'systemerror';
    }
    return 'userunknown';
  }

  return 'unknown';
}

export function classifyResponse(code: number, message?: string): ClassifiedResponse {
  if (SMTP_RESPONSE_CODES.SUCCESS.includes(code)) {
    return { type: 'success', reason: 'success', should_retry: false, should_suppress: false };
  }

  if (SMTP_RESPONSE_CODES.SOFT_FAIL.includes(code)) {
    const reason = message ? detectBounceReason(code, message) : 'expired';
    return { type: 'soft_fail', reason, should_retry: true, should_suppress: false };
  }

  if (SMTP_RESPONSE_CODES.HARD_FAIL.includes(code)) {
    const reason = message ? detectBounceReason(code, message) : 'userunknown';
    const noRetryReasons: BounceReason[] = ['userunknown', 'spamdetected', 'blocked', 'norelaying', 'suspend'];
    return { type: 'hard_fail', reason, should_retry: !noRetryReasons.includes(reason), should_suppress: noRetryReasons.includes(reason) };
  }

  if (SMTP_RESPONSE_CODES.AUTH_REQUIRED.includes(code)) {
    return { type: 'auth_required', reason: 'auth_required', should_retry: false, should_suppress: false };
  }

  const reason = message ? detectBounceReason(code, message) : 'unknown';
  return { type: 'unknown', reason, should_retry: false, should_suppress: false };
}

export function classifySMTPResponse(code: number, message: string): ClassifiedResponse {
  return classifyResponse(code, message);
}

/**
 * Parse SMTP response from server
 */
export function parseSMTPResponse(response: string): {
  code: number;
  message: string;
  is_multiline: boolean;
} {
  const lines = response.trim().split('\r\n');
  const lastLine = lines[lines.length - 1];

  const codeMatch = lastLine.match(/^(\d{3})\s*(.*)/);
  if (!codeMatch) {
    return { code: 0, message: response, is_multiline: false };
  }

  return {
    code: parseInt(codeMatch[1], 10),
    message: codeMatch[2] || '',
    is_multiline: lines.length > 1,
  };
}

/**
 * Get retry delay for attempt number
 */
export function getRetryDelay(attempt: number): number {
  const delays = [300000, 900000, 2700000]; // 5min, 15min, 45min
  return delays[Math.min(attempt - 1, delays.length - 1)];
}

/**
 * Should retry based on attempt count
 */
export function shouldRetry(attempt: number, maxRetries: number = 3): boolean {
  return attempt < maxRetries;
}
