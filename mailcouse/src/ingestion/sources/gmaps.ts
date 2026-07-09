// Google Maps API adapter for Plan 1 — Lead Ingestion
// Uses RapidAPI Maps Data for local business scraping
// Returns companies, not people — chain with Blitz for owner contacts

import { config } from '../../config';
import { RawLead } from '../types';

interface GMapsBusiness {
  name: string;
  domain?: string;
  phone?: string;
  address?: string;
  rating?: number;
  reviews_count?: number;
  category?: string;
  website?: string;
}

interface GMapsSearchResponse {
  results: GMapsBusiness[];
  total: number;
  next_page_token?: string;
}

// US zip codes for state-wide scraping
const US_ZIP_CODES: string[] = []; // Loaded from zip code database

export class GoogleMapsAdapter {
  private apiKey: string;
  private host = 'google-maps-data.p.rapidapi.com';
  private rateLimitDelay = 1000; // 1 req/sec to respect rate limits

  constructor() {
    this.apiKey = config.apiKeys.rapidapi;
    if (!this.apiKey) {
      console.warn('RAPIDAPI_KEY not set — Google Maps adapter will not work');
    }
  }

  /**
   * Search for businesses by category and location
   */
  async searchBusinesses(
    category: string,
    location: string,
    options: { limit?: number } = {}
  ): Promise<RawLead[]> {
    const { limit = 100 } = options;
    const businesses: GMapsBusiness[] = [];

    let pageToken: string | undefined;
    let collected = 0;

    while (collected < limit) {
      const response = await this.search(category, location, pageToken);

      for (const business of response.results) {
        if (collected >= limit) break;
        businesses.push(business);
        collected++;
      }

      pageToken = response.next_page_token;
      if (!pageToken) break;

      // Rate limiting
      await this.delay(this.rateLimitDelay);
    }

    return businesses.map((b) => this.mapBusinessToLead(b));
  }

  /**
   * Search Google Maps via RapidAPI
   */
  private async search(
    category: string,
    location: string,
    pageToken?: string
  ): Promise<GMapsSearchResponse> {
    const url = new URL(`https://${this.host}/place/search`);
    url.searchParams.set('query', `${category} in ${location}`);
    if (pageToken) {
      url.searchParams.set('page_token', pageToken);
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'X-RapidAPI-Key': this.apiKey,
        'X-RapidAPI-Host': this.host,
      },
    });

    if (!response.ok) {
      throw new Error(`Google Maps API error: ${response.status}`);
    }

    return response.json() as Promise<GMapsSearchResponse>;
  }

  /**
   * Map business to RawLead (company only, no person)
   */
  private mapBusinessToLead(business: GMapsBusiness): RawLead {
    // Extract domain from website URL
    let domain = business.domain;
    if (!domain && business.website) {
      try {
        const url = new URL(business.website);
        domain = url.hostname.replace('www.', '');
      } catch {
        // Ignore invalid URLs
      }
    }

    return {
      email: `contact@${domain || 'unknown.com'}`,
      company: business.name,
      industry: 'smart_homes', // Default for local businesses
      pain_point: business.category,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const gmaps = new GoogleMapsAdapter();
