import { buildHeaders, buildMimeHeaders, reorderHeaders, resetHeaderRandomizer } from '../header-randomizer';

describe('Header Randomizer', () => {
  beforeEach(() => {
    resetHeaderRandomizer();
  });

  describe('buildHeaders', () => {
    it('should generate basic headers', () => {
      const headers = buildHeaders('mail.example.com', 'job-1', 'Hello', 'John');
      expect(headers['Message-ID']).toBeTruthy();
      expect(headers['Message-ID']).toContain('@mail.example.com');
      expect(headers['Date']).toBeTruthy();
      expect(headers['Precedence']).toBeTruthy();
      expect(headers['List-Unsubscribe']).toBeTruthy();
    });

    it('should include pre-headers when provided', () => {
      const headers = buildHeaders('mail.example.com', 'job-1', 'Hello', 'John', {
        'Custom-Header': 'custom-value',
      });
      expect(headers['Custom-Header']).toBe('custom-value');
    });

    it('should generate Message-ID with domain', () => {
      const headers = buildHeaders('sub.example.com', 'abc-123', 'Test', 'John');
      expect(headers['Message-ID']).toMatch(/<.+@sub\.example\.com>/);
    });

    it('should generate valid dates', () => {
      const headers = buildHeaders('example.com', 'job-1', 'Hi', 'Jane');
      expect(new Date(headers['Date']).toUTCString()).toBe(headers['Date']);
    });
  });

  describe('reorderHeaders', () => {
    it('should return all headers in order', () => {
      const headers = {
        'From': 'a@b.com',
        'To': 'c@d.com',
        'Subject': 'Hello',
      };
      const ordered = reorderHeaders(headers);
      expect(ordered.length).toBe(3);
      expect(ordered[0].key).toBe('From');
      expect(ordered[0].value).toBe('a@b.com');
    });

    it('should handle empty headers', () => {
      const ordered = reorderHeaders({});
      expect(ordered).toEqual([]);
    });
  });

  describe('buildMimeHeaders', () => {
    it('should include MIME headers', () => {
      const headers = buildMimeHeaders('example.com', 'job-1', 'Hi', 'Sender');
      const keys = headers.map((h) => h.key);
      expect(keys).toContain('MIME-Version');
      expect(keys).toContain('Content-Type');
      expect(keys).toContain('Content-Transfer-Encoding');
    });

    it('should include Message-ID', () => {
      const headers = buildMimeHeaders('ex.com', 'jid-1', 'Sub', 'Name');
      const msgId = headers.find((h) => h.key === 'Message-ID');
      expect(msgId).toBeTruthy();
      expect(msgId!.value).toContain('@ex.com');
    });

    it('should produce valid MIME output', () => {
      const mimeHeaders = buildMimeHeaders('test.com', 'j-1', 'S', 'N');
      const lines = mimeHeaders.map((h) => `${h.key}: ${h.value}`);
      const output = lines.join('\r\n') + '\r\n\r\nbody';
      expect(output).toContain('Message-ID:');
      expect(output).toContain('MIME-Version: 1.0');
      expect(output).toContain('Content-Type:');
    });
  });
});
