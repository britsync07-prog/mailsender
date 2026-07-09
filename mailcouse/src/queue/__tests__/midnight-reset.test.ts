// Unit tests for midnight reset

// Mock Redis
const mockRedisInstance = {
  ping: jest.fn().mockResolvedValue('PONG'),
  del: jest.fn().mockResolvedValue(1),
  on: jest.fn(),
};

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => mockRedisInstance);
});

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../counter-store', () => ({
  resetAllSubdomainCounters: jest.fn().mockResolvedValue(100),
  resetAllIPCounters: jest.fn().mockResolvedValue(50),
}));

import { runMidnightReset, formatResetResult } from '../midnight-reset';
import { resetAllSubdomainCounters, resetAllIPCounters } from '../counter-store';
import { query } from '../../db/connection';

const mockResetSubdomains = resetAllSubdomainCounters as jest.MockedFunction<typeof resetAllSubdomainCounters>;
const mockResetIPs = resetAllIPCounters as jest.MockedFunction<typeof resetAllIPCounters>;
const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Midnight Reset', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('runMidnightReset', () => {
    it('should reset all counters successfully', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });

      const result = await runMidnightReset();

      expect(result.subdomains_reset).toBe(100);
      expect(result.ips_reset).toBe(50);
      expect(result.database_reset).toBe(true);
      expect(result.total_duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('should reset database counters', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });

      await runMidnightReset();

      expect(mockQuery).toHaveBeenCalledWith('UPDATE subdomains SET emails_sent_today = 0');
      expect(mockQuery).toHaveBeenCalledWith('UPDATE ip_pool SET emails_today = 0');
    });
  });

  describe('formatResetResult', () => {
    it('should format reset result for logging', () => {
      const result = {
        timestamp: new Date('2024-01-01T00:00:00Z'),
        subdomains_reset: 100,
        ips_reset: 50,
        database_reset: true,
        total_duration_ms: 500,
      };

      const formatted = formatResetResult(result);

      expect(formatted).toContain('Midnight Reset Report');
      expect(formatted).toContain('Subdomains: 100');
      expect(formatted).toContain('IPs: 50');
      expect(formatted).toContain('Duration: 500ms');
    });
  });
});
