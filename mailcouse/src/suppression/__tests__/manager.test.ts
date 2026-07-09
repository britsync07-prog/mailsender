// Unit tests for suppression manager

import { addSuppression, removeSuppression, bulkAddSuppression, getSuppressionStats, isSuppressed } from '../manager';

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../cache', () => ({
  addToCache: jest.fn(),
  removeFromCache: jest.fn(),
}));

import { query } from '../../db/connection';
import { addToCache, removeFromCache } from '../cache';

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockAddToCache = addToCache as jest.MockedFunction<typeof addToCache>;
const mockRemoveFromCache = removeFromCache as jest.MockedFunction<typeof removeFromCache>;

describe('Suppression Manager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('addSuppression', () => {
    it('should add new suppression entry', async () => {
      // Mock no existing entry
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({
          rows: [{
            id: 'uuid-1',
            email: 'test@example.com',
            reason: 'hard_bounce',
            suppressed_at: new Date(),
          }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        });

      const result = await addSuppression({
        email: 'test@example.com',
        reason: 'hard_bounce',
      });

      expect(result.email).toBe('test@example.com');
      expect(result.reason).toBe('hard_bounce');
      expect(mockAddToCache).toHaveBeenCalledWith('test@example.com');
    });

    it('should return existing entry if already suppressed', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'existing-id' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'existing-id',
          email: 'test@example.com',
          reason: 'manual',
          suppressed_at: new Date(),
        }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await addSuppression({
        email: 'test@example.com',
        reason: 'manual',
      });

      expect(result.id).toBe('existing-id');
      expect(mockAddToCache).not.toHaveBeenCalled();
    });

    it('should normalize email to lowercase', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({
          rows: [{
            id: 'uuid-1',
            email: 'test@example.com',
            reason: 'hard_bounce',
            suppressed_at: new Date(),
          }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        });

      await addSuppression({
        email: 'Test@Example.COM',
        reason: 'hard_bounce',
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['test@example.com'])
      );
    });
  });

  describe('removeSuppression', () => {
    it('should remove suppression entry', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await removeSuppression('test@example.com');

      expect(result).toBe(true);
      expect(mockRemoveFromCache).toHaveBeenCalledWith('test@example.com');
    });

    it('should return false if email was not suppressed', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });

      const result = await removeSuppression('notsuppressed@example.com');

      expect(result).toBe(false);
    });
  });

  describe('bulkAddSuppression', () => {
    it('should add multiple suppressions', async () => {
      // Mock all queries to return no existing entries and successful inserts
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });

      const result = await bulkAddSuppression([
        { email: 'user1@example.com', reason: 'hard_bounce' },
        { email: 'user2@example.com', reason: 'spam_complaint' },
      ]);

      // At minimum, it should process both emails without errors
      expect(result.added + result.already_suppressed).toBe(2);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle duplicates', async () => {
      // Mock first query to find existing, second to not find
      let callCount = 0;
      mockQuery.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First email exists
          return { rows: [{ id: 'existing' }], rowCount: 1, command: '', oid: 0, fields: [] };
        }
        // Second email doesn't exist, and inserts work
        return { rows: [], rowCount: 0, command: '', oid: 0, fields: [] };
      });

      const result = await bulkAddSuppression([
        { email: 'user1@example.com', reason: 'hard_bounce' },
        { email: 'user2@example.com', reason: 'hard_bounce' },
      ]);

      // First should be duplicate, second should be added
      expect(result.already_suppressed + result.added).toBe(2);
    });
  });

  describe('getSuppressionStats', () => {
    it('should return suppression statistics', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ count: '100' }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [
            { reason: 'hard_bounce', count: '50' },
            { reason: 'spam_complaint', count: '30' },
          ],
          rowCount: 2,
          command: '',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [],
          rowCount: 0,
          command: '',
          oid: 0,
          fields: [],
        });

      const stats = await getSuppressionStats();

      expect(stats.total_suppressed).toBe(100);
      expect(stats.by_reason).toHaveLength(2);
    });
  });

  describe('isSuppressed', () => {
    it('should return true for suppressed email', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ id: 'uuid-1' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await isSuppressed('suppressed@example.com');

      expect(result).toBe(true);
    });

    it('should return false for non-suppressed email', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await isSuppressed('active@example.com');

      expect(result).toBe(false);
    });
  });
});
