// Lead-to-industry assignment

import { query } from '../db/connection';
import { Industry, INDUSTRY_CLUSTERS } from './types';

/**
 * Determine industry for a lead based on multiple signals
 */
export function determineIndustry(lead: {
  industry?: string;
  job_title?: string;
  company?: string;
  email?: string;
}): Industry {
  // Primary: explicit industry field
  if (lead.industry && isValidIndustry(lead.industry)) {
    return lead.industry as Industry;
  }

  // Secondary: job title keyword matching
  if (lead.job_title) {
    const industryFromTitle = matchJobTitle(lead.job_title);
    if (industryFromTitle) return industryFromTitle;
  }

  // Tertiary: company name keyword matching
  if (lead.company) {
    const industryFromCompany = matchCompanyName(lead.company);
    if (industryFromCompany) return industryFromCompany;
  }

  // Default: cybersecurity (B2B default)
  return 'cybersecurity';
}

/**
 * Match job title to industry
 */
function matchJobTitle(jobTitle: string): Industry | null {
  const lowerTitle = jobTitle.toLowerCase();

  // Check mortgage keywords first (more specific)
  const mortgageKeywords = ['mortgage', 'loan', 'originator', 'underwriter', 'real estate agent'];
  for (const keyword of mortgageKeywords) {
    if (lowerTitle.includes(keyword)) return 'mortgage';
  }

  // Check smart homes keywords
  const smartHomeKeywords = ['contractor', 'installer', 'electrician', 'builder', 'hvac'];
  for (const keyword of smartHomeKeywords) {
    if (lowerTitle.includes(keyword)) return 'smart_homes';
  }

  // Check cybersecurity keywords
  const cyberKeywords = ['ciso', 'cto', 'cio', 'security', 'it director', 'network'];
  for (const keyword of cyberKeywords) {
    if (lowerTitle.includes(keyword)) return 'cybersecurity';
  }

  return null;
}

/**
 * Match company name to industry
 */
function matchCompanyName(companyName: string): Industry | null {
  const lowerCompany = companyName.toLowerCase();

  // Check mortgage keywords
  const mortgageKeywords = ['mortgage', 'lending', 'loan', 'real estate', 'property'];
  for (const keyword of mortgageKeywords) {
    if (lowerCompany.includes(keyword)) return 'mortgage';
  }

  // Check smart homes keywords
  const smartHomeKeywords = ['smart home', 'automation', 'security system', 'audio video', 'electrical'];
  for (const keyword of smartHomeKeywords) {
    if (lowerCompany.includes(keyword)) return 'smart_homes';
  }

  // Check cybersecurity keywords
  const cyberKeywords = ['security', 'cyber', 'infosec', 'technology', 'software', 'saas'];
  for (const keyword of cyberKeywords) {
    if (lowerCompany.includes(keyword)) return 'cybersecurity';
  }

  return null;
}

/**
 * Check if string is a valid industry
 */
export function isValidIndustry(industry: string): boolean {
  return ['smart_homes', 'mortgage', 'cybersecurity'].includes(industry);
}

/**
 * Assign industry to a lead and update database
 */
export async function assignLeadIndustry(
  leadId: string,
  industry: Industry
): Promise<void> {
  await query(
    'UPDATE leads SET industry = $1 WHERE id = $2',
    [industry, leadId]
  );
}

/**
 * Batch assign industries to leads
 */
export async function batchAssignIndustries(
  leads: { id: string; industry?: string; job_title?: string; company?: string }[]
): Promise<{ assigned: number; by_industry: Record<Industry, number> }> {
  const byIndustry: Record<Industry, number> = {
    smart_homes: 0,
    mortgage: 0,
    cybersecurity: 0,
  };

  for (const lead of leads) {
    const industry = determineIndustry(lead);
    await assignLeadIndustry(lead.id, industry);
    byIndustry[industry]++;
  }

  return {
    assigned: leads.length,
    by_industry: byIndustry,
  };
}

/**
 * Get industry distribution
 */
export async function getIndustryDistribution(): Promise<{
  total: number;
  by_industry: { industry: string; count: number; percentage: number }[];
}> {
  const result = await query<{ industry: string; count: number }>(
    'SELECT industry, COUNT(*) as count FROM leads GROUP BY industry ORDER BY count DESC'
  );

  const total = result.rows.reduce((sum, r) => sum + parseInt(String(r.count)), 0);

  return {
    total,
    by_industry: result.rows.map((r) => ({
      industry: r.industry,
      count: parseInt(String(r.count)),
      percentage: total > 0 ? Math.round((parseInt(String(r.count)) / total) * 100) : 0,
    })),
  };
}
