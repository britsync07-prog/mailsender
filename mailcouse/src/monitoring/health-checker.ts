// Main health evaluation loop

import { query } from '../db/connection';
import { checkAndRetireDomains } from './domain-retirement';
import { checkAndReplaceIPs } from './ip-replacement';
import { checkAllDomainsPostmaster } from './postmaster-client';
import { checkAllIPsBlacklist } from './mxtoolbox-client';
import { createAlert, sendAlert } from './alert-dispatcher';
import { SystemHealth, HealthStatus, ALERT_THRESHOLDS } from './types';

/**
 * Run full health check
 */
export async function runHealthCheck(): Promise<{
  health: SystemHealth;
  alerts_sent: number;
  duration_ms: number;
}> {
  const startTime = Date.now();
  let alertsSent = 0;

  // Check domains
  const postmasterResult = await checkAllDomainsPostmaster();
  const retirementResult = await checkAndRetireDomains();
  alertsSent += retirementResult.alerts_sent;

  // Check IPs
  const blacklistResult = await checkAllIPsBlacklist();
  const replacementResult = await checkAndReplaceIPs();
  alertsSent += replacementResult.alerts_sent;

  // Check for blacklisted IPs and send alerts
  if (blacklistResult.blacklisted > 0) {
    const alert = createAlert(
      'critical',
      'IP Blacklisted',
      blacklistResult.blacklisted,
      0,
      `${blacklistResult.blacklisted} IP(s) found on blacklists`
    );
    await sendAlert(alert);
    alertsSent++;
  }

  // Get queue depth
  const queueResult = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM send_jobs WHERE status = 'queued'"
  );
  const queueDepth = parseInt(String(queueResult.rows[0]?.count || '0'));

  // Check daily volume
  const volumeResult = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM send_jobs WHERE status = 'sent' AND sent_at >= CURRENT_DATE"
  );
  const dailyVolume = parseInt(String(volumeResult.rows[0]?.count || '0'));

  // Check if volume is below target
  if (dailyVolume < ALERT_THRESHOLDS.daily_volume_deviation * 100000) {
    const alert = createAlert(
      'warning',
      'Daily Volume Low',
      dailyVolume,
      100000 * (1 - ALERT_THRESHOLDS.daily_volume_deviation),
      `Daily volume ${dailyVolume} is below ${(1 - ALERT_THRESHOLDS.daily_volume_deviation) * 100}% of target`
    );
    await sendAlert(alert);
    alertsSent++;
  }

  // Get worker count
  const workerResult = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM rdp_instances WHERE status = 'running'"
  );
  const activeWorkers = parseInt(String(workerResult.rows[0]?.count || '0'));

  // Determine overall health
  let overallStatus: HealthStatus = 'healthy';
  if (retirementResult.retired > 0 || blacklistResult.blacklisted > 0) {
    overallStatus = 'critical';
  } else if (postmasterResult.flagged > 0) {
    overallStatus = 'warning';
  }

  return {
    health: {
      overall_status: overallStatus,
      domains: [],
      ips: [],
      queue_depth: queueDepth,
      active_workers: activeWorkers,
      daily_volume: dailyVolume,
      daily_target: 100000,
    },
    alerts_sent: alertsSent,
    duration_ms: Date.now() - startTime,
  };
}

/**
 * Get current system health status
 */
export async function getSystemHealth(): Promise<SystemHealth> {
  // Domain health
  const domainResult = await query<{
    id: string;
    domain: string;
    postmaster_score: number | null;
    complaint_rate_7d: number;
    bounce_rate_7d: number;
    status: string;
  }>(
    "SELECT id, domain, postmaster_score, complaint_rate_7d, bounce_rate_7d, status FROM domains WHERE status != 'retired'"
  );

  // IP health
  const ipResult = await query<{
    id: string;
    ip_address: string;
    blacklisted: boolean;
    status: string;
  }>(
    "SELECT id, ip_address, blacklisted, status FROM ip_pool WHERE status != 'retired'"
  );

  // Queue depth
  const queueResult = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM send_jobs WHERE status = 'queued'"
  );

  // Active workers
  const workerResult = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM rdp_instances WHERE status = 'running'"
  );

  // Daily volume
  const volumeResult = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM send_jobs WHERE status = 'sent' AND sent_at >= CURRENT_DATE"
  );

  // Determine overall status
  let overallStatus: HealthStatus = 'healthy';
  for (const domain of domainResult.rows) {
    if (domain.postmaster_score !== null && domain.postmaster_score < 70) {
      overallStatus = 'warning';
    }
    if (domain.complaint_rate_7d > ALERT_THRESHOLDS.complaint_rate_threshold) {
      overallStatus = 'critical';
    }
  }

  for (const ip of ipResult.rows) {
    if (ip.blacklisted) {
      overallStatus = 'critical';
    }
  }

  return {
    overall_status: overallStatus,
    domains: domainResult.rows.map((r) => ({
      domain_id: r.id,
      domain: r.domain,
      postmaster_score: r.postmaster_score,
      complaint_rate_7d: r.complaint_rate_7d,
      bounce_rate_7d: r.bounce_rate_7d,
      status: r.status,
      last_checked: new Date(),
    })),
    ips: ipResult.rows.map((r) => ({
      ip_id: r.id,
      ip_address: r.ip_address,
      blacklisted: r.blacklisted,
      last_check: new Date(),
      status: r.status,
    })),
    queue_depth: parseInt(String(queueResult.rows[0]?.count || '0')),
    active_workers: parseInt(String(workerResult.rows[0]?.count || '0')),
    daily_volume: parseInt(String(volumeResult.rows[0]?.count || '0')),
    daily_target: 100000,
  };
}
