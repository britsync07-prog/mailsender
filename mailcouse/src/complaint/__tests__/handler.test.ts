// Unit tests for handler

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../arf-parser', () => ({
  parseARFNotification: jest.fn(),
}));

jest.mock('../domain-evaluator', () => ({
  updateDomainComplaintRate: jest.fn(),
  shouldRetireDomain: jest.fn(),
  retireDomain: jest.fn(),
}));

import { processComplaint, processComplaintBatch, getComplaintStats } from '../handler';
import { parseARFNotification } from '../arf-parser';
import { shouldRetireDomain, retireDomain } from '../domain-evaluator';
import { query } from '../../db/connection';

const mockParseARFNotification = parseARFNotification as jest.MockedFunction<typeof parseARFNotification>;
const mockShouldRetireDomain = shouldRetireDomain as jest.MockedFunction<typeof shouldRetireDomain>;
const mockRetireDomain = retireDomain as jest.MockedFunction<typeof retireDomain>;
const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('processComplaint', () => {
    it('should process complaint successfully', async () => {
      mockParseARFNotification.mockReturnValue({
        complained_address: 'test@example.com',
        source: 'gmail',
      });

      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] }) // suppress
        .mockResolvedValueOnce({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] }) // log
        .mockResolvedValueOnce({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] }) // update count
        .mockResolvedValueOnce({ rows: [{ id: 'domain-1' }], rowCount: 1, command: '', oid: 0, fields: [] }); // get domain

      mockShouldRetireDomain.mockResolvedValue({
        should_retire: false,
        complaint_rate: 0.0005,
        threshold: 0.001,
      });

      const result = await processComplaint('ARF message');

      expect(result.processed).toBe(true);
      expect(result.suppressed).toBe(true);
    });

    it('should handle parse failure', async () => {
      mockParseARFNotification.mockReturnValue(null);

      const result = await processComplaint('invalid message');
      expect(result.processed).toBe(false);
    });

    it('should handle domain retirement check', async () => {
      mockParseARFNotification.mockReturnValue({
        complained_address: 'test@example.com',
        source: 'gmail',
        source_domain: 'example.com',
      });

      // Mock all queries to return reasonable defaults
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });

      mockShouldRetireDomain.mockResolvedValue({
        should_retire: false,
        complaint_rate: 0.0005,
        threshold: 0.001,
      });

      const result = await processComplaint('ARF message');

      expect(result.processed).toBe(true);
      expect(result.suppressed).toBe(true);
    });
  });

  describe('processComplaintBatch', () => {
    it('should process batch of complaints', async () => {
      mockParseARFNotification.mockReturnValue({
        complained_address: 'test@example.com',
        source: 'gmail',
      });

      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });
      mockShouldRetireDomain.mockResolvedValue({
        should_retire: false,
        complaint_rate: 0.0005,
        threshold: 0.001,
      });

      const result = await processComplaintBatch(['ARF 1', 'ARF 2']);

      expect(result.total).toBe(2);
      expect(result.processed).toBe(2);
    });
  });

  describe('getComplaintStats', () => {
    it('should return complaint statistics', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '30' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ source: 'gmail', count: '20' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ complained_address: 'test@test.com', source: 'gmail', timestamp: new Date() }], rowCount: 1, command: '', oid: 0, fields: [] });

      const stats = await getComplaintStats();

      expect(stats.total_complaints).toBe(30);
      expect(stats.by_source).toHaveLength(1);
    });
  });
});
