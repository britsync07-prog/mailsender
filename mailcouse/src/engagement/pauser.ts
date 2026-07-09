// Subdomain pause/resume logic

import { query } from '../db/connection';

/**
 * Pause a subdomain
 */
export async function pauseSubdomain(
  subdomainId: string,
  reason: string
): Promise<{ success: boolean; message: string }> {
  // Check if subdomain exists and is active
  const result = await query<{ status: string }>(
    'SELECT status FROM subdomains WHERE id = $1',
    [subdomainId]
  );

  if (result.rows.length === 0) {
    return { success: false, message: 'Subdomain not found' };
  }

  if (result.rows[0].status !== 'active') {
    return { success: false, message: `Subdomain is already ${result.rows[0].status}` };
  }

  // Pause the subdomain
  await query(
    "UPDATE subdomains SET status = 'paused' WHERE id = $1",
    [subdomainId]
  );

  // Log the pause event
  await query(
    `INSERT INTO subdomain_events (id, subdomain_id, event_type, reason, created_at)
     VALUES ($1, $2, 'paused', $3, NOW())`,
    [randomUUID(), subdomainId, reason]
  );

  return { success: true, message: `Subdomain paused: ${reason}` };
}

/**
 * Resume a paused subdomain
 */
export async function resumeSubdomain(
  subdomainId: string,
  reason: string
): Promise<{ success: boolean; message: string }> {
  // Check if subdomain exists and is paused
  const result = await query<{ status: string }>(
    'SELECT status FROM subdomains WHERE id = $1',
    [subdomainId]
  );

  if (result.rows.length === 0) {
    return { success: false, message: 'Subdomain not found' };
  }

  if (result.rows[0].status !== 'paused') {
    return { success: false, message: `Subdomain is not paused (current: ${result.rows[0].status})` };
  }

  // Resume the subdomain
  await query(
    "UPDATE subdomains SET status = 'active' WHERE id = $1",
    [subdomainId]
  );

  // Log the resume event
  await query(
    `INSERT INTO subdomain_events (id, subdomain_id, event_type, reason, created_at)
     VALUES ($1, $2, 'resumed', $3, NOW())`,
    [randomUUID(), subdomainId, reason]
  );

  return { success: true, message: `Subdomain resumed: ${reason}` };
}

/**
 * Auto-pause subdomains with low engagement
 */
export async function autoPauseLowEngagement(
  threshold: number = 20,
  minDaysBelowThreshold: number = 14
): Promise<{
  paused: number;
  subdomains: { id: string; subdomain: string; engagement_score: number }[];
}> {
  // Find subdomains below threshold for specified days
  const result = await query<{
    id: string;
    subdomain: string;
    engagement_score: number;
    days_below: number;
  }>(
    `SELECT s.id, s.subdomain, s.engagement_score,
            EXTRACT(DAY FROM NOW() - MIN(sj.sent_at)) as days_below
     FROM subdomains s
     JOIN send_jobs sj ON s.id = sj.subdomain_id
     WHERE s.status = 'active'
       AND s.engagement_score < $1
       AND sj.sent_at >= NOW() - INTERVAL '30 days'
     GROUP BY s.id, s.subdomain, s.engagement_score
     HAVING EXTRACT(DAY FROM NOW() - MIN(sj.sent_at)) >= $2`,
    [threshold, minDaysBelowThreshold]
  );

  const toPause = result.rows;
  let paused = 0;

  for (const subdomain of toPause) {
    const pauseResult = await pauseSubdomain(
      subdomain.id,
      `Auto-paused: engagement score ${subdomain.engagement_score} below threshold for ${subdomain.days_below} days`
    );
    if (pauseResult.success) paused++;
  }

  return {
    paused,
    subdomains: toPause.map((r) => ({
      id: r.id,
      subdomain: r.subdomain,
      engagement_score: r.engagement_score,
    })),
  };
}

/**
 * Get pause/resume statistics
 */
export async function getPauseStats(): Promise<{
  total_active: number;
  total_paused: number;
  recently_paused: { subdomain: string; reason: string; paused_at: Date }[];
}> {
  const activeResult = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM subdomains WHERE status = 'active'"
  );

  const pausedResult = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM subdomains WHERE status = 'paused'"
  );

  const recentResult = await query<{ subdomain: string; reason: string; created_at: Date }>(
    `SELECT s.subdomain, se.reason, se.created_at
     FROM subdomain_events se
     JOIN subdomains s ON se.subdomain_id = s.id
     WHERE se.event_type = 'paused'
     ORDER BY se.created_at DESC
     LIMIT 10`
  );

  return {
    total_active: parseInt(String(activeResult.rows[0]?.count || '0')),
    total_paused: parseInt(String(pausedResult.rows[0]?.count || '0')),
    recently_paused: recentResult.rows.map((r) => ({
      subdomain: r.subdomain,
      reason: r.reason,
      paused_at: r.created_at,
    })),
  };
}

function randomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
