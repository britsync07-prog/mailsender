// IP pool selection with weighting

import { query } from '../db/connection';

/**
 * Get next available IP from pool (priority-weighted)
 */
export async function selectIP(): Promise<{
  id: string;
  ip_address: string;
  vds_server_id: string;
  priority: number;
} | null> {
  const result = await query<{
    id: string;
    ip_address: string;
    vds_server_id: string;
    priority: number;
  }>(
    `SELECT id, ip_address, vds_server_id, priority
     FROM ip_pool
     WHERE status = 'active'
       AND blacklisted = false
     ORDER BY priority DESC, RANDOM()
     LIMIT 1`
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

/**
 * Get available IPs for sending
 */
export async function getAvailableIPs(): Promise<{
  id: string;
  ip_address: string;
  priority: number;
}[]> {
  const result = await query<{
    id: string;
    ip_address: string;
    priority: number;
  }>(
    `SELECT id, ip_address, priority
     FROM ip_pool
     WHERE status = 'active'
       AND blacklisted = false
     ORDER BY priority DESC`
  );

  return result.rows;
}

/**
 * Check if IP is available
 */
export async function isIPAvailable(ipId: string): Promise<boolean> {
  const result = await query<{ id: string }>(
    `SELECT id FROM ip_pool
     WHERE id = $1 AND status = 'active' AND blacklisted = false`,
    [ipId]
  );

  return result.rows.length > 0;
}

/**
 * Get IP statistics
 */
export async function getIPStats(): Promise<{
  total: number;
  active: number;
  blacklisted: number;
  avg_priority: number;
}> {
  const result = await query<{
    total: number;
    active: number;
    blacklisted: number;
    avg_priority: number;
  }>(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE status = 'active' AND blacklisted = false) as active,
       COUNT(*) FILTER (WHERE blacklisted = true) as blacklisted,
       AVG(priority) as avg_priority
     FROM ip_pool`
  );

  return result.rows[0] || { total: 0, active: 0, blacklisted: 0, avg_priority: 0 };
}
