// Unit tests for monitor

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { checkPostmasterScore, updatePostmasterScore, checkAllDomains, getDomainsNeedingExtension } from '../monitor';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Monitor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkPostmasterScore', () => {
    it('should return healthy score', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ postmaster_score: 85, last_checked: new Date() }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await checkPostmasterScore('domain-1');

      expect(result.score).toBe(85);
      expect(result.is_healthy).toBe(true);
    });

    it('should return unhealthy score', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ postmaster_score: 55, last_checked: new Date() }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await checkPostmasterScore('domain-1');

      expect(result.score).toBe(55);
      expect(result.is_healthy).toBe(false);
    });

    it('should handle domain not found', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await checkPostmasterScore('nonexistent');

      expect(result.score).toBeNull();
      expect(result.is_healthy).toBe(false);
    });
  });

  describe('updatePostmasterScore', () => {
    it('should update score', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      await updatePostmasterScore('domain-1', 85);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE domains'),
        [85, 'domain-1']
      );
    });
  });

  describe('checkAllDomains', () => {
    it('should check all domains', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { id: '1', domain: 'good.com', postmaster_score: 85 },
          { id: '2', domain: 'bad.com', postmaster_score: 55 },
          { id: '3', domain: 'ok.com', postmaster_score: 75 },
        ],
        rowCount: 3,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await checkAllDomains();

      expect(result.total).toBe(3);
      expect(result.healthy).toBe(2);
      expect(result.unhealthy).toBe(1);
      expect(result.flagged).toHaveLength(1);
      expect(result.flagged[0].domain).toBe('bad.com');
    });
  });

  describe('getDomainsNeedingExtension', () => {
    it('should find domains needing extension', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { domain_id: '1', domain: 'low.com', postmaster_score: 55, subdomains_affected: 200 },
        ],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await getDomainsNeedingExtension();

      expect(result).toHaveLength(1);
      expect(result[0].score).toBe(55);
      expect(result[0].subdomains_affected).toBe(200);
    });
  });
});
