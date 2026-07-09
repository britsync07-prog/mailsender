// Unit tests for parser

import { parseBounceMessage } from '../parser';

describe('Parser', () => {
  describe('parseBounceMessage', () => {
    it('should parse standard bounce message', () => {
      const message = `From: postmaster@example.com
To: sender@example.com
Subject: Delivery Status Notification
Original-Recipient: recipient@company.com
Diagnostic-Code: 550 5.1.1 User unknown
Action: failed
Status: 5.1.1`;

      const result = parseBounceMessage(message);

      expect(result).not.toBeNull();
      expect(result?.recipient).toBe('recipient@company.com');
      expect(result?.smtp_code).toBe(550);
      expect(result?.diagnostic_code).toBe('5.1.1');
    });

    it('should extract recipient from various formats', () => {
      const formats = [
        'Original-Recipient: test@example.com',
        'Final-Recipient: <test@example.com>',
        'X-Failed-Recipients: test@example.com',
      ];

      for (const format of formats) {
        const result = parseBounceMessage(format);
        expect(result?.recipient).toBe('test@example.com');
      }
    });

    it('should extract SMTP code', () => {
      const result = parseBounceMessage('SMTP error 550 User unknown');
      expect(result?.smtp_code).toBe(550);
    });

    it('should handle invalid message with defaults', () => {
      const result = parseBounceMessage('Not a bounce message');
      expect(result).not.toBeNull();
      expect(result?.smtp_code).toBe(0);
      expect(result?.recipient).toBe('unknown@unknown.com');
    });
  });
});
