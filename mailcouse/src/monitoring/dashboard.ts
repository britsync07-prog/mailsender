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

    <h2>Quick Send</h2>
    <div class="metric">
      <form id="sendForm">
        <p><input type="email" id="toEmail" placeholder="recipient@example.com" required style="width:100%;padding:8px;font-size:14px;"></p>
        <p><input type="text" id="subject" placeholder="Email Subject" required style="width:100%;padding:8px;font-size:14px;"></p>
        <p><textarea id="body" rows="6" placeholder="Email body..." required style="width:100%;padding:8px;font-size:14px;"></textarea></p>
        <p><input type="text" id="fromName" placeholder="Sender name (optional, e.g. John Smith)" style="width:100%;padding:8px;font-size:14px;"></p>
        <p><button type="submit" style="padding:10px 20px;font-size:14px;background-color:#00cc00;color:white;border:none;border-radius:4px;cursor:pointer;">Send Email</button></p>
      </form>
      <div id="sendResult" style="margin-top:10px;padding:10px;border-radius:4px;display:none;"></div>
    </div>

    <script>
      document.getElementById('sendForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        btn.disabled = true;
        btn.textContent = 'Sending...';
        const resultDiv = document.getElementById('sendResult');
        resultDiv.style.display = 'none';
        try {
          const res = await fetch('/api/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: document.getElementById('toEmail').value,
              subject: document.getElementById('subject').value,
              body: document.getElementById('body').value,
              from_name: document.getElementById('fromName').value || undefined,
            }),
          });
          const data = await res.json();
          resultDiv.style.display = 'block';
          if (data.success) {
            resultDiv.className = 'status healthy';
            resultDiv.textContent = 'Sent! Response: ' + (data.response_message || 'OK');
          } else {
            resultDiv.className = 'status critical';
            resultDiv.textContent = 'Failed: ' + (data.error || data.message || 'Unknown error');
          }
        } catch (err) {
          resultDiv.style.display = 'block';
          resultDiv.className = 'status critical';
          resultDiv.textContent = 'Error: ' + err.message;
        }
        btn.disabled = false;
        btn.textContent = 'Send Email';
      });
    </script>

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
