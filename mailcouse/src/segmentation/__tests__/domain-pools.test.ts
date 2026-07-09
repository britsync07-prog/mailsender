// Unit tests for domain pools

import { createDomainPool, getIndustryDomains, isDomainInIndustry, getDomainIndustry, getDomainPoolStats } from '../domain-pools';

// Mock database
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { query } from '../../db/connection';
const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Domain Pools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createDomainPool', () => {
    it('should create a domain pool entry', async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          id: 'uuid-1',
          industry: 'mortgage',
          domain: 'mortgage1.com',
          status: 'warming',
          assigned_at: new Date(),
        }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await createDomainPool('mortgage', 'mortgage1.com');

      expect(result.industry).toBe('mortgage');
      expect(result.domain).toBe('mortgage1.com');
      expect(result.status).toBe('warming');
    });
  });

  describe('getIndustryDomains', () => {
    it('should get domains for an industry', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { id: '1', industry: 'mortgage', domain: 'mortgage1.com', status: 'active' },
          { id: '2', industry: 'mortgage', domain: 'mortgage2.com', status: 'warming' },
        ],
        rowCount: 2,
        command: '',
        oid: 0,
        fields: [],
      });

      const domains = await getIndustryDomains('mortgage');

      expect(domains).toHaveLength(2);
    });
  });

  describe('isDomainInIndustry', () => {
    it('should return true if domain is in industry', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ id: 'uuid-1' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await isDomainInIndustry('mortgage1.com', 'mortgage');
      expect(result).toBe(true);
    });

    it('should return false if domain is not in industry', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await isDomainInIndustry('other.com', 'mortgage');
      expect(result).toBe(false);
    });
  });

  describe('getDomainIndustry', () => {
    it('should return domain industry', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ industry: 'cybersecurity' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await getDomainIndustry('cyber1.com');
      expect(result).toBe('cybersecurity');
    });

    it('should return null for unknown domain', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await getDomainIndustry('unknown.com');
      expect(result).toBeNull();
    });
  });

  describe('getDomainPoolStats', () => {
    it('should return pool statistics', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { industry: 'mortgage', status: 'active', count: '10' },
          { industry: 'mortgage', status: 'warming', count: '7' },
          { industry: 'cybersecurity', status: 'active', count: '12' },
          { industry: 'cybersecurity', status: 'warming', count: '4' },
          { industry: 'smart_homes', status: 'active', count: '15' },
          { industry: 'smart_homes', status: 'warming', count: '2' },
        ],
        rowCount: 6,
        command: '',
        oid: 0,
        fields: [],
      });

      const stats = await getDomainPoolStats();

      expect(stats.total_domains).toBe(50);
      expect(stats.by_industry).toHaveLength(3);
    });
  });
});
