// Unit tests for classifier

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { classifyAndRoute, getClassificationStats } from '../classifier';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Classifier', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('classifyAndRoute', () => {
    it('should route success to sent', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await classifyAndRoute('job-1', 250, 'OK');

      expect(result.action).toBe('sent');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('sent'),
        expect.arrayContaining([expect.stringContaining('250'), 'job-1'])
      );
    });

    it('should route soft fail to retry', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ attempt_count: 1 }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await classifyAndRoute('job-1', 450, 'Mailbox unavailable');

      expect(result.action).toBe('retry');
    });

    it('should route hard fail to suppress', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ lead_id: 'lead-1' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ email: 'test@example.com' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await classifyAndRoute('job-1', 550, 'User unknown');

      expect(result.action).toBe('suppress');
    });
  });

  describe('getClassificationStats', () => {
    it('should return classification statistics', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { status: 'sent', count: '500' },
          { status: 'failed', count: '50' },
          { status: 'queued', count: '100' },
        ],
        rowCount: 3,
        command: '',
        oid: 0,
        fields: [],
      });

      const stats = await getClassificationStats();

      expect(stats.total_processed).toBe(650);
      expect(stats.by_category).toHaveLength(3);
    });
  });
});
