// Token resolution and personalization

import { PersonalizationTokens } from './types';

// Available tokens
const AVAILABLE_TOKENS = [
  'first_name',
  'company_name',
  'industry',
  'pain_point',
  'sender_name',
  'unsubscribe_url',
];

/**
 * Resolve personalization tokens in content
 */
export function resolveTokens(
  content: string,
  tokens: PersonalizationTokens
): string {
  let resolved = content;

  for (const [key, value] of Object.entries(tokens)) {
    if (value !== undefined && value !== null) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      resolved = resolved.replace(regex, value);
    }
  }

  return resolved;
}

/**
 * Strip unresolved tokens from content
 */
export function stripUnresolvedTokens(content: string): string {
  // Remove {{token_name}} patterns that weren't resolved
  return content.replace(/\{\{[a-zA-Z_]+\}\}/g, '');
}

/**
 * Check for unresolved tokens
 */
export function hasUnresolvedTokens(content: string): boolean {
  return /\{\{[a-zA-Z_]+\}\}/.test(content);
}

/**
 * Get list of unresolved tokens
 */
export function getUnresolvedTokens(content: string): string[] {
  const tokens: string[] = [];
  const regex = /\{\{([a-zA-Z_]+)\}\}/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    tokens.push(match[1]);
  }

  return [...new Set(tokens)];
}

/**
 * Validate that all required tokens are present
 */
export function validateTokens(
  content: string,
  requiredTokens: string[]
): {
  valid: boolean;
  missing: string[];
} {
  const missing = requiredTokens.filter(
    (token) => !content.includes(`{{${token}}}`)
  );

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Create default token set for a lead
 */
export function createDefaultTokens(lead: {
  first_name?: string;
  company?: string;
  industry?: string;
  pain_point?: string;
}): PersonalizationTokens {
  return {
    first_name: lead.first_name || 'there',
    company_name: lead.company || 'your company',
    industry: lead.industry || '',
    pain_point: lead.pain_point || '',
    unsubscribe_url: '{{unsubscribe_url}}', // Placeholder for tracking
  };
}
