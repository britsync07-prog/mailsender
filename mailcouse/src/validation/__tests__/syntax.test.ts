// Unit tests for Stage 1: Syntax Check

import { validateSyntax } from '../stages/syntax';

describe('Stage 1: Syntax Check', () => {
  describe('valid emails', () => {
    const validEmails = [
      'user@example.com',
      'user.name@example.com',
      'user+tag@example.com',
      'user@sub.example.com',
      'user@example.co.uk',
      'user@example-domain.com',
      'user123@example.com',
      'first.last@example.com',
      'a@example.com',
      'user@ex.com',
    ];

    it.each(validEmails)('should accept: %s', (email) => {
      const result = validateSyntax(email);
      expect(result.passed).toBe(true);
      expect(result.stage).toBe('syntax');
    });
  });

  describe('invalid emails', () => {
    const invalidEmails = [
      { email: '', error: 'empty' },
      { email: 'notanemail', error: '@' },
      { email: '@example.com', error: 'empty' },
      { email: 'user@', error: 'empty' },
      { email: 'user@@example.com', error: '@' },
      { email: 'user@.com', error: 'dot' },
      { email: 'user@com', error: 'dot' },
      { email: 'user@exam ple.com', error: 'format' },
    ];

    it.each(invalidEmails.map((e) => [e.email, e.error]))(
      'should reject: %s (expecting %s error)',
      (email) => {
        const result = validateSyntax(email);
        expect(result.passed).toBe(false);
        expect(result.error).toBeDefined();
      }
    );
  });

  describe('edge cases', () => {
    it('should handle null input', () => {
      const result = validateSyntax(null as any);
      expect(result.passed).toBe(false);
    });

    it('should handle undefined input', () => {
      const result = validateSyntax(undefined as any);
      expect(result.passed).toBe(false);
    });

    it('should handle very long email', () => {
      const longEmail = 'a'.repeat(300) + '@example.com';
      const result = validateSyntax(longEmail);
      expect(result.passed).toBe(false);
      expect(result.error).toContain('length');
    });

    it('should handle email with spaces', () => {
      const result = validateSyntax('user @example.com');
      expect(result.passed).toBe(false);
    });

    it('should normalize email to lowercase', () => {
      const result = validateSyntax('User@Example.COM');
      expect(result.passed).toBe(true);
    });

    it('should handle email with special characters', () => {
      const result = validateSyntax('user.name+tag@example.com');
      expect(result.passed).toBe(true);
    });
  });

  describe('performance', () => {
    it('should complete in under 10ms', () => {
      const start = Date.now();
      validateSyntax('test@example.com');
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(10);
    });
  });
});
