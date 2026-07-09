// Unit tests for non-engager checker

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../../suppression/manager', () => ({
  addSuppression: jest.fn(),
}));

import { checkNonEngagers, isNonEngager, getNonEngagerStats } from '../checker';
import { query } from '../../db/connection';
import { addSuppression } from '../../suppression/manager';

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockAddSuppression = addSuppression as jest.MockedFunction<typeof addSuppression>;

describe('Non-Engager Checker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkNonEngagers', () => {
    it('should find and suppress non-engagers', async () => {
      // Mock finding non-engagers
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { id: '1', email: 'user1@example.com', send_count: 5 },
            { id: '2', email: 'user2@example.com', send_count: 3 },
          ],
          rowCount: 2,
          command: '',
          oid: 0,
          fields: [],
        })
        // Mock successful suppression updates
        .mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      mockAddSuppression.mockResolvedValue({
        id: 'uuid-1',
        email: 'user1@example.com',
        reason: 'non_engager',
        suppressed_at: new Date(),
      });

      const result = await checkNonEngagers();

      expect(result.non_engagers_found).toBe(2);
      expect(result.non_engagers_suppressed).toBe(2);
      expect(mockAddSuppression).toHaveBeenCalledTimes(2);
    });

    it('should handle empty non-engager list', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await checkNonEngagers();

      expect(result.non_engagers_found).toBe(0);
      expect(result.non_engagers_suppressed).toBe(0);
    });

    it('should handle suppression errors gracefully', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { id: '1', email: 'user1@example.com', send_count: 5 },
          ],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        });

      mockAddSuppression.mockRejectedValue(new Error('DB error'));

      const result = await checkNonEngagers();

      expect(result.non_engagers_found).toBe(1);
      expect(result.non_engagers_suppressed).toBe(0);
      expect(result.leads_skipped).toBe(1);
    });
  });

  describe('isNonEngager', () => {
    it('should return true for non-engager', async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          send_count: 3,
          replied_at: null,
          open_count: 0,
          engagement_score: 0,
          status: 'sent',
        }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await isNonEngager('lead-id');
      expect(result).toBe(true);
    });

    it('should return false for engaged lead', async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          send_count: 3,
          replied_at: null,
          open_count: 2,
          engagement_score: 20,
          status: 'sent',
        }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await isNonEngager('lead-id');
      expect(result).toBe(false);
    });

    it('should return false for lead with < 2 sends', async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          send_count: 1,
          replied_at: null,
          open_count: 0,
          engagement_score: 0,
          status: 'sent',
        }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await isNonEngager('lead-id');
      expect(result).toBe(false);
    });

    it('should return false for suppressed lead', async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          send_count: 5,
          replied_at: null,
          open_count: 0,
          engagement_score: 0,
          status: 'suppressed',
        }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await isNonEngager('lead-id');
      expect(result).toBe(false);
    });
  });

  describe('getNonEngagerStats', () => {
    it('should return engagement statistics', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '100' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '50' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '10' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '30' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '20' }], rowCount: 1, command: '', oid: 0, fields: [] });

      const stats = await getNonEngagerStats();

      expect(stats.total_leads).toBe(100);
      expect(stats.total_senders).toBe(50);
      expect(stats.non_engagers).toBe(10);
      expect(stats.engaged).toBe(30);
      expect(stats.suppressed).toBe(20);
    });
  });
});
