// Suppression types for Plan 3 — Suppression Check

export type SuppressionReason =
  | 'hard_bounce'
  | 'soft_bounce'
  | 'spam_complaint'
  | 'unsubscribe'
  | 'non_engager'
  | 'manual';

export interface SuppressionEntry {
  id: string;
  email: string;
  reason: SuppressionReason;
  suppressed_at: Date;
  source_subdomain_id?: string;
}

export interface AddSuppressionRequest {
  email: string;
  reason: SuppressionReason;
  source_subdomain_id?: string;
}

export interface SuppressionCheckResult {
  email: string;
  is_suppressed: boolean;
  reason?: SuppressionReason;
  suppressed_at?: Date;
}

export interface BatchSuppressionCheckResult {
  total: number;
  suppressed: number;
  not_suppressed: number;
  results: SuppressionCheckResult[];
  duration_ms: number;
}

export interface SuppressionStats {
  total_suppressed: number;
  by_reason: { reason: string; count: number }[];
  recent_additions: SuppressionEntry[];
}

export interface SuppressionImportResult {
  total_imported: number;
  total_duplicates: number;
  errors: { email: string; error: string }[];
}
