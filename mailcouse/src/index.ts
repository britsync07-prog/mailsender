import express from 'express';
import path from 'path';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import layouts from 'express-ejs-layouts';
import { config } from './config';
import { initializeDatabase, closePool } from './db/connection';
import apiRoutes from './api/routes';
import healthRoutes from './api/health-routes';
import adminRoutes from './api/admin-routes';
import sendRoutes from './api/send-routes';
import authRoutes from './api/auth-routes';
import portalRoutes from './api/portal-routes';
import { authenticate } from './api/auth-middleware';
import { formatDashboardHTML } from './monitoring/dashboard';
import { getDashboardData } from './monitoring/dashboard';
import { startCronRunner, stopCronRunner } from './cron/cron-runner';
import fetch from 'node-fetch';

const app = express();

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(morgan('short'));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// EJS view engine for Postal-like UI
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout extractScripts', true);
app.use(layouts);
app.use(express.static(path.join(__dirname, 'public')));

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
app.use('/api/send', apiLimiter, sendRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/portal', apiLimiter, portalRoutes);

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

app.get('/', (_req, res) => {
  res.redirect('/dashboard');
});

app.get('/api/cron-jobs', (_req, res) => {
  const { getJobConfigs } = require('./cron/scheduler');
  res.json(getJobConfigs());
});

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'api', 'admin-dashboard.html'));
});

// ─── UI Routes (Postal-like frontend) ─────────────────────

// Helper to get token from cookie or header
function getToken(req: express.Request): string | null {
  if (req.cookies?.token) return req.cookies.token;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.substring(7);
  return null;
}

// Store token from API response into cookie
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const apiRes = await fetch(`http://localhost:${config.api.port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await apiRes.json();
    if (!apiRes.ok) {
      return res.render('login', { layout: 'sub', title: 'Sign In', mode: 'login', error: data.error });
    }
    res.cookie('token', data.token, { httpOnly: true, maxAge: config.platform.sessionExpiryHours * 3600000 });
    res.redirect('/portal/dashboard');
  } catch {
    res.render('login', { layout: 'sub', title: 'Sign In', mode: 'login', error: 'Login failed' });
  }
});

app.post('/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const apiRes = await fetch(`http://localhost:${config.api.port}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    });
    const data = await apiRes.json();
    if (!apiRes.ok) {
      return res.render('login', { layout: 'sub', title: 'Create Account', mode: 'signup', error: data.error });
    }
    res.cookie('token', data.token, { httpOnly: true, maxAge: config.platform.sessionExpiryHours * 3600000 });
    res.redirect('/portal/dashboard');
  } catch {
    res.render('login', { layout: 'sub', title: 'Create Account', mode: 'signup', error: 'Signup failed' });
  }
});

