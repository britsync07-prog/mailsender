import { startCronRunner, stopCronRunner, getCronRunnerStatus } from '../cron-runner';

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
});
