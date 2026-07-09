// Unit tests for spam guard

import { checkSpam, cleanSpam, getSpamStats } from '../spam-guard';

describe('Spam Guard', () => {
  describe('checkSpam', () => {
    it('should pass clean content', () => {
      const result = checkSpam('Hello, I wanted to reach out about our services.');
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it('should detect banned words', () => {
      const result = checkSpam('Get free money now!');
      expect(result.passed).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it('should detect ALL CAPS words', () => {
      const result = checkSpam('This is URGENT news');
      expect(result.passed).toBe(false);
      expect(result.violations.some(v => v.includes('ALL CAPS'))).toBe(true);
    });

    it('should detect multiple exclamation marks', () => {
      const result = checkSpam('Great news!!');
      expect(result.passed).toBe(false);
      expect(result.violations.some(v => v.includes('exclamation'))).toBe(true);
    });

    it('should detect em dashes', () => {
      const result = checkSpam('This is a test — with em dash');
      expect(result.passed).toBe(false);
      expect(result.violations.some(v => v.includes('Em dash'))).toBe(true);
    });

    it('should provide replacement suggestions', () => {
      const result = checkSpam('Get this free offer');
      expect(result.suggestions.length).toBeGreaterThan(0);
    });
  });

  describe('cleanSpam', () => {
    it('should clean banned words', () => {
      const { cleaned, changes } = cleanSpam('Get this free offer');
      expect(cleaned).not.toContain('Get');
      expect(cleaned).not.toContain('free');
      expect(changes.length).toBeGreaterThan(0);
    });

    it('should clean em dashes', () => {
      const { cleaned } = cleanSpam('Test — with dash');
      expect(cleaned).not.toContain('—');
    });

    it('should clean multiple exclamation marks', () => {
      const { cleaned } = cleanSpam('Great news!!');
      expect(cleaned).not.toContain('!!');
    });

    it('should lowercase ALL CAPS words', () => {
      const { cleaned } = cleanSpam('This is URGENT');
      expect(cleaned).not.toContain('URGENT');
    });
  });

  describe('getSpamStats', () => {
    it('should return spam statistics', () => {
      const stats = getSpamStats();
      expect(stats.banned_words).toBeGreaterThan(0);
      expect(stats.banned_patterns).toBeGreaterThan(0);
      expect(stats.replacement_rules).toBeGreaterThan(0);
    });
  });
});
