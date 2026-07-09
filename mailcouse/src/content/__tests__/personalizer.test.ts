// Unit tests for personalizer

import { resolveTokens, stripUnresolvedTokens, hasUnresolvedTokens, getUnresolvedTokens, validateTokens, createDefaultTokens } from '../personalizer';

describe('Personalizer', () => {
  describe('resolveTokens', () => {
    it('should resolve tokens correctly', () => {
      const result = resolveTokens('Hello {{first_name}} from {{company_name}}', {
        first_name: 'John',
        company_name: 'Acme Corp',
      });
      expect(result).toBe('Hello John from Acme Corp');
    });

    it('should handle missing tokens', () => {
      const result = resolveTokens('Hello {{first_name}}', {});
      expect(result).toBe('Hello {{first_name}}');
    });

    it('should handle multiple same tokens', () => {
      const result = resolveTokens('{{name}} and {{name}}', { name: 'Test' });
      expect(result).toBe('Test and Test');
    });
  });

  describe('stripUnresolvedTokens', () => {
    it('should strip unresolved tokens', () => {
      const result = stripUnresolvedTokens('Hello {{first_name}} {{unknown}}');
      expect(result).toBe('Hello  ');
    });

    it('should leave resolved content intact', () => {
      const result = stripUnresolvedTokens('Hello World');
      expect(result).toBe('Hello World');
    });
  });

  describe('hasUnresolvedTokens', () => {
    it('should detect unresolved tokens', () => {
      expect(hasUnresolvedTokens('Hello {{name}}')).toBe(true);
      expect(hasUnresolvedTokens('Hello World')).toBe(false);
    });
  });

  describe('getUnresolvedTokens', () => {
    it('should get list of unresolved tokens', () => {
      const tokens = getUnresolvedTokens('{{a}} and {{b}} and {{a}}');
      expect(tokens).toEqual(['a', 'b']);
    });

    it('should return empty array when all resolved', () => {
      const tokens = getUnresolvedTokens('Hello World');
      expect(tokens).toHaveLength(0);
    });
  });

  describe('validateTokens', () => {
    it('should validate present tokens', () => {
      const result = validateTokens('{{first_name}} {{company}}', ['first_name', 'company']);
      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it('should detect missing tokens', () => {
      const result = validateTokens('{{first_name}}', ['first_name', 'company']);
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('company');
    });
  });

  describe('createDefaultTokens', () => {
    it('should create default tokens from lead', () => {
      const tokens = createDefaultTokens({
        first_name: 'John',
        company: 'Acme',
        industry: 'cybersecurity',
      });
      expect(tokens.first_name).toBe('John');
      expect(tokens.company_name).toBe('Acme');
      expect(tokens.industry).toBe('cybersecurity');
    });

    it('should handle missing fields', () => {
      const tokens = createDefaultTokens({});
      expect(tokens.first_name).toBe('there');
      expect(tokens.company_name).toBe('your company');
    });
  });
});
