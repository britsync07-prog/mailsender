// Unit tests for code parser

import { parseRawResponse, classifyCode, getCodeDescription, isTemporaryFailure, isPermanentFailure } from '../code-parser';

describe('Code Parser', () => {
  describe('parseRawResponse', () => {
    it('should parse single line response', () => {
      const result = parseRawResponse('250 OK');
      expect(result.code).toBe(250);
      expect(result.message).toBe('OK');
      expect(result.category).toBe('success');
    });

    it('should parse multiline response', () => {
      const result = parseRawResponse('250-ok\r\n250-AUTH LOGIN\r\n250 8BITMIME');
      expect(result.code).toBe(250);
      expect(result.category).toBe('success');
    });

    it('should extract enhanced status code', () => {
      const result = parseRawResponse('550 5.1.1 User unknown');
      expect(result.code).toBe(550);
      expect(result.enhanced_code).toBe('5.1.1');
    });

    it('should handle invalid response', () => {
      const result = parseRawResponse('invalid');
      expect(result.code).toBe(0);
      expect(result.category).toBe('unknown');
    });
  });

  describe('classifyCode', () => {
    it('should classify 2xx as success', () => {
      expect(classifyCode(250)).toBe('success');
      expect(classifyCode(251)).toBe('success');
      expect(classifyCode(252)).toBe('success');
    });

    it('should classify 4xx as soft_fail', () => {
      expect(classifyCode(421)).toBe('soft_fail');
      expect(classifyCode(450)).toBe('soft_fail');
      expect(classifyCode(451)).toBe('soft_fail');
      expect(classifyCode(452)).toBe('soft_fail');
    });

    it('should classify 5xx as hard_fail', () => {
      expect(classifyCode(550)).toBe('hard_fail');
      expect(classifyCode(551)).toBe('hard_fail');
      expect(classifyCode(553)).toBe('hard_fail');
      expect(classifyCode(554)).toBe('hard_fail');
    });

    it('should classify unknown codes', () => {
      expect(classifyCode(999)).toBe('unknown');
    });
  });

  describe('getCodeDescription', () => {
    it('should return description for known codes', () => {
      expect(getCodeDescription(250)).toContain('OK');
      expect(getCodeDescription(550)).toContain('Mailbox');
    });

    it('should return generic message for unknown codes', () => {
      expect(getCodeDescription(999)).toContain('Unknown');
    });
  });

  describe('isTemporaryFailure / isPermanentFailure', () => {
    it('should identify temporary failures', () => {
      expect(isTemporaryFailure(450)).toBe(true);
      expect(isTemporaryFailure(250)).toBe(false);
    });

    it('should identify permanent failures', () => {
      expect(isPermanentFailure(550)).toBe(true);
      expect(isPermanentFailure(250)).toBe(false);
    });
  });
});
