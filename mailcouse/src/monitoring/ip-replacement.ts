// Automatic IP replacement

import { query } from '../db/connection';
import { createAlert, sendAlert } from './alert-dispatcher';
import { ALERT_THRESHOLDS } from './types';

/**
 * Check and replace blacklisted IPs
 */
export async function checkAndReplaceIPs(): Promise<{
  checked: number;
  replaced: number;
  alerts_sent: number;
}> {
  let checked = 0;
  let replaced = 0;
  let alertsSent = 0;

  // Get blacklisted IPs
  const blacklistedIPs = await query<{ id: string; ip_address: string; vds_server_id: string }>(
    "SELECT id, ip_address, vds_server_id FROM ip_pool WHERE blacklisted = true AND status = 'blacklisted'"
  );

  for (const ip of blacklistedIPs.rows) {
    checked++;

    // Check if reserve pool has available IPs
    const reserveResult = await query<{ count: number }>(
      "SELECT COUNT(*) as count FROM ip_pool WHERE status = 'reserve' AND blacklisted = false"
    );

    const reserveCount = parseInt(String(reserveResult.rows[0]?.count || '0'));

    if (reserveCount > 0) {
      // Move blacklisted IP to retired
      await query(
        "UPDATE ip_pool SET status = 'retired' WHERE id = $1",
        [ip.id]
      );

      // Activate reserve IP
      await query(
        "UPDATE ip_pool SET status = 'active' WHERE vds_server_id = $1 AND status = 'reserve' AND blacklisted = false LIMIT 1",
        [ip.vds_server_id]
      );

      replaced++;
    } else {
      // No reserve IPs available, alert
      const alert = createAlert(
        'critical',
        'IP Replacement',
        0,
        ALERT_THRESHOLDS.reserve_ip_minimum,
        `No reserve IPs available to replace blacklisted IP ${ip.ip_address}`,
        undefined,
        ip.ip_address
      );
      await sendAlert(alert);
      alertsSent++;
    }
  }

  // Check reserve pool level
  const reserveResult = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM ip_pool WHERE status = 'reserve' AND blacklisted = false"
  );

  const reserveCount = parseInt(String(reserveResult.rows[0]?.count || '0'));

  if (reserveCount < ALERT_THRESHOLDS.reserve_ip_minimum) {
    const alert = createAlert(
      'warning',
      'Reserve IP Pool Low',
      reserveCount,
      ALERT_THRESHOLDS.reserve_ip_minimum,
      `Reserve IP pool has ${reserveCount} IPs (minimum: ${ALERT_THRESHOLDS.reserve_ip_minimum})`
    );
    await sendAlert(alert);
    alertsSent++;
  }

  return { checked, replaced, alerts_sent: alertsSent };
}

/**
 * Get IP replacement statistics
 */
export async function getReplacementStats(): Promise<{
  blacklisted_ips: number;
  reserve_ips: number;
  active_ips: number;
  recent_replacements: { ip: string; replaced_at: Date }[];
}> {
  const blacklistedResult = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM ip_pool WHERE blacklisted = true"
  );

  const reserveResult = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM ip_pool WHERE status = 'reserve' AND blacklisted = false"
  );

  const activeResult = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM ip_pool WHERE status = 'active'"
  );

  const recentResult = await query<{ ip_address: string; last_blacklist_check: Date }>(
    `SELECT ip_address, last_blacklist_check
     FROM ip_pool
     WHERE blacklisted = true
     ORDER BY last_blacklist_check DESC
     LIMIT 10`
  );

  return {
    blacklisted_ips: parseInt(String(blacklistedResult.rows[0]?.count || '0')),
    reserve_ips: parseInt(String(reserveResult.rows[0]?.count || '0')),
    active_ips: parseInt(String(activeResult.rows[0]?.count || '0')),
    recent_replacements: recentResult.rows.map((r) => ({
      ip: r.ip_address,
      replaced_at: r.last_blacklist_check,
    })),
  };
}
