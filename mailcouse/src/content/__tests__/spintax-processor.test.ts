// Unit tests for spintax processor

import { parseSpintax, countVariations, generateVariations, validateSpintax, extractOptions } from '../spintax-processor';

describe('Spintax Processor', () => {
  describe('parseSpintax', () => {
    it('should parse simple spintax', () => {
      const result = parseSpintax('{Hi|Hello|Hey}');
      expect(['Hi', 'Hello', 'Hey']).toContain(result);
    });

    it('should parse nested spintax', () => {
      const result = parseSpintax('{Hi {there|friend}|Hello}');
      expect(result).toMatch(/^(Hi (there|friend)|Hello)$/);
    });

    it('should handle empty input', () => {
      expect(parseSpintax('')).toBe('');
    });

    it('should handle text without spintax', () => {
      expect(parseSpintax('Hello world')).toBe('Hello world');
    });
  });

  describe('countVariations', () => {
    it('should count variations correctly', () => {
      expect(countVariations('{A|B|C}')).toBe(3);
      expect(countVariations('{A|B} {C|D}')).toBe(4);
      expect(countVariations('{A|B|C|D|E}')).toBe(5);
    });

    it('should return 1 for no spintax', () => {
      expect(countVariations('Hello world')).toBe(1);
    });
  });

  describe('generateVariations', () => {
    it('should generate requested number of variations', () => {
      const variations = generateVariations('{A|B|C|D|E}', 5);
      expect(variations).toHaveLength(5);
    });

    it('should generate unique variations', () => {
      const variations = generateVariations('{A|B|C|D|E|F|G|H|I|J}', 10);
      const unique = new Set(variations);
      expect(unique.size).toBe(10);
    });
  });

  describe('validateSpintax', () => {
    it('should validate correct spintax', () => {
      const result = validateSpintax('{A|B|C}');
      expect(result.valid).toBe(true);
    });

    it('should detect unmatched braces', () => {
      const result = validateSpintax('{A|B');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Unmatched'))).toBe(true);
    });

    it('should detect empty options', () => {
      const result = validateSpintax('{A|}');
      expect(result.valid).toBe(false);
    });
  });

  describe('extractOptions', () => {
    it('should extract options from spintax', () => {
      const options = extractOptions('{A|B|C} {X|Y}');
      expect(options).toHaveLength(2);
      expect(options[0]).toEqual(['A', 'B', 'C']);
      expect(options[1]).toEqual(['X', 'Y']);
    });

    it('should return empty array for no spintax', () => {
      const options = extractOptions('Hello world');
      expect(options).toHaveLength(0);
    });
  });
});
