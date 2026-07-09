// Validation types for Plan 2 — Validation Pipeline

export type ValidationStage =
  | 'syntax'
  | 'mx'
  | 'disposable'
  | 'role_based'
  | 'catch_all'
  | 'smtp_handshake';

export type ValidationResult =
  | 'valid'
  | 'invalid'
  | 'disposable'
  | 'role_based'
  | 'catch_all';

export interface StageResult {
  stage: ValidationStage;
  passed: boolean;
  error?: string;
  duration_ms: number;
}

export interface PipelineResult {
  lead_id: string;
  email: string;
  result: ValidationResult;
  stages: StageResult[];
  total_duration_ms: number;
  mx_records?: MXRecord[];
  catch_all_detected?: boolean;
  smtp_response?: string;
}

export interface BatchValidationResult {
  total: number;
  valid: number;
  invalid: number;
  disposable: number;
  role_based: number;
  catch_all: number;
  results: PipelineResult[];
  total_duration_ms: number;
}

export interface MXRecord {
  priority: number;
  exchange: string;
}

export interface SMTPConfig {
  from_domain: string;
  from_email: string;
  timeout_ms: number;
  max_retries: number;
}
