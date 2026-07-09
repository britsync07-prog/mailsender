// Unit tests for header builder

// Mock environment
process.env.DKIM_ENCRYPTION_KEY = 'test-encryption-key-32-chars-long!!';

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { buildEmailHeaders, formatHeadersForSMTP, verifyRequiredHeaders, verifyNoXMailer } from '../header-builder';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Header Builder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('buildEmailHeaders', () => {
    it('should build complete headers with DKIM', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ dkim_private_key: null, dkim_selector: null }],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      });

      const { headers, dkimResult } = await buildEmailHeaders(
        'sub-1',
        'test@example.com',
        'recipient@company.com',
        'Hello',
        'example.com'
      );

      expect(headers.from).toBe('test@example.com');
      expect(headers.to).toBe('recipient@company.com');
      expect(headers.subject).toBe('Hello');
      expect(headers['message-id']).toBeDefined();
      expect(headers['list-unsubscribe']).toContain('mailto:');
      expect(headers['list-unsubscribe-post']).toBe('List-Unsubscribe=One-Click');
      expect(headers.precedence).toBe('bulk');
    });

    it('should not include X-Mailer', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      });

      const { headers } = await buildEmailHeaders(
        'sub-1',
        'test@example.com',
        'recipient@company.com',
        'Hello',
        'example.com'
      );

      expect(headers['x-mailer']).toBeUndefined();
      expect(headers['X-Mailer']).toBeUndefined();
    });
  });

  describe('formatHeadersForSMTP', () => {
    it('should format headers for SMTP', () => {
      const formatted = formatHeadersForSMTP({
        from: 'test@example.com',
        to: 'recipient@company.com',
        subject: 'Hello',
      });

      expect(formatted).toContain('from: test@example.com');
      expect(formatted).toContain('to: recipient@company.com');
      expect(formatted).toContain('subject: Hello');
      expect(formatted).toContain('\r\n');
    });
  });

  describe('verifyRequiredHeaders', () => {
    it('should pass when all required headers present', () => {
      const result = verifyRequiredHeaders({
        from: 'test@example.com',
        to: 'recipient@company.com',
        subject: 'Hello',
        date: new Date().toUTCString(),
        'message-id': '<test@example.com>',
      });

      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it('should fail when headers missing', () => {
      const result = verifyRequiredHeaders({
        from: 'test@example.com',
      });

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('to');
      expect(result.missing).toContain('subject');
    });
  });

  describe('verifyNoXMailer', () => {
    it('should return true when no X-Mailer', () => {
      expect(verifyNoXMailer({ from: 'test@example.com' })).toBe(true);
    });

    it('should return false when X-Mailer present', () => {
      expect(verifyNoXMailer({ 'x-mailer': 'TestMailer' })).toBe(false);
      expect(verifyNoXMailer({ 'X-Mailer': 'TestMailer' })).toBe(false);
    });
  });
});
