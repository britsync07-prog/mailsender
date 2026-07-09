// IP pool selection

import { query } from '../db/connection';
import { IPAssignment } from './types';

/**
 * Get next available IP from pool (priority-weighted)
 */
export async function assignIP(): Promise<IPAssignment | null> {
  // Get active, non-blacklisted IPs sorted by priority
  const result = await query<IPAssignment & { weight: number }>(
    `SELECT id, ip_address, vds_server_id, status, blacklisted,
            priority as weight, emails_today
     FROM ip_pool
     WHERE status = 'active'
       AND blacklisted = false
     ORDER BY priority DESC, RANDOM()
     LIMIT 1`
  );

  if (result.rows.length === 0) {
    return null; // No available IPs
  }

  const ip = result.rows[0];
  return {
    id: ip.id,
    ip_address: ip.ip_address,
    vds_server_id: ip.vds_server_id,
    status: ip.status,
    blacklisted: ip.blacklisted,
    priority: ip.weight,
    emails_today: ip.emails_today,
  };
}

/**
 * Get available IP count
 */
export async function getAvailableIPCount(): Promise<number> {
  const result = await query<{ count: number }>(
    `SELECT COUNT(*) as count
     FROM ip_pool
     WHERE status = 'active'
       AND blacklisted = false`
  );

  return parseInt(String(result.rows[0]?.count || '0'));
}

/**
 * Get IP pool statistics
 */
export async function getIPPoolStats(): Promise<{
  total: number;
  active: number;
  reserve: number;
  blacklisted: number;
  retired: number;
}> {
  const result = await query<{ status: string; count: number }>(
    'SELECT status, COUNT(*) as count FROM ip_pool GROUP BY status'
  );

  const stats = {
    total: 0,
    active: 0,
    reserve: 0,
    blacklisted: 0,
    retired: 0,
  };

  for (const row of result.rows) {
    const count = parseInt(String(row.count));
    stats.total += count;
    stats[row.status as keyof typeof stats] += count;
  }

  return stats;
}

/**
 * Check if IP is available for sending
 */
export async function isIPAvailable(ipId: string): Promise<boolean> {
  const result = await query<{ id: string }>(
    `SELECT id FROM ip_pool
     WHERE id = $1
       AND status = 'active'
       AND blacklisted = false`,
    [ipId]
  );

  return result.rows.length > 0;
}
