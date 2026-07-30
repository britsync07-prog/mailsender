// Unit tests for handler

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
  getPool: jest.fn(() => ({ totalCount: 0, idleCount: 0, waitingCount: 0 })),
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

const BOUNCE_MESSAGE_WITH_TO =
  'To: test@example.com\r\n' +
  'From: sender@example.com\r\n' +
  'Subject: bounce\r\n' +
  'Original-Recipient: rfc822;bounce@test.com\r\n' +
  'Diagnostic-Code: smtp; 550 5.1.1 User unknown\r\n' +
  '\r\nbody';

const INVALID_MESSAGE = 'no headers here at all\r\n\r\njust body';

describe('Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('processBounce', () => {
    it('should process bounce successfully', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await processBounce(BOUNCE_MESSAGE_WITH_TO);

      expect(result.processed).toBe(true);
      expect(result.suppressed).toBe(true);
    });

    it('should handle parse failure', async () => {
      const result = await processBounce(INVALID_MESSAGE);

      expect(result.processed).toBe(false);
      expect(result.error).toContain('Failed to parse');
    });
  });

  describe('processBounceBatch', () => {
    it('should process batch of bounces', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await processBounceBatch([
        { message: BOUNCE_MESSAGE_WITH_TO },
        { message: BOUNCE_MESSAGE_WITH_TO.replace('test@example.com', 'other@example.com') },
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