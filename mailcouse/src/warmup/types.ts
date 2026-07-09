// Warmup state types for Plan 8

export type WarmupStatus = 'provisioning' | 'warming' | 'active' | 'paused' | 'retired';

export interface WarmupState {
  subdomain_id: string;
  status: WarmupStatus;
  warmup_started_at?: Date;
  warmup_complete: boolean;
  postmaster_score?: number;
  complaint_count: number;
  bounce_rate: number;
  daily_limit: number;
  emails_sent_today: number;
}

export interface WarmupGateCheck {
  subdomain_id: string;
  passed: boolean;
  criteria: WarmupCriteria;
  reason?: string;
}

export interface WarmupCriteria {
  warmup_complete: boolean;
  postmaster_score_ok: boolean;
  no_complaints: boolean;
  bounce_rate_ok: boolean;
}

export interface WarmupSchedule {
  week: number;
  emails_per_smtp_per_day: number;
  total_per_domain_per_day: number;
}

export interface WarmupServiceConfig {
  provider: 'warmbox' | 'mailreach';
  api_key: string;
  api_url: string;
}

export interface WarmupServiceStatus {
  connected: boolean;
  smtps_connected: number;
  smtps_total: number;
  last_check: Date;
}

export const WARMUP_SCHEDULE: WarmupSchedule[] = [
  { week: 1, emails_per_smtp_per_day: 2, total_per_domain_per_day: 400 },
  { week: 2, emails_per_smtp_per_day: 2, total_per_domain_per_day: 400 },
  { week: 3, emails_per_smtp_per_day: 5, total_per_domain_per_day: 1000 },
  { week: 4, emails_per_smtp_per_day: 5, total_per_domain_per_day: 1000 },
];

export const WARMUP_CRITERIA = {
  postmaster_score_threshold: 70,
  postmaster_score_extend: 60,
  max_complaints: 0,
  max_bounce_rate: 0.01, // 1%
  min_warmup_weeks: 4,
};
