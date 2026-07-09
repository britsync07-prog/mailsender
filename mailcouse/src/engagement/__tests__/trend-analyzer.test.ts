// Unit tests for trend analyzer

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { analyzeTrend, getEarlyWarnings, getEngagementHealth } from '../trend-analyzer';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Trend Analyzer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('analyzeTrend', () => {
    it('should analyze trend for a subdomain', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ engagement_score: 50 }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ avg: 45 }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ avg: 40 }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ avg: 35 }], rowCount: 1, command: '', oid: 0, fields: [] });

      const trend = await analyzeTrend('sub-1');

      expect(trend.subdomain_id).toBe('sub-1');
      expect(trend.current_score).toBe(50);
      expect(trend.trend).toBeDefined();
      expect(trend.recommendation).toBeDefined();
    });
  });

  describe('getEngagementHealth', () => {
    it('should return engagement health', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ avg_score: 45, above: 30, below: 10 }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const health = await getEngagementHealth();

      expect(health.overall_score).toBe(45);
      expect(health.health_status).toBeDefined();
      expect(health.subdomains_above_target).toBe(30);
      expect(health.subdomains_below_target).toBe(10);
      expect(health.recommendations).toBeDefined();
    });
  });

  describe('getEarlyWarnings', () => {
    it('should return early warnings', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { id: 'sub-1', subdomain: 'a.com', engagement_score: 15, days_declining: 10 },
        ],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const warnings = await getEarlyWarnings();

      expect(warnings).toHaveLength(1);
      expect(warnings[0].trend).toBe('declining');
    });
  });
});
