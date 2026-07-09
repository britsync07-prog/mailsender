// Unit tests for MXToolbox client

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { checkIPBlacklist, checkAllIPsBlacklist, getBlacklistStats } from '../mxtoolbox-client';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('MXToolbox Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkIPBlacklist', () => {
    it('should check IP blacklist status', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ blacklisted: false }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await checkIPBlacklist('1.2.3.4');

      expect(result.blacklisted).toBe(false);
    });

    it('should return false when API key missing', async () => {
      delete process.env.MXTOOLBOX_API_KEY;

      const result = await checkIPBlacklist('1.2.3.4');

      expect(result.blacklisted).toBe(false);
    });
  });

  describe('checkAllIPsBlacklist', () => {
    it('should check all active IPs', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 'ip-1', ip_address: '1.2.3.4' }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ blacklisted: false }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        })
        .mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await checkAllIPsBlacklist();

      expect(result.checked).toBe(1);
      expect(result.blacklisted).toBe(0);
    });
  });

  describe('getBlacklistStats', () => {
    it('should return blacklist statistics', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { status: 'active', count: '40', last_check: new Date() },
          { status: 'blacklisted', count: '3', last_check: new Date() },
          { status: 'reserve', count: '7', last_check: null },
        ],
        rowCount: 3,
        command: '',
        oid: 0,
        fields: [],
      });

      const stats = await getBlacklistStats();

      expect(stats.total_ips).toBe(50);
      expect(stats.active).toBe(40);
      expect(stats.blacklisted).toBe(3);
      expect(stats.reserve).toBe(7);
    });
  });
});
