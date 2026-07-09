// Unit tests for aggregator

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { getDailyStats, getHourlyRollup, getWeeklyTrend, getVolumeComparison } from '../aggregator';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Aggregator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getDailyStats', () => {
    it('should return daily statistics', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '5000' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ domain: 'example.com', count: '2000' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ ip: '1.2.3.4', count: '1000' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ industry: 'cybersecurity', count: '3000' }], rowCount: 1, command: '', oid: 0, fields: [] });

      const stats = await getDailyStats('2025-01-01');

      expect(stats.total_sent).toBe(5000);
      expect(stats.by_domain).toHaveLength(1);
      expect(stats.by_ip).toHaveLength(1);
      expect(stats.by_industry).toHaveLength(1);
    });
  });

  describe('getHourlyRollup', () => {
    it('should return hourly rollup', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ hour: 10, count: '500' }, { hour: 14, count: '800' }],
        rowCount: 2,
        command: '',
        oid: 0,
        fields: [],
      });

      const rollup = await getHourlyRollup('2025-01-01');

      expect(rollup).toHaveLength(2);
      expect(rollup[0].hour).toBe(10);
    });
  });

  describe('getWeeklyTrend', () => {
    it('should return weekly trend', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { date: '2025-01-01', count: '5000' },
          { date: '2025-01-02', count: '6000' },
        ],
        rowCount: 2,
        command: '',
        oid: 0,
        fields: [],
      });

      const trend = await getWeeklyTrend();

      expect(trend.dates).toHaveLength(2);
      expect(trend.totals).toHaveLength(2);
      expect(trend.avg_daily).toBe(5500);
    });
  });

  describe('getVolumeComparison', () => {
    it('should return volume comparison', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ count: '80000' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const comparison = await getVolumeComparison();

      expect(comparison.today).toBe(80000);
      expect(comparison.target).toBe(100000);
      expect(comparison.percentage).toBe(80);
      expect(comparison.status).toBe('on_track');
    });
  });
});
