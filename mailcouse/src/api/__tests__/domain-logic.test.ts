import * as dns from 'dns';
import { config } from '../../config';
import { parentDomains, findVerifiedDomainForAddress, checkDkimRecord, checkSpfRecord } from '../domain-logic';
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

describe('real DNS authentication checks', () => {
  const originalIpv4 = config.dns.outboundIpv4;
  const originalIpv6 = config.dns.outboundIpv6;
  let resolveTxtSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.DNS_RESOLVERS = ' ';
    resolveTxtSpy = jest.spyOn(dns.promises, 'resolveTxt');
  });

  afterEach(() => {
    config.dns.outboundIpv4 = originalIpv4;
    config.dns.outboundIpv6 = originalIpv6;
    resolveTxtSpy.mockRestore();
  });

  it('checks DKIM at the selector used by the sender and fails mismatched public keys', async () => {
    resolveTxtSpy.mockImplementation(async (name: string) => {
      expect(name).toBe('fy3fh2a8._domainkey.britsyncai.com');
      return [['v=DKIM1; t=s; h=sha256; p=wrong;']];
    });

    const result = await checkDkimRecord('britsyncai.com', 'fy3fh2a8', 'v=DKIM1; t=s; h=sha256; p=right;');

    expect(result.status).toBe('Invalid');
    expect(result.checked_name).toBe('fy3fh2a8._domainkey.britsyncai.com');
    expect(result.found).toContain('p=wrong');
  });

  it('fails SPF when a record exists but outbound IPv6 is not authorized', async () => {
    config.dns.outboundIpv4 = '';
    config.dns.outboundIpv6 = '2a02:c207:2319:5580::1';
    resolveTxtSpy.mockResolvedValue([['v=spf1 ip4:161.97.92.162 ~all']]);

    const result = await checkSpfRecord('britsyncai.com');

    expect(result.status).toBe('Invalid');
    expect(result.error).toBe('Outbound IPv6 2a02:c207:2319:5580::1 is not authorized by SPF for britsyncai.com');
    expect(result.found).toBe('v=spf1 ip4:161.97.92.162 ~all');
  });
});