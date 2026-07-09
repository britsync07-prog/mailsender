// Reply types and interfaces for Plan 17

export type ReplyClassification = 'positive' | 'neutral' | 'negative' | 'unsubscribe' | 'ooo' | 'bounce' | 'unknown';

export interface ReplyData {
  lead_id: string;
  subdomain_id?: string;
  message_id?: string;
  subject: string;
  body: string;
  from: string;
  timestamp: Date;
  classification?: ReplyClassification;
  confidence?: number;
}

export interface ClassificationResult {
  classification: ReplyClassification;
  confidence: number;
  reasoning: string;
}

export interface CRMForwardPayload {
  lead_id: string;
  lead_email: string;
  lead_name?: string;
  lead_company?: string;
  reply_subject: string;
  reply_body: string;
  reply_from: string;
  reply_timestamp: Date;
  subdomain_id?: string;
}

export const CLASSIFICATION_KEYWORDS: Record<ReplyClassification, string[]> = {
  positive: ['interested', 'demo', 'meeting', 'call', 'talk', 'yes', 'sure', 'sounds good', 'let me know', 'more info'],
  neutral: ['question', 'what', 'how', 'when', 'where', 'can you', 'could you', 'tell me'],
  negative: ['not interested', 'no thanks', 'remove', 'unsubscribe', 'stop', 'don\'t contact', 'not now'],
  unsubscribe: ['unsubscribe', 'remove me', 'opt out', 'stop sending', 'take me off'],
  ooo: ['out of office', 'on vacation', 'away from', 'auto-reply', 'automatic reply'],
  bounce: ['delivery failed', 'undeliverable', 'mailbox full', 'user unknown'],
  unknown: [],
};
