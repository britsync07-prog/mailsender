// Unit tests for engagement scorer

import { calculateScore, getPriority } from '../scorer';

describe('Engagement Scorer', () => {
  describe('calculateScore', () => {
    it('should calculate score for lead with replies', () => {
      const result = calculateScore(10, 2, 5, 1);
      // reply_rate = 0.2, open_rate = 0.5
      // score = (0.2 * 10) + (0.5 * 2) = 2 + 1 = 3
      // normalized = 3 * 10 = 30
      expect(result.score).toBe(30);
      expect(result.reply_rate).toBe(0.2);
      expect(result.open_rate).toBe(0.5);
    });

    it('should calculate score for lead with no engagement', () => {
      const result = calculateScore(10, 0, 0, 0);
      expect(result.score).toBe(0);
      expect(result.reply_rate).toBe(0);
      expect(result.open_rate).toBe(0);
    });

    it('should calculate score for lead with high engagement', () => {
      const result = calculateScore(10, 5, 8, 3);
      // reply_rate = 0.5, open_rate = 0.8
      // score = (0.5 * 10) + (0.8 * 2) = 5 + 1.6 = 6.6
      // normalized = 66
      expect(result.score).toBe(66);
    });

    it('should handle zero sends', () => {
      const result = calculateScore(0, 0, 0, 0);
      expect(result.score).toBe(0);
      expect(result.reply_rate).toBe(0);
    });

    it('should cap score at 100', () => {
      // Even with perfect engagement, score should not exceed 100
      const result = calculateScore(10, 10, 10, 10);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it('should calculate click rate', () => {
      const result = calculateScore(10, 1, 3, 2);
      expect(result.click_rate).toBe(0.2);
    });
  });

  describe('getPriority', () => {
    it('should return high priority for score > 50', () => {
      expect(getPriority(51)).toBe('high');
      expect(getPriority(100)).toBe('high');
    });

    it('should return medium priority for score 20-50', () => {
      expect(getPriority(20)).toBe('medium');
      expect(getPriority(35)).toBe('medium');
      expect(getPriority(50)).toBe('medium');
    });

    it('should return low priority for score < 20', () => {
      expect(getPriority(0)).toBe('low');
      expect(getPriority(19)).toBe('low');
    });
  });
});