app.get('/logout', async (req, res) => {
  const token = getToken(req);
  if (token) {
    try {
      await fetch(`http://localhost:${config.api.port}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      });
    } catch {}
  }
  res.clearCookie('token');
  res.redirect('/login');
});

app.get('/login', (_req, res) => {
  res.render('login', { layout: 'sub', title: 'Sign In', mode: 'login', error: null });
});

app.get('/signup', (_req, res) => {
  res.render('login', { layout: 'sub', title: 'Create Account', mode: 'signup', error: null });
});

app.get('/portal/dashboard', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
      const base = `http://localhost:${config.api.port}`;
      const [userRes, dataRes] = await Promise.all([
        fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
        fetch(`${base}/api/portal/dashboard`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const data = dataRes.ok ? await dataRes.json() : { stats: { domains: 0, credentials: 0, messagesSent: 0 }, recentMessages: [] };
    res.render('dashboard', { layout: 'application', ...data, title: 'Dashboard', active: 'dashboard', email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

app.get('/portal/domains', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes, dataRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/domains`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const data = dataRes.ok ? await dataRes.json() : { domains: [] };
    res.render('domains', { layout: 'application', ...data, title: 'Domains', active: 'domains', email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

app.get('/portal/credentials', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes, dataRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/credentials`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const data = dataRes.ok ? await dataRes.json() : { credentials: [] };
    res.render('credentials', { layout: 'application', ...data, title: 'Credentials', active: 'credentials', email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

app.get('/portal/messages', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  res.redirect('/portal/messages/outgoing');
});

app.get('/portal/messages/outgoing', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const qs = new URLSearchParams({ ...req.query as any, scope: 'outgoing' }).toString();
    const [userRes, dataRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/messages${qs ? '?' + qs : ''}`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const data = dataRes.ok ? await dataRes.json() : { messages: [], pagination: { page: 1, totalPages: 1 } };
    res.render('messages', { layout: 'application', ...data, title: 'Outgoing Messages', scope: 'outgoing', active: 'messages', email: userData.user?.email || '', token, search: req.query.search || '', status: req.query.status || '' });
  } catch { res.redirect('/login'); }
});

app.get('/portal/messages/incoming', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const qs = new URLSearchParams({ ...req.query as any, scope: 'incoming' }).toString();
    const [userRes, dataRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/messages${qs ? '?' + qs : ''}`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const data = dataRes.ok ? await dataRes.json() : { messages: [], pagination: { page: 1, totalPages: 1 } };
    res.render('messages', { layout: 'application', ...data, title: 'Incoming Messages', scope: 'incoming', active: 'messages', email: userData.user?.email || '', token, search: req.query.search || '', status: req.query.status || '' });
  } catch { res.redirect('/login'); }
});

app.get('/portal/messages/held', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const qs = new URLSearchParams({ ...req.query as any, scope: 'held' }).toString();
    const [userRes, dataRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/messages${qs ? '?' + qs : ''}`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const data = dataRes.ok ? await dataRes.json() : { messages: [], pagination: { page: 1, totalPages: 1 } };
    res.render('messages', { layout: 'application', ...data, title: 'Held Messages', scope: 'held', active: 'messages', email: userData.user?.email || '', token, search: req.query.search || '', status: req.query.status || '' });
  } catch { res.redirect('/login'); }
});

app.get('/portal/messages/queue', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const qs = new URLSearchParams({ ...req.query as any, scope: 'outgoing', status: 'queued' }).toString();
    const [userRes, dataRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/messages${qs ? '?' + qs : ''}`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const data = dataRes.ok ? await dataRes.json() : { messages: [], pagination: { page: 1, totalPages: 1 } };
    res.render('messages', { layout: 'application', ...data, title: 'Message Queue', scope: 'queue', active: 'messages', email: userData.user?.email || '', token, search: req.query.search || '', status: req.query.status || '' });
  } catch { res.redirect('/login'); }
});

app.get('/portal/messages/suppressions', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes, dataRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/suppressions`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const data = dataRes.ok ? await dataRes.json() : { suppressions: [] };
    res.render('messages', { layout: 'application', ...data, title: 'Suppressions', scope: 'suppressions', active: 'messages', email: userData.user?.email || '', token, search: '', status: '' });
  } catch { res.redirect('/login'); }
});

app.get('/portal/messages/:id', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes, msgRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/messages/${req.params.id}`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    if (!msgRes.ok) return res.redirect('/portal/messages');
    const data = await msgRes.json();
    res.render('message-detail', { layout: 'application', msg: data.message, title: 'Message', active: 'messages', tab: req.query.tab || 'properties', email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

app.get('/portal/webhooks/history', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const qs = new URLSearchParams(req.query as any).toString();
    const [userRes, dataRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/webhooks/history${qs ? '?' + qs : ''}`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const data = dataRes.ok ? await dataRes.json() : { requests: [], pagination: { page: 1, totalPages: 1 } };
    res.render('webhook-history', { layout: 'application', ...data, title: 'Webhook History', active: 'webhooks', email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

app.get('/portal/webhooks/history/:uuid', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes, dataRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/webhooks/history/${req.params.uuid}`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    if (!dataRes.ok) return res.redirect('/portal/webhooks/history');
    const data = await dataRes.json();
    res.render('webhook-request', { layout: 'application', req: data.request, title: 'Webhook Request', active: 'webhooks', email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

app.get('/portal/settings/limits', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes, dataRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/settings`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const data = dataRes.ok ? await dataRes.json() : { server: {} };
    res.render('settings-limits', { layout: 'application', server: data.server, title: 'Send Limit', active: 'settings', email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

app.get('/portal/settings/retention', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes, dataRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/settings`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const data = dataRes.ok ? await dataRes.json() : { server: {} };
    res.render('settings-retention', { layout: 'application', server: data.server, title: 'Message Retention', active: 'settings', email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

app.get('/portal/settings/advanced', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes, dataRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/settings`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const data = dataRes.ok ? await dataRes.json() : { server: {} };
    res.render('settings-advanced', { layout: 'application', server: data.server, title: 'Advanced Settings', active: 'settings', email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

app.get('/portal/help/outgoing', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    res.render('help-outgoing', {
      layout: 'application', title: 'Help — Sending E-Mail', active: 'help',
      email: userData.user?.email || '', token,
      smtpHost: config.api.host, smtpPort: config.platform.smtpPort,
      credentialName: 'u_' + (userData.user?.id || '').substring(0, 8),
    });
  } catch { res.redirect('/login'); }
});

app.get('/portal/help/incoming', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    res.render('help-incoming', { layout: 'application', title: 'Help — Receiving E-Mail', active: 'help', email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

app.get('/portal/send', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes, domainRes, routeRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/domains`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/routes`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const domainData = domainRes.ok ? await domainRes.json() : { domains: [] };
    const routeData = routeRes.ok ? await routeRes.json() : { routes: [] };
    const firstDomain = domainData.domains?.find((d: any) => d.verified);
    res.render('send-message', {
      layout: 'application',
      title: 'Send Message',
      active: 'messages',
      email: userData.user?.email || '',
      token,
      direction: req.query.direction || 'outgoing',
      message: {
        from: firstDomain ? `test@${firstDomain.domain}` : '',
        to: '',
        subject: `Test Message at ${new Date().toLocaleString()}`,
        plain_body: 'This is a message to test the delivery of messages through Postal.',
      },
      routes: routeData.routes || [],
      domains: domainData.domains || [],
    });
  } catch { res.redirect('/login'); }
});

app.get('/portal/settings', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes, dataRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/settings`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const data = dataRes.ok ? await dataRes.json() : { organization: {}, members: [] };
    res.render('settings', { layout: 'application', org: data.organization, members: data.members, title: 'Settings', active: 'settings', email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

// ─── SMTP Relay Server ────────────────────────────────────
import { createSmtpRelay } from './smtp-relay';
let smtpServer: any = null;

app.get('/portal/routes', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes, dataRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/routes`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const data = dataRes.ok ? await dataRes.json() : { routes: [] };
    res.render('routes', { layout: 'application', ...data, title: 'Routes', active: 'routes', email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

app.get('/portal/webhooks', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes, dataRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/webhooks`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const data = dataRes.ok ? await dataRes.json() : { webhooks: [] };
    res.render('webhooks', { layout: 'application', ...data, title: 'Webhooks', active: 'webhooks', email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

app.get('/portal/track-domains', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes, dataRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/track-domains`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const data = dataRes.ok ? await dataRes.json() : { trackDomains: [] };
    res.render('track-domains', { layout: 'application', ...data, title: 'Tracking Domains', active: 'track-domains', email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

app.get('/portal/pool', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes, dataRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/pool`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const data = dataRes.ok ? await dataRes.json() : { pool: [] };
    res.render('pool', { layout: 'application', ...data, title: 'Subdomain Pool', active: 'pool', email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

// ─── 404 ──────────────────────────────────────────────────

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
      console.log(`UI: http://localhost:${config.api.port}/login`);
    });

    // Start SMTP relay
    smtpServer = createSmtpRelay();
    const smtpPort = config.platform.smtpPort;
    smtpServer.listen(smtpPort, () => {
      console.log(`SMTP relay listening on port ${smtpPort}`);
    });
    console.log(`SMTP relay ready on port ${config.platform.smtpPort}${config.platform.smtpPort !== config.platform.smtpPortAlt ? ` and ${config.platform.smtpPortAlt}` : ''}`);
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
    if (smtpServer) {
      await new Promise<void>((resolve) => smtpServer.close(() => resolve()));
      console.log('SMTP relay stopped');
    }
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
