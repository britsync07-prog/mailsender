// SMTP response code parsing

import { ParsedResponse, ResponseCategory, RESPONSE_CODE_MAP } from './types';

/**
 * Parse raw SMTP response string
 */
export function parseRawResponse(rawResponse: string): ParsedResponse {
  const lines = rawResponse.trim().split(/\r?\n/);
  const lastLine = lines[lines.length - 1];

  // Extract numeric code
  const codeMatch = lastLine.match(/^(\d{3})\s*(.*)/);
  if (!codeMatch) {
    return {
      code: 0,
      message: rawResponse,
      category: 'unknown',
    };
  }

  const code = parseInt(codeMatch[1], 10);
  const message = codeMatch[2] || '';

  // Extract enhanced status code if present (e.g., 5.7.1)
  const enhancedMatch = message.match(/(\d+\.\d+\.\d+)/);
  const enhanced_code = enhancedMatch ? enhancedMatch[1] : undefined;

  // Determine category
  const category = classifyCode(code);

  return {
    code,
    message,
    enhanced_code,
    category,
  };
}

/**
 * Classify response code to category
 */
export function classifyCode(code: number): ResponseCategory {
  return RESPONSE_CODE_MAP[code] || 'unknown';
}

/**
 * Get human-readable description for response code
 */
export function getCodeDescription(code: number): string {
  const descriptions: Record<number, string> = {
    250: 'OK, message accepted',
    251: 'User not local, will forward',
    252: 'Cannot VRFY user, will accept',
    421: 'Service not available',
    450: 'Mailbox unavailable',
    451: 'Temporary error',
    452: 'Insufficient storage',
    550: 'Mailbox unavailable or not found',
    551: 'User not local',
    553: 'Mailbox name not allowed',
    554: 'Transaction failed',
  };

  return descriptions[code] || `Unknown response code: ${code}`;
}

/**
 * Check if response indicates temporary failure
 */
export function isTemporaryFailure(code: number): boolean {
  return classifyCode(code) === 'soft_fail';
}

/**
 * Check if response indicates permanent failure
 */
export function isPermanentFailure(code: number): boolean {
  return classifyCode(code) === 'hard_fail';
}
