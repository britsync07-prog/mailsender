// Unit tests for dead letter

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { getDeadLetterJobs, getDeadLetterCount, retryDeadLetterJob, deleteDeadLetterEntry, purgeOldDeadLetter, getDeadLetterStats } from '../dead-letter';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Dead Letter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getDeadLetterJobs', () => {
    it('should get dead letter jobs', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { job_id: 'job-1', moved_at: new Date(), reason: 'Max retries' },
          { job_id: 'job-2', moved_at: new Date(), reason: 'Hard fail' },
        ],
        rowCount: 2,
        command: '',
        oid: 0,
        fields: [],
      });

      const jobs = await getDeadLetterJobs();
      expect(jobs).toHaveLength(2);
    });
  });

  describe('getDeadLetterCount', () => {
    it('should return dead letter count', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ count: '25' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const count = await getDeadLetterCount();
      expect(count).toBe(25);
    });
  });

  describe('retryDeadLetterJob', () => {
    it('should retry dead letter job', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ job_id: 'job-1' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await retryDeadLetterJob('dl-1');
      expect(result).toBe(true);
    });

    it('should return false if not found', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });

      const result = await retryDeadLetterJob('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('purgeOldDeadLetter', () => {
    it('should purge old entries', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 10, command: '', oid: 0, fields: [] });

      const count = await purgeOldDeadLetter(30);
      expect(count).toBe(10);
    });
  });

  describe('getDeadLetterStats', () => {
    it('should return dead letter statistics', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '50' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ reason: 'Max retries', count: '30' }, { reason: 'Hard fail', count: '20' }], rowCount: 2, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ oldest: new Date(), newest: new Date() }], rowCount: 1, command: '', oid: 0, fields: [] });

      const stats = await getDeadLetterStats();

      expect(stats.total).toBe(50);
      expect(stats.by_reason).toHaveLength(2);
    });
  });
});
