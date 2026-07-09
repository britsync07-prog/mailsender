// Blitz API adapter for Plan 1 — Lead Ingestion
// Domain-first contact discovery
// Rate: 30 req/sec

import { config } from '../../config';
import { RawLead, Industry } from '../types';

interface BlitzContact {
  email: string;
  first_name: string;
  last_name: string;
  company_name: string;
  job_title: string;
  domain: string;
  linkedin_url?: string;
}

interface BlitzResponse {
  contacts: BlitzContact[];
  total: number;
  found: number;
}

export class BlitzAdapter {
  private apiKey: string;
  private baseUrl = 'https://api.blitz.com/v1';
  private rateLimitDelay = 34; // ~30 req/sec

  constructor() {
    this.apiKey = config.apiKeys.blitz;
    if (!this.apiKey) {
      console.warn('BLITZ_API_KEY not set — Blitz adapter will not work');
    }
  }

  /**
   * Find contacts for a list of company domains
   */
  async findContactsByDomains(
    domains: string[],
    options: { industry?: Industry } = {}
  ): Promise<RawLead[]> {
    const leads: RawLead[] = [];

    // Process in batches of 50
    const batchSize = 50;
    for (let i = 0; i < domains.length; i += batchSize) {
      const batch = domains.slice(i, i + batchSize);
      const batchLeads = await this.processBatch(batch, options.industry);
      leads.push(...batchLeads);

      // Rate limiting
      await this.delay(this.rateLimitDelay);
    }

    return leads;
  }

  /**
   * Process a batch of domains
   */
  private async processBatch(
    domains: string[],
    industry?: Industry
  ): Promise<RawLead[]> {
    const leads: RawLead[] = [];

    for (const domain of domains) {
      try {
        const contacts = await this.findContactsByDomain(domain);
        for (const contact of contacts) {
          leads.push(this.mapContactToLead(contact, industry));
        }
      } catch (error) {
        console.error(`Blitz error for domain ${domain}:`, error);
      }
    }

    return leads;
  }

  /**
   * Find contacts for a single domain
   */
  async findContactsByDomain(domain: string): Promise<BlitzContact[]> {
    const response = await fetch(`${this.baseUrl}/find-contacts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ domain }),
    });

    if (!response.ok) {
      throw new Error(`Blitz API error: ${response.status}`);
    }

    const data = (await response.json()) as BlitzResponse;
    return data.contacts || [];
  }

  /**
   * Map Blitz contact to RawLead
   */
  private mapContactToLead(contact: BlitzContact, industry?: Industry): RawLead {
    return {
      email: contact.email.toLowerCase(),
      first_name: contact.first_name,
      last_name: contact.last_name,
      company: contact.company_name,
      job_title: contact.job_title,
      industry: industry || 'cybersecurity',
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const blitz = new BlitzAdapter();
