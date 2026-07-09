// Unit tests for domain evaluator

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { calculateComplaintRate, shouldRetireDomain, retireDomain, getComplaintStats } from '../domain-evaluator';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Domain Evaluator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateComplaintRate', () => {
    it('should calculate complaint rate', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ complaints: 5, sent: 1000 }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await calculateComplaintRate('domain-1');

      expect(result.complaint_rate).toBe(0.005);
      expect(result.complaints_7d).toBe(5);
      expect(result.emails_sent_7d).toBe(1000);
    });

    it('should handle zero sends', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ complaints: 0, sent: 0 }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await calculateComplaintRate('domain-1');
      expect(result.complaint_rate).toBe(0);
    });
  });

  describe('shouldRetireDomain', () => {
    it('should flag domain for retirement when rate exceeds threshold', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ complaints: 2, sent: 1000 }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await shouldRetireDomain('domain-1');
      expect(result.should_retire).toBe(true);
    });

    it('should not flag domain when rate is below threshold', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ complaints: 0, sent: 1000 }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await shouldRetireDomain('domain-1');
      expect(result.should_retire).toBe(false);
    });
  });

  describe('retireDomain', () => {
    it('should retire domain', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      await retireDomain('domain-1', 'Complaint rate exceeded');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('retired'),
        expect.arrayContaining(['Complaint rate exceeded', 'domain-1'])
      );
    });
  });

  describe('getComplaintStats', () => {
    it('should return complaint statistics', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '50' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ domain: 'example.com', complaints: 5, sent: 1000 }], rowCount: 1, command: '', oid: 0, fields: [] });

      const stats = await getComplaintStats();

      expect(stats.total_complaints).toBe(50);
      expect(stats.by_domain).toHaveLength(1);
    });
  });
});
