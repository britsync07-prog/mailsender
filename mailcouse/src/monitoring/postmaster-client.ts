// Gmail Postmaster API client

import { query } from '../db/connection';

/**
 * Fetch Postmaster score for a domain
 */
export async function fetchPostmasterScore(
  domain: string
): Promise<{
  score: number | null;
  spam_rate: number | null;
  dkim_success: number | null;
  spf_success: number | null;
}> {
  try {
    const apiKey = process.env.GMAIL_SERVICE_ACCOUNT_KEY;
    if (!apiKey) {
      return { score: null, spam_rate: null, dkim_success: null, spf_success: null };
    }

    // In production, this would call Gmail Postmaster Tools API
    // For now, return mock data
    const result = await query<{ postmaster_score: number | null }>(
      'SELECT postmaster_score FROM domains WHERE domain = $1',
      [domain]
    );

    const score = result.rows[0]?.postmaster_score || null;

    return {
      score,
      spam_rate: null,
      dkim_success: null,
      spf_success: null,
    };
  } catch (error) {
    console.error(`Failed to fetch Postmaster score for ${domain}:`, error);
    return { score: null, spam_rate: null, dkim_success: null, spf_success: null };
  }
}

/**
 * Update Postmaster score in database
 */
export async function updatePostmasterScore(
  domainId: string,
  score: number
): Promise<void> {
  await query(
    'UPDATE domains SET postmaster_score = $1, last_checked = NOW() WHERE id = $2',
    [score, domainId]
  );
}

/**
 * Check all domains for Postmaster score updates
 */
export async function checkAllDomainsPostmaster(): Promise<{
  checked: number;
  flagged: number;
  errors: string[];
}> {
  const domains = await query<{ id: string; domain: string }>(
    "SELECT id, domain FROM domains WHERE status != 'retired'"
  );

  let checked = 0;
  let flagged = 0;
  const errors: string[] = [];

  for (const domain of domains.rows) {
    try {
      const { score } = await fetchPostmasterScore(domain.domain);
      if (score !== null) {
        await updatePostmasterScore(domain.id, score);
        if (score < 70) flagged++;
      }
      checked++;
    } catch (error) {
      errors.push(`Failed to check ${domain.domain}: ${error}`);
    }
  }

  return { checked, flagged, errors };
}
