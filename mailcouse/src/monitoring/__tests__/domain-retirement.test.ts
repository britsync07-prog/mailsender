// Unit tests for domain retirement

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../alert-dispatcher', () => ({
  createAlert: jest.fn(),
  sendAlert: jest.fn().mockResolvedValue(true),
}));

import { checkAndRetireDomains, retireDomain, getDomainsNeedingCheck } from '../domain-retirement';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Domain Retirement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkAndRetireDomains', () => {
    it('should check and retire domains', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { id: 'd1', domain: 'bad.com', postmaster_score: 65, complaint_rate_7d: 0.002, bounce_rate_7d: 0.05 },
          ],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        })
        .mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await checkAndRetireDomains();

      expect(result.checked).toBe(1);
      expect(result.retired).toBe(1);
    });

    it('should not retire healthy domains', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { id: 'd1', domain: 'good.com', postmaster_score: 85, complaint_rate_7d: 0.0005, bounce_rate_7d: 0.01 },
        ],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await checkAndRetireDomains();

      expect(result.checked).toBe(1);
      expect(result.retired).toBe(0);
    });
  });

  describe('retireDomain', () => {
    it('should retire domain', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      await retireDomain('d1', 'example.com', 'High complaint rate');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('retired'),
        expect.arrayContaining(['High complaint rate', 'd1'])
      );
    });
  });

  describe('getDomainsNeedingCheck', () => {
    it('should get domains needing check', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { id: 'd1', domain: 'old.com', postmaster_score: 75, complaint_rate_7d: 0.001, bounce_rate_7d: 0.02, days_since_check: 5 },
        ],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const domains = await getDomainsNeedingCheck();

      expect(domains).toHaveLength(1);
      expect(domains[0].days_since_check).toBe(5);
    });
  });
});
