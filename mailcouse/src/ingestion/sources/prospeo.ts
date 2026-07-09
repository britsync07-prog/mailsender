// Prospeo API adapter for Plan 1 — Lead Ingestion
// API: POST https://api.prospeo.io/search-person
// Rate: 25 results/page, 1000 pages max per search

import { config } from '../../config';
import { RawLead, Industry } from '../types';

interface ProspeoSearchFilters {
  job_title?: string[];
  location?: string[];
  industry?: string[];
  headcount?: string[];
  technology?: string[];
  company_name?: string[];
  company_domain?: string[];
}

interface ProspeoPerson {
  first_name: string;
  last_name: string;
  email: string;
  company_name: string;
  job_title: string;
  linkedin_url?: string;
  industry?: string;
  location?: string;
}

interface ProspeoSearchResponse {
  data: ProspeoPerson[];
  pagination: {
    current_page: number;
    total_pages: number;
    total_results: number;
    per_page: number;
  };
}

export class ProspeoAdapter {
  private apiKey: string;
  private baseUrl = 'https://api.prospeo.io';
  private rateLimitDelay = 200; // 5 req/sec to be safe

  constructor() {
    this.apiKey = config.apiKeys.prospeo;
    if (!this.apiKey) {
      console.warn('PROSPEO_API_KEY not set — Prospeo adapter will not work');
    }
  }

  /**
   * Search for people matching filters
   */
  async search(
    filters: ProspeoSearchFilters,
    options: { page?: number; perPage?: number } = {}
  ): Promise<ProspeoSearchResponse> {
    const { page = 1, perPage = 25 } = options;

    const response = await fetch(`${this.baseUrl}/search-person`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': this.apiKey,
      },
      body: JSON.stringify({
        ...filters,
        page,
        per_page: perPage,
      }),
    });

    if (!response.ok) {
      throw new Error(`Prospeo API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<ProspeoSearchResponse>;
  }

  /**
   * Paginate through all results
   */
  async searchAll(
    filters: ProspeoSearchFilters,
    maxPages: number = 1000
  ): Promise<RawLead[]> {
    const leads: RawLead[] = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages && page <= maxPages) {
      const response = await this.search(filters, { page });

      for (const person of response.data) {
        leads.push(this.mapPersonToLead(person));
      }

      totalPages = response.pagination.total_pages;
      page++;

      // Rate limiting
      await this.delay(this.rateLimitDelay);
    }

    return leads;
  }

  /**
   * Map Prospeo person to RawLead
   */
  private mapPersonToLead(person: ProspeoPerson): RawLead {
    return {
      email: person.email.toLowerCase(),
      first_name: person.first_name,
      last_name: person.last_name,
      company: person.company_name,
      job_title: person.job_title,
      industry: this.mapIndustry(person.industry),
    };
  }

  /**
   * Map Prospeo industry to our industry enum
   */
  private mapIndustry(prospeoIndustry?: string): Industry {
    if (!prospeoIndustry) return 'cybersecurity'; // Default

    const lower = prospeoIndustry.toLowerCase();

    if (lower.includes('real estate') || lower.includes('mortgage') || lower.includes('financial')) {
      return 'mortgage';
    }
    if (lower.includes('smart home') || lower.includes('iot') || lower.includes('construction')) {
      return 'smart_homes';
    }
    if (lower.includes('cyber') || lower.includes('security') || lower.includes('tech')) {
      return 'cybersecurity';
    }

    return 'cybersecurity'; // Default for B2B
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const prospeo = new ProspeoAdapter();
