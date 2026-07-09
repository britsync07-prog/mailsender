// Engagement score calculation

import { query } from '../db/connection';
import { EngagementScore, EngagementPriority } from './types';

/**
 * Calculate engagement score for a single lead
 * Formula: (reply_rate × 10) + (open_rate × 2)
 * Score range: 0-100
 */
export function calculateScore(
  sends: number,
  replies: number,
  opens: number,
  clicks: number
): { score: number; reply_rate: number; open_rate: number; click_rate: number } {
  if (sends === 0) {
    return { score: 0, reply_rate: 0, open_rate: 0, click_rate: 0 };
  }

  const reply_rate = Math.min(replies / sends, 1);
  const open_rate = Math.min(opens / sends, 1);
  const click_rate = Math.min(clicks / sends, 1);

  // Score formula: (reply_rate × 10) + (open_rate × 2)
  // Normalize to 0-100 scale
  const rawScore = (reply_rate * 10) + (open_rate * 2);
  const score = Math.min(Math.round(rawScore * 10), 100);

  return { score, reply_rate, open_rate, click_rate };
}

/**
 * Determine engagement priority based on score
 */
export function getPriority(score: number): EngagementPriority {
  if (score > 50) return 'high';
  if (score >= 20) return 'medium';
  return 'low';
}

/**
 * Calculate and update engagement score for a lead
 */
export async function calculateAndUpdateLeadScore(
  leadId: string
): Promise<EngagementScore | null> {
  // Get lead stats
  const leadResult = await query<{
    send_count: number;
    reply_count: number;
    open_count: number;
    click_count: number;
  }>(
    `SELECT send_count, reply_count, open_count,
            COALESCE(click_count, 0) as click_count
     FROM leads WHERE id = $1`,
    [leadId]
  );

  if (leadResult.rows.length === 0) return null;

  const lead = leadResult.rows[0];
  const { score, reply_rate, open_rate, click_rate } = calculateScore(
    lead.send_count,
    lead.reply_count,
    lead.open_count,
    lead.click_count
  );

  const priority = getPriority(score);

  // Update lead's engagement score
  await query(
    'UPDATE leads SET engagement_score = $1 WHERE id = $2',
    [score, leadId]
  );

  return {
    lead_id: leadId,
    score,
    reply_rate,
    open_rate,
    click_rate,
    priority,
    calculated_at: new Date(),
  };
}

/**
 * Batch calculate engagement scores for all leads
 */
export async function batchCalculateScores(): Promise<{
  total: number;
  high: number;
  medium: number;
  low: number;
  duration_ms: number;
}> {
  const startTime = Date.now();

  // Get all leads that have been sent at least once
  const leadsResult = await query<{ id: string }>(
    'SELECT id FROM leads WHERE send_count > 0'
  );

  let high = 0;
  let medium = 0;
  let low = 0;

  for (const lead of leadsResult.rows) {
    const score = await calculateAndUpdateLeadScore(lead.id);
    if (score) {
      switch (score.priority) {
        case 'high': high++; break;
        case 'medium': medium++; break;
        case 'low': low++; break;
      }
    }
  }

  return {
    total: leadsResult.rows.length,
    high,
    medium,
    low,
    duration_ms: Date.now() - startTime,
  };
}

/**
 * Get engagement score for a lead
 */
export async function getLeadScore(leadId: string): Promise<EngagementScore | null> {
  const result = await query<{
    engagement_score: number;
    send_count: number;
    reply_count: number;
    open_count: number;
    click_count: number;
  }>(
    `SELECT engagement_score, send_count, reply_count, open_count,
            COALESCE(click_count, 0) as click_count
     FROM leads WHERE id = $1`,
    [leadId]
  );

  if (result.rows.length === 0) return null;

  const lead = result.rows[0];
  const { reply_rate, open_rate, click_rate } = calculateScore(
    lead.send_count,
    lead.reply_count,
    lead.open_count,
    lead.click_count
  );

  return {
    lead_id: leadId,
    score: lead.engagement_score,
    reply_rate,
    open_rate,
    click_rate,
    priority: getPriority(lead.engagement_score),
    calculated_at: new Date(),
  };
}
