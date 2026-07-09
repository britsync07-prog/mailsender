// Unit tests for importer.ts

import { normalizeEmail } from '../validators';

// Mock the database connection
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
  transaction: jest.fn((callback) => callback({ query: jest.fn() })),
}));

// Mock the deduplicator
jest.mock('../deduplicator', () => ({
  checkBatchDuplicates: jest.fn(),
}));

import { importLeads, importFromCSV, getImportStats } from '../importer';
import { checkBatchDuplicates } from '../deduplicator';
import { query } from '../../db/connection';
import { LeadImportRequest, RawLead } from '../types';

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockCheckBatchDuplicates = checkBatchDuplicates as jest.MockedFunction<typeof checkBatchDuplicates>;

describe('Importer', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockCheckBatchDuplicates.mockReset();
  });

  describe('importLeads', () => {
    it('should import valid leads successfully', async () => {
      // Mock no duplicates
      mockCheckBatchDuplicates.mockResolvedValue(new Map());

      // Mock successful insert
      mockQuery.mockResolvedValue({
        rows: [
          {
            id: 'uuid-1',
            email: 'test@example.com',
            industry: 'cybersecurity',
            status: 'pending',
            validated: false,
            send_count: 0,
            engagement_score: 0,
            created_at: new Date(),
          },
        ],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const request: LeadImportRequest = {
        leads: [
          {
            email: 'test@example.com',
            first_name: 'John',
            last_name: 'Doe',
            company: 'Acme Corp',
            industry: 'cybersecurity',
          },
        ],
        source: 'prospeo',
      };

      const result = await importLeads(request);

      expect(result.total_received).toBe(1);
      expect(result.total_imported).toBe(1);
      expect(result.total_duplicates).toBe(0);
      expect(result.total_invalid).toBe(0);
      expect(result.imported_leads).toHaveLength(1);
    });

    it('should handle duplicate emails', async () => {
      // Mock duplicate found
      const dupMap = new Map();
      dupMap.set('dup@example.com', { is_duplicate: true, existing_lead_id: 'existing-id' });
      mockCheckBatchDuplicates.mockResolvedValue(dupMap);

      // Mock insert (no rows since all are duplicates)
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      });

      const request: LeadImportRequest = {
        leads: [
          { email: 'dup@example.com', industry: 'cybersecurity' },
        ],
        source: 'prospeo',
      };

      const result = await importLeads(request);

      expect(result.total_received).toBe(1);
      expect(result.total_imported).toBe(0);
      expect(result.total_duplicates).toBe(1);
    });

    it('should handle invalid leads', async () => {
      const request: LeadImportRequest = {
        leads: [
          { email: 'invalid-email', industry: 'cybersecurity' },
          { email: '', industry: 'cybersecurity' },
        ],
        source: 'prospeo',
      };

      const result = await importLeads(request);

      expect(result.total_received).toBe(2);
      expect(result.total_imported).toBe(0);
      expect(result.total_invalid).toBe(2);
      expect(result.errors).toHaveLength(2);
    });

    it('should apply industry override', async () => {
      mockCheckBatchDuplicates.mockResolvedValue(new Map());
      mockQuery.mockResolvedValue({
        rows: [
          {
            id: 'uuid-1',
            email: 'test@example.com',
            industry: 'mortgage',
            status: 'pending',
            validated: false,
            send_count: 0,
            engagement_score: 0,
            created_at: new Date(),
          },
        ],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const request: LeadImportRequest = {
        leads: [
          { email: 'test@example.com', industry: 'cybersecurity' },
        ],
        source: 'prospeo',
        industry: 'mortgage',
      };

      const result = await importLeads(request);

      expect(result.imported_leads[0].industry).toBe('mortgage');
    });

    it('should handle empty leads array', async () => {
      const request: LeadImportRequest = {
        leads: [],
        source: 'prospeo',
      };

      const result = await importLeads(request);

      expect(result.total_received).toBe(0);
      expect(result.total_imported).toBe(0);
    });
  });

  describe('importFromCSV', () => {
    it('should parse CSV and import leads', async () => {
      mockCheckBatchDuplicates.mockResolvedValue(new Map());
      mockQuery.mockResolvedValue({
        rows: [
          {
            id: 'uuid-1',
            email: 'john@example.com',
            industry: 'cybersecurity',
            status: 'pending',
            validated: false,
            send_count: 0,
            engagement_score: 0,
            created_at: new Date(),
          },
          {
            id: 'uuid-2',
            email: 'jane@example.com',
            industry: 'mortgage',
            status: 'pending',
            validated: false,
            send_count: 0,
            engagement_score: 0,
            created_at: new Date(),
          },
        ],
        rowCount: 2,
        command: '',
        oid: 0,
        fields: [],
      });

      const csv = `email,first_name,last_name,company,industry
john@example.com,John,Doe,Acme Corp,cybersecurity
jane@example.com,Jane,Smith,Builders Inc,mortgage`;

      const result = await importFromCSV(csv, 'csv_import');

      expect(result.total_received).toBe(2);
      expect(result.total_imported).toBe(2);
    });

    it('should handle CSV with different header names', async () => {
      mockCheckBatchDuplicates.mockResolvedValue(new Map());
      mockQuery.mockResolvedValue({
        rows: [
          {
            id: 'uuid-1',
            email: 'test@example.com',
            industry: 'cybersecurity',
            status: 'pending',
            validated: false,
            send_count: 0,
            engagement_score: 0,
            created_at: new Date(),
          },
        ],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const csv = `Email Address,FirstName,LastName,Company Name,Job Title
test@example.com,John,Doe,Acme Corp,CTO`;

      const result = await importFromCSV(csv, 'csv_import');

      expect(result.total_received).toBe(1);
    });

    it('should reject empty CSV', async () => {
      await expect(importFromCSV('', 'csv_import')).rejects.toThrow('CSV must have at least');
    });

    it('should reject CSV with only headers', async () => {
      await expect(importFromCSV('email,first_name', 'csv_import')).rejects.toThrow('CSV must have at least');
    });
  });

  describe('getImportStats', () => {
    it('should return import statistics', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '100' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({
          rows: [
            { industry: 'cybersecurity', count: '50' },
            { industry: 'mortgage', count: '30' },
            { industry: 'smart_homes', count: '20' },
          ],
          rowCount: 3,
          command: '',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [
            { source: 'prospeo', count: '60' },
            { source: 'csv_import', count: '40' },
          ],
          rowCount: 2,
          command: '',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [
            { status: 'pending', count: '100' },
          ],
          rowCount: 1,
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

      const stats = await getImportStats();

      expect(stats.total_leads).toBe(100);
      expect(stats.by_industry).toHaveLength(3);
      expect(stats.by_source).toHaveLength(2);
      expect(stats.by_status).toHaveLength(1);
    });
  });
});
