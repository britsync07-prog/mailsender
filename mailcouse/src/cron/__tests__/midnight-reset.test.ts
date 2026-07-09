// Unit tests for midnight reset

// Mock Redis
const mockRedisInstance = {
  ping: jest.fn().mockResolvedValue('PONG'),
  keys: jest.fn().mockResolvedValue([]),
  del: jest.fn().mockResolvedValue(1),
  set: jest.fn().mockResolvedValue('OK'),
  quit: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
};

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => mockRedisInstance);
});

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { runMidnightReset } from '../midnight-reset';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Midnight Reset', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('runMidnightReset', () => {
    it('should reset all counters', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 100, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: 50, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '5000' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await runMidnightReset();

      expect(result.success).toBe(true);
      expect(result.job_name).toBe('midnight_reset');
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    });
  });
});
