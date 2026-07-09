// Unit tests for suppressor

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { suppressBouncedAddress, batchSuppress, updateDomainBounceRate, getSuppressionStats } from '../suppressor';
import { query } from '../../db/connection';
import { BounceData } from '../types';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Suppressor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('suppressBouncedAddress', () => {
    it('should suppress bounced address', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const bounce: BounceData = {
        recipient: 'test@example.com',
        sender: 'sender@example.com',
        bounce_type: 'hard_bounce',
        smtp_code: 550,
        message: 'User unknown',
        timestamp: new Date(),
      };

      const result = await suppressBouncedAddress(bounce);

      expect(result.suppressed).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO suppression_list'),
        expect.arrayContaining(['test@example.com', 'hard_bounce'])
      );
    });

    it('should handle suppression error', async () => {
      mockQuery.mockRejectedValue(new Error('DB error'));

      const bounce: BounceData = {
        recipient: 'test@example.com',
        sender: 'sender@example.com',
        bounce_type: 'hard_bounce',
        smtp_code: 550,
        message: 'User unknown',
        timestamp: new Date(),
      };

      const result = await suppressBouncedAddress(bounce);

      expect(result.suppressed).toBe(false);
      expect(result.reason).toBeDefined();
    });
  });

  describe('batchSuppress', () => {
    it('should batch suppress bounces', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const bounces: BounceData[] = [
        { recipient: 'a@test.com', sender: 's@test.com', bounce_type: 'hard_bounce', smtp_code: 550, message: 'User unknown', timestamp: new Date() },
        { recipient: 'b@test.com', sender: 's@test.com', bounce_type: 'hard_bounce', smtp_code: 550, message: 'User unknown', timestamp: new Date() },
      ];

      const result = await batchSuppress(bounces);

      expect(result.suppressed).toBe(2);
      expect(result.failed).toBe(0);
    });
  });

  describe('getSuppressionStats', () => {
    it('should return suppression statistics', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '100' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ reason: 'hard_bounce', count: '70' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ email: 'test@test.com', reason: 'hard_bounce', suppressed_at: new Date() }], rowCount: 1, command: '', oid: 0, fields: [] });

      const stats = await getSuppressionStats();

      expect(stats.total_suppressed).toBe(100);
      expect(stats.by_reason).toHaveLength(1);
      expect(stats.recent_suppressions).toHaveLength(1);
    });
  });
});
