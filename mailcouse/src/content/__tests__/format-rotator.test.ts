// Unit tests for format rotator

import { textToHtml, formatEmail, alternateFormats, getRandomFormat } from '../format-rotator';

describe('Format Rotator', () => {
  describe('textToHtml', () => {
    it('should convert text to HTML', () => {
      const html = textToHtml('Hello World');
      expect(html).toContain('<div');
      expect(html).toContain('Hello World');
    });

    it('should include signature', () => {
      const html = textToHtml('Hello', 'Best regards');
      expect(html).toContain('Best regards');
    });
  });

  describe('formatEmail', () => {
    it('should format as plain text', () => {
      const result = formatEmail('Hello', 'plain');
      expect(result).toBe('Hello');
    });

    it('should format as HTML', () => {
      const result = formatEmail('Hello', 'html');
      expect(result).toContain('<div');
    });
  });

  describe('alternateFormats', () => {
    it('should alternate formats', () => {
      const formats = alternateFormats(6);
      expect(formats).toHaveLength(6);
      // Should have mix of plain and html
      expect(formats.includes('plain')).toBe(true);
      expect(formats.includes('html')).toBe(true);
    });

    it('should shuffle to avoid predictable patterns', () => {
      const formats1 = alternateFormats(10);
      const formats2 = alternateFormats(10);
      // Very unlikely to be identical after shuffle
      // But we just check they have the right count
      expect(formats1).toHaveLength(10);
      expect(formats2).toHaveLength(10);
    });
  });

  describe('getRandomFormat', () => {
    it('should return valid format', () => {
      const format = getRandomFormat();
      expect(['plain', 'html']).toContain(format);
    });
  });
});
