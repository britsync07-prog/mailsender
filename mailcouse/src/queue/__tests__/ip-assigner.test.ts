// Unit tests for IP assigner

// Mock database
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { assignIP, getAvailableIPCount, getIPPoolStats, isIPAvailable } from '../ip-assigner';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('IP Assigner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('assignIP', () => {
    it('should assign available IP', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          {
            id: 'ip-1',
            ip_address: '1.2.3.4',
            vds_server_id: 'vds-1',
            status: 'active',
            blacklisted: false,
            weight: 80,
          },
        ],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await assignIP();

      expect(result).not.toBeNull();
      expect(result?.ip_address).toBe('1.2.3.4');
    });

    it('should return null when no IPs available', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await assignIP();
      expect(result).toBeNull();
    });
  });

  describe('getAvailableIPCount', () => {
    it('should return count of available IPs', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ count: '45' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const count = await getAvailableIPCount();
      expect(count).toBe(45);
    });
  });

  describe('getIPPoolStats', () => {
    it('should return IP pool statistics', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { status: 'active', count: '40' },
          { status: 'reserve', count: '5' },
          { status: 'blacklisted', count: '3' },
          { status: 'retired', count: '2' },
        ],
        rowCount: 4,
        command: '',
        oid: 0,
        fields: [],
      });

      const stats = await getIPPoolStats();

      expect(stats.total).toBe(50);
      expect(stats.active).toBe(40);
      expect(stats.reserve).toBe(5);
    });
  });

  describe('isIPAvailable', () => {
    it('should return true for available IP', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ id: 'ip-1' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await isIPAvailable('ip-1');
      expect(result).toBe(true);
    });

    it('should return false for unavailable IP', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await isIPAvailable('blacklisted-ip');
      expect(result).toBe(false);
    });
  });
});
