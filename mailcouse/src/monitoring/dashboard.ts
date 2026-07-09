// Health dashboard server

import { getSystemHealth } from './health-checker';
import { getBlacklistStats } from './mxtoolbox-client';
import { getReplacementStats } from './ip-replacement';

/**
 * Generate dashboard data
 */
export async function getDashboardData(): Promise<{
  health: any;
  blacklist: any;
  replacement: any;
  generated_at: Date;
}> {
  const [health, blacklist, replacement] = await Promise.all([
    getSystemHealth(),
    getBlacklistStats(),
    getReplacementStats(),
  ]);

  return {
    health,
    blacklist,
    replacement,
    generated_at: new Date(),
  };
}

/**
 * Format dashboard as HTML
 */
export function formatDashboardHTML(data: any): string {
  const statusColor = data.health.overall_status === 'healthy' ? '#00cc00' :
                      data.health.overall_status === 'warning' ? '#ffcc00' : '#ff0000';

  return `<!DOCTYPE html>
<html>
<head>
  <title>Mailcouse Health Dashboard</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; }
    .status { padding: 10px; border-radius: 5px; color: white; font-weight: bold; }
    .healthy { background-color: #00cc00; }
    .warning { background-color: #ffcc00; color: black; }
    .critical { background-color: #ff0000; }
    .metric { margin: 10px 0; padding: 10px; border: 1px solid #ccc; }
    .metric h3 { margin: 0 0 5px 0; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0; }
    th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
    th { background-color: #f0f0f0; }
  </style>
</head>
<body>
  <h1>Mailcouse Health Dashboard</h1>
  <p>Generated: ${data.generated_at.toISOString()}</p>
  
  <div class="status ${data.health.overall_status}">
    Overall Status: ${data.health.overall_status.toUpperCase()}
  </div>

  <div class="metric">
    <h3>Queue</h3>
    <p>Depth: ${data.health.queue_depth}</p>
    <p>Active Workers: ${data.health.active_workers}</p>
  </div>

  <div class="metric">
    <h3>Daily Volume</h3>
    <p>Current: ${data.health.daily_volume.toLocaleString()}</p>
    <p>Target: ${data.health.daily_target.toLocaleString()}</p>
    <p>Percentage: ${Math.round((data.health.daily_volume / data.health.daily_target) * 100)}%</p>
  </div>

  <div class="metric">
    <h3>IP Status</h3>
    <p>Active: ${data.blacklist.active}</p>
    <p>Blacklisted: ${data.blacklist.blacklisted}</p>
    <p>Reserve: ${data.blacklist.reserve}</p>
    <p>Last Check: ${data.blacklist.last_check?.toISOString() || 'Never'}</p>
  </div>

  <h2>Domains</h2>
  <table>
    <tr>
      <th>Domain</th>
      <th>Postmaster Score</th>
      <th>Complaint Rate</th>
      <th>Bounce Rate</th>
      <th>Status</th>
    </tr>
    ${data.health.domains.map((d: any) => `
    <tr>
      <td>${d.domain}</td>
      <td>${d.postmaster_score ?? 'N/A'}</td>
      <td>${(d.complaint_rate_7d * 100).toFixed(2)}%</td>
      <td>${(d.bounce_rate_7d * 100).toFixed(2)}%</td>
      <td>${d.status}</td>
    </tr>
    `).join('')}
  </table>

  <h2>IPs</h2>
  <table>
    <tr>
      <th>IP Address</th>
      <th>Status</th>
      <th>Blacklisted</th>
    </tr>
    ${data.health.ips.map((ip: any) => `
    <tr>
      <td>${ip.ip_address}</td>
      <td>${ip.status}</td>
      <td>${ip.blacklisted ? 'Yes' : 'No'}</td>
    </tr>
    `).join('')}
  </table>
</body>
</html>`;
}
