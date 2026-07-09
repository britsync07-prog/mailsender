// Engagement types for Plan 4 — Engagement Score Check

export type EngagementEventType = 'open' | 'reply' | 'click' | 'bounce' | 'unsubscribe';

export type EngagementPriority = 'high' | 'medium' | 'low';

export interface EngagementEvent {
  id: string;
  lead_id: string;
  subdomain_id?: string;
  event_type: EngagementEventType;
  event_data?: Record<string, any>;
  created_at: Date;
}

export interface EngagementScore {
  lead_id: string;
  score: number;
  reply_rate: number;
  open_rate: number;
  click_rate: number;
  priority: EngagementPriority;
  calculated_at: Date;
}

export interface NonEngagerCheckResult {
  total_checked: number;
  non_engagers_found: number;
  non_engagers_suppressed: number;
  leads_skipped: number;
  duration_ms: number;
}

export interface EngagementStats {
  total_leads: number;
  avg_engagement_score: number;
  high_priority: number;
  medium_priority: number;
  low_priority: number;
  non_engagers: number;
}

export interface TrackingPixelData {
  lead_id: string;
  subdomain_id?: string;
  campaign_id?: string;
  timestamp: Date;
}

export interface ClickTrackingData {
  lead_id: string;
  subdomain_id?: string;
  url: string;
  timestamp: Date;
}

export interface ReplyTrackingData {
  lead_id: string;
  subdomain_id?: string;
  reply_content?: string;
  timestamp: Date;
}
