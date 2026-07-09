// Unit tests for report generator

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { generateWeeklyReport, formatReportAsMarkdown } from '../report-generator';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Report Generator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateWeeklyReport', () => {
    it('should generate weekly report', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ total_sent: 10000, total_replies: 500, total_opens: 3000, avg_score: 45 }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ industry: 'cybersecurity', emails_sent: 5000, replies: 250, complaints: 5 }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ subdomain: 'a.com', engagement_score: 70, reply_rate: 0.05 }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ subdomain: 'b.com', engagement_score: 10, reply_rate: 0.01 }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        });

      const report = await generateWeeklyReport();

      expect(report.period).toBeDefined();
      expect(report.summary.total_emails_sent).toBe(10000);
      expect(report.by_industry).toHaveLength(1);
      expect(report.top_subdomains).toHaveLength(1);
      expect(report.low_subdomains).toHaveLength(1);
    });
  });

  describe('formatReportAsMarkdown', () => {
    it('should format report as markdown', () => {
      const report = {
        period: '2025-01-01 to 2025-01-07',
        generated_at: new Date(),
        summary: {
          total_emails_sent: 10000,
          total_replies: 500,
          total_opens: 3000,
          avg_engagement_score: 45,
        },
        by_industry: [
          { industry: 'cybersecurity', emails_sent: 5000, replies: 250, reply_rate: 5, open_rate: 60, complaints: 5 },
        ],
        top_subdomains: [
          { subdomain: 'a.com', engagement_score: 70, reply_rate: 0.05 },
        ],
        low_subdomains: [
          { subdomain: 'b.com', engagement_score: 10, reply_rate: 0.01 },
        ],
      };

      const markdown = formatReportAsMarkdown(report);

      expect(markdown).toContain('# Weekly Engagement Report');
      expect(markdown).toContain('Total emails sent: 10,000');
      expect(markdown).toContain('cybersecurity');
      expect(markdown).toContain('a.com');
      expect(markdown).toContain('b.com');
    });
  });
});
