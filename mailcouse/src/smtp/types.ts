// SMTP types and interfaces for Plan 12

export interface SMTPConfig {
  port: number;
  timeout_ms: number;
  max_retries: number;
  retry_delays_ms: number[];
  max_concurrent_per_ip: number;
  require_tls: boolean;
}

export interface SMTPConnection {
  host: string;
  port: number;
  secure: boolean;
  ip_id: string;
  ip_address: string;
  connected_at: Date;
  last_used: Date;
  is_healthy: boolean;
}

export interface SMTPSendResult {
  success: boolean;
  response_code: number;
  response_message: string;
  retry: boolean;
  should_suppress?: boolean;
  backoff_seconds?: number;
  error?: string;
  duration_ms: number;
}

export interface SMTPSessionLog {
  job_id: string;
  from: string;
  to: string;
  subdomain: string;
  ip_address: string;
  connected_at: Date;
  sent_at?: Date;
  response_code?: number;
  response_message?: string;
  error?: string;
  duration_ms: number;
  bytes_sent?: number;
}

export interface MXRecord {
  priority: number;
  exchange: string;
}

export const DEFAULT_SMTP_CONFIG: SMTPConfig = {
  port: 587,
  timeout_ms: 10000,
  max_retries: 3,
  retry_delays_ms: [300000, 900000, 2700000], // 5min, 15min, 45min
  max_concurrent_per_ip: 10,
  require_tls: true,
};

export const SMTP_RESPONSE_CODES = {
  SUCCESS: [250, 251, 252],
  SOFT_FAIL: [421, 450, 451, 452],
  HARD_FAIL: [550, 551, 553, 554],
  AUTH_REQUIRED: [530, 535],
};
