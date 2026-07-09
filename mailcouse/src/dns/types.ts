export type DNSRecordType =
  | 'A' | 'AAAA' | 'CAA' | 'CNAME' | 'DS' | 'DNSKEY'
  | 'LOC' | 'MX' | 'NAPTR' | 'NS' | 'NSEC' | 'NSEC3'
  | 'NSEC3PARAM' | 'OPENPGPKEY' | 'PTR' | 'RRSIG'
  | 'SOA' | 'SPF' | 'SRV' | 'SSHFP' | 'SVCB'
  | 'TLSA' | 'TXT' | 'URI';

export interface DNSRecordSpec {
  name: string;
  type: 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'MX' | 'NS';
  content: string;
  ttl: number;
  priority?: number;
}

export interface DNSRecord {
  id: string;
  zone_id: string;
  name: string;
  type: DNSRecordType;
  content: string;
  ttl: number;
  priority?: number;
  weight?: number;
  port?: number;
  flags?: number;
  tag?: string;
  proxied?: boolean;
}

export interface SPFConfig {
  ipAddresses: string[];
  includeDomains?: string[];
  aRecords?: string[];
  mxRecords?: string[];
  exists?: string[];
  redirect?: string;
  exp?: string;
  policy: '~all' | '-all' | '+all' | '?all';
}

export interface DMARCConfig {
  policy: 'none' | 'quarantine' | 'reject';
  subdomainPolicy?: 'none' | 'quarantine' | 'reject';
  aggregateReportUri?: string;
  forensicReportUri?: string;
  percentage?: number;
  alignmentDkim?: 'r' | 's';
  alignmentSpf?: 'r' | 's';
  reportingInterval?: number;
  failureReporting?: {
    dkim?: boolean;
    spf?: boolean;
  };
}

export interface DKIMConfig {
  domain: string;
  selector: string;
  publicKey: string;
  privateKeyEncrypted: string;
  keyLength: 1024 | 2048 | 4096;
  algorithm: 'rsa-sha256';
  notes?: string;
}

export interface CAAConfig {
  flags: number;
  tag: 'issue' | 'issuewild' | 'iodef';
  value: string;
}

export interface MXConfig {
  priority: number;
  host: string;
}

export interface SRVConfig {
  priority: number;
  weight: number;
  port: number;
  target: string;
}

export interface TLSAConfig {
  usage: 0 | 1 | 2 | 3;
  selector: 0 | 1;
  matchingType: 0 | 1 | 2;
  certificateAssociation: string;
}

export interface DNSDiff {
  added: DNSRecord[];
  removed: DNSRecord[];
  changed: { before: DNSRecord; after: DNSRecord }[];
}

export interface DNSHealthCheck {
  domain: string;
  spf: { found: boolean; valid: boolean; error?: string };
  dkim: { found: boolean; valid: boolean; selector?: string; error?: string };
  dmarc: { found: boolean; valid: boolean; policy?: string; error?: string };
  mx: { found: boolean; records: MXConfig[] };
  ns: { found: boolean; servers: string[] };
  caa: { found: boolean; records: CAAConfig[] };
  tls: { found: boolean; record?: TLSAConfig };
  dnskey: { found: boolean };
}
