import { Router, Request, Response } from 'express';
import { query } from '../db/connection';
import { getSystemHealth } from '../monitoring/health-checker';
import { getBlacklistStats } from '../monitoring/mxtoolbox-client';
import { getReplacementStats, checkAndReplaceIPs } from '../monitoring/ip-replacement';
import { getDashboardData } from '../monitoring/dashboard';
import { checkDatabaseHealth } from '../db/connection';
import { getJobStats, getExecutionHistory, getJobConfigs, executeJob } from '../cron/scheduler';
import { getCronRunnerStatus } from '../cron/cron-runner';
import { addSuppression, removeSuppression, getSuppressionStats } from '../suppression/manager';
import { createTemplate, getTemplate, getTemplatesByIndustry, updateTemplate, deleteTemplate, getTemplateStats, createNewVersion } from '../content/template-manager';
import { provisionDomain } from '../dns/provisioner';
import { activateSubdomain, pauseSubdomain, resumeSubdomain, getActivationStats } from '../warmup/activator';
import { getWarmupGateStats } from '../warmup/gate';
import { getWarmupStats } from '../warmup/scheduler';
import { startDrain, executeRotation, getRotationStats, provisionNewWorker } from '../worker/rotation';
import { getWorkerStats } from '../worker/registration';
import { getVolumeStats } from '../queue/daily-limiter';
import { CRON_SCHEDULES } from '../cron/types';

const router = Router();
const p = (req: Request, name: string): string => req.params[name] as string;

