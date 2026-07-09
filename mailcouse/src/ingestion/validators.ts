// Field validation rules for Plan 1 — Lead Ingestion

import { config } from '../config';
import { Industry, LeadSource, RawLead, FieldValidationResult } from './types';

// Email regex per RFC 5322
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

// Role-based email prefixes
const ROLE_PREFIXES = config.validation.roleBasedPrefixes;

/**
 * Validate a single lead field
 */
export function validateLead(lead: RawLead, source: LeadSource): FieldValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Email validation
  if (!lead.email || typeof lead.email !== 'string') {
    errors.push('Email is required');
  } else {
    const normalizedEmail = lead.email.toLowerCase().trim();

    // Length check (before regex to catch obviously invalid lengths)
    if (normalizedEmail.length > 320) {
      errors.push('Email exceeds maximum length of 320 characters');
    }

    // Syntax check
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      errors.push(`Invalid email format: ${lead.email}`);
    }

    // Domain part check
    const parts = normalizedEmail.split('@');
    if (parts.length !== 2) {
      errors.push('Email must contain exactly one @ symbol');
    } else {
      const domain = parts[1];

      // Check for common free email providers (warning, not error)
      const freeProviders = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com'];
      if (freeProviders.includes(domain)) {
        warnings.push(`Email uses free provider: ${domain}`);
      }

      // Domain length check
      if (domain.length > 253) {
        errors.push('Domain name exceeds maximum length');
      }
    }
  }

  // Industry validation
  if (!lead.industry) {
    errors.push('Industry is required');
  } else if (!config.import.allowedIndustries.includes(lead.industry as Industry)) {
    errors.push(`Invalid industry: ${lead.industry}. Must be one of: ${config.import.allowedIndustries.join(', ')}`);
  }

  // Source validation
  if (!source) {
    errors.push('Source is required');
  } else if (!config.import.allowedSources.includes(source as LeadSource)) {
    errors.push(`Invalid source: ${source}`);
  }

  // Field length validations
  if (lead.first_name && lead.first_name.length > 100) {
    errors.push('First name exceeds maximum length of 100 characters');
  }
  if (lead.last_name && lead.last_name.length > 100) {
    errors.push('Last name exceeds maximum length of 100 characters');
  }
  if (lead.company && lead.company.length > 200) {
    errors.push('Company name exceeds maximum length of 200 characters');
  }
  if (lead.job_title && lead.job_title.length > 200) {
    errors.push('Job title exceeds maximum length of 200 characters');
  }
  if (lead.pain_point && lead.pain_point.length > 500) {
    errors.push('Pain point exceeds maximum length of 500 characters');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Check if email is role-based
 */
export function isRoleBasedEmail(email: string): boolean {
  const localPart = email.split('@')[0]?.toLowerCase();
  if (!localPart) return false;

  // Check exact match
  if (ROLE_PREFIXES.includes(localPart)) return true;

  // Check prefix patterns (e.g., admin@example.com, support-team@example.com)
  for (const prefix of ROLE_PREFIXES) {
    if (localPart.startsWith(prefix + '-') || localPart.startsWith(prefix + '.')) {
      return true;
    }
  }

  return false;
}

/**
 * Normalize email address
 */
export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/**
 * Validate batch of leads
 */
export function validateBatch(
  leads: RawLead[],
  source: LeadSource
): { valid: RawLead[]; invalid: { lead: RawLead; errors: string[] }[] } {
  const valid: RawLead[] = [];
  const invalid: { lead: RawLead; errors: string[] }[] = [];

  for (const lead of leads) {
    const result = validateLead(lead, source);
    if (result.valid) {
      valid.push(lead);
    } else {
      invalid.push({ lead, errors: result.errors });
    }
  }

  return { valid, invalid };
}
