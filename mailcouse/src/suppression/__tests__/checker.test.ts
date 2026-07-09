// Unit tests for suppression checker

import { checkSuppression, batchCheckSuppression, checkAndUpdateLeads } from '../checker';

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../cache', () => ({
  isInCache: jest.fn(),
  batchCheckCache: jest.fn(),
}));

import { query } from '../../db/connection';
import { isInCache, batchCheckCache } from '../cache';

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockIsInCache = isInCache as jest.MockedFunction<typeof isInCache>;
const mockBatchCheckCache = batchCheckCache as jest.MockedFunction<typeof batchCheckCache>;

describe('Suppression Checker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkSuppression', () => {
    it('should return not suppressed for email not in cache', async () => {
      mockIsInCache.mockResolvedValue(false);

      const result = await checkSuppression('user@example.com');

      expect(result.is_suppressed).toBe(false);
      expect(result.email).toBe('user@example.com');
    });

    it('should return suppressed for email in cache', async () => {
      mockIsInCache.mockResolvedValue(true);
      mockQuery.mockResolvedValue({
        rows: [{ reason: 'hard_bounce', suppressed_at: new Date() }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await checkSuppression('bounced@example.com');

      expect(result.is_suppressed).toBe(true);
      expect(result.reason).toBe('hard_bounce');
      expect(result.suppressed_at).toBeDefined();
    });

    it('should normalize email to lowercase', async () => {
      mockIsInCache.mockResolvedValue(false);

      await checkSuppression('User@Example.COM');

      expect(mockIsInCache).toHaveBeenCalledWith('user@example.com');
    });
  });

  describe('batchCheckSuppression', () => {
    it('should batch check multiple emails', async () => {
      const cacheResults = new Map([
        ['user1@example.com', false],
        ['user2@example.com', true],
        ['user3@example.com', false],
      ]);
      mockBatchCheckCache.mockResolvedValue(cacheResults);

      mockQuery.mockResolvedValue({
        rows: [{ email: 'user2@example.com', reason: 'spam_complaint', suppressed_at: new Date() }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await batchCheckSuppression([
        'user1@example.com',
        'user2@example.com',
        'user3@example.com',
      ]);

      expect(result.total).toBe(3);
      expect(result.suppressed).toBe(1);
      expect(result.not_suppressed).toBe(2);
    });

    it('should handle empty input', async () => {
      mockBatchCheckCache.mockResolvedValue(new Map());

      const result = await batchCheckSuppression([]);

      expect(result.total).toBe(0);
      expect(result.suppressed).toBe(0);
    });
  });

  describe('checkAndUpdateLeads', () => {
    it('should update suppressed leads status', async () => {
      const cacheResults = new Map([
        ['lead1@example.com', false],
        ['lead2@example.com', true],
      ]);
      mockBatchCheckCache.mockResolvedValue(cacheResults);

      mockQuery.mockResolvedValue({
        rows: [{ reason: 'hard_bounce', suppressed_at: new Date() }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const leads = [
        { id: '1', email: 'lead1@example.com' },
        { id: '2', email: 'lead2@example.com' },
      ];

      const result = await checkAndUpdateLeads(leads);

      expect(result.total).toBe(2);
      expect(result.suppressed).toBe(1);
      expect(result.allowed).toBe(1);
    });
  });
});
