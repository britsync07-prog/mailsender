import { Pool } from 'pg';

const pool = new Pool({
  host: 'localhost', port: 5433, database: 'mailcouse',
  user: 'mailcouse', password: 'postgres', max: 3,
});

// Midnight UTC reset — resets daily send counters (TSD §14 step 20)
export async function resetDailyCounters(): Promise<void> {
  try {
    const result = await pool.query(
      `WITH archived AS (
        SELECT COALESCE(SUM(emails_sent_today), 0) as sent,
               COALESCE(SUM(bounce_count), 0) as bounces,
               COALESCE(SUM(complaint_count), 0) as complaints,
               COALESCE(SUM(reply_count), 0) as replies
        FROM subdomains
      )
      UPDATE subdomains SET emails_sent_today = 0;
      UPDATE ip_pool SET emails_today = 0;
      INSERT INTO daily_stats (date, total_sent, total_bounces, total_complaints, total_replies)
      SELECT CURRENT_DATE, sent, bounces, complaints, replies FROM archived
      ON CONFLICT (date) DO NOTHING;`
    );
    console.log(`[cron] Daily counters reset at ${new Date().toISOString()}`);
  } catch (err: any) {
    console.error('[cron] resetDailyCounters failed:', err.message);
  }
}

// Non-engager suppression — auto-suppress leads with 2+ sends and zero engagement (TSD §8.8)
export async function suppressNonEngagers(): Promise<void> {
  try {
    const result = await pool.query(
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

// Update subdomain engagement scores (TSD §8.8)
export async function updateEngagementScores(): Promise<void> {
  try {
    await pool.query(
      `UPDATE subdomains SET
        engagement_score = (reply_count * 10) + (open_count * 2)
       WHERE status = 'active'`
    );
  } catch (err: any) {
    console.error('[cron] updateEngagementScores failed:', err.message);
  }
}

// Evaluate domain health — check for retirement triggers (TSD §4.3)
export async function evaluateDomainHealth(): Promise<void> {
  try {
    const domains = await pool.query(
      `SELECT d.id, d.domain, d.status, d.complaint_rate_7d, d.bounce_rate_7d,
              d.postmaster_score, d.retired_at, d.created_at
       FROM domains d WHERE d.status = 'active'`
    );
    for (const row of domains.rows) {
      let reason = '';
      if (row.postmaster_score !== null && row.postmaster_score < 70) {
        // Check consecutive days — simplified: just flag
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
        await pool.query(
          `UPDATE domains SET status = 'flagged', retirement_reason = $1 WHERE id = $2 AND status = 'active'`,
          [reason, row.id]
        );
      }
    }
  } catch (err: any) {
    console.error('[cron] evaluateDomainHealth failed:', err.message);
  }
}

// Run all daily cron jobs (midnight UTC)
export async function runDailyCron(): Promise<void> {
  await resetDailyCounters();
  await suppressNonEngagers();
  await updateEngagementScores();
  await evaluateDomainHealth();
}

// Run hourly engagement score update
export async function runHourlyCron(): Promise<void> {
  await updateEngagementScores();
}
