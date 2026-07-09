// Unit tests for retry manager

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { calculateRetryTime, requeueForRetry, moveToDeadLetter, getRetryStats } from '../retry-manager';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Retry Manager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateRetryTime', () => {
    it('should calculate retry time for attempt 1', () => {
      const retryTime = calculateRetryTime(1);
      const now = Date.now();
      expect(retryTime.getTime()).toBeGreaterThan(now + 290000); // ~5 minutes
      expect(retryTime.getTime()).toBeLessThan(now + 310000);
    });

    it('should calculate retry time for attempt 2', () => {
      const retryTime = calculateRetryTime(2);
      const now = Date.now();
      expect(retryTime.getTime()).toBeGreaterThan(now + 890000); // ~15 minutes
    });

    it('should calculate retry time for attempt 3', () => {
      const retryTime = calculateRetryTime(3);
      const now = Date.now();
      expect(retryTime.getTime()).toBeGreaterThan(now + 2690000); // ~45 minutes
    });
  });

  describe('requeueForRetry', () => {
    it('should requeue job for retry', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      await requeueForRetry('job-1', 1);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE send_jobs'),
        expect.arrayContaining([expect.any(Date), 'job-1'])
      );
    });
  });

  describe('moveToDeadLetter', () => {
    it('should move job to dead letter', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      await moveToDeadLetter('job-1', 'Max retries exceeded');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('failed'),
        expect.arrayContaining(['Max retries exceeded', 'job-1'])
      );
    });
  });

  describe('getRetryStats', () => {
    it('should return retry statistics', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ total_retried: 50, total_dead_letter: 10, avg_attempts: 1.5 }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const stats = await getRetryStats();

      expect(stats.total_retried).toBe(50);
      expect(stats.total_dead_letter).toBe(10);
      expect(stats.avg_attempts).toBe(1.5);
    });
  });
});
