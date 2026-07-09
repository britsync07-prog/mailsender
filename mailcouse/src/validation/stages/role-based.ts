// Stage 4: Role-Based Email Detection

import { StageResult } from '../types';

// Known role-based email prefixes
const ROLE_PREFIXES = [
  'admin',
  'administrator',
  'info',
  'support',
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'sales',
  'webmaster',
  'postmaster',
  'hostmaster',
  'abuse',
  'noc',
  'security',
  'billing',
  'help',
  'office',
  'hr',
  'marketing',
  'press',
  'legal',
  'team',
  'staff',
  'contact',
  'hello',
  'feedback',
  'newsletter',
  'subscribe',
  'unsubscribe',
  'mailer-daemon',
  'daemon',
  'root',
  'sysadmin',
  'networkadmin',
  'privacy',
  'compliance',
  'accounts',
  'customerservice',
  'customersupport',
  'techsupport',
  'service',
  'operations',
  'development',
  'dev',
  'engineering',
  'design',
  'media',
  'pr',
  'jobs',
  'careers',
  'recruitment',
  'info',
  'enquiries',
  'enquiry',
  'inquiries',
  'inquiry',
];

// Separators that might appear between role prefix and rest
const SEPARATORS = ['-', '_', '.', '+', ''];

/**
 * Validate if email is role-based
 */
export function validateRoleBased(email: string): StageResult {
  const startTime = Date.now();

  try {
    // Extract local part from email
    const parts = email.split('@');
    if (parts.length !== 2) {
      return {
        stage: 'role_based',
        passed: false,
        error: 'Invalid email format',
        duration_ms: Date.now() - startTime,
      };
    }

    const localPart = parts[0].toLowerCase();

    // Check exact match
    if (ROLE_PREFIXES.includes(localPart)) {
      return {
        stage: 'role_based',
        passed: false,
        error: `Role-based email detected: ${localPart}@`,
        duration_ms: Date.now() - startTime,
      };
    }

    // Check with separators (e.g., admin-team, support.help)
    for (const prefix of ROLE_PREFIXES) {
      for (const sep of SEPARATORS) {
        if (sep === '') {
          // Check if local part starts with prefix followed by numbers
          // e.g., admin1, support2
          if (/^admin\d+$/.test(localPart) || /^support\d+$/.test(localPart)) {
            return {
              stage: 'role_based',
              passed: false,
              error: `Role-based email detected: ${localPart}@`,
              duration_ms: Date.now() - startTime,
            };
          }
        } else {
          const pattern = `${prefix}${sep}`;
          if (localPart.startsWith(pattern) && localPart.length > pattern.length) {
            return {
              stage: 'role_based',
              passed: false,
              error: `Role-based email detected: ${localPart}@`,
              duration_ms: Date.now() - startTime,
            };
          }
        }
      }
    }

    return {
      stage: 'role_based',
      passed: true,
      duration_ms: Date.now() - startTime,
    };
  } catch (error) {
    return {
      stage: 'role_based',
      passed: false,
      error: `Role-based check error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Get list of all role-based prefixes
 */
export function getRolePrefixes(): string[] {
  return [...ROLE_PREFIXES];
}

/**
 * Check if a specific local part is role-based
 */
export function isRoleBased(localPart: string): boolean {
  const lower = localPart.toLowerCase();
  return ROLE_PREFIXES.includes(lower);
}
