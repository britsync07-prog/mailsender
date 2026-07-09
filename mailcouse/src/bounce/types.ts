// Bounce types and interfaces for Plan 15

export type BounceType = 'hard_bounce' | 'soft_bounce' | 'policy_block' | 'mailbox_full' | 'spam_block' | 'unknown';

export interface BounceData {
  recipient: string;
  sender: string;
  bounce_type: BounceType;
  smtp_code: number;
  diagnostic_code?: string;
  diagnostic_status?: string;
  message: string;
  timestamp: Date;
  subdomain_id?: string;
  ip_address?: string;
  job_id?: string;
}

export interface ParsedBounce {
  recipient: string;
  sender: string;
  smtp_code: number;
  message: string;
  diagnostic_code?: string;
  mta_type?: string;
  action?: string;
  status?: string;
}

export interface BounceClassification {
  type: BounceType;
  should_suppress: boolean;
  should_retry: boolean;
  retry_after_hours?: number;
  max_retries?: number;
}

export const BOUNCE_TYPE_MAP: Record<number, BounceType> = {
  421: 'soft_bounce',
  450: 'soft_bounce',
  451: 'soft_bounce',
  452: 'soft_bounce',
  550: 'hard_bounce',
  551: 'hard_bounce',
  553: 'hard_bounce',
  554: 'hard_bounce',
  521: 'spam_block',
};

export const BOUNCE_CLASSIFICATIONS: Record<BounceType, BounceClassification> = {
  hard_bounce: {
    type: 'hard_bounce',
    should_suppress: true,
    should_retry: false,
  },
  soft_bounce: {
    type: 'soft_bounce',
    should_suppress: false,
    should_retry: true,
    retry_after_hours: 24,
    max_retries: 2,
  },
  policy_block: {
    type: 'policy_block',
    should_suppress: true,
    should_retry: false,
  },
  mailbox_full: {
    type: 'mailbox_full',
    should_suppress: false,
    should_retry: true,
    retry_after_hours: 24,
    max_retries: 2,
  },
  spam_block: {
    type: 'spam_block',
    should_suppress: true,
    should_retry: false,
  },
  unknown: {
    type: 'unknown',
    should_suppress: false,
    should_retry: false,
  },
};
