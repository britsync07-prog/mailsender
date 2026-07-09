// Unit tests for processor

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../classifier', () => ({
  classifyReply: jest.fn(),
}));

jest.mock('../crm-forwarder', () => ({
  forwardToCRM: jest.fn(),
}));

import { processReply, processReplyBatch, getReplyStats } from '../processor';
import { classifyReply } from '../classifier';
import { forwardToCRM } from '../crm-forwarder';
import { query } from '../../db/connection';

const mockClassifyReply = classifyReply as jest.MockedFunction<typeof classifyReply>;
const mockForwardToCRM = forwardToCRM as jest.MockedFunction<typeof forwardToCRM>;
const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Processor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('processReply', () => {
    it('should process positive reply', async () => {
      mockClassifyReply.mockReturnValue({
        classification: 'positive',
        confidence: 0.8,
        reasoning: 'Matched interest keywords',
      });

      mockForwardToCRM.mockResolvedValue({
        success: true,
        crm_entry_id: 'crm-1',
      });

      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await processReply({
        lead_id: 'lead-1',
        subject: 'Re: Meeting',
        body: 'I am interested',
        from: 'test@example.com',
        timestamp: new Date(),
      });

      expect(result.processed).toBe(true);
      expect(result.classification).toBe('positive');
      expect(result.action).toBe('forwarded_to_crm');
    });

    it('should process negative reply', async () => {
      mockClassifyReply.mockReturnValue({
        classification: 'negative',
        confidence: 0.9,
        reasoning: 'Matched negative keywords',
      });

      mockQuery
        .mockResolvedValueOnce({ rows: [{ email: 'test@test.com' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await processReply({
        lead_id: 'lead-1',
        subject: 'Re: Offer',
        body: 'Not interested',
        from: 'test@example.com',
        timestamp: new Date(),
      });

      expect(result.processed).toBe(true);
      expect(result.classification).toBe('negative');
      expect(result.action).toBe('suppressed');
    });

    it('should process neutral reply', async () => {
      mockClassifyReply.mockReturnValue({
        classification: 'neutral',
        confidence: 0.7,
        reasoning: 'Matched question keywords',
      });

      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await processReply({
        lead_id: 'lead-1',
        subject: 'Question',
        body: 'What are your prices?',
        from: 'test@example.com',
        timestamp: new Date(),
      });

      expect(result.processed).toBe(true);
      expect(result.classification).toBe('neutral');
      expect(result.action).toBe('logged_for_review');
    });
  });

  describe('processReplyBatch', () => {
    it('should process batch of replies', async () => {
      mockClassifyReply.mockReturnValue({
        classification: 'positive',
        confidence: 0.8,
        reasoning: 'Matched keywords',
      });

      mockForwardToCRM.mockResolvedValue({ success: true });
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await processReplyBatch([
        { lead_id: '1', subject: 'Re:', body: 'Interested', from: 'a@test.com', timestamp: new Date() },
        { lead_id: '2', subject: 'Re:', body: 'Interested', from: 'b@test.com', timestamp: new Date() },
      ]);

      expect(result.total).toBe(2);
      expect(result.processed).toBe(2);
      expect(result.positive).toBe(2);
    });
  });

  describe('getReplyStats', () => {
    it('should return reply statistics', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '100' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ classification: 'positive', count: '30' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '30' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '10' }], rowCount: 1, command: '', oid: 0, fields: [] });

      const stats = await getReplyStats();

      expect(stats.total_replies).toBe(100);
      expect(stats.positive_rate).toBe(30);
    });
  });
});
