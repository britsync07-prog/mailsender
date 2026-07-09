// Stage 1: RFC 5322 Syntax Check

import { StageResult } from '../types';

// RFC 5322 compliant email regex
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

// Maximum lengths per RFC
const MAX_LOCAL_LENGTH = 64;
const MAX_DOMAIN_LENGTH = 253;
const MAX_EMAIL_LENGTH = 320;

export function validateSyntax(email: string): StageResult {
  const startTime = Date.now();

  try {
    // Null/undefined check
    if (!email || typeof email !== 'string') {
      return {
        stage: 'syntax',
        passed: false,
        error: 'Email is empty or not a string',
        duration_ms: Date.now() - startTime,
      };
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Total length check
    if (normalizedEmail.length > MAX_EMAIL_LENGTH) {
      return {
        stage: 'syntax',
        passed: false,
        error: `Email exceeds maximum length of ${MAX_EMAIL_LENGTH} characters`,
        duration_ms: Date.now() - startTime,
      };
    }

    // Must contain exactly one @
    const parts = normalizedEmail.split('@');
    if (parts.length !== 2) {
      return {
        stage: 'syntax',
        passed: false,
        error: 'Email must contain exactly one @ symbol',
        duration_ms: Date.now() - startTime,
      };
    }

    const [localPart, domain] = parts;

    // Local part length check
    if (localPart.length === 0) {
      return {
        stage: 'syntax',
        passed: false,
        error: 'Local part (before @) is empty',
        duration_ms: Date.now() - startTime,
      };
    }

    if (localPart.length > MAX_LOCAL_LENGTH) {
      return {
        stage: 'syntax',
        passed: false,
        error: `Local part exceeds maximum length of ${MAX_LOCAL_LENGTH} characters`,
        duration_ms: Date.now() - startTime,
      };
    }

    // Domain length check
    if (domain.length === 0) {
      return {
        stage: 'syntax',
        passed: false,
        error: 'Domain part (after @) is empty',
        duration_ms: Date.now() - startTime,
      };
    }

    if (domain.length > MAX_DOMAIN_LENGTH) {
      return {
        stage: 'syntax',
        passed: false,
        error: `Domain exceeds maximum length of ${MAX_DOMAIN_LENGTH} characters`,
        duration_ms: Date.now() - startTime,
      };
    }

    // Domain must contain at least one dot
    if (!domain.includes('.')) {
      return {
        stage: 'syntax',
        passed: false,
        error: 'Domain must contain at least one dot',
        duration_ms: Date.now() - startTime,
      };
    }

    // Domain TLD must be at least 2 characters
    const tld = domain.split('.').pop();
    if (!tld || tld.length < 2) {
      return {
        stage: 'syntax',
        passed: false,
        error: 'Domain TLD must be at least 2 characters',
        duration_ms: Date.now() - startTime,
      };
    }

    // Full regex check
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      return {
        stage: 'syntax',
        passed: false,
        error: 'Email does not match RFC 5322 format',
        duration_ms: Date.now() - startTime,
      };
    }

    return {
      stage: 'syntax',
      passed: true,
      duration_ms: Date.now() - startTime,
    };
  } catch (error) {
    return {
      stage: 'syntax',
      passed: false,
      error: `Syntax check error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      duration_ms: Date.now() - startTime,
    };
  }
}
