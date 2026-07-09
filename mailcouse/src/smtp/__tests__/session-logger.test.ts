// Unit tests for session logger

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { logSession, getSessionLogs, getRecentLogs, getSMTPStats } from '../session-logger';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Session Logger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('logSession', () => {
    it('should log SMTP session', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      await logSession({
        job_id: 'job-1',
        from: 'test@example.com',
        to: 'recipient@company.com',
        subdomain: 'test.example.com',
        ip_address: '1.2.3.4',
        connected_at: new Date(),
        response_code: 250,
        response_message: 'OK',
        duration_ms: 150,
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO smtp_logs'),
        expect.arrayContaining(['job-1', 'test@example.com', 'recipient@company.com'])
      );
    });
  });

  describe('getSessionLogs', () => {
    it('should get logs for a job', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { job_id: 'job-1', response_code: 250 },
          { job_id: 'job-1', response_code: 250 },
        ],
        rowCount: 2,
        command: '',
        oid: 0,
        fields: [],
      });

      const logs = await getSessionLogs('job-1');
      expect(logs).toHaveLength(2);
    });
  });

  describe('getSMTPStats', () => {
    it('should return SMTP statistics', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ total: 1000, success: 950, avg_duration: 150 }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ code: 250, count: 950 }, { code: 550, count: 50 }],
          rowCount: 2,
          command: '',
          oid: 0,
          fields: [],
        });

      const stats = await getSMTPStats();

      expect(stats.total_sent).toBe(1000);
      expect(stats.success_rate).toBe(95);
      expect(stats.by_response_code).toHaveLength(2);
    });
  });
});
