// DiscoLike API adapter for Plan 1 — Lead Ingestion
// Lookalike company discovery via 65M+ business domain database
// Cost: $0.10/call + $2/1K records

import { config } from '../../config';
import { RawLead, Industry } from '../types';

interface DiscoCompany {
  domain: string;
  name: string;
  description?: string;
  industry?: string;
  employee_count?: number;
  founded_year?: number;
  country?: string;
}

interface DiscoSearchResponse {
  companies: DiscoCompany[];
  total: number;
  page: number;
  per_page: number;
}

export class DiscoLikeAdapter {
  private apiKey: string;
  private baseUrl = 'https://api.disco-like.com/v1';
  private rateLimitDelay = 500; // 2 req/sec

  constructor() {
    this.apiKey = config.apiKeys.discoLike;
    if (!this.apiKey) {
      console.warn('DISCOLIKE_API_KEY not set — DiscoLike adapter will not work');
    }
  }

  /**
   * Search for lookalike companies by seed domains
   */
  async discoverBySeedDomains(
    seedDomains: string[],
    options: { limit?: number; country?: string } = {}
  ): Promise<RawLead[]> {
    const { limit = 100, country } = options;
    const companies: DiscoCompany[] = [];

    let page = 1;
    const perPage = 50;

    while (companies.length < limit) {
      const response = await this.search({
        seed_domains: seedDomains,
        page,
        per_page: perPage,
        country,
      });

      companies.push(...response.companies);

      if (response.companies.length < perPage) break;
      page++;

      // Rate limiting
      await this.delay(this.rateLimitDelay);
    }

    return companies.slice(0, limit).map((c) => this.mapCompanyToLead(c));
  }

  /**
   * Search by natural language ICP text
   */
  async discoverByICP(
    icpText: string,
    options: { limit?: number; country?: string } = {}
  ): Promise<RawLead[]> {
    const { limit = 100, country } = options;
    const companies: DiscoCompany[] = [];

    let page = 1;
    const perPage = 50;

    while (companies.length < limit) {
      const response = await this.search({
        text_query: icpText,
        page,
        per_page: perPage,
        country,
      });

      companies.push(...response.companies);

      if (response.companies.length < perPage) break;
      page++;

      // Rate limiting
      await this.delay(this.rateLimitDelay);
    }

    return companies.slice(0, limit).map((c) => this.mapCompanyToLead(c));
  }

  /**
   * Single domain lookup for enrichment
   */
  async lookupDomain(domain: string): Promise<DiscoCompany | null> {
    const response = await fetch(`${this.baseUrl}/companies/${domain}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`DiscoLike API error: ${response.status}`);
    }

    return response.json() as Promise<DiscoCompany>;
  }

  /**
   * Internal search method
   */
  private async search(params: {
    seed_domains?: string[];
    text_query?: string;
    page: number;
    per_page: number;
    country?: string;
  }): Promise<DiscoSearchResponse> {
    const response = await fetch(`${this.baseUrl}/companies/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(`DiscoLike API error: ${response.status}`);
    }

    return response.json() as Promise<DiscoSearchResponse>;
  }

  /**
   * Map company to RawLead (company only, no person)
   */
  private mapCompanyToLead(company: DiscoCompany): RawLead {
    return {
      email: `contact@${company.domain}`,
      company: company.name,
      industry: this.mapIndustry(company.industry),
    };
  }

  /**
   * Map DiscoLike industry to our industry enum
   */
  private mapIndustry(discoIndustry?: string): Industry {
    if (!discoIndustry) return 'cybersecurity';

    const lower = discoIndustry.toLowerCase();

    if (lower.includes('real estate') || lower.includes('mortgage') || lower.includes('financial')) {
      return 'mortgage';
    }
    if (lower.includes('smart home') || lower.includes('iot') || lower.includes('construction')) {
      return 'smart_homes';
    }
    if (lower.includes('cyber') || lower.includes('security') || lower.includes('tech')) {
      return 'cybersecurity';
    }

    return 'cybersecurity';
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const disco = new DiscoLikeAdapter();
