// Unit tests for non-engager sweep

// Mock dependencies
jest.mock('../checker', () => ({
  checkNonEngagers: jest.fn(),
  getNonEngagerStats: jest.fn(),
}));

jest.mock('../scorer', () => ({
  batchCalculateScores: jest.fn(),
}));

import { runWeeklySweep, formatSweepResult } from '../non-engager-sweep';
import { checkNonEngagers, getNonEngagerStats } from '../checker';
import { batchCalculateScores } from '../scorer';

const mockCheckNonEngagers = checkNonEngagers as jest.MockedFunction<typeof checkNonEngagers>;
const mockGetNonEngagerStats = getNonEngagerStats as jest.MockedFunction<typeof getNonEngagerStats>;
const mockBatchCalculateScores = batchCalculateScores as jest.MockedFunction<typeof batchCalculateScores>;

describe('Non-Engager Sweep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('runWeeklySweep', () => {
    it('should run full sweep successfully', async () => {
      mockBatchCalculateScores.mockResolvedValue({
        total: 100,
        high: 20,
        medium: 50,
        low: 30,
        duration_ms: 500,
      });

      mockCheckNonEngagers.mockResolvedValue({
        total_checked: 30,
        non_engagers_found: 10,
        non_engagers_suppressed: 8,
        leads_skipped: 2,
        duration_ms: 200,
      });

      mockGetNonEngagerStats.mockResolvedValue({
        total_leads: 100,
        total_senders: 50,
        non_engagers: 2,
        engaged: 40,
        suppressed: 8,
      });

      const result = await runWeeklySweep();

      expect(result.scores_calculated.total).toBe(100);
      expect(result.non_engagers.suppressed).toBe(8);
      expect(result.stats.total_leads).toBe(100);
    });

    it('should handle sweep with no non-engagers', async () => {
      mockBatchCalculateScores.mockResolvedValue({
        total: 50,
        high: 30,
        medium: 20,
        low: 0,
        duration_ms: 300,
      });

      mockCheckNonEngagers.mockResolvedValue({
        total_checked: 0,
        non_engagers_found: 0,
        non_engagers_suppressed: 0,
        leads_skipped: 0,
        duration_ms: 50,
      });

      mockGetNonEngagerStats.mockResolvedValue({
        total_leads: 50,
        total_senders: 50,
        non_engagers: 0,
        engaged: 50,
        suppressed: 0,
      });

      const result = await runWeeklySweep();

      expect(result.non_engagers.found).toBe(0);
      expect(result.non_engagers.suppressed).toBe(0);
    });
  });

  describe('formatSweepResult', () => {
    it('should format sweep result for logging', () => {
      const result = {
        timestamp: new Date('2024-01-01T00:00:00Z'),
        scores_calculated: { total: 100, high: 20, medium: 50, low: 30, duration_ms: 500 },
        non_engagers: { total_checked: 30, found: 10, suppressed: 8, skipped: 2, duration_ms: 200 },
        stats: { total_leads: 100, total_senders: 50, non_engagers: 2, engaged: 40, suppressed: 8 },
        total_duration_ms: 700,
      };

      const formatted = formatSweepResult(result);

      expect(formatted).toContain('Weekly Non-Engager Sweep Report');
      expect(formatted).toContain('Total leads scored: 100');
      expect(formatted).toContain('Non-engagers found: 10');
      expect(formatted).toContain('Successfully suppressed: 8');
    });
  });
});
