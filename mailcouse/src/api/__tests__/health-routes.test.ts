import express from 'express';
import request from 'supertest';
import healthRoutes from '../health-routes';

jest.mock('../../db/connection', () => ({
  checkDatabaseHealth: jest.fn().mockResolvedValue({ connected: true, poolSize: 5, idleCount: 3, waitingCount: 0 }),
  query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] }),
}));

jest.mock('../../monitoring/health-checker', () => ({
  getSystemHealth: jest.fn().mockResolvedValue({
    overall_status: 'healthy',
    domains: [],
    ips: [],
    queue_depth: 0,
    active_workers: 2,
    daily_volume: 5000,
    daily_target: 100000,
  }),
  runHealthCheck: jest.fn().mockResolvedValue({ health: { overall_status: 'healthy' }, alerts_sent: 0, duration_ms: 100 }),
}));

jest.mock('../../monitoring/mxtoolbox-client', () => ({
  getBlacklistStats: jest.fn().mockResolvedValue({ total_ips: 10, active: 8, blacklisted: 0, reserve: 2, last_check: null }),
}));

jest.mock('../../monitoring/ip-replacement', () => ({
  getReplacementStats: jest.fn().mockResolvedValue({ blacklisted_ips: 0, reserve_ips: 2, active_ips: 8, recent_replacements: [] }),
}));

jest.mock('../../monitoring/dashboard', () => ({
  getDashboardData: jest.fn().mockResolvedValue({ health: { overall_status: 'healthy' }, blacklist: {}, replacement: {}, generated_at: new Date() }),
  formatDashboardHTML: jest.fn().mockReturnValue('<html><body>Dashboard</body></html>'),
}));

jest.mock('../../cron/scheduler', () => ({
  getJobStats: jest.fn().mockReturnValue({ total_executions: 10, successful: 9, failed: 1, avg_duration_ms: 500 }),
  getExecutionHistory: jest.fn().mockReturnValue([]),
  getJobConfigs: jest.fn().mockReturnValue([]),
}));

jest.mock('../../cron/cron-runner', () => ({
  getCronRunnerStatus: jest.fn().mockReturnValue({ running: true, tasks: 14, enabled: 14, lastRuns: {} }),
}));

jest.mock('../../worker/processor', () => ({
  getCadenceStats: jest.fn().mockReturnValue({ activeCadences: 3, totalDailySent: 500 }),
}));

jest.mock('../../threading/manager', () => ({
  getThreadStats: jest.fn().mockResolvedValue({ totalThreads: 50, activeThreads: 30, totalMessages: 120 }),
}));

const app = express();
app.use(express.json());
app.use('/api/health', healthRoutes);

describe('Health Routes', () => {
  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });

  describe('GET /api/health/system', () => {
    it('should return system health', async () => {
      const res = await request(app).get('/api/health/system');
      expect(res.status).toBe(200);
      expect(res.body.overall_status).toBe('healthy');
    });
  });

  describe('GET /api/health/domains', () => {
    it('should return domain health', async () => {
      const res = await request(app).get('/api/health/domains');
      expect(res.status).toBe(200);
      expect(res.body.domains).toBeDefined();
    });
  });

  describe('GET /api/health/ips', () => {
    it('should return IP health', async () => {
      const res = await request(app).get('/api/health/ips');
      expect(res.status).toBe(200);
      expect(res.body.ips).toBeDefined();
    });
  });

  describe('GET /api/health/queue', () => {
    it('should return queue status', async () => {
      const res = await request(app).get('/api/health/queue');
      expect(res.status).toBe(200);
      expect(res.body.queue_depth).toBe(0);
    });
  });

  describe('GET /api/health/workers', () => {
    it('should return worker status', async () => {
      const res = await request(app).get('/api/health/workers');
      expect(res.status).toBe(200);
      expect(res.body.active_workers).toBe(2);
    });
  });

  describe('GET /api/health/cron', () => {
    it('should return cron status', async () => {
      const res = await request(app).get('/api/health/cron');
      expect(res.status).toBe(200);
      expect(res.body.runner.running).toBe(true);
    });
  });

  describe('GET /api/health/db', () => {
    it('should return database health', async () => {
      const res = await request(app).get('/api/health/db');
      expect(res.status).toBe(200);
      expect(res.body.connected).toBe(true);
    });
  });

  describe('GET /api/health/threads', () => {
    it('should return thread stats', async () => {
      const res = await request(app).get('/api/health/threads');
      expect(res.status).toBe(200);
      expect(res.body.totalThreads).toBe(50);
    });
  });

  describe('GET /api/health/run-check', () => {
    it('should run health check', async () => {
      const res = await request(app).get('/api/health/run-check');
      expect(res.status).toBe(200);
      expect(res.body.health.overall_status).toBe('healthy');
    });
  });
});
