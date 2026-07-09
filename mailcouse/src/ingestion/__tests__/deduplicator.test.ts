// Unit tests for deduplicator.ts

import { normalizeEmail } from '../validators';

// Mock the database connection
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { checkDuplicate, checkBatchDuplicates, getDuplicateStats } from '../deduplicator';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Deduplicator', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe('checkDuplicate', () => {
    it('should return is_duplicate=false for new email', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });

      const result = await checkDuplicate('new@example.com');
      expect(result.is_duplicate).toBe(false);
    });

    it('should return is_duplicate=true for existing email', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ id: 'existing-id' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await checkDuplicate('existing@example.com');
      expect(result.is_duplicate).toBe(true);
      expect(result.existing_lead_id).toBe('existing-id');
    });

    it('should normalize email before checking', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });

      await checkDuplicate('Test@Example.COM');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        ['test@example.com']
      );
    });
  });

  describe('checkBatchDuplicates', () => {
    it('should return results for all emails', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ email: 'dup@example.com', id: 'dup-id' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await checkBatchDuplicates([
        'new@example.com',
        'dup@example.com',
        'another@example.com',
      ]);

      expect(result.size).toBe(3);
      expect(result.get('new@example.com')?.is_duplicate).toBe(false);
      expect(result.get('dup@example.com')?.is_duplicate).toBe(true);
      expect(result.get('another@example.com')?.is_duplicate).toBe(false);
    });

    it('should handle empty input', async () => {
      const result = await checkBatchDuplicates([]);
      expect(result.size).toBe(0);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('getDuplicateStats', () => {
    it('should calculate correct statistics', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ email: 'dup1@example.com', id: 'id1' }, { email: 'dup2@example.com', id: 'id2' }],
        rowCount: 2,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await getDuplicateStats([
        'new1@example.com',
        'dup1@example.com',
        'new2@example.com',
        'dup2@example.com',
      ]);

      expect(result.total).toBe(4);
      expect(result.duplicates).toBe(2);
      expect(result.unique).toBe(2);
    });
  });
});
