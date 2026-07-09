// Unit tests for ARF parser

import { parseARFNotification } from '../arf-parser';

describe('ARF Parser', () => {
  describe('parseARFNotification', () => {
    it('should parse standard ARF notification', () => {
      const message = `Complained-Address: test@example.com
Source-IP: 1.2.3.4
Source: gmail.com
Arrival-Date: Mon, 01 Jan 2025 12:00:00 GMT`;

      const result = parseARFNotification(message);

      expect(result).not.toBeNull();
      expect(result?.complained_address).toBe('test@example.com');
      expect(result?.source_ip).toBe('1.2.3.4');
      expect(result?.source).toBe('gmail');
    });

    it('should extract source IP', () => {
      const message = `Complained-Address: test@example.com
Source-IP: 192.168.1.1`;

      const result = parseARFNotification(message);
      expect(result?.source_ip).toBe('192.168.1.1');
    });

    it('should determine source from domain', () => {
      const tests = [
        { domain: 'gmail.com', expected: 'gmail' },
        { domain: 'yahoo.com', expected: 'yahoo' },
        { domain: 'outlook.com', expected: 'outlook' },
      ];

      for (const test of tests) {
        const message = `Complained-Address: test@example.com\nSource: ${test.domain}`;
        const result = parseARFNotification(message);
        expect(result?.source).toBe(test.expected);
      }
    });

    it('should return null for invalid message', () => {
      const result = parseARFNotification('Not an ARF message');
      expect(result).toBeNull();
    });
  });
});
