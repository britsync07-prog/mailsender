// Unit tests for recalculator

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { recalculateAllScores, calculateSubdomainScore, getPriority, getScoresSummary } from '../recalculator';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Recalculator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateSubdomainScore', () => {
    it('should calculate score based on reply and open rates', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ emails_sent: 100, replies: 5, opens: 30 }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const score = await calculateSubdomainScore('sub-1');

      expect(score).toBe(11); // (0.05*10 + 0.3*2) * 10 = 11
    });

    it('should return null for no data', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      });

      const score = await calculateSubdomainScore('nonexistent');
      expect(score).toBeNull();
    });

    it('should return 0 for zero sends', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ emails_sent: 0, replies: 0, opens: 0 }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const score = await calculateSubdomainScore('sub-1');
      expect(score).toBe(0);
    });
  });

  describe('getPriority', () => {
    it('should return high for score > 50', () => {
      expect(getPriority(51)).toBe('high');
      expect(getPriority(100)).toBe('high');
    });

    it('should return medium for score 20-50', () => {
      expect(getPriority(20)).toBe('medium');
      expect(getPriority(35)).toBe('medium');
      expect(getPriority(50)).toBe('medium');
    });

    it('should return low for score < 20', () => {
      expect(getPriority(0)).toBe('low');
      expect(getPriority(19)).toBe('low');
    });
  });

  describe('getScoresSummary', () => {
    it('should return scores summary', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { priority: 'high', count: '10', avg_score: 70 },
          { priority: 'medium', count: '20', avg_score: 35 },
          { priority: 'low', count: '5', avg_score: 10 },
        ],
        rowCount: 3,
        command: '',
        oid: 0,
        fields: [],
      });

      const summary = await getScoresSummary();

      expect(summary.total).toBe(35);
      expect(summary.by_priority).toHaveLength(3);
    });
  });
});
