// Unit tests for retry manager

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { calculateBackoff, canRetry, requeueForRetry, getRetryableJobs, getRetryStatistics } from '../retry-manager';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Retry Manager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateBackoff', () => {
    it('should calculate backoff for attempt 1', () => {
      const retryAt = calculateBackoff(1);
      const now = Date.now();
      expect(retryAt.getTime()).toBeGreaterThan(now + 290000);
      expect(retryAt.getTime()).toBeLessThan(now + 310000);
    });

    it('should calculate backoff for attempt 2', () => {
      const retryAt = calculateBackoff(2);
      const now = Date.now();
      expect(retryAt.getTime()).toBeGreaterThan(now + 890000);
    });

    it('should calculate backoff for attempt 3', () => {
      const retryAt = calculateBackoff(3);
      const now = Date.now();
      expect(retryAt.getTime()).toBeGreaterThan(now + 2690000);
    });
  });

  describe('canRetry', () => {
    it('should return true if under max attempts', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ attempt_count: 1 }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await canRetry('job-1');
      expect(result).toBe(true);
    });

    it('should return false if at max attempts', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ attempt_count: 3 }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await canRetry('job-1');
      expect(result).toBe(false);
    });
  });

  describe('requeueForRetry', () => {
    it('should requeue job for retry', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ attempt_count: 1 }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await requeueForRetry('job-1', 450, 'Mailbox unavailable');

      expect(result.success).toBe(true);
      expect(result.retry_at).toBeInstanceOf(Date);
    });
  });

  describe('getRetryStatistics', () => {
    it('should return retry statistics', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ retried: 50, avg_attempts: 1.5, max_reached: 10 }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const stats = await getRetryStatistics();

      expect(stats.total_retried).toBe(50);
      expect(stats.avg_attempts).toBe(1.5);
      expect(stats.max_attempts_reached).toBe(10);
    });
  });
});
