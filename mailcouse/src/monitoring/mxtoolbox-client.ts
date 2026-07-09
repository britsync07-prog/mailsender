// MXToolbox API client

import { query } from '../db/connection';

/**
 * Check IP blacklist status via MXToolbox
 */
export async function checkIPBlacklist(
  ipAddress: string
): Promise<{
  blacklisted: boolean;
  blacklists: { name: string; listed: boolean }[];
}> {
  try {
    const apiKey = process.env.MXTOOLBOX_API_KEY;
    if (!apiKey) {
      return { blacklisted: false, blacklists: [] };
    }

    // In production, this would call MXToolbox Business API
    // For now, check database for cached status
    const result = await query<{ blacklisted: boolean }>(
      'SELECT blacklisted FROM ip_pool WHERE ip_address = $1',
      [ipAddress]
    );

    const blacklisted = result.rows[0]?.blacklisted || false;

    return {
      blacklisted,
      blacklists: [],
    };
  } catch (error) {
    console.error(`Failed to check blacklist for ${ipAddress}:`, error);
    return { blacklisted: false, blacklists: [] };
  }
}

/**
 * Check all active IPs for blacklist status
 */
export async function checkAllIPsBlacklist(): Promise<{
  checked: number;
  blacklisted: number;
  errors: string[];
}> {
  const ips = await query<{ id: string; ip_address: string }>(
    "SELECT id, ip_address FROM ip_pool WHERE status = 'active'"
  );

  let checked = 0;
  let blacklisted = 0;
  const errors: string[] = [];

  for (const ip of ips.rows) {
    try {
      const { blacklisted: isBlacklisted } = await checkIPBlacklist(ip.ip_address);

      if (isBlacklisted) {
        // Mark IP as blacklisted in database
        await query(
          "UPDATE ip_pool SET blacklisted = true, last_blacklist_check = NOW(), status = 'blacklisted' WHERE id = $1",
          [ip.id]
        );
        blacklisted++;
      } else {
        // Update last check time
        await query(
          'UPDATE ip_pool SET last_blacklist_check = NOW() WHERE id = $1',
          [ip.id]
        );
      }
      checked++;
    } catch (error) {
      errors.push(`Failed to check IP ${ip.ip_address}: ${error}`);
    }
  }

  return { checked, blacklisted, errors };
}

/**
 * Get IP blacklist statistics
 */
export async function getBlacklistStats(): Promise<{
  total_ips: number;
  active: number;
  blacklisted: number;
  reserve: number;
  last_check: Date | null;
}> {
  const result = await query<{ status: string; count: number; last_check: Date | null }>(
    `SELECT status, COUNT(*) as count, MAX(last_blacklist_check) as last_check
     FROM ip_pool
     GROUP BY status`
  );

  const stats = {
    total_ips: 0,
    active: 0,
    blacklisted: 0,
    reserve: 0,
    last_check: null as Date | null,
  };

  for (const row of result.rows) {
    const count = parseInt(String(row.count));
    stats.total_ips += count;
    if (row.status === 'active') stats.active = count;
    if (row.status === 'blacklisted') stats.blacklisted = count;
    if (row.status === 'reserve') stats.reserve = count;
    if (row.last_check && (!stats.last_check || row.last_check > stats.last_check)) {
      stats.last_check = row.last_check;
    }
  }

  return stats;
}
