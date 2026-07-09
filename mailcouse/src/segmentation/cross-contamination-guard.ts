// Isolation enforcement - prevent cross-industry contamination

import { query } from '../db/connection';
import { Industry, CrossContaminationCheck } from './types';
import { getDomainIndustry } from './domain-pools';

/**
 * Check if a lead can be sent from a domain (industry match)
 */
export async function checkCrossContamination(
  leadId: string,
  domainId: string
): Promise<CrossContaminationCheck> {
  // Get lead's industry
  const leadResult = await query<{ id: string; industry: Industry; email: string }>(
    'SELECT id, industry, email FROM leads WHERE id = $1',
    [leadId]
  );

  if (leadResult.rows.length === 0) {
    return {
      lead_id: leadId,
      lead_industry: 'cybersecurity',
      domain: '',
      domain_industry: null,
      is_safe: false,
      reason: 'Lead not found',
    };
  }

  const lead = leadResult.rows[0];

  // Get domain's industry
  const domainResult = await query<{ id: string; domain: string; industry: Industry }>(
    'SELECT id, domain, industry FROM industry_domain_pools WHERE id = $1',
    [domainId]
  );

  if (domainResult.rows.length === 0) {
    return {
      lead_id: leadId,
      lead_industry: lead.industry,
      domain: '',
      domain_industry: null,
      is_safe: false,
      reason: 'Domain not found in pool',
    };
  }

  const domain = domainResult.rows[0];

  // Check if industries match
  const isSafe = lead.industry === domain.industry;

  return {
    lead_id: leadId,
    lead_industry: lead.industry,
    domain: domain.domain,
    domain_industry: domain.industry,
    is_safe: isSafe,
    reason: isSafe ? undefined : `Industry mismatch: lead=${lead.industry}, domain=${domain.industry}`,
  };
}

/**
 * Validate a batch of lead-domain assignments
 */
export async function validateBatchAssignments(
  assignments: { lead_id: string; domain_id: string }[]
): Promise<{
  valid: number;
  invalid: number;
  violations: CrossContaminationCheck[];
}> {
  const violations: CrossContaminationCheck[] = [];
  let valid = 0;
  let invalid = 0;

  for (const assignment of assignments) {
    const check = await checkCrossContamination(assignment.lead_id, assignment.domain_id);
    if (check.is_safe) {
      valid++;
    } else {
      invalid++;
      violations.push(check);
    }
  }

  return { valid, invalid, violations };
}

/**
 * Check if an email has been sent under multiple industries
 */
export async function checkEmailIndustryConflict(
  email: string
): Promise<{
  has_conflict: boolean;
  industries: Industry[];
  lead_ids: string[];
}> {
  const result = await query<{ id: string; industry: Industry }>(
    'SELECT id, industry FROM leads WHERE email = $1',
    [email.toLowerCase().trim()]
  );

  const industries = [...new Set(result.rows.map((r) => r.industry))];
  const leadIds = result.rows.map((r) => r.id);

  return {
    has_conflict: industries.length > 1,
    industries,
    lead_ids: leadIds,
  };
}

/**
 * Get cross-contamination statistics
 */
export async function getContaminationStats(): Promise<{
  total_leads: number;
  leads_per_industry: { industry: Industry; count: number }[];
  domains_per_industry: { industry: Industry; count: number }[];
  potential_conflicts: number;
}> {
  const leadsResult = await query<{ industry: Industry; count: number }>(
    'SELECT industry, COUNT(*) as count FROM leads GROUP BY industry'
  );

  const domainsResult = await query<{ industry: Industry; count: number }>(
    'SELECT industry, COUNT(*) as count FROM industry_domain_pools GROUP BY industry'
  );

  // Check for emails that appear in multiple industries
  const conflictsResult = await query<{ count: number }>(
    `SELECT COUNT(*) as count FROM (
      SELECT email FROM leads GROUP BY email HAVING COUNT(DISTINCT industry) > 1
    ) conflicts`
  );

  return {
    total_leads: leadsResult.rows.reduce((sum, r) => sum + parseInt(String(r.count)), 0),
    leads_per_industry: leadsResult.rows.map((r) => ({
      industry: r.industry,
      count: parseInt(String(r.count)),
    })),
    domains_per_industry: domainsResult.rows.map((r) => ({
      industry: r.industry,
      count: parseInt(String(r.count)),
    })),
    potential_conflicts: parseInt(String(conflictsResult.rows[0]?.count || '0')),
  };
}

/**
 * Alert on contamination attempt
 */
export async function alertContamination(
  check: CrossContaminationCheck
): Promise<void> {
  // Log the contamination attempt
  console.error(`CONTAMINATION ALERT: ${check.reason}`);

  // In production, this would send Telegram/Slack alert
  // For now, just log
  await query(
    `INSERT INTO contamination_alerts (lead_id, lead_industry, domain, domain_industry, detected_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [check.lead_id, check.lead_industry, check.domain, check.domain_industry]
  );
}
