import express from 'express';
import path from 'path';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { initializeDatabase, closePool } from './db/connection';
import apiRoutes from './api/routes';
import healthRoutes from './api/health-routes';
import adminRoutes from './api/admin-routes';
import { formatDashboardHTML } from './monitoring/dashboard';
import { getDashboardData } from './monitoring/dashboard';
import { startCronRunner, stopCronRunner } from './cron/cron-runner';

const app = express();

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(morgan('short'));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

const apiLimiter = rateLimit({
  windowMs: 60000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

const healthLimiter = rateLimit({
  windowMs: 60000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/leads', apiLimiter, apiRoutes);
app.use('/api/health', healthLimiter, healthRoutes);
app.use('/api/admin', apiLimiter, adminRoutes);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/dashboard', async (_req, res) => {
  try {
    const data = await getDashboardData();
    const html = formatDashboardHTML(data as any);
    res.type('html').send(html);
  } catch (error) {
    res.status(500).type('html').send(`<h1>Dashboard Error</h1><pre>${error instanceof Error ? error.message : String(error)}</pre>`);
  }
});

app.get('/api/cron-jobs', (_req, res) => {
  const { getJobConfigs } = require('./cron/scheduler');
  res.json(getJobConfigs());
});

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'api', 'admin-dashboard.html'));
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: config.api.host === '0.0.0.0' ? 'An unexpected error occurred' : err.message,
  });
});

async function start() {
  try {
    await initializeDatabase();
    console.log('Database initialized');

    await startCronRunner();
    console.log('Cron runner started');

    app.listen(config.api.port, config.api.host, () => {
      console.log(`Mailcouse server running on ${config.api.host}:${config.api.port}`);
      console.log(`Health: http://localhost:${config.api.port}/health`);
      console.log(`Dashboard: http://localhost:${config.api.port}/dashboard`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

const shutdown = async (signal: string) => {
  console.log(`Received ${signal}, shutting down gracefully...`);
  const timeout = setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);

  try {
    await stopCronRunner();
    console.log('Cron runner stopped');
    await closePool();
    console.log('Database pool closed');
    clearTimeout(timeout);
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    clearTimeout(timeout);
    process.exit(1);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();

export default app;
