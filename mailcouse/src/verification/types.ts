// Types for email verification and pre-send policy layer

export type VerificationDecision = 'allow' | 'block' | 'review';

export type SuppressionStatus =
  | 'active'
  | 'hard_bounce'
  | 'invalid'
  | 'suppressed'
  | 'unknown';

export interface VerificationResult {
  email: string;
  valid: boolean;
  syntax_valid: boolean;
  has_mx_records: boolean;
  smtp_verified: boolean;
  reachable: 'yes' | 'no' | 'unknown';
  disposable: boolean;
  role_account: boolean;
  free_provider: boolean;
  catch_all: boolean;
  suggestion: string | null;
  decision: VerificationDecision;
  reason: string;
  duration_ms?: number;
}

export interface PreSendVerificationResult {
  email: string;
  decision: VerificationDecision;
  allowed: boolean;
  reason: string;
  source: 'suppression' | 'cache' | 'verifier_api' | 'fallback';
  details?: Partial<VerificationResult>;
  suggestion?: string | null;
  duration_ms: number;
}

export interface SuppressionRecord {
  id?: string;
  email: string;
  reason: string;
  status: SuppressionStatus;
  first_seen: Date;
  last_seen: Date;
  expires_at?: Date | null;
  source_subdomain_id?: string | null;
}

export interface VerifierClientConfig {
  enabled: boolean;
  serviceUrl: string;
  apiKey: string;
  timeoutMs: number;
  failureMode: 'allow' | 'block';
  cacheEnabled: boolean;
  cacheTtlSuccessSec: number;
  cacheTtlNegativeSec: number;
  cacheTtlUnknownSec: number;
}
