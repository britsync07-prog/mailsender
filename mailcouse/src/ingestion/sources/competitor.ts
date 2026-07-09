// LinkedIn Competitor Engagers adapter for Plan 1 — Lead Ingestion
// Finds people actively engaging with competitor LinkedIn posts
// Uses RapidAPI for LinkedIn data + AI analysis

import { config } from '../../config';
import { RawLead, Industry } from '../types';

interface LinkedInPost {
  post_url: string;
  author_name: string;
  author_company: string;
  content_snippet: string;
  engagement_date: string;
}

interface LinkedInEngager {
  name: string;
  email?: string;
  linkedin_url: string;
  company_name: string;
  job_title: string;
  engagement_type: 'comment' | 'reaction';
  post_url: string;
}

export class CompetitorEngagerAdapter {
  private rapidapiKey: string;
  private host = 'linkedin-data-api.p.rapidapi.com';
  private rateLimitDelay = 2000; // 1 req/sec for LinkedIn API

  constructor() {
    this.rapidapiKey = config.apiKeys.rapidapi;
    if (!this.rapidapiKey) {
      console.warn('RAPIDAPI_KEY not set — Competitor Engager adapter will not work');
    }
  }

  /**
   * Find people engaging with competitor posts
   */
  async findEngagers(
    competitorUrls: string[],
    options: { industry?: Industry; daysBack?: number } = {}
  ): Promise<RawLead[]> {
    const { industry = 'cybersecurity', daysBack = 90 } = options;
    const engagers: LinkedInEngager[] = [];

    for (const url of competitorUrls) {
      try {
        const posts = await this.getCompanyPosts(url, daysBack);

        for (const post of posts) {
          const postEngagers = await this.getPostEngagers(post.post_url);
          engagers.push(...postEngagers);
        }

        // Rate limiting
        await this.delay(this.rateLimitDelay);
      } catch (error) {
        console.error(`Error processing competitor ${url}:`, error);
      }
    }

    // Deduplicate by LinkedIn URL
    const uniqueEngagers = this.deduplicateEngagers(engagers);

    return uniqueEngagers
      .filter((e) => e.email) // Only include engagers with emails
      .map((e) => this.mapEngagerToLead(e, industry));
  }

  /**
   * Get posts from a company LinkedIn page
   */
  private async getCompanyPosts(
    linkedinUrl: string,
    daysBack: number
  ): Promise<LinkedInPost[]> {
    const response = await fetch(`https://${this.host}/company/posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RapidAPI-Key': this.rapidapiKey,
        'X-RapidAPI-Host': this.host,
      },
      body: JSON.stringify({
        url: linkedinUrl,
        days_back: daysBack,
      }),
    });

    if (!response.ok) {
      throw new Error(`LinkedIn API error: ${response.status}`);
    }

    const data = (await response.json()) as { posts: LinkedInPost[] };
    return data.posts || [];
  }

  /**
   * Get engagers (commenters + reactors) on a post
   */
  private async getPostEngagers(postUrl: string): Promise<LinkedInEngager[]> {
    const response = await fetch(`https://${this.host}/post/engagers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RapidAPI-Key': this.rapidapiKey,
        'X-RapidAPI-Host': this.host,
      },
      body: JSON.stringify({ url: postUrl }),
    });

    if (!response.ok) {
      throw new Error(`LinkedIn API error: ${response.status}`);
    }

    const data = (await response.json()) as { engagers: LinkedInEngager[] };
    return data.engagers || [];
  }

  /**
   * Deduplicate engagers by LinkedIn URL
   */
  private deduplicateEngagers(engagers: LinkedInEngager[]): LinkedInEngager[] {
    const seen = new Map<string, LinkedInEngager>();

    for (const engager of engagers) {
      if (!seen.has(engager.linkedin_url)) {
        seen.set(engager.linkedin_url, engager);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Map engager to RawLead
   */
  private mapEngagerToLead(engager: LinkedInEngager, industry: Industry): RawLead {
    // Extract name parts
    const nameParts = engager.name.split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ');

    return {
      email: engager.email!.toLowerCase(),
      first_name: firstName,
      last_name: lastName,
      company: engager.company_name,
      job_title: engager.job_title,
      industry,
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const competitorEngagers = new CompetitorEngagerAdapter();
