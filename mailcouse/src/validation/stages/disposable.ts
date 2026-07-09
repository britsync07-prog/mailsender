// Stage 3: Disposable Domain Check

import * as fs from 'fs';
import * as path from 'path';
import { StageResult } from '../types';

// Singleton disposable domains Set
let disposableDomains: Set<string> | null = null;

/**
 * Load disposable domains from JSON file into memory Set
 */
function loadDisposableDomains(): Set<string> {
  if (disposableDomains) return disposableDomains;

  // Try multiple possible paths
  const possiblePaths = [
    // From project root (mailcouse)
    path.resolve(__dirname, '../../../source/disposable-email-providers/disposable-email-providers.json'),
    // From mailsendr root
    path.resolve(__dirname, '../../../../source/disposable-email-providers/disposable-email-providers.json'),
    // Absolute path fallback
    'G:/myjob/mailsendr/source/disposable-email-providers/disposable-email-providers.json',
  ];

  let filePath = '';
  let fileFound = false;

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      filePath = p;
      fileFound = true;
      break;
    }
  }

  if (!fileFound) {
    console.error('Disposable email providers file not found');
    disposableDomains = new Set();
    return disposableDomains;
  }

  try {
    const rawData = fs.readFileSync(filePath, 'utf-8');
    const domains: string[] = JSON.parse(rawData);

    // Convert to Set for O(1) lookup
    disposableDomains = new Set(domains.map((d) => d.toLowerCase()));
    console.log(`Loaded ${disposableDomains.size} disposable domains`);

    return disposableDomains;
  } catch (error) {
    console.error('Failed to load disposable domains:', error);
    // Return empty set as fallback
    disposableDomains = new Set();
    return disposableDomains;
  }
}

/**
 * Validate if email uses a disposable domain
 */
export function validateDisposable(email: string): StageResult {
  const startTime = Date.now();

  try {
    // Extract domain from email
    const parts = email.split('@');
    if (parts.length !== 2) {
      return {
        stage: 'disposable',
        passed: false,
        error: 'Invalid email format',
        duration_ms: Date.now() - startTime,
      };
    }

    const domain = parts[1].toLowerCase();

    // Load disposable domains (cached after first load)
    const disposableSet = loadDisposableDomains();

    // Check if domain is disposable
    if (disposableSet.has(domain)) {
      return {
        stage: 'disposable',
        passed: false,
        error: `Disposable domain detected: ${domain}`,
        duration_ms: Date.now() - startTime,
      };
    }

    return {
      stage: 'disposable',
      passed: true,
      duration_ms: Date.now() - startTime,
    };
  } catch (error) {
    return {
      stage: 'disposable',
      passed: false,
      error: `Disposable check error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Get statistics about the disposable domains database
 */
export function getDisposableStats(): {
  total_domains: number;
  loaded: boolean;
} {
  const set = loadDisposableDomains();
  return {
    total_domains: set.size,
    loaded: true,
  };
}

/**
 * Check if a specific domain is disposable
 */
export function isDisposableDomain(domain: string): boolean {
  const set = loadDisposableDomains();
  return set.has(domain.toLowerCase());
}
