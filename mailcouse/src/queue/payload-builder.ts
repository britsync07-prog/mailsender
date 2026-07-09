// Build job payload with all fields

import { randomUUID } from 'crypto';
import { JobPayload } from './types';

interface LeadData {
  id: string;
  email: string;
  first_name?: string;
  company?: string;
  industry: string;
  pain_point?: string;
  engagement_score: number;
}

interface SubdomainData {
  id: string;
  subdomain: string;
  sender_name: string;
}

interface IPData {
  id: string;
  ip_address: string;
}

/**
 * Build a complete job payload
 */
export function buildJobPayload(
  lead: LeadData,
  subdomain: SubdomainData,
  ip: IPData,
  templateId: string
): JobPayload {
  return {
    job_id: randomUUID(),
    lead_id: lead.id,
    email: lead.email.toLowerCase().trim(),
    first_name: lead.first_name,
    company: lead.company,
    industry: lead.industry,
    pain_point: lead.pain_point,
    subdomain_id: subdomain.id,
    subdomain: subdomain.subdomain,
    ip_id: ip.id,
    sending_ip: ip.ip_address,
    template_id: templateId,
    sender_name: subdomain.sender_name,
    attempt: 1,
    queued_at: new Date().toISOString(),
  };
}

/**
 * Serialize job payload for Redis
 */
export function serializeJob(payload: JobPayload): string {
  return JSON.stringify(payload);
}

/**
 * Deserialize job payload from Redis
 */
export function deserializeJob(data: string): JobPayload {
  return JSON.parse(data);
}

/**
 * Validate job payload structure
 */
export function validatePayload(payload: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!payload.job_id) errors.push('Missing job_id');
  if (!payload.lead_id) errors.push('Missing lead_id');
  if (!payload.email) errors.push('Missing email');
  if (!payload.subdomain_id) errors.push('Missing subdomain_id');
  if (!payload.subdomain) errors.push('Missing subdomain');
  if (!payload.ip_id) errors.push('Missing ip_id');
  if (!payload.sending_ip) errors.push('Missing sending_ip');
  if (!payload.template_id) errors.push('Missing template_id');
  if (!payload.sender_name) errors.push('Missing sender_name');
  if (!payload.queued_at) errors.push('Missing queued_at');

  // Validate email format
  if (payload.email && !payload.email.includes('@')) {
    errors.push('Invalid email format');
  }

  // Validate attempt number
  if (payload.attempt !== undefined && (payload.attempt < 1 || payload.attempt > 3)) {
    errors.push('Attempt must be between 1 and 3');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
