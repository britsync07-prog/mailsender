// Unit tests for industry router

import { determineIndustry, isValidIndustry, batchAssignIndustries, getIndustryDistribution } from '../industry-router';

// Mock database
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { query } from '../../db/connection';
const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Industry Router', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('determineIndustry', () => {
    it('should use explicit industry field', () => {
      const result = determineIndustry({ industry: 'mortgage' });
      expect(result).toBe('mortgage');
    });

    it('should detect mortgage from job title', () => {
      const result = determineIndustry({ job_title: 'Mortgage Broker' });
      expect(result).toBe('mortgage');
    });

    it('should detect smart_homes from job title', () => {
      const result = determineIndustry({ job_title: 'Electrical Contractor' });
      expect(result).toBe('smart_homes');
    });

    it('should detect cybersecurity from job title', () => {
      const result = determineIndustry({ job_title: 'CISO' });
      expect(result).toBe('cybersecurity');
    });

    it('should detect mortgage from company name', () => {
      const result = determineIndustry({ company: 'ABC Mortgage Lending' });
      expect(result).toBe('mortgage');
    });

    it('should detect smart_homes from company name', () => {
      const result = determineIndustry({ company: 'Smart Home Automation Inc' });
      expect(result).toBe('smart_homes');
    });

    it('should detect cybersecurity from company name', () => {
      const result = determineIndustry({ company: 'CyberSecurity Solutions' });
      expect(result).toBe('cybersecurity');
    });

    it('should default to cybersecurity when no signals', () => {
      const result = determineIndustry({});
      expect(result).toBe('cybersecurity');
    });

    it('should prioritize explicit industry over keywords', () => {
      const result = determineIndustry({
        industry: 'mortgage',
        job_title: 'CISO',
        company: 'Cyber Corp',
      });
      expect(result).toBe('mortgage');
    });
  });

  describe('isValidIndustry', () => {
    it('should accept valid industries', () => {
      expect(isValidIndustry('smart_homes')).toBe(true);
      expect(isValidIndustry('mortgage')).toBe(true);
      expect(isValidIndustry('cybersecurity')).toBe(true);
    });

    it('should reject invalid industries', () => {
      expect(isValidIndustry('invalid')).toBe(false);
      expect(isValidIndustry('')).toBe(false);
      expect(isValidIndustry('healthcare')).toBe(false);
    });
  });

  describe('batchAssignIndustries', () => {
    it('should assign industries to leads', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const leads = [
        { id: '1', industry: 'mortgage' },
        { id: '2', job_title: 'CISO' },
        { id: '3', company: 'Smart Home Inc' },
      ];

      const result = await batchAssignIndustries(leads);

      expect(result.assigned).toBe(3);
      expect(result.by_industry.mortgage).toBe(1);
      expect(result.by_industry.cybersecurity).toBe(1);
      expect(result.by_industry.smart_homes).toBe(1);
    });
  });

  describe('getIndustryDistribution', () => {
    it('should return industry distribution', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { industry: 'cybersecurity', count: '50' },
          { industry: 'mortgage', count: '30' },
          { industry: 'smart_homes', count: '20' },
        ],
        rowCount: 3,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await getIndustryDistribution();

      expect(result.total).toBe(100);
      expect(result.by_industry).toHaveLength(3);
    });
  });
});
