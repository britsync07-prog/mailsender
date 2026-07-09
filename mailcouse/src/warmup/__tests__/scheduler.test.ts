// Unit tests for warmup scheduler

import { getScheduleForWeek, calculateWarmupWeek, getWarmupDailyLimit, WARMUP_SCHEDULE } from '../scheduler';

describe('Warmup Scheduler', () => {
  describe('getScheduleForWeek', () => {
    it('should return schedule for week 1', () => {
      const schedule = getScheduleForWeek(1);
      expect(schedule).not.toBeNull();
      expect(schedule?.emails_per_smtp_per_day).toBe(2);
      expect(schedule?.total_per_domain_per_day).toBe(400);
    });

    it('should return schedule for week 3', () => {
      const schedule = getScheduleForWeek(3);
      expect(schedule).not.toBeNull();
      expect(schedule?.emails_per_smtp_per_day).toBe(5);
      expect(schedule?.total_per_domain_per_day).toBe(1000);
    });

    it('should return null for week 5', () => {
      const schedule = getScheduleForWeek(5);
      expect(schedule).toBeNull();
    });
  });

  describe('calculateWarmupWeek', () => {
    it('should calculate week 1 for recent start', () => {
      const start = new Date();
      start.setDate(start.getDate() - 3); // 3 days ago
      const week = calculateWarmupWeek(start);
      expect(week).toBe(1);
    });

    it('should calculate week 2 for 10 days ago', () => {
      const start = new Date();
      start.setDate(start.getDate() - 10);
      const week = calculateWarmupWeek(start);
      expect(week).toBe(2);
    });

    it('should calculate week 3 for 17 days ago', () => {
      const start = new Date();
      start.setDate(start.getDate() - 17);
      const week = calculateWarmupWeek(start);
      expect(week).toBe(3);
    });

    it('should cap at week 4', () => {
      const start = new Date();
      start.setDate(start.getDate() - 60); // 60 days ago
      const week = calculateWarmupWeek(start);
      expect(week).toBe(4);
    });
  });

  describe('getWarmupDailyLimit', () => {
    it('should return 2 for week 1', () => {
      const limit = getWarmupDailyLimit(1);
      expect(limit).toBe(2);
    });

    it('should return 5 for week 3', () => {
      const limit = getWarmupDailyLimit(3);
      expect(limit).toBe(5);
    });

    it('should return default for unknown week', () => {
      const limit = getWarmupDailyLimit(10);
      expect(limit).toBe(3);
    });
  });

  describe('WARMUP_SCHEDULE', () => {
    it('should have 4 weeks defined', () => {
      expect(WARMUP_SCHEDULE).toHaveLength(4);
    });

    it('should increase volume from week 2 to 3', () => {
      expect(WARMUP_SCHEDULE[2].emails_per_smtp_per_day).toBeGreaterThan(
        WARMUP_SCHEDULE[1].emails_per_smtp_per_day
      );
    });
  });
});
