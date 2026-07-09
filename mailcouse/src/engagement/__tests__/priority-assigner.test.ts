// Unit tests for priority assigner

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { getPrioritizedSubdomains, getTopPerformers, getLowPerformers, updateAllPriorities } from '../priority-assigner';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Priority Assigner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getPrioritizedSubdomains', () => {
    it('should return subdomains ordered by priority', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { id: 'sub-1', subdomain: 'a.com', engagement_score: 70, emails_sent_today: 5, daily_limit: 10 },
          { id: 'sub-2', subdomain: 'b.com', engagement_score: 30, emails_sent_today: 8, daily_limit: 10 },
          { id: 'sub-3', subdomain: 'c.com', engagement_score: 10, emails_sent_today: 3, daily_limit: 10 },
        ],
        rowCount: 3,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await getPrioritizedSubdomains();

      expect(result).toHaveLength(3);
      expect(result[0].priority).toBe('high');
      expect(result[1].priority).toBe('medium');
      expect(result[2].priority).toBe('low');
    });

    it('should filter by industry', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ id: 'sub-1', subdomain: 'a.com', engagement_score: 70, emails_sent_today: 5, daily_limit: 10 }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await getPrioritizedSubdomains('cybersecurity');

      expect(result).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('d.industry'),
        ['cybersecurity']
      );
    });
  });

  describe('updateAllPriorities', () => {
    it('should update priorities for all subdomains', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { id: '1', engagement_score: 70 },
          { id: '2', engagement_score: 30 },
          { id: '3', engagement_score: 10 },
        ],
        rowCount: 3,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await updateAllPriorities();

      expect(result.updated).toBe(3);
      expect(result.high).toBe(1);
      expect(result.medium).toBe(1);
      expect(result.low).toBe(1);
    });
  });
});
