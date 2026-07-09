// Unit tests for content engine

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { generateEmail, generateVariationsBatch } from '../engine';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Content Engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateEmail', () => {
    it('should generate email from template', async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          id: 'template-1',
          name: 'Test Template',
          industry: 'cybersecurity',
          subject_spintax: '{Hello|Hi} {{first_name}}',
          body_spintax: 'We help {{company_name}} with security.',
          format: 'plain',
          length_tier: 'medium',
          version: 1,
          created_at: new Date(),
        }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await generateEmail('template-1', {
        first_name: 'John',
        company_name: 'Acme Corp',
      });

      expect(result.subject).toBeDefined();
      expect(result.body).toBeDefined();
      expect(result.variation_id).toBeDefined();
    });

    it('should throw error for missing template', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      });

      await expect(
        generateEmail('nonexistent', {})
      ).rejects.toThrow('Template not found');
    });
  });

  describe('generateVariationsBatch', () => {
    it('should generate multiple variations', async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          id: 'template-1',
          name: 'Test Template',
          industry: 'cybersecurity',
          subject_spintax: '{Hello|Hi|Hey} {{first_name}}',
          body_spintax: 'We help {{company_name}}.',
          format: 'plain',
          length_tier: 'medium',
          version: 1,
          created_at: new Date(),
        }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const variations = await generateVariationsBatch('template-1', {
        first_name: 'John',
        company_name: 'Acme',
      }, 5);

      expect(variations).toHaveLength(5);
      // Each should have unique variation_id
      const ids = new Set(variations.map(v => v.variation_id));
      expect(ids.size).toBe(5);
    });
  });
});
