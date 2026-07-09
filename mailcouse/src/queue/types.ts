// Job payload types

export type JobStatus = 'queued' | 'processing' | 'sent' | 'failed' | 'suppressed' | 'dead';

export interface JobPayload {
  job_id: string;
  lead_id: string;
  email: string;
  first_name?: string;
  company?: string;
  industry: string;
  pain_point?: string;
  subdomain_id: string;
  subdomain: string;
  ip_id: string;
  sending_ip: string;
  template_id: string;
  sender_name: string;
  attempt: number;
  queued_at: string;
  scheduled_at?: string;
  thread_id?: string;
  in_reply_to?: string;
  references?: string[];
}

export interface SendJob {
  id: string;
  lead_id: string;
  subdomain_id: string;
  ip_id: string;
  template_id: string;
  status: JobStatus;
  attempt_count: number;
  smtp_response?: string;
  queued_at: Date;
  scheduled_at?: Date;
  sent_at?: Date;
  failed_at?: Date;
}

export interface SubdomainAssignment {
  id: string;
  domain_id: string;
  subdomain: string;
  sender_name: string;
  warmup_complete: boolean;
  warmup_started_at?: Date;
  daily_limit: number;
  emails_sent_today: number;
  dns_verified: boolean;
  engagement_score: number;
}

export interface IPAssignment {
  id: string;
  ip_address: string;
  vds_server_id: string;
  status: 'active' | 'reserve' | 'blacklisted' | 'retired';
  blacklisted: boolean;
  priority: number;
  emails_today: number;
}

export interface ScheduleConfig {
  timezone: string;
  send_window_start: number;
  send_window_end: number;
  send_days: number[];
  delay_between_sends: { min: number; max: number };
}

export interface JobCreationResult {
  total_leads: number;
  jobs_created: number;
  jobs_failed: number;
  by_industry: Record<string, number>;
  errors: { lead_id: string; error: string }[];
  duration_ms: number;
}

export const DEFAULT_SCHEDULE_CONFIG: ScheduleConfig = {
  timezone: 'America/New_York',
  send_window_start: 9,
  send_window_end: 17,
  send_days: [1, 2, 3, 4, 5],
  delay_between_sends: { min: 90, max: 140 },
};
