// Unit tests for daily limiter

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../counter-store', () => ({
  getSubdomainCount: jest.fn(),
  getIPCount: jest.fn(),
  incrementSubdomainCount: jest.fn(),
  incrementIPCount: jest.fn(),
  incrementTotalDailyVolume: jest.fn(),
}));

import { canDispatch, recordSend, requeueJob, getVolumeStats } from '../daily-limiter';
import { query } from '../../db/connection';
import { getSubdomainCount, getIPCount } from '../counter-store';

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockGetSubdomainCount = getSubdomainCount as jest.MockedFunction<typeof getSubdomainCount>;
const mockGetIPCount = getIPCount as jest.MockedFunction<typeof getIPCount>;

describe('Daily Limiter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('canDispatch', () => {
    it('should allow dispatch when under limits', async () => {
      mockGetSubdomainCount.mockResolvedValue(5);
      mockGetIPCount.mockResolvedValue(100);
      mockQuery.mockResolvedValue({
        rows: [{ daily_limit: 10, warmup_complete: true }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await canDispatch({
        job_id: 'job-1',
        subdomain_id: 'sub-1',
        ip_id: 'ip-1',
      } as any);

      expect(result.allowed).toBe(true);
      expect(result.subdomain_count).toBe(5);
      expect(result.ip_count).toBe(100);
    });

    it('should deny dispatch when subdomain at limit', async () => {
      mockGetSubdomainCount.mockResolvedValue(10);
      mockQuery.mockResolvedValue({
        rows: [{ daily_limit: 10, warmup_complete: true }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await canDispatch({
        job_id: 'job-1',
        subdomain_id: 'sub-1',
        ip_id: 'ip-1',
      } as any);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Subdomain at limit');
    });

    it('should deny dispatch when IP at limit', async () => {
      mockGetSubdomainCount.mockResolvedValue(5);
      mockGetIPCount.mockResolvedValue(2000);
      mockQuery.mockResolvedValue({
        rows: [{ daily_limit: 10, warmup_complete: true }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await canDispatch({
        job_id: 'job-1',
        subdomain_id: 'sub-1',
        ip_id: 'ip-1',
      } as any);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('IP at limit');
    });
  });

  describe('getVolumeStats', () => {
    it('should return volume statistics', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '50000' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '10' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '5' }], rowCount: 1, command: '', oid: 0, fields: [] });

      const stats = await getVolumeStats();

      expect(stats.total_today).toBe(50000);
      expect(stats.target_daily).toBe(100000);
      expect(stats.percentage).toBe(50);
      expect(stats.subdomains_at_limit).toBe(10);
      expect(stats.ips_at_limit).toBe(5);
    });
  });
});
