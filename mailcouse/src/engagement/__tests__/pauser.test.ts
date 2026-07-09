// Unit tests for pauser

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { pauseSubdomain, resumeSubdomain, autoPauseLowEngagement, getPauseStats } from '../pauser';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Pauser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('pauseSubdomain', () => {
    it('should pause an active subdomain', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ status: 'active' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await pauseSubdomain('sub-1', 'Low engagement');

      expect(result.success).toBe(true);
      expect(result.message).toContain('paused');
    });

    it('should fail if subdomain not found', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });

      const result = await pauseSubdomain('nonexistent', 'Test');

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should fail if already paused', async () => {
      mockQuery.mockResolvedValue({ rows: [{ status: 'paused' }], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await pauseSubdomain('sub-1', 'Test');

      expect(result.success).toBe(false);
      expect(result.message).toContain('already paused');
    });
  });

  describe('resumeSubdomain', () => {
    it('should resume a paused subdomain', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ status: 'paused' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await resumeSubdomain('sub-1', 'Review complete');

      expect(result.success).toBe(true);
      expect(result.message).toContain('resumed');
    });

    it('should fail if not paused', async () => {
      mockQuery.mockResolvedValue({ rows: [{ status: 'active' }], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await resumeSubdomain('sub-1', 'Test');

      expect(result.success).toBe(false);
      expect(result.message).toContain('not paused');
    });
  });

  describe('getPauseStats', () => {
    it('should return pause statistics', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '50' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '10' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ subdomain: 'a.com', reason: 'Low score', created_at: new Date() }], rowCount: 1, command: '', oid: 0, fields: [] });

      const stats = await getPauseStats();

      expect(stats.total_active).toBe(50);
      expect(stats.total_paused).toBe(10);
      expect(stats.recently_paused).toHaveLength(1);
    });
  });
});
