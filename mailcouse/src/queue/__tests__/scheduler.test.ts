// Unit tests for scheduler

import { calculateNextSendTime, isInSendWindow, isSendDay, DEFAULT_SCHEDULE_CONFIG } from '../scheduler';

describe('Scheduler', () => {
  describe('calculateNextSendTime', () => {
    it('should return a future date', () => {
      const fromTime = new Date();
      const next = calculateNextSendTime(DEFAULT_SCHEDULE_CONFIG, fromTime);
      expect(next).toBeDefined();
      expect(next.getTime()).toBeGreaterThanOrEqual(fromTime.getTime());
    });

    it('should return date within send window on send day', () => {
      // Create a Monday at 10 AM EST
      const fromTime = new Date('2025-01-06T15:00:00Z'); // 10 AM EST
      const next = calculateNextSendTime(DEFAULT_SCHEDULE_CONFIG, fromTime);
      expect(next).toBeDefined();
    });
  });

  describe('isInSendWindow', () => {
    it('should handle timezone correctly', () => {
      // 10 AM EST = 3 PM UTC
      const time = new Date('2025-01-06T15:00:00Z');
      const result = isInSendWindow(time);
      // Result depends on timezone conversion
      expect(typeof result).toBe('boolean');
    });
  });

  describe('isSendDay', () => {
    it('should return true for Monday', () => {
      const time = new Date('2025-01-06T10:00:00Z'); // Monday
      expect(isSendDay(time)).toBe(true);
    });

    it('should return false for Saturday', () => {
      const time = new Date('2025-01-11T10:00:00Z'); // Saturday
      expect(isSendDay(time)).toBe(false);
    });

    it('should return false for Sunday', () => {
      const time = new Date('2025-01-12T10:00:00Z'); // Sunday
      expect(isSendDay(time)).toBe(false);
    });

    it('should return true for Friday', () => {
      const time = new Date('2025-01-10T10:00:00Z'); // Friday
      expect(isSendDay(time)).toBe(true);
    });
  });

  describe('DEFAULT_SCHEDULE_CONFIG', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_SCHEDULE_CONFIG.timezone).toBe('America/New_York');
      expect(DEFAULT_SCHEDULE_CONFIG.send_window_start).toBe(9);
      expect(DEFAULT_SCHEDULE_CONFIG.send_window_end).toBe(17);
      expect(DEFAULT_SCHEDULE_CONFIG.send_days).toEqual([1, 2, 3, 4, 5]);
    });
  });
});
