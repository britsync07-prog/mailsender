// Unit tests for cross-contamination guard

import { checkCrossContamination, validateBatchAssignments, checkEmailIndustryConflict } from '../cross-contamination-guard';

// Mock database
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { query } from '../../db/connection';
const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Cross-Contamination Guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkCrossContamination', () => {
    it('should pass when industries match', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: '1', industry: 'mortgage', email: 'test@example.com' }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'd1', domain: 'mortgage1.com', industry: 'mortgage' }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        });

      const result = await checkCrossContamination('1', 'd1');

      expect(result.is_safe).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should fail when industries mismatch', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: '1', industry: 'mortgage', email: 'test@example.com' }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'd1', domain: 'cyber1.com', industry: 'cybersecurity' }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        });

      const result = await checkCrossContamination('1', 'd1');

      expect(result.is_safe).toBe(false);
      expect(result.reason).toContain('Industry mismatch');
    });

    it('should fail when lead not found', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await checkCrossContamination('nonexistent', 'd1');

      expect(result.is_safe).toBe(false);
      expect(result.reason).toContain('Lead not found');
    });

    it('should fail when domain not found', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: '1', industry: 'mortgage', email: 'test@example.com' }],
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

      const result = await checkCrossContamination('1', 'nonexistent');

      expect(result.is_safe).toBe(false);
      expect(result.reason).toContain('Domain not found');
    });
  });

  describe('validateBatchAssignments', () => {
    it('should validate batch assignments', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ id: '1', industry: 'mortgage', email: 'a@test.com' }],
          rowCount: 1, command: '', oid: 0, fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'd1', domain: 'm1.com', industry: 'mortgage' }],
          rowCount: 1, command: '', oid: 0, fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ id: '2', industry: 'cybersecurity', email: 'b@test.com' }],
          rowCount: 1, command: '', oid: 0, fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'd2', domain: 'm2.com', industry: 'mortgage' }],
          rowCount: 1, command: '', oid: 0, fields: [],
        });

      const result = await validateBatchAssignments([
        { lead_id: '1', domain_id: 'd1' },
        { lead_id: '2', domain_id: 'd2' },
      ]);

      expect(result.valid).toBe(1);
      expect(result.invalid).toBe(1);
      expect(result.violations).toHaveLength(1);
    });
  });

  describe('checkEmailIndustryConflict', () => {
    it('should detect no conflict for single industry', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ id: '1', industry: 'mortgage' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await checkEmailIndustryConflict('test@example.com');

      expect(result.has_conflict).toBe(false);
      expect(result.industries).toHaveLength(1);
    });

    it('should detect conflict for multiple industries', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { id: '1', industry: 'mortgage' },
          { id: '2', industry: 'cybersecurity' },
        ],
        rowCount: 2,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await checkEmailIndustryConflict('test@example.com');

      expect(result.has_conflict).toBe(true);
      expect(result.industries).toHaveLength(2);
    });
  });
});
