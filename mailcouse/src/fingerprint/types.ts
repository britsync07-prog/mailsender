export interface HeaderRandomizerConfig {
  messageIdPatterns: MessageIdPattern[];
  userAgents: string[];
  xMailers: string[];
  listUnsubscribeFormats: ListUnsubscribeFormat[];
  headerOrderTemplates: string[][];
  injectReceivedHeaders: boolean;
}

export type MessageIdPattern = 'uuid_at_domain' | 'random_at_domain' | 'timestamp_hash_at_domain' | 'short_uuid_at_domain';

export interface ListUnsubscribeFormat {
  type: 'mailto' | 'url' | 'both';
  urlTemplate?: string;
}

export interface GeneratedHeaders {
  'Message-ID': string;
  'Date': string;
  'X-Mailer'?: string;
  'User-Agent'?: string;
  'List-Unsubscribe'?: string;
  'Precedence': string;
  'Received'?: string;
  [key: string]: string | undefined;
}

export interface PatternDiversifierConfig {
  baseDelayMs: number;
  jitterPercent: number;
  volumeRampSteps: number;
  minBurstSize: number;
  maxBurstSize: number;
  burstCooldownMs: number;
  dailyShape: 'linear_ramp' | 'bell_curve' | 'random_walk' | 'uniform';
}

export interface SendCadence {
  subdomainId: string;
  ipId: string;
  lastSendAt: number;
  burstCount: number;
  burstStartAt: number;
  dailySent: number;
}

export interface TimingDecision {
  delayMs: number;
  burstRemaining: number;
}

export const DEFAULT_HEADER_CONFIG: HeaderRandomizerConfig = {
  messageIdPatterns: ['uuid_at_domain', 'random_at_domain', 'timestamp_hash_at_domain', 'short_uuid_at_domain'],
  userAgents: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  ],
  xMailers: [
    'Microsoft Outlook 16.0.17328',
    'Mozilla Thunderbird 115.6.0',
    'Apple Mail 3657.120.4.7.1',
    'Windows Live Mail 16.4.3528.0331',
    'Postbox 7.0.58',
    'eM Client 9.2.2277',
    'Mailspring 1.13.3',
    'The Bat! 10.5.1',
  ],
  listUnsubscribeFormats: [
    { type: 'mailto' },
    { type: 'both', urlTemplate: 'https://unsubscribe.{domain}/?id={job_id}' },
    { type: 'url', urlTemplate: 'https://{domain}/unsub/{short_id}' },
  ],
  headerOrderTemplates: [
    ['From', 'To', 'Subject', 'Date', 'Message-ID', 'MIME-Version', 'Content-Type', 'Content-Transfer-Encoding'],
    ['From', 'To', 'Date', 'Subject', 'Message-ID', 'MIME-Version', 'Content-Type', 'Content-Transfer-Encoding'],
    ['From', 'To', 'Subject', 'Date', 'X-Mailer', 'Message-ID', 'MIME-Version', 'Content-Type', 'Content-Transfer-Encoding'],
    ['Date', 'From', 'To', 'Subject', 'Message-ID', 'MIME-Version', 'Content-Type', 'Content-Transfer-Encoding'],
    ['From', 'To', 'Date', 'Message-ID', 'Subject', 'MIME-Version', 'Content-Type', 'Content-Transfer-Encoding'],
    ['From', 'To', 'Subject', 'Date', 'Message-ID', 'User-Agent', 'MIME-Version', 'Content-Type', 'Content-Transfer-Encoding'],
  ],
  injectReceivedHeaders: true,
};

export const DEFAULT_PATTERN_CONFIG: PatternDiversifierConfig = {
  baseDelayMs: 90000,
  jitterPercent: 35,
  volumeRampSteps: 10,
  minBurstSize: 1,
  maxBurstSize: 3,
  burstCooldownMs: 600000,
  dailyShape: 'bell_curve',
};
