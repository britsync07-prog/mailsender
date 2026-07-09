// Spam word checking

import { SpamCheckResult } from './types';

// Banned words and phrases
const BANNED_WORDS = [
  'get', 'bank', 'credit', 'access', 'open', 'click',
  'free', 'winner', 'congratulations', 'urgent', 'immediate',
  'act now', 'limited time', 'expires', 'deadline',
  '100% free', 'no cost', 'no obligation', 'risk free',
  'make money', 'extra income', 'work from home',
  'buy', 'order', 'purchase', 'subscribe',
];

const BANNED_PATTERNS = [
  /[A-Z]{5,}/, // ALL CAPS words (5+ chars)
  /!{2,}/, // Multiple exclamation marks
  /\$\d+/, // Dollar amounts
  /\d+% off/, // Discount percentages
  /free money/, // Free money phrases
  /click here/, // Click here phrases
  /act now/, // Urgency phrases
  /limited time/, // Urgency phrases
];

// Safe replacement patterns
const REPLACEMENTS: Record<string, string[]> = {
  'get': ['receive', 'obtain', 'access'],
  'free': ['complimentary', 'no-cost', 'included'],
  'buy': ['acquire', 'invest in', 'consider'],
  'money': ['funds', 'capital', 'investment'],
  'urgent': ['time-sensitive', 'important', 'notable'],
  'act now': ['take the next step', 'get started', 'learn more'],
  'limited time': ['currently available', 'for a limited period', 'while available'],
};

/**
 * Check content for spam words and patterns
 */
export function checkSpam(content: string): SpamCheckResult {
  const violations: string[] = [];
  const suggestions: string[] = [];

  const lowerContent = content.toLowerCase();

  // Check banned words
  for (const word of BANNED_WORDS) {
    if (lowerContent.includes(word.toLowerCase())) {
      violations.push(`Banned word: "${word}"`);

      // Add replacement suggestion
      const normalizedWord = word.toLowerCase();
      if (REPLACEMENTS[normalizedWord]) {
        const replacements = REPLACEMENTS[normalizedWord];
        suggestions.push(`Replace "${word}" with: ${replacements.join(', ')}`);
      }
    }
  }

  // Check banned patterns
  for (const pattern of BANNED_PATTERNS) {
    if (pattern.test(content)) {
      violations.push(`Banned pattern: ${pattern.toString()}`);
    }
  }

  // Check for em dashes (—)
  if (content.includes('—')) {
    violations.push('Em dash detected');
    suggestions.push('Replace em dash with hyphen or comma');
  }

  // Check for multiple exclamation marks
  if (/!{2,}/.test(content)) {
    violations.push('Multiple exclamation marks');
    suggestions.push('Use single exclamation mark or period');
  }

  // Check for ALL CAPS words
  const words = content.split(/\s+/);
  for (const word of words) {
    if (word.length >= 5 && word === word.toUpperCase() && /^[A-Z]+$/.test(word)) {
      violations.push(`ALL CAPS word: "${word}"`);
      suggestions.push(`Lowercase "${word.toLowerCase()}"`);
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    suggestions,
  };
}

/**
 * Clean content of spam violations
 */
export function cleanSpam(content: string): { cleaned: string; changes: string[] } {
  let cleaned = content;
  const changes: string[] = [];

  // Replace banned words
  for (const [word, replacements] of Object.entries(REPLACEMENTS)) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    if (regex.test(cleaned)) {
      const replacement = replacements[0]; // Use first replacement
      cleaned = cleaned.replace(regex, replacement);
      changes.push(`Replaced "${word}" with "${replacement}"`);
    }
  }

  // Replace em dashes with hyphens
  if (cleaned.includes('—')) {
    cleaned = cleaned.replace(/—/g, '-');
    changes.push('Replaced em dashes with hyphens');
  }

  // Replace multiple exclamation marks
  if (/!{2,}/.test(cleaned)) {
    cleaned = cleaned.replace(/!{2,}/g, '!');
    changes.push('Replaced multiple exclamation marks');
  }

  // Lowercase ALL CAPS words (5+ chars)
  cleaned = cleaned.replace(/\b([A-Z]{5,})\b/g, (match) => {
    changes.push(`Lowercased "${match}"`);
    return match.toLowerCase();
  });

  return { cleaned, changes };
}

/**
 * Get spam check statistics
 */
export function getSpamStats(): {
  banned_words: number;
  banned_patterns: number;
  replacement_rules: number;
} {
  return {
    banned_words: BANNED_WORDS.length,
    banned_patterns: BANNED_PATTERNS.length,
    replacement_rules: Object.keys(REPLACEMENTS).length,
  };
}
