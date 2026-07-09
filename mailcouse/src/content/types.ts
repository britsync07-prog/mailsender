// Content types and interfaces for Plan 10

export type EmailFormat = 'plain' | 'html';
export type LengthTier = 'short' | 'medium' | 'long';

export interface Template {
  id: string;
  name: string;
  industry: string;
  subject_spintax: string;
  body_spintax: string;
  format: EmailFormat;
  length_tier: LengthTier;
  version: number;
  created_at: Date;
}

export interface RenderedEmail {
  subject: string;
  body: string;
  format: EmailFormat;
  from_name: string;
  tracking_url?: string;
  variation_id: string;
}

export interface PersonalizationTokens {
  first_name?: string;
  company_name?: string;
  industry?: string;
  pain_point?: string;
  [key: string]: string | undefined;
}

export interface SpamCheckResult {
  passed: boolean;
  violations: string[];
  suggestions: string[];
}

export interface ContentVariation {
  id: string;
  template_id: string;
  subject: string;
  body: string;
  format: EmailFormat;
  created_at: Date;
}

// Length tier word counts
export const LENGTH_TIERS: Record<LengthTier, { min: number; max: number }> = {
  short: { min: 50, max: 100 },
  medium: { min: 100, max: 200 },
  long: { min: 200, max: 300 },
};

// Signature variations
export const SIGNATURES = [
  'Best',
  'Best regards',
  'Regards',
  'Thanks',
  'Thank you',
  'Cheers',
  'Sincerely',
  'Warm regards',
  'Kind regards',
  'All the best',
];

// Opening line variations by industry
export const OPENING_LINES: Record<string, string[]> = {
  cybersecurity: [
    'I noticed your company has been growing its security team.',
    'With the rise in cyber threats, I wanted to reach out.',
    'Your focus on security caught my attention.',
    'Given the current threat landscape, I had a question for you.',
    'I saw your recent security initiatives and had an idea.',
  ],
  mortgage: [
    'I see you\'re active in the mortgage industry.',
    'With the current market conditions, I wanted to connect.',
    'Your lending business caught my attention.',
    'I noticed you\'re helping clients with home financing.',
    'Given the competitive mortgage market, I had a thought.',
  ],
  smart_homes: [
    'Your work in smart home technology is impressive.',
    'I see you\'re involved in the home automation space.',
    'The smart home market is booming, and I noticed your company.',
    'Your projects in home technology caught my eye.',
    'I wanted to connect about the growing smart home demand.',
  ],
};
