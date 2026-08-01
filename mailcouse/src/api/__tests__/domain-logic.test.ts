import { parentDomains, findVerifiedDomainForAddress, checkMxRecords, checkReturnPathRecord } from '../domain-logic';
import { query } from '../../db/connection';

jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

describe('Domain Logic Extra Features', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('parentDomains', () => {
    it('should split domains correctly', () => {
      expect(parentDomains('sub.example.com')).toEqual(['sub.example.com', 'example.com']);
      expect(parentDomains('a.b.c.com')).toEqual(['a.b.c.com', 'b.c.com', 'c.com']);
    });
  });

  describe('findVerifiedDomainForAddress', () => {
    it('should return null when no matching domain found', async () => {
      (query as jest.Mock).mockResolvedValueOnce({ rows: [] });
      const result = await findVerifiedDomainForAddress('sender@sub.example.com', 'org-123');
      expect(result).toBeNull();
    });

    it('should match direct domains', async () => {
      const mockDomain = { id: '1', domain: 'sub.example.com' };
      (query as jest.Mock).mockResolvedValueOnce({ rows: [mockDomain] });
      const result = await findVerifiedDomainForAddress('sender@sub.example.com', 'org-123');
      expect(result).toEqual(mockDomain);
    });

    it('should match parent domains and return the longest (most specific) one', async () => {
      const mockDomain1 = { id: '1', domain: 'example.com' };
      const mockDomain2 = { id: '2', domain: 'sub.example.com' };
      (query as jest.Mock).mockResolvedValueOnce({ rows: [mockDomain1, mockDomain2] });
      const result = await findVerifiedDomainForAddress('sender@sub.example.com', 'org-123');
      expect(result).toEqual(mockDomain2);
    });
  });
});
