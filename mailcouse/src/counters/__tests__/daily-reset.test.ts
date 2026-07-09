// Unit tests for daily reset

// Mock Redis
const mockRedisInstance = {
  ping: jest.fn().mockResolvedValue('PONG'),
  keys: jest.fn().mockResolvedValue([]),
  del: jest.fn().mockResolvedValue(1),
  set: jest.fn().mockResolvedValue('OK'),
  on: jest.fn(),
};

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => mockRedisInstance);
});

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { runDailyReset, archiveDailyCounters } from '../daily-reset';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Daily Reset', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('runDailyReset', () => {
    it('should reset all counters', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 100, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: 50, command: '', oid: 0, fields: [] });

      const result = await runDailyReset();

      expect(result.subdomains_reset).toBe(100);
      expect(result.ips_reset).toBe(50);
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe('archiveDailyCounters', () => {
    it('should archive daily counters', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '5000' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await archiveDailyCounters();

      expect(result.archived).toBe(true);
      expect(result.date).toBeDefined();
    });
  });
});
