export interface CloudflareConfig {
  apiToken: string;
  accountId: string;
}

export interface CloudflareZone {
  id: string;
  name: string;
  status: string;
  name_servers: string[];
  original_name_servers: string[];
  paused: boolean;
  created_on: string;
  modified_on: string;
}

export interface CloudflareDNSRecord {
  id: string;
  zone_id: string;
  zone_name: string;
  name: string;
  type: string;
  content: string;
  proxied: boolean;
  ttl: number;
  created_on: string;
  modified_on: string;
}

export interface CreateDNSRecordInput {
  type: 'A' | 'AAAA' | 'CNAME' | 'TXT' | 'MX' | 'NS';
  name: string;
  content: string;
  ttl?: number;
  proxied?: boolean;
  priority?: number;
}

export interface CloudflareApiResponse<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  messages: string[];
  result: T;
}

export interface CloudflareListResponse<T> {
  success: boolean;
  errors: { code: number; message: string }[];
  messages: string[];
  result: T[];
  result_info: {
    page: number;
    per_page: number;
    total_pages: number;
    count: number;
    total_count: number;
  };
}

export interface ProvisionResult {
  success: boolean;
  zone_id?: string;
  dns_records: {
    dkim: boolean;
    spf: boolean;
    dmarc: boolean;
  };
  verified: boolean;
  errors: string[];
}
