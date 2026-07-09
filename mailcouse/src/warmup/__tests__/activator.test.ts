// Unit tests for activator

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../gate', () => ({
  checkWarmupGate: jest.fn(),
  canActivateColdEmail: jest.fn(),
}));

jest.mock('../scheduler', () => ({
  completeWarmup: jest.fn(),
}));

import { activateSubdomain, pauseSubdomain, resumeSubdomain, batchActivate, getActivationStats } from '../activator';
import { query } from '../../db/connection';
import { checkWarmupGate, canActivateColdEmail } from '../gate';
import { completeWarmup } from '../scheduler';

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockCheckWarmupGate = checkWarmupGate as jest.MockedFunction<typeof checkWarmupGate>;
const mockCanActivateColdEmail = canActivateColdEmail as jest.MockedFunction<typeof canActivateColdEmail>;
const mockCompleteWarmup = completeWarmup as jest.MockedFunction<typeof completeWarmup>;

describe('Activator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('activateSubdomain', () => {
    it('should activate subdomain when criteria met', async () => {
      mockCanActivateColdEmail.mockResolvedValue({ can_activate: true });
      mockCompleteWarmup.mockResolvedValue(undefined);
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await activateSubdomain('sub-1');

      expect(result.success).toBe(true);
      expect(result.new_status).toBe('active');
      expect(result.new_daily_limit).toBe(10);
    });

    it('should fail activation when criteria not met', async () => {
      mockCanActivateColdEmail.mockResolvedValue({
        can_activate: false,
        reason: 'Warmup not complete',
      });

      const result = await activateSubdomain('sub-1');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Warmup not complete');
    });
  });

  describe('pauseSubdomain', () => {
    it('should pause subdomain', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await pauseSubdomain('sub-1', 'Low engagement');

      expect(result.success).toBe(true);
      expect(result.message).toContain('paused');
    });
  });

  describe('resumeSubdomain', () => {
    it('should resume when gate passes', async () => {
      mockCheckWarmupGate.mockResolvedValue({
        subdomain_id: 'sub-1',
        passed: true,
        criteria: {
          warmup_complete: true,
          postmaster_score_ok: true,
          no_complaints: true,
          bounce_rate_ok: true,
        },
      });
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await resumeSubdomain('sub-1');

      expect(result.success).toBe(true);
    });

    it('should fail resume when gate fails', async () => {
      mockCheckWarmupGate.mockResolvedValue({
        subdomain_id: 'sub-1',
        passed: false,
        criteria: {
          warmup_complete: false,
          postmaster_score_ok: false,
          no_complaints: true,
          bounce_rate_ok: true,
        },
        reason: 'warmup not complete',
      });

      const result = await resumeSubdomain('sub-1');

      expect(result.success).toBe(false);
    });
  });

  describe('batchActivate', () => {
    it('should batch activate ready subdomains', async () => {
      // Mock finding ready subdomains
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'sub-1' }, { id: 'sub-2' }],
        rowCount: 2,
        command: '',
        oid: 0,
        fields: [],
      });

      // Mock canActivateColdEmail for each subdomain
      mockCanActivateColdEmail
        .mockResolvedValueOnce({ can_activate: true })
        .mockResolvedValueOnce({ can_activate: true });

      // Mock completeWarmup for each subdomain
      mockCompleteWarmup
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      // Mock UPDATE queries for each subdomain
      mockQuery
        .mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await batchActivate();

      expect(result.total).toBe(2);
      expect(result.activated).toBe(2);
    });
  });

  describe('getActivationStats', () => {
    it('should return activation statistics', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '20' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '100' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '5' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '150' }], rowCount: 1, command: '', oid: 0, fields: [] });

      const stats = await getActivationStats();

      expect(stats.ready_to_activate).toBe(20);
      expect(stats.total_active).toBe(150);
    });
  });
});