router.use((req: Request, res: Response, next) => {
  const token = req.headers['authorization'];
  const adminToken = process.env.ADMIN_API_TOKEN;
  if (adminToken && (!token || token !== `Bearer ${adminToken}`)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

router.get('/dashboard', async (_req: Request, res: Response) => {
  try {
    const data = await getDashboardData();
    const volume = await getVolumeStats();
    const cronStats = getJobStats();
    const cronStatus = getCronRunnerStatus();
    const dbHealth = await checkDatabaseHealth();
    const templateStats = await getTemplateStats();
    const suppressionStats = await getSuppressionStats();
    const warmupStats = await getActivationStats();
    const rotationStats = await getRotationStats();
    const workerStats = await getWorkerStats();

    res.json({
      health: data.health,
      volume,
      cron: { stats: cronStats, runner: cronStatus },
      database: dbHealth,
      templates: templateStats,
      suppression: suppressionStats,
      warmup: warmupStats,
      workers: workerStats,
      rotation: rotationStats,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load dashboard', message: error instanceof Error ? error.message : String(error) });
  }
});

router.get('/cron-jobs', (_req: Request, res: Response) => {
  const configs = getJobConfigs();
  const stats = getJobStats();
  const history = getExecutionHistory(20);
  const runner = getCronRunnerStatus();
  res.json({ configs, stats, history, runner });
});

router.post('/cron-jobs/:name/run', async (req: Request, res: Response) => {
  try {
    const result = await executeJob(p(req, 'name'));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: `Failed to run job: ${p(req, 'name')}` });
  }
});

router.put('/cron-jobs/:name/toggle', async (req: Request, res: Response) => {
  try {
    const { enabled } = req.body;
    const updated = CRON_SCHEDULES.map((j) =>
      j.name === p(req, 'name') ? { ...j, enabled: !!enabled } : j
    );
    res.json({ success: true, name: p(req, 'name'), enabled: !!enabled });
  } catch (error) {
    res.status(500).json({ error: 'Failed to toggle cron job' });
  }
});

router.get('/domains', async (_req: Request, res: Response) => {
  try {
    const result = await query(
      `SELECT id, domain, industry, registrar, status, cloudflare_zone_id, dns_provisioned,
              postmaster_score, complaint_rate_7d, bounce_rate_7d,
              created_at, retired_at, retirement_reason
       FROM domains ORDER BY created_at DESC`
    );
    res.json({ domains: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list domains' });
  }
});

router.post('/domains', async (req: Request, res: Response) => {
  try {
    const { domain, industry, registrar } = req.body;
    if (!domain || !industry) {
      return res.status(400).json({ error: 'domain and industry required' });
    }
    const result = await query(
      `INSERT INTO domains (id, domain, industry, registrar, status, created_at)
       VALUES (uuid_generate_v4(), $1, $2, $3, 'pending', NOW())
       RETURNING *`,
      [domain.toLowerCase().trim(), industry, registrar || null]
    );
    res.status(201).json({ domain: result.rows[0] });
  } catch (error: any) {
    if (error?.code === '23505') {
      return res.status(409).json({ error: 'Domain already exists' });
    }
    res.status(500).json({ error: 'Failed to create domain' });
  }
});

router.delete('/domains/:id', async (req: Request, res: Response) => {
  try {
    await query("UPDATE domains SET status = 'retired', retired_at = NOW() WHERE id = $1", [p(req, 'id')]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retire domain' });
  }
});

router.post('/domains/:id/provision', async (req: Request, res: Response) => {
  try {
    const result = await provisionDomain(p(req, 'id'));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'DNS provisioning failed', message: error instanceof Error ? error.message : String(error) });
  }
});

router.get('/subdomains', async (req: Request, res: Response) => {
  try {
    const domainId = req.query.domain_id as string | undefined;
    let sql = `SELECT s.*, d.domain as parent_domain
               FROM subdomains s JOIN domains d ON s.domain_id = d.id`;
    const params: any[] = [];
    if (domainId) {
      sql += ' WHERE s.domain_id = $1';
      params.push(domainId);
    }
    sql += ' ORDER BY s.created_at DESC';
    const result = await query(sql, params);
    res.json({ subdomains: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list subdomains' });
  }
});

router.post('/subdomains/:id/activate', async (req: Request, res: Response) => {
  try {
    const result = await activateSubdomain(p(req, 'id'));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Activation failed' });
  }
});

router.post('/subdomains/:id/pause', async (req: Request, res: Response) => {
  try {
    const result = await pauseSubdomain(p(req, 'id'), req.body.reason || 'Manual pause');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Pause failed' });
  }
});

router.post('/subdomains/:id/resume', async (req: Request, res: Response) => {
  try {
    const result = await resumeSubdomain(p(req, 'id'));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Resume failed' });
  }
});

router.get('/ips', async (_req: Request, res: Response) => {
  try {
    const [ips, blacklist, replacement] = await Promise.all([
      query('SELECT * FROM ip_pool ORDER BY status, priority'),
      getBlacklistStats(),
      getReplacementStats(),
    ]);
    res.json({ ips: ips.rows, blacklist_stats: blacklist, replacement_stats: replacement });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list IPs' });
  }
});

router.post('/ips/replace', async (_req: Request, res: Response) => {
  try {
    const result = await checkAndReplaceIPs();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'IP replacement failed' });
  }
});

router.get('/workers', async (_req: Request, res: Response) => {
  try {
    const [active, rotation] = await Promise.all([
      getWorkerStats(),
      getRotationStats(),
    ]);
    res.json({ workers: active, rotation });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list workers' });
  }
});

router.post('/workers/:id/drain', async (req: Request, res: Response) => {
  try {
    const result = await startDrain(p(req, 'id'));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Drain failed' });
  }
});

router.post('/workers/:id/rotate', async (req: Request, res: Response) => {
  try {
    const result = await executeRotation(p(req, 'id'), req.body.provider || 'unknown');
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Rotation failed' });
  }
});

router.get('/templates', async (_req: Request, res: Response) => {
  try {
    const industry = _req.query.industry as string | undefined;
    const stats = await getTemplateStats();
    if (industry) {
      const templates = await getTemplatesByIndustry(industry);
      res.json({ templates, stats });
    } else {
      const result = await query('SELECT * FROM templates ORDER BY created_at DESC');
      res.json({ templates: result.rows, stats });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

router.post('/templates', async (req: Request, res: Response) => {
  try {
    const { name, industry, subject_spintax, body_spintax, format, length_tier } = req.body;
    if (!name || !industry || !subject_spintax || !body_spintax) {
      return res.status(400).json({ error: 'name, industry, subject_spintax, body_spintax required' });
    }
    const result = await createTemplate({ name, industry, subject_spintax, body_spintax, format, length_tier });
    res.status(201).json({ template: result });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create template' });
  }
});

router.get('/templates/:id', async (req: Request, res: Response) => {
  try {
    const result = await getTemplate(p(req, 'id'));
    if (!result) return res.status(404).json({ error: 'Template not found' });
    res.json({ template: result });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get template' });
  }
});

router.put('/templates/:id', async (req: Request, res: Response) => {
  try {
    const result = await updateTemplate(p(req, 'id'), req.body);
    if (!result) return res.status(404).json({ error: 'Template not found' });
    res.json({ template: result });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update template' });
  }
});

router.post('/templates/:id/version', async (req: Request, res: Response) => {
  try {
    const result = await createNewVersion(p(req, 'id'), req.body);
    res.status(201).json({ template: result });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create new version' });
  }
});

router.delete('/templates/:id', async (req: Request, res: Response) => {
  try {
    const result = await deleteTemplate(p(req, 'id'));
    if (!result) return res.status(404).json({ error: 'Template not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

router.get('/suppression', async (_req: Request, res: Response) => {
  try {
    const search = _req.query.search as string | undefined;
    const stats = await getSuppressionStats();
    let entries;
    if (search) {
      const result = await query(
        `SELECT * FROM suppression_list WHERE email ILIKE $1 ORDER BY suppressed_at DESC LIMIT 100`,
        [`%${search}%`]
      );
      entries = result.rows;
    } else {
      const result = await query(
        `SELECT * FROM suppression_list ORDER BY suppressed_at DESC LIMIT 100`
      );
      entries = result.rows;
    }
    res.json({ entries, stats });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list suppression' });
  }
});

router.post('/suppression', async (req: Request, res: Response) => {
  try {
    const { email, reason } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });
    const result = await addSuppression({ email, reason: reason || 'manual' });
    res.status(201).json({ entry: result });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add suppression' });
  }
});

router.delete('/suppression/:email', async (req: Request, res: Response) => {
  try {
    const result = await removeSuppression(decodeURIComponent(p(req, 'email')));
    res.json({ success: result });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove suppression' });
  }
});

router.get('/warmup', async (_req: Request, res: Response) => {
  try {
    const [gate, warmup, activation] = await Promise.all([
      getWarmupGateStats(),
      getWarmupStats(),
      getActivationStats(),
    ]);
    res.json({ gate, warmup, activation });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get warmup stats' });
  }
});

router.get('/reports', async (_req: Request, res: Response) => {
  try {
    const type = _req.query.type as string | undefined;
    let sql = 'SELECT * FROM report_logs';
    const params: any[] = [];
    if (type) {
      sql += ' WHERE report_type = $1';
      params.push(type);
    }
    sql += ' ORDER BY created_at DESC LIMIT 50';
    const result = await query(sql, params);
    res.json({ reports: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list reports' });
  }
});

router.get('/leads', async (_req: Request, res: Response) => {
  try {
    const page = (_req.query.page as string) || '1';
    const limit = (_req.query.limit as string) || '50';
    const industry = _req.query.industry as string | undefined;
    const status = _req.query.status as string | undefined;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let where = 'WHERE 1=1';
    const params: any[] = [];
    let paramIdx = 1;
    if (industry) { where += ` AND industry = $${paramIdx++}`; params.push(industry); }
    if (status) { where += ` AND status = $${paramIdx++}`; params.push(status); }
    const countResult = await query(`SELECT COUNT(*) as count FROM leads ${where}`, params);
    const total = parseInt(String(countResult.rows[0]?.count || '0'));
    params.push(parseInt(limit), offset);
    const result = await query(
      `SELECT * FROM leads ${where} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      params
    );
    res.json({
      leads: result.rows,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list leads' });
  }
});

router.get('/health', async (_req: Request, res: Response) => {
  try {
    const health = await getSystemHealth();
    res.json(health);
  } catch (error) {
    res.status(500).json({ error: 'Health check failed' });
  }
});

router.get('/config', (_req: Request, res: Response) => {
  const safeConfig = {
    db: { host: '***', port: 5432, name: '***' },
    api: { port: process.env.API_PORT || '3000' },
    cloudflare: { accountId: process.env.CLOUDFLARE_ACCOUNT_ID ? '***' : undefined },
    monitoring: {
      mxtoolboxApiKey: process.env.MXTOOLBOX_API_KEY ? '***' : undefined,
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ? '***' : undefined,
      telegramChatId: process.env.TELEGRAM_CHAT_ID ? '***' : undefined,
    },
    warmup: {
      provider: process.env.WARMBOX_API_KEY ? 'configured' : 'not configured',
    },
    limits: {
      emailsPerSmtpPerDay: 10,
      maxRetries: 3,
      jobTtlHours: 72,
    },
  };
  res.json({ config: safeConfig });
});

export default router;
