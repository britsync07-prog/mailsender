// Unit tests for job creator

// Mock Redis
jest.mock('ioredis', () => {
  const mockRedis = {
    ping: jest.fn().mockResolvedValue('PONG'),
    zadd: jest.fn().mockResolvedValue(1),
    zcard: jest.fn().mockResolvedValue(10),
    on: jest.fn(),
  };
  return jest.fn().mockImplementation(() => mockRedis);
});

// Mock database
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../subdomain-assigner', () => ({
  assignSubdomain: jest.fn(),
}));

jest.mock('../ip-assigner', () => ({
  assignIP: jest.fn(),
}));

jest.mock('../scheduler', () => ({
  calculateNextSendTime: jest.fn().mockReturnValue(new Date('2025-01-06T10:00:00Z')),
}));

import { createJobs, getQueueStats } from '../job-creator';
import { query } from '../../db/connection';
import { assignSubdomain } from '../subdomain-assigner';
import { assignIP } from '../ip-assigner';

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockAssignSubdomain = assignSubdomain as jest.MockedFunction<typeof assignSubdomain>;
const mockAssignIP = assignIP as jest.MockedFunction<typeof assignIP>;

describe('Job Creator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createJobs', () => {
    it('should create jobs for leads', async () => {
      // Mock lead lookup
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'lead-1',
          email: 'john@example.com',
          first_name: 'John',
          company: 'Acme',
          industry: 'mortgage',
          pain_point: 'cac',
          engagement_score: 50,
        }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      // Mock subdomain assignment
      mockAssignSubdomain.mockResolvedValue({
        id: 'sub-1',
        domain_id: 'dom-1',
        subdomain: 's4j2.mortgage.com',
        sender_name: 'John Smith',
        warmup_complete: true,
        daily_limit: 10,
        emails_sent_today: 5,
        dns_verified: true,
        engagement_score: 50,
      });

      // Mock IP assignment
      mockAssignIP.mockResolvedValue({
        id: 'ip-1',
        ip_address: '1.2.3.4',
        vds_server_id: 'vds-1',
        status: 'active',
        blacklisted: false,
        priority: 80,
        emails_today: 0,
      });

      // Mock job insert and lead update
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await createJobs(
        [{ id: 'lead-1', email: 'john@example.com', industry: 'mortgage', engagement_score: 50 }],
        'template-1'
      );

      expect(result.jobs_created).toBe(1);
      expect(result.jobs_failed).toBe(0);
      expect(result.by_industry.mortgage).toBe(1);
    });

    it('should handle leads with no available subdomains', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'lead-1',
          email: 'john@example.com',
          industry: 'mortgage',
          engagement_score: 50,
        }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      mockAssignSubdomain.mockResolvedValue(null);

      const result = await createJobs(
        [{ id: 'lead-1', email: 'john@example.com', industry: 'mortgage', engagement_score: 50 }],
        'template-1'
      );

      expect(result.jobs_created).toBe(0);
      expect(result.jobs_failed).toBe(1);
      expect(result.errors[0].error).toContain('No available subdomains');
    });

    it('should handle leads with no available IPs', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          id: 'lead-1',
          email: 'john@example.com',
          industry: 'mortgage',
          engagement_score: 50,
        }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      mockAssignSubdomain.mockResolvedValue({
        id: 'sub-1',
        subdomain: 'test.com',
        sender_name: 'Test',
      } as any);

      mockAssignIP.mockResolvedValue(null);

      const result = await createJobs(
        [{ id: 'lead-1', email: 'john@example.com', industry: 'mortgage', engagement_score: 50 }],
        'template-1'
      );

      expect(result.jobs_created).toBe(0);
      expect(result.jobs_failed).toBe(1);
    });
  });

  describe('getQueueStats', () => {
    it('should return queue statistics', async () => {
      // getQueueDepth uses Redis zcard (returns 10 from mock)
      // Then 3 more queries for processing, sent, failed
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '5' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '500' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '10' }], rowCount: 1, command: '', oid: 0, fields: [] });

      const stats = await getQueueStats();

      // depth comes from Redis mock (zcard returns 10)
      expect(stats.depth).toBe(10);
      expect(stats.processing).toBe(5);
      expect(stats.sent_today).toBe(500);
      expect(stats.failed_today).toBe(10);
    });
  });
});
