// Unit tests for daily report

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../../monitoring/alert-dispatcher', () => ({
  createAlert: jest.fn(),
  sendAlert: jest.fn().mockResolvedValue(true),
}));

import { generateDailyReport, formatDailyReport } from '../daily-report';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Daily Report', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateDailyReport', () => {
    it('should generate daily report', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '50000' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ domain: 'example.com', sent: '5000' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ ip: '1.2.3.4', sent: '1000' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ industry: 'cybersecurity', sent: '30000' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ total: 50000, bounced: 500 }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '10' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '50' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '5' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '3' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '10' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await generateDailyReport();

      expect(result.success).toBe(true);
      expect(result.job_name).toBe('daily_report');
    });
  });

  describe('formatDailyReport', () => {
    it('should format report as markdown', () => {
      const data = {
        date: '2025-01-01',
        total_sent: 50000,
        target: 100000,
        percentage: 50,
        by_domain: [{ domain: 'example.com', sent: 5000 }],
        by_ip: [{ ip: '1.2.3.4', sent: 1000 }],
        by_industry: [{ industry: 'cybersecurity', sent: 30000 }],
        bounce_rate: 0.01,
        complaint_rate: 0.001,
        reply_rate: 0.05,
        suppression_additions: 10,
        blacklisted_ips: 2,
        retired_domains: 1,
        dead_letter_count: 5,
      };

      const markdown = formatDailyReport(data);

      expect(markdown).toContain('# Daily Report');
      expect(markdown).toContain('50,000');
      expect(markdown).toContain('cybersecurity');
    });
  });
});
