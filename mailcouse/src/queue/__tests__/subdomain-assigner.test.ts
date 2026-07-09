// Unit tests for subdomain assigner

// Mock database
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { assignSubdomain, getAvailableSubdomainCount, getSubdomainStats } from '../subdomain-assigner';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Subdomain Assigner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('assignSubdomain', () => {
    it('should assign available subdomain', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            id: 'sub-1',
            domain_id: 'dom-1',
            subdomain: 's4j2.mortgage1.com',
            sender_name: 'John Smith',
            warmup_complete: true,
            daily_limit: 10,
            emails_sent_today: 5,
          },
        ],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await assignSubdomain('mortgage');

      expect(result).not.toBeNull();
      expect(result?.subdomain).toBe('s4j2.mortgage1.com');
    });

    it('should return null when no subdomains available', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await assignSubdomain('mortgage');
      expect(result).toBeNull();
    });

    it('should use round-robin selection', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { id: 'sub-1', subdomain: 'a.com', sender_name: 'A' },
          { id: 'sub-2', subdomain: 'b.com', sender_name: 'B' },
          { id: 'sub-3', subdomain: 'c.com', sender_name: 'C' },
        ],
        rowCount: 3,
        command: '',
        oid: 0,
        fields: [],
      });

      const result1 = await assignSubdomain('cybersecurity');
      const result2 = await assignSubdomain('cybersecurity');
      const result3 = await assignSubdomain('cybersecurity');

      expect(result1?.subdomain).toBe('a.com');
      expect(result2?.subdomain).toBe('b.com');
      expect(result3?.subdomain).toBe('c.com');
    });
  });

  describe('getAvailableSubdomainCount', () => {
    it('should return count of available subdomains', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ count: '50' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const count = await getAvailableSubdomainCount('mortgage');
      expect(count).toBe(50);
    });
  });

  describe('getSubdomainStats', () => {
    it('should return subdomain statistics', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '100' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '80' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '60' }], rowCount: 1, command: '', oid: 0, fields: [] });

      const stats = await getSubdomainStats('mortgage');

      expect(stats.total).toBe(100);
      expect(stats.active).toBe(80);
      expect(stats.available).toBe(60);
      expect(stats.at_limit).toBe(20);
    });
  });
});
