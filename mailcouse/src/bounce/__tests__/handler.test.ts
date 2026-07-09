// Unit tests for handler

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../parser', () => ({
  parseBounceMessage: jest.fn(),
}));

jest.mock('../classifier', () => ({
  classifyBounce: jest.fn(),
}));

jest.mock('../suppressor', () => ({
  suppressBouncedAddress: jest.fn(),
  updateDomainBounceRate: jest.fn(),
}));

import { processBounce, processBounceBatch, getBounceStats } from '../handler';
import { parseBounceMessage } from '../parser';
import { classifyBounce } from '../classifier';
import { suppressBouncedAddress } from '../suppressor';
import { query } from '../../db/connection';

const mockParseBounceMessage = parseBounceMessage as jest.MockedFunction<typeof parseBounceMessage>;
const mockClassifyBounce = classifyBounce as jest.MockedFunction<typeof classifyBounce>;
const mockSuppressBouncedAddress = suppressBouncedAddress as jest.MockedFunction<typeof suppressBouncedAddress>;
const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('processBounce', () => {
    it('should process bounce successfully', async () => {
      mockParseBounceMessage.mockReturnValue({
        recipient: 'test@example.com',
        sender: 'sender@example.com',
        smtp_code: 550,
        message: 'User unknown',
      });

      mockClassifyBounce.mockReturnValue({
        type: 'hard_bounce',
        should_suppress: true,
        should_retry: false,
      });

      mockSuppressBouncedAddress.mockResolvedValue({
        suppressed: true,
        reason: 'Hard bounce',
      });

      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await processBounce('bounce message');

      expect(result.processed).toBe(true);
      expect(result.bounce_type).toBe('hard_bounce');
      expect(result.suppressed).toBe(true);
    });

    it('should handle parse failure', async () => {
      mockParseBounceMessage.mockReturnValue(null);

      const result = await processBounce('invalid message');

      expect(result.processed).toBe(false);
      expect(result.error).toContain('Failed to parse');
    });
  });

  describe('processBounceBatch', () => {
    it('should process batch of bounces', async () => {
      mockParseBounceMessage.mockReturnValue({
        recipient: 'test@example.com',
        sender: 'sender@example.com',
        smtp_code: 550,
        message: 'User unknown',
      });

      mockClassifyBounce.mockReturnValue({
        type: 'hard_bounce',
        should_suppress: true,
        should_retry: false,
      });

      mockSuppressBouncedAddress.mockResolvedValue({
        suppressed: true,
        reason: 'Hard bounce',
      });

      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await processBounceBatch([
        { message: 'bounce 1' },
        { message: 'bounce 2' },
      ]);

      expect(result.total).toBe(2);
      expect(result.processed).toBe(2);
      expect(result.suppressed).toBe(2);
    });
  });

  describe('getBounceStats', () => {
    it('should return bounce statistics', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '50' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ bounce_type: 'hard_bounce', count: '30' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ total: 1000, bounced: 30 }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });

      const stats = await getBounceStats();

      expect(stats.total_bounces).toBe(50);
      expect(stats.bounce_rate_7d).toBe(0.03);
    });
  });
});
