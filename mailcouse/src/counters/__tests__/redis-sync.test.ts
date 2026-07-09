// Unit tests for redis sync

// Mock Redis
const mockRedisInstance = {
  ping: jest.fn().mockResolvedValue('PONG'),
  keys: jest.fn().mockResolvedValue([]),
  get: jest.fn().mockResolvedValue('10'),
  set: jest.fn().mockResolvedValue('OK'),
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

import { syncToDatabase, syncFromDatabase, verifyConsistency } from '../redis-sync';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Redis Sync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('syncToDatabase', () => {
    it('should sync Redis to PostgreSQL', async () => {
      mockRedisInstance.keys.mockResolvedValue(['subdomain:1:sent_today', 'subdomain:2:sent_today']);
      mockRedisInstance.get.mockResolvedValue('10');
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await syncToDatabase();

      expect(result.subdomains_synced).toBe(2);
    });
  });

  describe('syncFromDatabase', () => {
    it('should sync PostgreSQL to Redis', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 'sub-1', emails_sent_today: 50 }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'ip-1', emails_today: 100 }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        });

      const result = await syncFromDatabase();

      expect(result.subdomains_loaded).toBe(1);
      expect(result.ips_loaded).toBe(1);
    });
  });

  describe('verifyConsistency', () => {
    it('should return consistent when no discrepancies', async () => {
      mockRedisInstance.keys.mockResolvedValue(['subdomain:1:sent_today']);
      mockRedisInstance.get.mockResolvedValue('50');
      mockQuery.mockResolvedValue({
        rows: [{ id: '1', emails_sent_today: 50 }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await verifyConsistency();

      expect(result.consistent).toBe(true);
      expect(result.discrepancies).toHaveLength(0);
    });

    it('should detect discrepancies', async () => {
      mockRedisInstance.keys.mockResolvedValue(['subdomain:1:sent_today']);
      mockRedisInstance.get.mockResolvedValue('50');
      mockQuery.mockResolvedValue({
        rows: [{ id: '1', emails_sent_today: 60 }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await verifyConsistency();

      expect(result.consistent).toBe(false);
      expect(result.discrepancies).toHaveLength(1);
    });
  });
});
