import { decideTiming, getDailyVolumeTarget, resetPatternDiversifier, getCadenceStats } from '../pattern-diversifier';

describe('Pattern Diversifier', () => {
  beforeEach(() => {
    resetPatternDiversifier();
  });

  describe('decideTiming', () => {
    it('should return zero delay on first call', () => {
      const timing = decideTiming('sub-1', 'ip-1');
      expect(timing.delayMs).toBe(0);
      expect(timing.burstRemaining).toBe(0);
    });

    it('should return delay on subsequent calls', () => {
      decideTiming('sub-1', 'ip-1');
      const timing = decideTiming('sub-1', 'ip-1');
      expect(timing.delayMs).toBeGreaterThanOrEqual(0);
    });

    it('should track different subdomain/IP combos separately', () => {
      const t1 = decideTiming('sub-1', 'ip-1');
      const t2 = decideTiming('sub-2', 'ip-2');
      expect(t1.delayMs).toBe(0);
      expect(t2.delayMs).toBe(0);
    });
  });

  describe('getDailyVolumeTarget', () => {
    it('should return a number within capacity', () => {
      const target = getDailyVolumeTarget(1000);
      expect(target).toBeGreaterThanOrEqual(0);
      expect(target).toBeLessThanOrEqual(1000);
    });

    it('should handle zero capacity', () => {
      const target = getDailyVolumeTarget(0);
      expect(target).toBe(0);
    });
  });

  describe('getCadenceStats', () => {
    it('should return stats after sends', () => {
      decideTiming('sub-1', 'ip-1');
      const stats = getCadenceStats();
      expect(stats.activeCadences).toBeGreaterThanOrEqual(1);
    });
  });
});
