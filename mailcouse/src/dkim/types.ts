// DKIM types and interfaces for Plan 11

export interface DKIMKeyPair {
  publicKey: string;
  privateKey: string;
  selector: string;
}

export interface DKIMSignature {
  v: string; // Version
  a: string; // Algorithm
  d: string; // Domain
  s: string; // Selector
  h: string; // Signed headers
  bh: string; // Body hash
  b: string; // Header signature
}

export interface EmailHeaders {
  from: string;
  to: string;
  subject: string;
  date: string;
  messageId: string;
  listUnsubscribe?: string;
  listUnsubscribePost?: string;
  precedence?: string;
  [key: string]: string | undefined;
}

export interface DKIMSignResult {
  success: boolean;
  signature?: string;
  error?: string;
}

export interface DKIMConfig {
  domain: string;
  selector: string;
  privateKey: string;
  headers: string[];
}

export const DEFAULT_DKIM_HEADERS = [
  'from',
  'to',
  'subject',
  'date',
  'message-id',
  'list-unsubscribe',
];

export const DKIM_ALGORITHM = 'rsa-sha256';
export const DKIM_VERSION = '1';
