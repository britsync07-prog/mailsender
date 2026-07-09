// Feedback loop registration management

import { query } from '../db/connection';
import { ComplaintSource } from './types';

/**
 * Register FBL with email provider
 */
export async function registerFBL(
  domain: string,
  provider: ComplaintSource,
  callbackUrl: string
): Promise<{ success: boolean; registration_id?: string }> {
  try {
    const result = await query<{ id: string }>(
      `INSERT INTO fbl_registrations (id, domain, provider, callback_url, status, registered_at)
       VALUES (uuid_generate_v4(), $1, $2, $3, 'active', NOW())
       RETURNING id`,
      [domain, provider, callbackUrl]
    );

    return {
      success: true,
      registration_id: result.rows[0]?.id,
    };
  } catch (error) {
    return {
      success: false,
    };
  }
}

/**
 * Get FBL registrations for a domain
 */
export async function getFBLRegistrations(
  domain: string
): Promise<{ provider: ComplaintSource; status: string; registered_at: Date }[]> {
  const result = await query<{ provider: string; status: string; registered_at: Date }>(
    'SELECT provider, status, registered_at FROM fbl_registrations WHERE domain = $1',
    [domain]
  );

  return result.rows.map((r) => ({
    provider: r.provider as ComplaintSource,
    status: r.status,
    registered_at: r.registered_at,
  }));
}

/**
 * Check if domain has FBL registration
 */
export async function hasFBLRegistration(
  domain: string,
  provider: ComplaintSource
): Promise<boolean> {
  const result = await query<{ id: string }>(
    `SELECT id FROM fbl_registrations
     WHERE domain = $1 AND provider = $2 AND status = 'active'`,
    [domain, provider]
  );

  return result.rows.length > 0;
}

/**
 * Get all active FBL registrations
 */
export async function getAllActiveFBL(): Promise<{
  domain: string;
  provider: ComplaintSource;
  callback_url: string;
}[]> {
  const result = await query<{ domain: string; provider: string; callback_url: string }>(
    `SELECT domain, provider, callback_url
     FROM fbl_registrations
     WHERE status = 'active'`
  );

  return result.rows.map((r) => ({
    domain: r.domain,
    provider: r.provider as ComplaintSource,
    callback_url: r.callback_url,
  }));
}
