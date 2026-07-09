// Unit tests for warmup gate

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { checkWarmupGate, canActivateColdEmail, getWarmupGateStats } from '../gate';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Warmup Gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkWarmupGate', () => {
    it('should pass when all criteria met', async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          id: 'sub-1',
          warmup_complete: true,
          status: 'warming',
          postmaster_score: 85,
          complaint_count: 0,
          bounce_rate: 0.005,
          daily_limit: 10,
        }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await checkWarmupGate('sub-1');

      expect(result.passed).toBe(true);
      expect(result.criteria.warmup_complete).toBe(true);
      expect(result.criteria.postmaster_score_ok).toBe(true);
    });

    it('should fail when warmup not complete', async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          id: 'sub-1',
          warmup_complete: false,
          status: 'warming',
          postmaster_score: 85,
          complaint_count: 0,
          bounce_rate: 0.005,
          daily_limit: 3,
        }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await checkWarmupGate('sub-1');

      expect(result.passed).toBe(false);
      expect(result.criteria.warmup_complete).toBe(false);
      expect(result.reason).toContain('warmup not complete');
    });

    it('should fail when postmaster score too low', async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          id: 'sub-1',
          warmup_complete: true,
          status: 'warming',
          postmaster_score: 55,
          complaint_count: 0,
          bounce_rate: 0.005,
          daily_limit: 10,
        }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await checkWarmupGate('sub-1');

      expect(result.passed).toBe(false);
      expect(result.criteria.postmaster_score_ok).toBe(false);
      expect(result.reason).toContain('postmaster score');
    });

    it('should fail when complaints received', async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          id: 'sub-1',
          warmup_complete: true,
          status: 'warming',
          postmaster_score: 85,
          complaint_count: 2,
          bounce_rate: 0.005,
          daily_limit: 10,
        }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await checkWarmupGate('sub-1');

      expect(result.passed).toBe(false);
      expect(result.criteria.no_complaints).toBe(false);
      expect(result.reason).toContain('complaints');
    });

    it('should fail when bounce rate too high', async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          id: 'sub-1',
          warmup_complete: true,
          status: 'warming',
          postmaster_score: 85,
          complaint_count: 0,
          bounce_rate: 0.05, // 5%
          daily_limit: 10,
        }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await checkWarmupGate('sub-1');

      expect(result.passed).toBe(false);
      expect(result.criteria.bounce_rate_ok).toBe(false);
      expect(result.reason).toContain('bounce rate');
    });

    it('should handle subdomain not found', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await checkWarmupGate('nonexistent');

      expect(result.passed).toBe(false);
      expect(result.reason).toContain('not found');
    });
  });

  describe('getWarmupGateStats', () => {
    it('should return warmup statistics', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { status: 'warming', count: '50' },
            { status: 'active', count: '100' },
            { status: 'paused', count: '5' },
          ],
          rowCount: 3,
          command: '',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ count: '20' }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        });

      const stats = await getWarmupGateStats();

      expect(stats.total_subdomains).toBe(155);
      expect(stats.warming).toBe(50);
      expect(stats.active).toBe(100);
      expect(stats.awaiting_activation).toBe(20);
    });
  });
});
