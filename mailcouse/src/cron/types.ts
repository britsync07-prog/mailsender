// Cron types and interfaces — full TSD §16.3 schedule

export type CronJobName =
  | 'midnight_reset'
  | 'ip_blacklist_check'
  | 'postmaster_pull'
  | 'yahoo_postmaster_pull'
  | 'microsoft_snds_pull'
  | 'domain_health_eval'
  | 'warmup_health'
  | 'reserve_pool_check'
  | 'suppression_backup'
  | 'rdp_heartbeat'
  | 'weekly_report'
  | 'dead_letter_review'
  | 'domain_expiry_check'
  | 'daily_report';

export interface CronJobConfig {
  name: CronJobName;
  schedule: string;
  description: string;
  enabled: boolean;
}

export interface CronJobResult {
  job_name: CronJobName;
  started_at: Date;
  completed_at: Date;
  success: boolean;
  duration_ms: number;
  message: string;
}

export interface DailyReportData {
  date: string;
  total_sent: number;
  target: number;
  percentage: number;
  by_domain: { domain: string; sent: number }[];
  by_ip: { ip: string; sent: number }[];
  by_industry: { industry: string; sent: number }[];
  bounce_rate: number;
  complaint_rate: number;
  reply_rate: number;
  suppression_additions: number;
  blacklisted_ips: number;
  retired_domains: number;
  dead_letter_count: number;
}

export const CRON_SCHEDULES: CronJobConfig[] = [
  { name: 'midnight_reset', schedule: '0 0 * * *', description: 'Reset daily send counters to 0', enabled: true },
  { name: 'ip_blacklist_check', schedule: '0 */6 * * *', description: 'MXToolbox check all active IPs', enabled: true },
  { name: 'postmaster_pull', schedule: '0 6 * * *', description: 'Pull Gmail Postmaster scores for all domains', enabled: true },
  { name: 'yahoo_postmaster_pull', schedule: '30 6 * * *', description: 'Pull Yahoo complaint data', enabled: true },
  { name: 'microsoft_snds_pull', schedule: '0 7 * * *', description: 'Pull Microsoft SNDS complaint data', enabled: true },
  { name: 'domain_health_eval', schedule: '0 8 * * *', description: 'Evaluate retirement triggers on all active domains', enabled: true },
  { name: 'warmup_health', schedule: '*/15 * * * *', description: 'Verify all SMTPs connected to warmup service', enabled: true },
  { name: 'reserve_pool_check', schedule: '0 */4 * * *', description: 'Alert if reserve IP pool below 5 clean IPs', enabled: true },
  { name: 'suppression_backup', schedule: '0 2 * * *', description: 'Encrypted backup of suppression list', enabled: true },
  { name: 'rdp_heartbeat', schedule: '* * * * *', description: 'Alert if any RDP misses 3 consecutive heartbeats', enabled: true },
  { name: 'weekly_report', schedule: '0 9 * * 1', description: 'Generate per-cluster engagement report', enabled: true },
  { name: 'dead_letter_review', schedule: '0 8 * * *', description: 'Alert if dead letter queue non-empty', enabled: true },
  { name: 'domain_expiry_check', schedule: '0 10 * * *', description: 'Alert on domain expiring within 30 days', enabled: true },
  { name: 'daily_report', schedule: '5 0 * * *', description: 'Generate daily volume report', enabled: true },
];
