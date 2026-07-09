// Unit tests for suppression importer

import { importFromCSV, importFromListmonk, importFromPostal } from '../importer';

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../cache', () => ({
  addToCache: jest.fn(),
}));

import { query } from '../../db/connection';
import { addToCache } from '../cache';

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockAddToCache = addToCache as jest.MockedFunction<typeof addToCache>;

describe('Suppression Importer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('importFromCSV', () => {
    it('should import emails from CSV', async () => {
      // Mock no existing entries
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });
      // Mock successful inserts
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const csv = `email,reason
user1@example.com,hard_bounce
user2@example.com,spam_complaint`;

      const result = await importFromCSV(csv);

      expect(result.total_imported).toBe(2);
      expect(result.total_duplicates).toBe(0);
      expect(mockAddToCache).toHaveBeenCalledTimes(2);
    });

    it('should handle CSV without header', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const csv = `user1@example.com
user2@example.com`;

      const result = await importFromCSV(csv);

      expect(result.total_imported).toBe(2);
    });

    it('should handle duplicates', async () => {
      // Mock existing entry
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'existing' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const csv = `email
existing@example.com`;

      const result = await importFromCSV(csv);

      expect(result.total_duplicates).toBe(1);
      expect(result.total_imported).toBe(0);
    });

    it('should handle invalid emails', async () => {
      const csv = `email
notanemail
another@`;

      const result = await importFromCSV(csv);

      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('importFromListmonk', () => {
    it('should import from listmonk format', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const blocklist = [
        { email: 'user1@example.com', timestamp: '2024-01-01T00:00:00Z' },
        { email: 'user2@example.com' },
      ];

      const result = await importFromListmonk(blocklist);

      expect(result.total_imported).toBe(2);
    });
  });

  describe('importFromPostal', () => {
    it('should import from postal format', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const suppressions = [
        { address: 'user1@example.com', timestamp: '2024-01-01T00:00:00Z' },
        { address: 'user2@example.com' },
      ];

      const result = await importFromPostal(suppressions);

      expect(result.total_imported).toBe(2);
    });
  });
});
