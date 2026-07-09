// Unit tests for CRM forwarder

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { forwardToCRM, getCRMEntries, getCRMStats } from '../crm-forwarder';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('CRM Forwarder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('forwardToCRM', () => {
    it('should forward positive reply to CRM', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ id: 'crm-1' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await forwardToCRM({
        lead_id: 'lead-1',
        lead_email: 'test@example.com',
        reply_subject: 'Re: Meeting',
        reply_body: 'Interested in your offer',
        reply_from: 'test@example.com',
        reply_timestamp: new Date(),
      });

      expect(result.success).toBe(true);
      expect(result.crm_entry_id).toBeDefined();
    });

    it('should handle duplicate CRM entry', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ id: 'existing-1' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await forwardToCRM({
        lead_id: 'lead-1',
        lead_email: 'test@example.com',
        reply_subject: 'Re: Meeting',
        reply_body: 'Interested',
        reply_from: 'test@example.com',
        reply_timestamp: new Date(),
      });

      expect(result.success).toBe(true);
      expect(result.crm_entry_id).toBe('existing-1');
    });
  });

  describe('getCRMEntries', () => {
    it('should get CRM entries for a lead', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { id: 'crm-1', reply_subject: 'Re: Meeting', reply_body: 'Interested', reply_from: 'test@test.com', reply_timestamp: new Date() },
        ],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const entries = await getCRMEntries('lead-1');
      expect(entries).toHaveLength(1);
    });
  });

  describe('getCRMStats', () => {
    it('should return CRM statistics', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '50' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '20' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '5' }], rowCount: 1, command: '', oid: 0, fields: [] });

      const stats = await getCRMStats();

      expect(stats.total_forwards).toBe(50);
      expect(stats.by_lead).toBe(20);
      expect(stats.today_forwards).toBe(5);
    });
  });
});
