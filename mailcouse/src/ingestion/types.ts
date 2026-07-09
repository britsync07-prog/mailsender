// Lead types and interfaces for Plan 1 — Lead Ingestion

export interface Lead {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  job_title?: string;
  industry: Industry;
  pain_point?: string;
  source: LeadSource;
  validated: boolean;
  validation_result?: ValidationResult;
  status: LeadStatus;
  send_count: number;
  last_sent_at?: Date;
  replied_at?: Date;
  engagement_score: number;
  created_at: Date;
}

export type Industry = 'smart_homes' | 'mortgage' | 'cybersecurity';

export type LeadSource =
  | 'prospeo'
  | 'blitz'
  | 'google_maps'
  | 'disco_like'
  | 'competitor_engagers'
  | 'csv_import'
  | 'manual';

export type ValidationResult =
  | 'valid'
  | 'invalid'
  | 'disposable'
  | 'role_based'
  | 'catch_all';

export type LeadStatus =
  | 'pending'
  | 'queued'
  | 'sent'
  | 'replied'
  | 'bounced'
  | 'suppressed'
  | 'unsubscribed';

export interface LeadImportRequest {
  leads: RawLead[];
  source: LeadSource;
  industry?: Industry; // Override industry for all leads in batch
}

export interface RawLead {
  email: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  job_title?: string;
  industry?: Industry;
  pain_point?: string;
}

export interface ImportResult {
  total_received: number;
  total_imported: number;
  total_duplicates: number;
  total_invalid: number;
  errors: ImportError[];
  imported_leads: Lead[];
}

export interface ImportError {
  email: string;
  reason: string;
  field?: string;
}

export interface ImportBatchLog {
  id: string;
  source: LeadSource;
  industry?: Industry;
  total_received: number;
  total_imported: number;
  total_duplicates: number;
  total_invalid: number;
  started_at: Date;
  completed_at: Date;
  duration_ms: number;
}

export interface LeadDeduplicationResult {
  is_duplicate: boolean;
  existing_lead_id?: string;
  conflict_fields?: string[];
}

export interface FieldValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
