// Warmbox/Mailreach API integration

import { WarmupServiceConfig, WarmupServiceStatus } from './types';

/**
 * Warmup service client
 */
export class WarmupServiceClient {
  private config: WarmupServiceConfig;

  constructor(config: WarmupServiceConfig) {
    this.config = config;
  }

  /**
   * Connect SMTP account to warmup service
   */
  async connectSMTP(smtpData: {
    email: string;
    password: string;
    imap_host: string;
    imap_port: number;
    smtp_host: string;
    smtp_port: number;
  }): Promise<{ success: boolean; account_id?: string; error?: string }> {
    try {
      const response = await fetch(`${this.config.api_url}/accounts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.api_key}`,
        },
        body: JSON.stringify(smtpData),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error };
      }

      const data: any = await response.json();
      return { success: true, account_id: data.id };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  /**
   * Enable warmup for an account
   */
  async enableWarmup(
    accountId: string,
    options: { starting_quantity?: number; max_quantity?: number; ramp_up?: boolean } = {}
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.config.api_url}/accounts/${accountId}/warmup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.api_key}`,
        },
        body: JSON.stringify({
          enabled: true,
          starting_quantity: options.starting_quantity || 2,
          max_quantity: options.max_quantity || 40,
          ramp_up: options.ramp_up !== false,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to enable warmup',
      };
    }
  }

  /**
   * Disable warmup for an account
   */
  async disableWarmup(accountId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.config.api_url}/accounts/${accountId}/warmup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.api_key}`,
        },
        body: JSON.stringify({ enabled: false }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to disable warmup',
      };
    }
  }

  /**
   * Get warmup status for an account
   */
  async getWarmupStatus(
    accountId: string
  ): Promise<{ connected: boolean; emails_sent: number; health_score: number }> {
    try {
      const response = await fetch(`${this.config.api_url}/accounts/${accountId}/warmup`, {
        headers: {
          'Authorization': `Bearer ${this.config.api_key}`,
        },
      });

      if (!response.ok) {
        return { connected: false, emails_sent: 0, health_score: 0 };
      }

      const data: any = await response.json();
      return {
        connected: data.connected || false,
        emails_sent: data.emails_sent || 0,
        health_score: data.health_score || 0,
      };
    } catch (error) {
      return { connected: false, emails_sent: 0, health_score: 0 };
    }
  }

  /**
   * Check service health
   */
  async checkHealth(): Promise<WarmupServiceStatus> {
    try {
      const response = await fetch(`${this.config.api_url}/health`, {
        headers: {
          'Authorization': `Bearer ${this.config.api_key}`,
        },
      });

      if (!response.ok) {
        return {
          connected: false,
          smtps_connected: 0,
          smtps_total: 0,
          last_check: new Date(),
        };
      }

      const data: any = await response.json();
      return {
        connected: true,
        smtps_connected: data.smtps_connected || 0,
        smtps_total: data.smtps_total || 0,
        last_check: new Date(),
      };
    } catch (error) {
      return {
        connected: false,
        smtps_connected: 0,
        smtps_total: 0,
        last_check: new Date(),
      };
    }
  }

  /**
   * Disconnect SMTP account
   */
  async disconnectSMTP(accountId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.config.api_url}/accounts/${accountId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${this.config.api_key}`,
        },
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to disconnect',
      };
    }
  }
}

/**
 * Create warmup service client from environment
 */
export function createWarmupClient(): WarmupServiceClient {
  const provider = (process.env.WARMUP_PROVIDER as 'warmbox' | 'mailreach') || 'warmbox';
  const apiKey = process.env.WARMUP_API_KEY || '';
  const apiUrl = process.env.WARMUP_API_URL || 'https://api.warmbox.com/v1';

  return new WarmupServiceClient({
    provider,
    api_key: apiKey,
    api_url: apiUrl,
  });
}
