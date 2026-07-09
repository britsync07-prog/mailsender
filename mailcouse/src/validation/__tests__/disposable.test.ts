// Unit tests for Stage 3: Disposable Domain Check

import { validateDisposable, isDisposableDomain, getDisposableStats } from '../stages/disposable';

describe('Stage 3: Disposable Domain Check', () => {
  describe('disposable email detection', () => {
    const disposableEmails = [
      'test@mailinator.com',
      'user@guerrillamail.com',
      'fake@yopmail.com',
      'spam@grr.la',
      'test@10minutemail.com',
      'user@tempail.com',
      'test@dispostable.com',
    ];

    it.each(disposableEmails)('should detect disposable: %s', (email) => {
      const result = validateDisposable(email);
      expect(result.passed).toBe(false);
      expect(result.error).toContain('Disposable');
    });
  });

  describe('non-disposable emails', () => {
    const nonDisposableEmails = [
      'user@gmail.com',
      'john@company.com',
      'info@business.org',
      'contact@example.net',
      'admin@microsoft.com',
      'support@apple.com',
    ];

    it.each(nonDisposableEmails)('should accept: %s', (email) => {
      const result = validateDisposable(email);
      expect(result.passed).toBe(true);
    });
  });

  describe('isDisposableDomain', () => {
    it('should return true for known disposable domains', () => {
      expect(isDisposableDomain('mailinator.com')).toBe(true);
      expect(isDisposableDomain('guerrillamail.com')).toBe(true);
      expect(isDisposableDomain('yopmail.com')).toBe(true);
    });

    it('should return false for legitimate domains', () => {
      expect(isDisposableDomain('gmail.com')).toBe(false);
      expect(isDisposableDomain('company.com')).toBe(false);
      expect(isDisposableDomain('microsoft.com')).toBe(false);
    });

    it('should handle case insensitivity', () => {
      expect(isDisposableDomain('MAILINATOR.COM')).toBe(true);
      expect(isDisposableDomain('GuerrillaMail.Com')).toBe(true);
    });
  });

  describe('getDisposableStats', () => {
    it('should return database statistics', () => {
      const stats = getDisposableStats();
      expect(stats.total_domains).toBeGreaterThan(100000);
      expect(stats.loaded).toBe(true);
    });
  });

  describe('performance', () => {
    it('should complete check in under 5ms', () => {
      const start = Date.now();
      validateDisposable('test@example.com');
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(5);
    });

    it('should handle 10000 checks in under 1 second', () => {
      const start = Date.now();
      for (let i = 0; i < 10000; i++) {
        validateDisposable(`test${i}@example.com`);
      }
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('edge cases', () => {
    it('should handle invalid email format', () => {
      const result = validateDisposable('notanemail');
      expect(result.passed).toBe(false);
      expect(result.error).toContain('Invalid email');
    });

    it('should handle empty email', () => {
      const result = validateDisposable('');
      expect(result.passed).toBe(false);
    });
  });
});
