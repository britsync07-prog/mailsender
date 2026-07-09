// Unit tests for service client

import { WarmupServiceClient } from '../service-client';

// Mock fetch
global.fetch = jest.fn();

describe('Service Client', () => {
  let client: WarmupServiceClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new WarmupServiceClient({
      provider: 'warmbox',
      api_key: 'test-key',
      api_url: 'https://api.test.com/v1',
    });
  });

  describe('connectSMTP', () => {
    it('should connect SMTP successfully', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'account-1' }),
      });

      const result = await client.connectSMTP({
        email: 'test@example.com',
        password: 'pass',
        imap_host: 'imap.example.com',
        imap_port: 993,
        smtp_host: 'smtp.example.com',
        smtp_port: 587,
      });

      expect(result.success).toBe(true);
      expect(result.account_id).toBe('account-1');
    });

    it('should handle connection failure', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: false,
        text: () => Promise.resolve('Invalid credentials'),
      });

      const result = await client.connectSMTP({
        email: 'test@example.com',
        password: 'wrong',
        imap_host: 'imap.example.com',
        imap_port: 993,
        smtp_host: 'smtp.example.com',
        smtp_port: 587,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid credentials');
    });
  });

  describe('enableWarmup', () => {
    it('should enable warmup successfully', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const result = await client.enableWarmup('account-1');

      expect(result.success).toBe(true);
    });
  });

  describe('disableWarmup', () => {
    it('should disable warmup successfully', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const result = await client.disableWarmup('account-1');

      expect(result.success).toBe(true);
    });
  });

  describe('checkHealth', () => {
    it('should return healthy status', async () => {
      (fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          connected: true,
          smtps_connected: 50,
          smtps_total: 100,
        }),
      });

      const status = await client.checkHealth();

      expect(status.connected).toBe(true);
      expect(status.smtps_connected).toBe(50);
    });

    it('should return unhealthy status on error', async () => {
      (fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

      const status = await client.checkHealth();

      expect(status.connected).toBe(false);
    });
  });
});
