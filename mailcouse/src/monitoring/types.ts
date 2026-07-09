// Monitoring types for Plan 19

export type AlertSeverity = 'critical' | 'warning' | 'info';

export type HealthStatus = 'healthy' | 'warning' | 'critical';

export interface Alert {
  id: string;
  severity: AlertSeverity;
  metric: string;
  domain?: string;
  ip?: string;
  current_value: number;
  threshold: number;
  message: string;
  timestamp: Date;
  acknowledged: boolean;
}

export interface DomainHealth {
  domain_id: string;
  domain: string;
  postmaster_score: number | null;
  complaint_rate_7d: number;
  bounce_rate_7d: number;
  status: string;
  last_checked: Date;
}

export interface IPHealth {
  ip_id: string;
  ip_address: string;
  blacklisted: boolean;
  last_check: Date;
  status: string;
}

export interface SystemHealth {
  overall_status: HealthStatus;
  domains: DomainHealth[];
  ips: IPHealth[];
  queue_depth: number;
  active_workers: number;
  daily_volume: number;
  daily_target: number;
}

export const ALERT_THRESHOLDS = {
  postmaster_score_warning: 70,
  postmaster_score_critical: 60,
  complaint_rate_threshold: 0.001, // 0.1%
  bounce_rate_threshold: 0.03, // 3%
  reserve_ip_minimum: 5,
  daily_volume_deviation: 0.2, // 20%
  domain_expiry_days: 30,
};
