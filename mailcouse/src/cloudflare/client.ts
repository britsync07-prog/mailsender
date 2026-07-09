import { config } from '../config';
import type {
  CloudflareConfig,
  CloudflareZone,
  CloudflareDNSRecord,
  CreateDNSRecordInput,
  CloudflareApiResponse,
  CloudflareListResponse,
} from './types';

const BASE_URL = 'https://api.cloudflare.com/client/v4';

export class CloudflareClient {
  private config: CloudflareConfig;

  constructor(cfg?: CloudflareConfig) {
    this.config = cfg || config.cloudflare;
  }

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiToken}`,
    };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${BASE_URL}${path}`;
    const response = await fetch(url, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Cloudflare API ${method} ${path}: ${response.status} ${text}`);
    }

    return response.json() as Promise<T>;
  }

  async createZone(domain: string): Promise<CloudflareZone> {
    const res = await this.request<CloudflareApiResponse<CloudflareZone>>('POST', '/zones', {
      name: domain,
      account: { id: this.config.accountId },
      jump_start: true,
      type: 'full',
    });

    if (!res.success) {
      throw new Error(`Failed to create zone: ${res.errors.map((e) => e.message).join(', ')}`);
    }

    return res.result;
  }

  async listZones(): Promise<CloudflareZone[]> {
    const res = await this.request<CloudflareListResponse<CloudflareZone>>('GET', '/zones');
    return res.result;
  }

  async getZone(zoneId: string): Promise<CloudflareZone> {
    const res = await this.request<CloudflareApiResponse<CloudflareZone>>('GET', `/zones/${zoneId}`);
    if (!res.success) {
      throw new Error(`Failed to get zone: ${res.errors.map((e) => e.message).join(', ')}`);
    }
    return res.result;
  }

  async getZoneByName(domain: string): Promise<CloudflareZone | null> {
    const res = await this.request<CloudflareListResponse<CloudflareZone>>('GET', `/zones?name=${encodeURIComponent(domain)}`);
    return res.result[0] || null;
  }

  async deleteZone(zoneId: string): Promise<void> {
    const res = await this.request<CloudflareApiResponse<null>>('DELETE', `/zones/${zoneId}`);
    if (!res.success) {
      throw new Error(`Failed to delete zone: ${res.errors.map((e) => e.message).join(', ')}`);
    }
  }

  async listDNSRecords(zoneId: string): Promise<CloudflareDNSRecord[]> {
    const res = await this.request<CloudflareListResponse<CloudflareDNSRecord>>('GET', `/zones/${zoneId}/dns_records`);
    return res.result;
  }

  async createDNSRecord(
    zoneId: string,
    input: CreateDNSRecordInput
  ): Promise<CloudflareDNSRecord> {
    const res = await this.request<CloudflareApiResponse<CloudflareDNSRecord>>(
      `/zones/${zoneId}/dns_records`,
      'POST',
      input
    );

    if (!res.success) {
      throw new Error(`Failed to create DNS record: ${res.errors.map((e) => e.message).join(', ')}`);
    }

    return res.result;
  }

  async updateDNSRecord(
    zoneId: string,
    recordId: string,
    input: Partial<CreateDNSRecordInput>
  ): Promise<CloudflareDNSRecord> {
    const res = await this.request<CloudflareApiResponse<CloudflareDNSRecord>>(
      `/zones/${zoneId}/dns_records/${recordId}`,
      'PUT',
      input
    );

    if (!res.success) {
      throw new Error(`Failed to update DNS record: ${res.errors.map((e) => e.message).join(', ')}`);
    }

    return res.result;
  }

  async deleteDNSRecord(zoneId: string, recordId: string): Promise<void> {
    const res = await this.request<CloudflareApiResponse<null>>(
      `/zones/${zoneId}/dns_records/${recordId}`,
      'DELETE'
    );

    if (!res.success) {
      throw new Error(`Failed to delete DNS record: ${res.errors.map((e) => e.message).join(', ')}`);
    }
  }

  async upsertDNSRecord(
    zoneId: string,
    input: CreateDNSRecordInput
  ): Promise<CloudflareDNSRecord> {
    const records = await this.listDNSRecords(zoneId);
    const existing = records.find(
      (r) => r.name === input.name && r.type === input.type
    );

    if (existing) {
      return this.updateDNSRecord(zoneId, existing.id, input);
    }

    return this.createDNSRecord(zoneId, input);
  }
}

export function createCloudflareClient(): CloudflareClient {
  return new CloudflareClient();
}
