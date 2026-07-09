// Counter types for Plan 14

export interface CounterUpdate {
  subdomain_id?: string;
  ip_id?: string;
  lead_id?: string;
  job_id: string;
  timestamp: Date;
}

export interface DailyStats {
  date: string;
  total_sent: number;
  by_domain: { domain: string; count: number }[];
  by_ip: { ip: string; count: number }[];
  by_industry: { industry: string; count: number }[];
}

export interface HourlyRollup {
  hour: number;
  count: number;
}

export interface CounterSnapshot {
  subdomain_id: string;
  emails_sent_today: number;
  total_sent: number;
  captured_at: Date;
}

export const DAILY_TARGET = 100000; // Phase 1
export const SYNC_INTERVAL_MS = 300000; // 5 minutes
