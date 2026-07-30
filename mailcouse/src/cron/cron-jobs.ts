import { query } from '../db/connection';
import * as dns from 'dns';

// Midnight UTC reset — resets daily send counters
export async function resetDailyCounters(): Promise<void> {
  try {
    const result = await query(`SELECT COALESCE(SUM(emails_sent_today), 0) as sent,
                                       COALESCE(SUM(bounce_count), 0) as bounces,
                                       COALESCE(SUM(complaint_count), 0) as complaints,
                                       COALESCE(SUM(reply_count), 0) as replies
                                FROM subdomains`);
    await query('UPDATE subdomains SET emails_sent_today = 0');
    await query('UPDATE ip_pool SET emails_today = 0');
    const s = result.rows[0];
    await query(
      `INSERT INTO daily_stats (date, total_sent, total_bounces, total_complaints, total_replies)
       SELECT CURRENT_DATE, $1, $2, $3, $4
       WHERE NOT EXISTS (SELECT 1 FROM daily_stats WHERE date = CURRENT_DATE)`,
      [s.sent, s.bounces, s.complaints, s.replies]
    );
    console.log(`[cron] Daily counters reset at ${new Date().toISOString()}`);
  } catch (err: any) {
    console.error('[cron] resetDailyCounters failed:', err.message);
  }
}

// Non-engager suppression
export async function suppressNonEngagers(): Promise<void> {
  try {
    const result = await query(
      `INSERT INTO suppression_list (email, reason)
       SELECT l.email, 'non_engager'
       FROM leads l
       WHERE l.send_count >= 2
         AND l.open_count = 0
         AND l.reply_count = 0
         AND l.status NOT IN ('suppressed', 'unsubscribed', 'bounced')
         AND NOT EXISTS (SELECT 1 FROM suppression_list s WHERE s.email = l.email)
       ON CONFLICT (email) DO NOTHING`
    );
    if (result.rowCount && result.rowCount > 0) {
      console.log(`[cron] Suppressed ${result.rowCount} non-engagers`);
    }
  } catch (err: any) {
    console.error('[cron] suppressNonEngagers failed:', err.message);
  }
}

// Update subdomain engagement scores
export async function updateEngagementScores(): Promise<void> {
  try {
    await query(
      `UPDATE subdomains SET
        engagement_score = (reply_count * 10) + (open_count * 2)
       WHERE status = 'active'`
    );
  } catch (err: any) {
    console.error('[cron] updateEngagementScores failed:', err.message);
  }
}

// Evaluate domain health
export async function evaluateDomainHealth(): Promise<void> {
  try {
    const domains = await query<{
      id: string; domain: string; status: string;
      complaint_rate_7d: number; bounce_rate_7d: number;
      postmaster_score: number; retired_at: Date; created_at: Date;
    }>(
      `SELECT d.id, d.domain, d.status, d.complaint_rate_7d, d.bounce_rate_7d,
              d.postmaster_score, d.retired_at, d.created_at
       FROM domains d WHERE d.status = 'active'`
    );
    for (const row of domains.rows) {
      let reason = '';
      if (row.postmaster_score !== null && row.postmaster_score < 70) {
        reason = 'postmaster_below_70';
      }
      if (row.complaint_rate_7d !== null && row.complaint_rate_7d > 0.001) {
        reason = 'complaint_rate_exceeded';
      }
      if (row.bounce_rate_7d !== null && row.bounce_rate_7d > 0.03) {
        reason = 'bounce_rate_exceeded';
      }
      if (reason) {
        console.log(`[cron] Domain ${row.domain} flagged: ${reason}`);
        await query(
          `UPDATE domains SET status = 'flagged', retirement_reason = $1 WHERE id = $2 AND status = 'active'`,
          [reason, row.id]
        );
      }
    }
  } catch (err: any) {
    console.error('[cron] evaluateDomainHealth failed:', err.message);
  }
}

// Auto-DNS check for customer domains (Postal-like)
export async function autoCheckCustomerDomainDNS(): Promise<void> {
  try {
    const domains = await query<{
      id: string; domain: string; dkim_selector: string; dkim_public_key: string;
    }>(
      `SELECT id, domain, dkim_selector, dkim_public_key
       FROM customer_domains
       WHERE verified = true
         AND (dns_checked_at IS NULL OR dns_checked_at < NOW() - INTERVAL '1 hour')`
    );

    let checked = 0;
    let changed = 0;

    for (const row of domains.rows) {
      try {
        const statuses: Record<string, string> = {};
        try {
          const txtRecords = await dns.promises.resolveTxt(row.domain);
          const spfRecord = txtRecords.flat().find(r => r.startsWith('v=spf1'));
          statuses.spf = spfRecord ? 'ok' : 'missing';
        } catch { statuses.spf = 'missing'; }

        try {
          const dkimRecords = await dns.promises.resolveTxt(`${row.dkim_selector}._domainkey.${row.domain}`);
          statuses.dkim = dkimRecords.length > 0 ? 'ok' : 'missing';
        } catch { statuses.dkim = 'missing'; }

        try {
          const mxRecords = await dns.promises.resolveMx(row.domain);
          statuses.mx = mxRecords.length > 0 ? 'ok' : 'missing';
        } catch { statuses.mx = 'missing'; }

        try {
          const dmarcRecords = await dns.promises.resolveTxt(`_dmarc.${row.domain}`);
          statuses.return_path = dmarcRecords.flat().find(r => r.startsWith('v=DMARC1')) ? 'ok' : 'missing';
        } catch { statuses.return_path = 'missing'; }

        const allOk = Object.values(statuses).every(s => s === 'ok');

        await query(
          `UPDATE customer_domains SET
           spf_status = $1, dkim_status = $2, mx_status = $3, return_path_status = $4,
           verified = $5, dns_checked_at = NOW()
           WHERE id = $6`,
          [statuses.spf, statuses.dkim, statuses.mx, statuses.return_path, allOk, row.id]
        );

        if (!allOk) changed++;
        checked++;
      } catch {
        // Skip individual domain failures
      }
    }

    if (checked > 0) {
      console.log(`[cron] Auto-checked DNS for ${checked} customer domains, ${changed} have issues`);
    }
  } catch (err: any) {
    console.error('[cron] autoCheckCustomerDomainDNS failed:', err.message);
  }
}

// Run all daily cron jobs (midnight UTC)
export async function runDailyCron(): Promise<void> {
  await resetDailyCounters();
  await suppressNonEngagers();
  await updateEngagementScores();
  await evaluateDomainHealth();
}

// Run hourly cron jobs
export async function runHourlyCron(): Promise<void> {
  await updateEngagementScores();
  await autoCheckCustomerDomainDNS();
}