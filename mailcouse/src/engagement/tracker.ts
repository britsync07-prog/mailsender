// Open/reply/click tracking

import { randomUUID } from 'crypto';
import { query } from '../db/connection';
import { EngagementEventType, EngagementEvent, TrackingPixelData, ClickTrackingData, ReplyTrackingData } from './types';

/**
 * Record an engagement event
 */
export async function recordEvent(
  eventType: EngagementEventType,
  leadId: string,
  subdomainId?: string,
  eventData?: Record<string, any>
): Promise<EngagementEvent> {
  const id = randomUUID();

  const result = await query<EngagementEvent>(
    `INSERT INTO engagement_events (id, lead_id, subdomain_id, event_type, event_data, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING *`,
    [id, leadId, subdomainId || null, eventType, eventData ? JSON.stringify(eventData) : null]
  );

  // Update lead counters
  await updateLeadCounters(leadId, eventType);

  return result.rows[0];
}

/**
 * Update lead engagement counters
 */
async function updateLeadCounters(
  leadId: string,
  eventType: EngagementEventType
): Promise<void> {
  switch (eventType) {
    case 'open':
      await query(
        'UPDATE leads SET open_count = open_count + 1 WHERE id = $1',
        [leadId]
      );
      break;
    case 'reply':
      await query(
        `UPDATE leads SET reply_count = reply_count + 1, replied_at = COALESCE(replied_at, NOW()) WHERE id = $1`,
        [leadId]
      );
      break;
    case 'click':
      await query(
        'UPDATE leads SET click_count = COALESCE(click_count, 0) + 1 WHERE id = $1',
        [leadId]
      );
      break;
  }
}

/**
 * Track email open via pixel
 */
export async function trackOpen(data: TrackingPixelData): Promise<void> {
  await recordEvent('open', data.lead_id, data.subdomain_id, {
    campaign_id: data.campaign_id,
    user_agent: undefined, // Would be set from HTTP request
  });
}

/**
 * Track reply
 */
export async function trackReply(data: ReplyTrackingData): Promise<void> {
  await recordEvent('reply', data.lead_id, data.subdomain_id, {
    reply_content: data.reply_content,
  });
}

/**
 * Track click
 */
export async function trackClick(data: ClickTrackingData): Promise<void> {
  await recordEvent('click', data.lead_id, data.subdomain_id, {
    url: data.url,
  });
}

/**
 * Get engagement events for a lead
 */
export async function getLeadEvents(
  leadId: string,
  limit: number = 100
): Promise<EngagementEvent[]> {
  const result = await query<EngagementEvent>(
    `SELECT * FROM engagement_events
     WHERE lead_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [leadId, limit]
  );

  return result.rows;
}

/**
 * Get engagement events by type
 */
export async function getEventsByType(
  eventType: EngagementEventType,
  startDate?: Date,
  endDate?: Date
): Promise<EngagementEvent[]> {
  let whereClause = 'WHERE event_type = $1';
  const params: any[] = [eventType];

  if (startDate) {
    whereClause += ' AND created_at >= $' + (params.length + 1);
    params.push(startDate);
  }
  if (endDate) {
    whereClause += ' AND created_at <= $' + (params.length + 1);
    params.push(endDate);
  }

  const result = await query<EngagementEvent>(
    `SELECT * FROM engagement_events ${whereClause} ORDER BY created_at DESC`,
    params
  );

  return result.rows;
}

/**
 * Generate tracking pixel URL
 */
export function generateTrackingPixelUrl(
  leadId: string,
  subdomainId?: string
): string {
  const baseUrl = process.env.TRACKING_BASE_URL || 'https://track.example.com';
  const params = new URLSearchParams({ lid: leadId });
  if (subdomainId) params.append('sid', subdomainId);
  return `${baseUrl}/pixel.gif?${params.toString()}`;
}

/**
 * Generate click tracking URL
 */
export function generateClickTrackingUrl(
  originalUrl: string,
  leadId: string,
  subdomainId?: string
): string {
  const baseUrl = process.env.TRACKING_BASE_URL || 'https://track.example.com';
  const params = new URLSearchParams({
    url: originalUrl,
    lid: leadId,
  });
  if (subdomainId) params.append('sid', subdomainId);
  return `${baseUrl}/click?${params.toString()}`;
}
