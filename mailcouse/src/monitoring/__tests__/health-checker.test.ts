// Unit tests for health checker

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../domain-retirement', () => ({
  checkAndRetireDomains: jest.fn().mockResolvedValue({ checked: 5, retired: 1, alerts_sent: 1 }),
}));

jest.mock('../ip-replacement', () => ({
  checkAndReplaceIPs: jest.fn().mockResolvedValue({ checked: 50, replaced: 2, alerts_sent: 1 }),
}));

jest.mock('../postmaster-client', () => ({
  checkAllDomainsPostmaster: jest.fn().mockResolvedValue({ checked: 10, flagged: 2, errors: [] }),
}));

jest.mock('../mxtoolbox-client', () => ({
  checkAllIPsBlacklist: jest.fn().mockResolvedValue({ checked: 50, blacklisted: 1, errors: [] }),
}));

jest.mock('../alert-dispatcher', () => ({
  createAlert: jest.fn(),
  sendAlert: jest.fn().mockResolvedValue(true),
}));

import { runHealthCheck, getSystemHealth } from '../health-checker';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Health Checker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('runHealthCheck', () => {
    it('should run full health check', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '100' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '50000' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '50' }], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await runHealthCheck();

      expect(result.health).toBeDefined();
      expect(result.health.overall_status).toBeDefined();
      expect(result.alerts_sent).toBeGreaterThanOrEqual(0);
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getSystemHealth', () => {
    it('should get system health', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: 'd1', domain: 'good.com', postmaster_score: 85, complaint_rate_7d: 0.001, bounce_rate_7d: 0.01, status: 'active' }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'ip-1', ip_address: '1.2.3.4', blacklisted: false, status: 'active' }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({ rows: [{ count: '100' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '50' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '50000' }], rowCount: 1, command: '', oid: 0, fields: [] });

      const health = await getSystemHealth();

      expect(health.overall_status).toBe('healthy');
      expect(health.domains).toHaveLength(1);
      expect(health.ips).toHaveLength(1);
      expect(health.queue_depth).toBe(100);
      expect(health.daily_volume).toBe(50000);
    });
  });
});
