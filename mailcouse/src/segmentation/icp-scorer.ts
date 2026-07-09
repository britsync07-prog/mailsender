// ICP qualification scoring

import { Industry, ICPQualification, ICPCriteria, INDUSTRY_CLUSTERS } from './types';

/**
 * Score a lead against industry ICP criteria
 */
export function scoreLeadICP(lead: {
  id: string;
  email?: string;
  job_title?: string;
  company?: string;
  industry?: Industry;
}): ICPQualification {
  const industry = lead.industry || 'cybersecurity';
  const cluster = INDUSTRY_CLUSTERS[industry];

  const criteria: ICPCriteria = {
    hasValidEmail: !!lead.email && lead.email.includes('@'),
    hasJobTitle: !!lead.job_title && lead.job_title.length > 0,
    isDecisionMaker: checkDecisionMaker(lead.job_title, industry),
    hasCompany: !!lead.company && lead.company.length > 0,
    companySizeMet: true, // Would need additional data to verify
    industryMatch: !!lead.industry,
  };

  // Calculate score (0-100)
  let score = 0;
  if (criteria.hasValidEmail) score += 20;
  if (criteria.hasJobTitle) score += 15;
  if (criteria.isDecisionMaker) score += 30;
  if (criteria.hasCompany) score += 15;
  if (criteria.companySizeMet) score += 10;
  if (criteria.industryMatch) score += 10;

  // Determine qualification (score >= 60 = qualified)
  const qualified = score >= 60;

  // Generate reason if not qualified
  let reason: string | undefined;
  if (!qualified) {
    const missing: string[] = [];
    if (!criteria.hasValidEmail) missing.push('valid email');
    if (!criteria.isDecisionMaker) missing.push('decision maker title');
    if (!criteria.hasCompany) missing.push('company name');
    reason = `Missing: ${missing.join(', ')}`;
  }

  return {
    lead_id: lead.id,
    industry,
    qualified,
    score,
    criteria,
    reason,
  };
}

/**
 * Check if job title indicates decision maker
 */
function checkDecisionMaker(jobTitle: string | undefined, industry: Industry): boolean {
  if (!jobTitle) return false;

  const lowerTitle = jobTitle.toLowerCase();
  const cluster = INDUSTRY_CLUSTERS[industry];

  // Check against industry-specific keywords
  for (const keyword of cluster.jobTitleKeywords) {
    if (lowerTitle.includes(keyword)) return true;
  }

  // Generic decision maker titles
  const genericDecisionMakers = [
    'owner', 'founder', 'ceo', 'cto', 'cio', 'ciso',
    'president', 'director', 'manager', 'head',
  ];

  for (const title of genericDecisionMakers) {
    if (lowerTitle.includes(title)) return true;
  }

  return false;
}

/**
 * Batch score leads against ICP
 */
export function batchScoreLeads(
  leads: { id: string; email?: string; job_title?: string; company?: string; industry?: Industry }[]
): {
  qualified: number;
  disqualified: number;
  results: ICPQualification[];
} {
  const results = leads.map((lead) => scoreLeadICP(lead));

  return {
    qualified: results.filter((r) => r.qualified).length,
    disqualified: results.filter((r) => !r.qualified).length,
    results,
  };
}

/**
 * Get ICP criteria for an industry
 */
export function getICPCriteria(industry: Industry): {
  industry: Industry;
  requiredCriteria: string[];
  scoringWeights: Record<string, number>;
  passThreshold: number;
} {
  const cluster = INDUSTRY_CLUSTERS[industry];

  return {
    industry,
    requiredCriteria: [
      'Valid email address',
      'Decision maker job title',
      'Company name provided',
      'Industry match confirmed',
    ],
    scoringWeights: {
      valid_email: 20,
      job_title: 15,
      decision_maker: 30,
      company: 15,
      company_size: 10,
      industry_match: 10,
    },
    passThreshold: 60,
  };
}
