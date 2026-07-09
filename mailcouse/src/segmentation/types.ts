// Industry segmentation types for Plan 5

export type Industry = 'smart_homes' | 'mortgage' | 'cybersecurity';

export interface IndustryCluster {
  id: Industry;
  name: string;
  description: string;
  targetDomains: number; // Phase 1 allocation
  targetLeads: string[];
  jobTitleKeywords: string[];
  companyKeywords: string[];
  painPoints: string[];
}

export interface DomainPool {
  id: string;
  industry: Industry;
  domain: string;
  status: 'active' | 'warming' | 'paused' | 'retired';
  assigned_at: Date;
}

export interface ICPQualification {
  lead_id: string;
  industry: Industry;
  qualified: boolean;
  score: number;
  criteria: ICPCriteria;
  reason?: string;
}

export interface ICPCriteria {
  hasValidEmail: boolean;
  hasJobTitle: boolean;
  isDecisionMaker: boolean;
  hasCompany: boolean;
  companySizeMet: boolean;
  industryMatch: boolean;
}

export interface CrossContaminationCheck {
  lead_id: string;
  lead_industry: Industry;
  domain: string;
  domain_industry: Industry | null;
  is_safe: boolean;
  reason?: string;
}

export interface IndustryPerformance {
  industry: Industry;
  total_leads: number;
  qualified_leads: number;
  total_sent: number;
  bounce_rate: number;
  complaint_rate: number;
  reply_rate: number;
}

export const INDUSTRY_CLUSTERS: Record<Industry, IndustryCluster> = {
  smart_homes: {
    id: 'smart_homes',
    name: 'Smart Homes',
    description: 'Homeowners, contractors, smart home installers, property developers',
    targetDomains: 17,
    targetLeads: ['homeowner', 'contractor', 'installer', 'developer', 'builder'],
    jobTitleKeywords: [
      'owner', 'manager', 'director', 'president', 'ceo', 'cto',
      'contractor', 'installer', 'electrician', 'builder', 'developer',
      'architect', 'engineer', 'technician', 'specialist',
    ],
    companyKeywords: [
      'home', 'smart', 'automation', 'security', 'audio', 'video',
      'lighting', 'hvac', 'electrical', 'construction', 'real estate',
      'property', 'building', 'residential',
    ],
    painPoints: [
      'high customer acquisition cost',
      'low lead quality',
      'difficult to reach decision makers',
      'competitive market',
      'long sales cycles',
    ],
  },
  mortgage: {
    id: 'mortgage',
    name: 'Mortgage',
    description: 'Mortgage brokers, loan officers, real estate agents, financial advisors',
    targetDomains: 17,
    targetLeads: ['broker', 'loan officer', 'real estate agent', 'financial advisor'],
    jobTitleKeywords: [
      'broker', 'loan officer', 'agent', 'advisor', 'consultant',
      'manager', 'director', 'president', 'ceo', 'originator',
      'underwriter', 'processor', 'closer', 'account executive',
    ],
    companyKeywords: [
      'mortgage', 'lending', 'loan', 'finance', 'financial',
      'real estate', 'property', 'home', 'bank', 'credit',
      'insurance', 'investment', 'wealth',
    ],
    painPoints: [
      'high customer acquisition cost',
      'regulatory compliance burden',
      'competition from online lenders',
      'lead quality issues',
      'difficult to differentiate',
    ],
  },
  cybersecurity: {
    id: 'cybersecurity',
    name: 'Cybersecurity',
    description: 'IT managers, CISOs, CTOs, security directors at 50+ employee companies',
    targetDomains: 16,
    targetLeads: ['IT manager', 'CISO', 'CTO', 'security director'],
    jobTitleKeywords: [
      'ciso', 'cto', 'cio', 'it director', 'security director',
      'security manager', 'security analyst', 'security engineer',
      'network administrator', 'it manager', 'infrastructure',
      'compliance', 'risk', 'governance',
    ],
    companyKeywords: [
      'security', 'cyber', 'infosec', 'network', 'technology',
      'software', 'saas', 'cloud', 'data', 'privacy',
      'compliance', 'consulting', 'managed services',
    ],
    painPoints: [
      'constant threat landscape',
      'talent shortage',
      'budget constraints',
      'compliance requirements',
      'vendor consolidation',
    ],
  },
};
