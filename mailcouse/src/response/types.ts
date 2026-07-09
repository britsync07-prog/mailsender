// Response types and interfaces for Plan 13

export type ResponseCategory = 'success' | 'soft_fail' | 'hard_fail' | 'unknown';

export interface ParsedResponse {
  code: number;
  message: string;
  enhanced_code?: string;
  category: ResponseCategory;
}

export interface RetryPolicy {
  max_attempts: number;
  backoff_delays_ms: number[];
  job_ttl_hours: number;
}

export interface DeadLetterJob {
  job_id: string;
  lead_id: string;
  email: string;
  last_response_code: number;
  last_response_message: string;
  attempt_count: number;
  moved_at: Date;
  reason: string;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  max_attempts: 3,
  backoff_delays_ms: [300000, 900000, 2700000], // 5min, 15min, 45min
  job_ttl_hours: 72,
};

export const RESPONSE_CODE_MAP: Record<number, ResponseCategory> = {
  250: 'success',
  251: 'success',
  252: 'success',
  421: 'soft_fail',
  450: 'soft_fail',
  451: 'soft_fail',
  452: 'soft_fail',
  550: 'hard_fail',
  551: 'hard_fail',
  553: 'hard_fail',
  554: 'hard_fail',
};
