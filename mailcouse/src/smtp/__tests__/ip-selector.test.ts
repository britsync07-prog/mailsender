// Unit tests for IP selector

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { selectIP, getAvailableIPs, isIPAvailable, getIPStats } from '../ip-selector';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('IP Selector', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('selectIP', () => {
    it('should select available IP', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ id: 'ip-1', ip_address: '1.2.3.4', vds_server_id: 'vds-1', priority: 80 }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const ip = await selectIP();
      expect(ip).not.toBeNull();
      expect(ip?.ip_address).toBe('1.2.3.4');
    });

    it('should return null when no IPs available', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      });

      const ip = await selectIP();
      expect(ip).toBeNull();
    });
  });

  describe('getAvailableIPs', () => {
    it('should return list of available IPs', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { id: 'ip-1', ip_address: '1.2.3.4', priority: 80 },
          { id: 'ip-2', ip_address: '1.2.3.5', priority: 60 },
        ],
        rowCount: 2,
        command: '',
        oid: 0,
        fields: [],
      });

      const ips = await getAvailableIPs();
      expect(ips).toHaveLength(2);
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

  describe('getIPStats', () => {
    it('should return IP statistics', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ total: 50, active: 45, blacklisted: 3, avg_priority: 65 }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const stats = await getIPStats();
      expect(stats.total).toBe(50);
      expect(stats.active).toBe(45);
    });
  });
});
