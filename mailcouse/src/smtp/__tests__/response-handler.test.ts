// Unit tests for response handler

import { classifyResponse, parseSMTPResponse, getRetryDelay, shouldRetry } from '../response-handler';

describe('Response Handler', () => {
  describe('classifyResponse', () => {
    it('should classify success codes', () => {
      expect(classifyResponse(250).type).toBe('success');
      expect(classifyResponse(251).type).toBe('success');
      expect(classifyResponse(252).type).toBe('success');
    });

    it('should classify soft fail codes', () => {
      expect(classifyResponse(421).type).toBe('soft_fail');
      expect(classifyResponse(450).type).toBe('soft_fail');
      expect(classifyResponse(451).type).toBe('soft_fail');
      expect(classifyResponse(452).type).toBe('soft_fail');
    });

    it('should classify hard fail codes', () => {
      expect(classifyResponse(550).type).toBe('hard_fail');
      expect(classifyResponse(551).type).toBe('hard_fail');
      expect(classifyResponse(553).type).toBe('hard_fail');
      expect(classifyResponse(554).type).toBe('hard_fail');
    });

    it('should recommend retry for soft fails', () => {
      const result = classifyResponse(450);
      expect(result.should_retry).toBe(true);
      expect(result.should_suppress).toBe(false);
    });

    it('should recommend suppression for hard fails', () => {
      const result = classifyResponse(550);
      expect(result.should_retry).toBe(false);
      expect(result.should_suppress).toBe(true);
    });
  });

  describe('parseSMTPResponse', () => {
    it('should parse single line response', () => {
      const result = parseSMTPResponse('250 OK');
      expect(result.code).toBe(250);
      expect(result.message).toBe('OK');
      expect(result.is_multiline).toBe(false);
    });

    it('should parse multiline response', () => {
      const result = parseSMTPResponse('250-ok\r\n250-AUTH LOGIN\r\n250 8BITMIME');
      expect(result.code).toBe(250);
      expect(result.is_multiline).toBe(true);
    });

    it('should handle invalid response', () => {
      const result = parseSMTPResponse('invalid');
      expect(result.code).toBe(0);
    });
  });

  describe('getRetryDelay', () => {
    it('should return 5 minutes for first attempt', () => {
      expect(getRetryDelay(1)).toBe(300000);
    });

    it('should return 15 minutes for second attempt', () => {
      expect(getRetryDelay(2)).toBe(900000);
    });

    it('should return 45 minutes for third attempt', () => {
      expect(getRetryDelay(3)).toBe(2700000);
    });
  });

  describe('shouldRetry', () => {
    it('should retry if under max attempts', () => {
      expect(shouldRetry(1, 3)).toBe(true);
      expect(shouldRetry(2, 3)).toBe(true);
    });

    it('should not retry if at max attempts', () => {
      expect(shouldRetry(3, 3)).toBe(false);
    });
  });
});
