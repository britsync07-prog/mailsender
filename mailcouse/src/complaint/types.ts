// Complaint types and interfaces for Plan 16

export type ComplaintSource = 'gmail' | 'yahoo' | 'outlook' | 'unknown';

export interface ComplaintData {
  complained_address: string;
  source_ip?: string;
  source_domain?: string;
  source: ComplaintSource;
  timestamp: Date;
  subdomain_id?: string;
  job_id?: string;
  original_message_id?: string;
}

export interface ARFNotification {
  complained_address: string;
  source_ip?: string;
  source_domain?: string;
  arrival_date?: string;
  original_headers?: string;
  source: ComplaintSource;
}

export interface ComplaintClassification {
  should_suppress: boolean;
  should_flag_subdomain: boolean;
  should_pause_subdomain: boolean;
  should_retire_domain: boolean;
}

export const COMPLAINT_THRESHOLDS = {
  complaint_rate_threshold: 0.001, // 0.1%
  complaints_to_pause_subdomain: 3,
  domain_retirement_threshold: 0.001, // 0.1%
};

export const COMPLAINT_SOURCES: Record<string, ComplaintSource> = {
  'gmail.com': 'gmail',
  'google.com': 'gmail',
  'yahoo.com': 'yahoo',
  'aol.com': 'yahoo',
  'outlook.com': 'outlook',
  'microsoft.com': 'outlook',
  'hotmail.com': 'outlook',
};
