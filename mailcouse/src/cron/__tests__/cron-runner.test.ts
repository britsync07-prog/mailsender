import { startCronRunner, stopCronRunner, getCronRunnerStatus, shouldRunNow } from '../cron-runner';

jest.mock('../../db/connection', () => ({
  query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] }),
}));

jest.mock('../../monitoring/alert-dispatcher', () => ({
  createAlert: jest.fn().mockReturnValue({ id: 'alert-1', severity: 'warning' }),
  sendAlert: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../monitoring/mxtoolbox-client', () => ({
  checkAllIPsBlacklist: jest.fn().mockResolvedValue({ checked: 0, blacklisted: 0, errors: [] }),
}));

jest.mock('../../monitoring/postmaster-client', () => ({
  checkAllDomainsPostmaster: jest.fn().mockResolvedValue({ checked: 0, flagged: 0, errors: [] }),
}));

jest.mock('../../monitoring/domain-retirement', () => ({
  checkAndRetireDomains: jest.fn().mockResolvedValue({ checked: 0, retired: 0, alerts_sent: 0 }),
}));

jest.mock('../../monitoring/ip-replacement', () => ({
  checkAndReplaceIPs: jest.fn().mockResolvedValue({ checked: 0, replaced: 0, alerts_sent: 0 }),
}));

jest.mock('../midnight-reset', () => ({
  runMidnightReset: jest.fn().mockResolvedValue({ success: true, message: 'Reset done' }),
}));

jest.mock('../daily-report', () => ({
  generateDailyReport: jest.fn().mockResolvedValue({ success: true, message: 'Report done' }),
}));

jest.mock('../weekly-report', () => ({
  generateWeeklyReport: jest.fn().mockResolvedValue({ success: true, message: 'Weekly report done' }),
}));

jest.mock('../dead-letter-review', () => ({
  checkDeadLetterQueue: jest.fn().mockResolvedValue({ success: true, message: 'No dead letters' }),
}));

jest.mock('../domain-expiry-check', () => ({
  checkDomainExpiry: jest.fn().mockResolvedValue({ success: true, message: 'No expiring domains' }),
}));

describe('Cron Runner', () => {
  afterEach(async () => {
    await stopCronRunner();
  });

  describe('startCronRunner', () => {
    it('should start with tasks', async () => {
      await startCronRunner();
      const status = getCronRunnerStatus();
      expect(status.running).toBe(true);
      expect(status.tasks).toBeGreaterThan(0);
    });

    it('should not start twice', async () => {
      await startCronRunner();
      await startCronRunner();
      const status = getCronRunnerStatus();
      expect(status.running).toBe(true);
    });
  });

  describe('stopCronRunner', () => {
    it('should stop running', async () => {
      await startCronRunner();
      await stopCronRunner();
      const status = getCronRunnerStatus();
      expect(status.running).toBe(false);
    });
  });

  describe('getCronRunnerStatus', () => {
    it('should return stopped status when not running', () => {
      const status = getCronRunnerStatus();
      expect(status.running).toBe(false);
      expect(status.tasks).toBe(0);
    });
  });

  // Regression tests for the date-blind scheduling bug that permanently
  // blocked fixed-time jobs (midnight_reset et al.) after their first run.
  describe('shouldRunNow scheduling logic', () => {
    const daily = { name: 'midnight_reset', schedule: '0 0 * * *', enabled: true };
    const weekly = { name: 'weekly_report', schedule: '0 9 * * 1', enabled: true };

    it('fires on a new day even if last run was at the same HH:MM yesterday', () => {
      const now = new Date(2026, 7, 25, 0, 0, 30);
      const lastRun = new Date(2026, 7, 24, 0, 0, 5).getTime();
      expect(shouldRunNow(daily as any, lastRun, now)).toBe(true);
    });

    it('does not fire twice within the same slot day', () => {
      const now = new Date(2026, 7, 25, 14, 0, 0);
      const lastRun = new Date(2026, 7, 25, 0, 0, 2).getTime();
      expect(shouldRunNow(daily as any, lastRun, now)).toBe(false);
    });

    it('catches up when the exact minute tick was missed', () => {
      const now = new Date(2026, 7, 25, 6, 37, 12);
      const lastRun = new Date(2026, 7, 23, 0, 0, 1).getTime();
      expect(shouldRunNow(daily as any, lastRun, now)).toBe(true);
    });

    it('does not fire before the scheduled time', () => {
      const nineAmDaily = { name: 'postmaster_pull', schedule: '0 9 * * *', enabled: true };
      const now = new Date(2026, 7, 25, 8, 59, 59); // before today's 09:00 slot
      const lastRun = new Date(2026, 7, 24, 9, 0, 0).getTime();
      expect(shouldRunNow(nineAmDaily as any, lastRun, now)).toBe(false);
    });

    it('fires on matching weekday only (weekly job)', () => {
      const mondayNoon = new Date(2026, 7, 24, 12, 0, 0); // Monday
      const tuesdayNoon = new Date(2026, 7, 25, 12, 0, 0); // Tuesday
      const lastWeekRun = new Date(2026, 7, 17, 9, 0, 3).getTime(); // prior Monday
      expect(shouldRunNow(weekly as any, lastWeekRun, mondayNoon)).toBe(true);
      expect(shouldRunNow(weekly as any, lastWeekRun, tuesdayNoon)).toBe(false);
    });

    it('handles hourly-step schedules ("0 */1 * * *") that previously never fired', () => {
      const hourly = { name: 'warmup_send', schedule: '0 */1 * * *', enabled: true };
      const now = new Date(2026, 7, 25, 5, 0, 10);
      const prevHour = new Date(2026, 7, 25, 4, 0, 2).getTime();
      expect(shouldRunNow(hourly as any, prevHour, now)).toBe(true);
    });

    it('handles "0 */6 * * *" step schedules once per step window', () => {
      const sixHourly = { name: 'ip_blacklist_check', schedule: '0 */6 * * *', enabled: true };
      const dueAt = new Date(2026, 7, 25, 12, 0, 20); // slot 12:00
      const ranAt06 = new Date(2026, 7, 25, 6, 0, 1).getTime();
      const ranAt12 = new Date(2026, 7, 25, 12, 0, 21).getTime();
      const laterSameSlot = new Date(2026, 7, 25, 13, 30, 0);
      expect(shouldRunNow(sixHourly as any, ranAt06, dueAt)).toBe(true);
      expect(shouldRunNow(sixHourly as any, ranAt12, laterSameSlot)).toBe(false);
    });

    it('keeps minute-interval schedules working ("*/15 * * * *")', () => {
      const interval = { name: 'warmup_health', schedule: '*/15 * * * *', enabled: true };
      const now = new Date(2026, 7, 25, 10, 16, 0);
      expect(shouldRunNow(interval as any, now.getTime() - 15 * 60000 - 1000, now)).toBe(true);
      expect(shouldRunNow(interval as any, now.getTime() - 5 * 60000, now)).toBe(false);
    });

    it('never fires for malformed schedules', () => {
      const bad = { name: 'x', schedule: 'garbage', enabled: true };
      expect(shouldRunNow(bad as any, 0)).toBe(false);
    });
  });
});
