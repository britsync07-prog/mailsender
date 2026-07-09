// Unit tests for scheduler

// Mock dependencies
jest.mock('../midnight-reset', () => ({
  runMidnightReset: jest.fn().mockResolvedValue({
    job_name: 'midnight_reset',
    started_at: new Date(),
    completed_at: new Date(),
    success: true,
    duration_ms: 100,
    message: 'Reset completed',
  }),
}));

jest.mock('../daily-report', () => ({
  generateDailyReport: jest.fn().mockResolvedValue({
    job_name: 'daily_report',
    started_at: new Date(),
    completed_at: new Date(),
    success: true,
    duration_ms: 200,
    message: 'Report generated',
  }),
}));

jest.mock('../weekly-report', () => ({
  generateWeeklyReport: jest.fn().mockResolvedValue({
    job_name: 'weekly_report',
    started_at: new Date(),
    completed_at: new Date(),
    success: true,
    duration_ms: 300,
    message: 'Weekly report generated',
  }),
}));

jest.mock('../dead-letter-review', () => ({
  checkDeadLetterQueue: jest.fn().mockResolvedValue({
    job_name: 'dead_letter_review',
    started_at: new Date(),
    completed_at: new Date(),
    success: true,
    duration_ms: 50,
    message: 'Dead letter check completed',
  }),
}));

jest.mock('../domain-expiry-check', () => ({
  checkDomainExpiry: jest.fn().mockResolvedValue({
    job_name: 'domain_expiry_check',
    started_at: new Date(),
    completed_at: new Date(),
    success: true,
    duration_ms: 75,
    message: 'Domain expiry check completed',
  }),
}));

import { executeJob, getJobConfigs, getExecutionHistory, getJobStats, validateCronExpression } from '../scheduler';

describe('Scheduler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('executeJob', () => {
    it('should execute midnight reset job', async () => {
      const result = await executeJob('midnight_reset');

      expect(result.success).toBe(true);
      expect(result.job_name).toBe('midnight_reset');
    });

    it('should execute daily report job', async () => {
      const result = await executeJob('daily_report');

      expect(result.success).toBe(true);
      expect(result.job_name).toBe('daily_report');
    });

    it('should handle unknown job', async () => {
      const result = await executeJob('unknown_job');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Unknown job');
    });
  });

  describe('getJobConfigs', () => {
    it('should return all job configurations', () => {
      const configs = getJobConfigs();

      expect(configs.length).toBeGreaterThan(0);
      expect(configs.some((c) => c.name === 'midnight_reset')).toBe(true);
      expect(configs.some((c) => c.name === 'daily_report')).toBe(true);
    });
  });

  describe('getExecutionHistory', () => {
    it('should return execution history', async () => {
      await executeJob('midnight_reset');
      await executeJob('daily_report');

      const history = getExecutionHistory();

      expect(history.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getJobStats', () => {
    it('should return job statistics', async () => {
      await executeJob('midnight_reset');
      await executeJob('daily_report');

      const stats = getJobStats();

      expect(stats.total_executions).toBeGreaterThanOrEqual(2);
      expect(stats.successful).toBeGreaterThanOrEqual(2);
    });
  });

  describe('validateCronExpression', () => {
    it('should validate correct cron expressions', () => {
      expect(validateCronExpression('* * * * *')).toBe(true);
      expect(validateCronExpression('0 0 * * *')).toBe(true);
      expect(validateCronExpression('*/5 * * * *')).toBe(true);
    });

    it('should reject invalid cron expressions', () => {
      expect(validateCronExpression('invalid')).toBe(false);
      expect(validateCronExpression('* * *')).toBe(false);
    });
  });
});
