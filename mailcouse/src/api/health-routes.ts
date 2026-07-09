import { Router, Request, Response } from 'express';
import { getSystemHealth, runHealthCheck } from '../monitoring/health-checker';
import { getBlacklistStats } from '../monitoring/mxtoolbox-client';
import { getReplacementStats } from '../monitoring/ip-replacement';
import { getDashboardData, formatDashboardHTML } from '../monitoring/dashboard';
import { checkDatabaseHealth } from '../db/connection';
import { getJobStats, getExecutionHistory, getJobConfigs } from '../cron/scheduler';
import { getCronRunnerStatus } from '../cron/cron-runner';
import { getCadenceStats } from '../worker/processor';
import { getThreadStats } from '../threading/manager';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const dbHealth = await checkDatabaseHealth();
  res.json({
    status: dbHealth.connected ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    database: dbHealth,
  });
});

router.get('/system', async (_req: Request, res: Response) => {
  try {
    const health = await getSystemHealth();
    res.json(health);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get system health', message: error instanceof Error ? error.message : String(error) });
  }
});

router.get('/domains', async (_req: Request, res: Response) => {
  try {
    const health = await getSystemHealth();
    res.json({ domains: health.domains, overall_status: health.overall_status });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get domain health' });
  }
});

router.get('/ips', async (_req: Request, res: Response) => {
  try {
    const [health, blacklist, replacement] = await Promise.all([
      getSystemHealth(),
      getBlacklistStats(),
      getReplacementStats(),
    ]);
    res.json({
      ips: health.ips,
      blacklist_stats: blacklist,
      replacement_stats: replacement,
      overall_status: health.overall_status,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get IP health' });
  }
});

router.get('/queue', async (_req: Request, res: Response) => {
  try {
    const health = await getSystemHealth();
    const cadence = getCadenceStats();
    res.json({
      queue_depth: health.queue_depth,
      active_workers: health.active_workers,
      daily_volume: health.daily_volume,
      daily_target: health.daily_target,
      cadence_stats: cadence,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get queue status' });
  }
});

router.get('/workers', async (_req: Request, res: Response) => {
  try {
    const health = await getSystemHealth();
    res.json({
      active_workers: health.active_workers,
      overall_status: health.overall_status,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get worker status' });
  }
});

router.get('/cron', async (_req: Request, res: Response) => {
  try {
    const stats = getJobStats();
    const history = getExecutionHistory(10);
    const configs = getJobConfigs();
    const runnerStatus = getCronRunnerStatus();
    res.json({ stats, recent_history: history, configs, runner: runnerStatus });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get cron status' });
  }
});

router.get('/run-check', async (_req: Request, res: Response) => {
  try {
    const result = await runHealthCheck();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Health check failed', message: error instanceof Error ? error.message : String(error) });
  }
});

router.get('/threads', async (_req: Request, res: Response) => {
  try {
    const stats = await getThreadStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get thread stats' });
  }
});

router.get('/db', async (_req: Request, res: Response) => {
  const dbHealth = await checkDatabaseHealth();
  res.json(dbHealth);
});

export default router;
