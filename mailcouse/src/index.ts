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
import trackingRoutes from './api/tracking-routes';
import { startBounceHandler, stopBounceHandler } from './bounce/handler';
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

// Global EJS helpers
app.locals.timeAgo = function(date: Date | string | null | undefined): string {
  if (!date) return 'Never';
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  return `${Math.floor(diffMonths / 12)}y ago`;
};

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

function getFlash(req: express.Request): { type: string; message: string } | null {
  const notice = req.query.notice as string | undefined;
  const alert = req.query.alert as string | undefined;
  if (notice) return { type: 'notice', message: notice };
  if (alert) return { type: 'alert', message: alert };
  return null;
}

async function fetchServerHeader(token: string): Promise<Record<string, unknown>> {
  try {
    const base = `http://localhost:${config.api.port}`;
    const res = await fetch(`${base}/api/portal/dashboard`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) return {};
    const data = await res.json();
    const stats = data.stats || {};
    const sent = parseInt(stats.messagesSent || 0);
    const bounces = parseInt(stats.bounces || 0);
    const limit = stats.sendLimit ? parseInt(stats.sendLimit) : null;
    const todaySent = parseInt(stats.todaySent || 0);
    const ds = data.domain_stats || {};
    return {
      serverMode: data.server?.mode || 'live',
      serverName: 'Mail Server',
      totalDomains: ds.total ?? parseInt(stats.domains || 0),
      unverifiedDomains: ds.unverified ?? 0,
      badDnsDomains: ds.bad_dns ?? 0,
      heldMessages: parseInt(stats.held || 0),
      queuedMessages: parseInt(stats.queued || 0),
      bounceRate: sent > 0 ? (bounces / sent * 100).toFixed(1) : '0.0',
      diskUsed: '0 MB',
      outgoingPct: limit && limit > 0 ? Math.min(100, Math.round(todaySent / limit * 100)) : 0,
      outgoingMessages: todaySent,
      incomingMessages: 0,
      messageRate: (parseInt(stats.dailyAverage || 0) / 1440).toFixed(2),
      sendLimit: limit,
    };
  } catch {
    return {};
  }
}

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
app.use('/track', trackingRoutes);

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
  res.redirect('/login');
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

app.get('/login/reset', (_req, res) => {
  res.render('password-reset', { layout: 'sub', title: 'Reset your password', flash: null });
});

app.post('/login/reset', async (req, res) => {
  try {
    const apiRes = await fetch(`http://localhost:${config.api.port}/api/auth/password-reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email_address: req.body.email_address }),
    });
    const data = await apiRes.json();
    if (data.reset_token) {
      return res.render('password-reset', {
        layout: 'sub', title: 'Reset your password',
        flash: { type: 'notice', message: data.message },
        devLink: `http://localhost:${config.api.port}/login/reset/${data.reset_token}`,
      });
    }
    res.render('password-reset', { layout: 'sub', title: 'Reset your password', flash: { type: 'notice', message: data.message } });
  } catch {
    res.render('password-reset', { layout: 'sub', title: 'Reset your password', flash: { type: 'error', message: 'Failed to start password reset' } });
  }
});

app.get('/login/reset/:token', (req, res) => {
  res.render('password-reset-finish', { layout: 'sub', title: 'Reset your password', token: req.params.token, flash: null });
});

app.post('/login/reset/:token', async (req, res) => {
  try {
    const apiRes = await fetch(`http://localhost:${config.api.port}/api/auth/password-reset/${req.params.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: req.body.password, password_confirmation: req.body.password_confirmation }),
    });
    const data = await apiRes.json();
    if (!apiRes.ok) {
      return res.render('password-reset-finish', { layout: 'sub', title: 'Reset your password', token: req.params.token, flash: { type: 'error', message: data.error } });
    }
    res.redirect('/login');
  } catch {
    res.render('password-reset-finish', { layout: 'sub', title: 'Reset your password', token: req.params.token, flash: { type: 'error', message: 'Failed to reset password' } });
  }
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
    const data = dataRes.ok ? await dataRes.json() : { stats: { domains: 0, credentials: 0, messagesSent: 0, held: 0, queued: 0, bounces: 0, todaySent: 0, sendLimit: null }, recentMessages: [], server: { mode: 'live', suspended: false } };
    const header = await fetchServerHeader(token);
    const outRaw = (data.stats?.graphOutgoing || '').split(',').map((n: string) => parseInt(n || '0'));
    const inRaw = (data.stats?.graphIncoming || '').split(',').map((n: string) => parseInt(n || '0'));
    const labels: string[] = [];
    for (let i = outRaw.length - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      labels.push(d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
    }
    res.render('dashboard', {
      layout: 'application', ...data, ...header, title: 'Dashboard', active: 'dashboard', email: userData.user?.email || '', token,
      graphLabels: labels,
      graphSeries: [outRaw.slice().reverse(), inRaw.slice().reverse()],
      graphData: labels.map((label, i) => ({ label, out: outRaw[outRaw.length - 1 - i], in: inRaw[inRaw.length - 1 - i] })),
      graphFirstDate: labels[0] || new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    });
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
    const flash = getFlash(req);
    const header = await fetchServerHeader(token);
    res.render('domains', { layout: 'application', ...data, ...header, flash, title: 'Domains', active: 'domains', email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

app.get('/portal/domains/add', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const userRes = await fetch(`http://localhost:${config.api.port}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const header = await fetchServerHeader(token);
    res.render('add-domain', { layout: 'application', ...header, error: req.query.error || null, title: 'Add Domain', active: 'domains', email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

app.get('/portal/domains/:id/setup', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes, dataRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/domains/${req.params.id}/setup`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const data = dataRes.ok ? await dataRes.json() : {};
    if (data.redirect) {
      const flash = data.flash ? `?${data.flash.notice ? 'notice' : 'alert'}=${encodeURIComponent(data.flash.notice || data.flash.alert)}` : '';
      return res.redirect(data.redirect + flash);
    }
    const header = await fetchServerHeader(token);
    res.render('domain-setup', {
      layout: 'application',
      ...header,
      flash: getFlash(req),
      id: data.id,
      name: data.name || req.params.id,
      dnsCheckedAt: data.dns_checked_at || null,
      spfRecord: data.spf_record || '',
      dkimRecordName: data.dkim_record_name || '',
      dkimRecord: data.dkim_record || '',
      returnPathDomain: data.return_path_domain || '',
      returnPathTarget: data.return_path_target || '',
      mxRecords: data.mx_records || [],
      checks: data.checks || { spf: { status: null, error: null }, dkim: { status: null, error: null }, mx: { status: null, error: null }, return_path: { status: null, error: null } },
      spfInclude: (data.spf_record || '').match(/include:([^\s]+)/)?.[1] || config.dns.spfInclude,
      title: 'DNS Setup', active: 'domains', email: userData.user?.email || '', token,
    });
  } catch { res.redirect('/login'); }
});

app.get('/portal/domains/:id/verify', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes, dataRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/domains/${req.params.id}/verify${req.query.email_address ? `?email_address=${encodeURIComponent(req.query.email_address as string)}` : ''}`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const data = dataRes.ok ? await dataRes.json() : {};
    if (data.verified && data.redirect) {
      const flash = data.flash ? `?${data.flash.notice ? 'notice' : 'alert'}=${encodeURIComponent(data.flash.notice || data.flash.alert)}` : '';
      return res.redirect(data.redirect + flash);
    }
    const header = await fetchServerHeader(token);
    res.render('domain-verify', {
      layout: 'application',
      ...header,
      domainId: data.id || req.params.id,
      domainName: data.name || '',
      verificationMethod: data.verification_method || 'DNS',
      dnsVerificationString: data.dns_verification_string || '',
      verificationEmailAddresses: data.verification_email_addresses || [],
      emailAddress: data.email_address || '',
      title: 'Verify Domain', active: 'domains', email: userData.user?.email || '', token,
    });
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
    const header = await fetchServerHeader(token);
    res.render('credentials', { layout: 'application', ...header, ...data, title: 'Credentials', active: 'credentials', email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

app.get('/portal/credentials/add', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes, domainRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/domains`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const domainData = domainRes.ok ? await domainRes.json() : { domains: [] };
    const header = await fetchServerHeader(token);
    res.render('add-credential', { layout: 'application', ...header, domains: domainData.domains || [], title: 'Add Credential', active: 'credentials', email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

app.get('/portal/credentials/:id/edit', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes, credRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/credentials/${req.params.id}`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    if (credRes.status === 404) return res.redirect('/portal/credentials');
    const userData = await userRes.json();
    const credential = await credRes.json();
    const header = await fetchServerHeader(token);
    res.render('add-credential', { layout: 'application', ...header, credential, title: 'Edit Credential', active: 'credentials', email: userData.user?.email || '', token });
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
    const header = await fetchServerHeader(token);
    res.render('messages', { layout: 'application', ...header, ...data, title: 'Outgoing Messages', scope: 'outgoing', active: 'messages', email: userData.user?.email || '', token, search: req.query.search || '', status: req.query.status || '', currentPath: '/portal/messages/outgoing' });
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
    const header = await fetchServerHeader(token);
    res.render('messages', { layout: 'application', ...header, ...data, title: 'Incoming Messages', scope: 'incoming', active: 'messages', email: userData.user?.email || '', token, search: req.query.search || '', status: req.query.status || '', currentPath: '/portal/messages/incoming' });
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
    const header = await fetchServerHeader(token);
    res.render('messages', { layout: 'application', ...header, ...data, title: 'Held Messages', scope: 'held', active: 'messages', email: userData.user?.email || '', token, search: req.query.search || '', status: req.query.status || '', currentPath: '/portal/messages/held' });
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
    const header = await fetchServerHeader(token);
    res.render('messages', { layout: 'application', ...header, ...data, title: 'Message Queue', scope: 'queue', active: 'messages', email: userData.user?.email || '', token, search: req.query.search || '', status: req.query.status || '', currentPath: '/portal/messages/queue' });
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
    const header = await fetchServerHeader(token);
    res.render('messages', { layout: 'application', ...header, ...data, title: 'Suppressions', scope: 'suppressions', active: 'messages', email: userData.user?.email || '', token, search: '', status: '' });
  } catch { res.redirect('/login'); }
});

app.get('/portal/messages/:id/download', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes, msgRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/messages/${req.params.id}`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    if (!msgRes.ok) return res.redirect('/portal/messages');
    const data = await msgRes.json();
    const msg = data.message;
    const rawContent = msg.raw_headers
      ? `${msg.raw_headers}\n\n${msg.body_text || ''}`
      : `From: ${msg.mail_from}\nTo: ${msg.rcpt_to}\nSubject: ${msg.subject}\nDate: ${msg.created_at}\n\n${msg.body_text || ''}`;
    res.setHeader('Content-Type', 'message/rfc822');
    res.setHeader('Content-Disposition', `attachment; filename="${msg.message_id || 'message'}.eml"`);
    res.send(rawContent);
  } catch { res.redirect('/portal/messages'); }
});

function humanSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val % 1 === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[i]}`;
}

function parseHeaders(raw: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  if (!raw) return out;
  const lines = raw.split(/\r?\n/);
  let current: { key: string; value: string } | null = null;
  for (const line of lines) {
    if (/^[\t ]/.test(line)) {
      if (current) current.value += ' ' + line.trim();
      continue;
    }
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    current = { key: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
    out.push(current);
  }
  return out;
}

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
    const header = await fetchServerHeader(token);
    res.render('message-detail', { layout: 'application', ...header, msg: data.message, title: 'Message', active: 'messages', activeTab: 'properties', humanSize, parseHeaders, email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

app.get('/portal/messages/:id/:tab', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  const tabs = ['activity', 'headers', 'spam', 'plain', 'html', 'attachments', 'raw'];
  if (!tabs.includes(req.params.tab)) return res.redirect('/portal/messages');
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
    const header = await fetchServerHeader(token);
    res.render('message-detail', { layout: 'application', ...header, msg: data.message, title: 'Message', active: 'messages', activeTab: req.params.tab, humanSize, parseHeaders, email: userData.user?.email || '', token });
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
    const header = await fetchServerHeader(token);
    res.render('webhook-history', { layout: 'application', ...header, ...data, title: 'Webhook History', active: 'webhooks', email: userData.user?.email || '', token });
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
    const header = await fetchServerHeader(token);
    res.render('webhook-request', { layout: 'application', ...header, request: data.request, title: 'Webhook Request', active: 'webhooks', email: userData.user?.email || '', token });
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
    const header = await fetchServerHeader(token);
    res.render('settings-limits', { layout: 'application', ...header, server: data.server, title: 'Send Limit', active: 'settings', email: userData.user?.email || '', token });
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
    const header = await fetchServerHeader(token);
    res.render('settings-retention', { layout: 'application', ...header, server: data.server, title: 'Message Retention', active: 'settings', humanSize, email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

app.get('/portal/settings/spam', async (req, res) => {
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
    const server = data.server || {};
    const header = await fetchServerHeader(token);
    res.render('settings-spam', {
      layout: 'application', ...header,
      server,
      spamThreshold: server.spam_threshold ?? 5,
      spamFailureThreshold: server.spam_failure_threshold ?? 20,
      outboundSpamThreshold: server.outbound_spam_threshold ?? null,
      title: 'Spam Handling', active: 'settings', email: userData.user?.email || '', token,
    });
  } catch { res.redirect('/login'); }
});

app.get('/portal/settings/delete', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const userRes = await fetch(`http://localhost:${config.api.port}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const header = await fetchServerHeader(token);
    res.render('settings-delete', { layout: 'application', ...header, title: 'Delete Server', active: 'settings', email: userData.user?.email || '', token });
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
    const header = await fetchServerHeader(token);
    res.render('settings-advanced', { layout: 'application', ...header, server: data.server, title: 'Advanced Settings', active: 'settings', email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

app.get('/portal/help/outgoing', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes, settingsRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/settings`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const settingsData = settingsRes.ok ? await settingsRes.json() : { server: null, credentials: [] };
    const header = await fetchServerHeader(token);
    res.render('help-outgoing', {
      layout: 'application', ...header, title: 'Help — Sending E-Mail', active: 'help',
      email: userData.user?.email || '', token,
      smtpHost: config.dns.heloHostname || config.api.host,
      smtpPort: config.platform.smtpPort,
      smtpUsername: settingsData.credentials?.[0]?.username || '',
      permalink: (settingsData.server?.name || 'mailserver') + '.' + config.dns.routeDomain,
      maxAttempts: 3,
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
    const header = await fetchServerHeader(token);
    res.render('help-incoming', {
      layout: 'application', ...header, title: 'Help — Receiving E-Mail', active: 'help',
      email: userData.user?.email || '', token,
      mxRecords: config.dns.mxRecords,
    });
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
    const header = await fetchServerHeader(token);
    res.render('send-message', {
      layout: 'application',
      ...header,
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
    const header = await fetchServerHeader(token);
    res.render('settings', { layout: 'application', ...header, org: data.organization, members: data.members, title: 'Settings', active: 'settings', email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

app.get('/portal/subdomains', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes, dataRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/subdomains`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const data = dataRes.ok ? await dataRes.json() : { subdomains: [] };
    const search = (req.query.search as string || '').toLowerCase();
    const filtered = data.subdomains.filter((s: any) => !search || s.subdomain.includes(search) || s.root_domain.includes(search));
    const header = await fetchServerHeader(token);
    res.render('subdomains', { layout: 'application', subdomains: filtered, title: 'Subdomains', activeNav: 'subdomains', email: userData.user?.email || '', token, search: req.query.search || '', ...header });
  } catch { res.redirect('/login'); }
});

// ─── SMTP Relay Server ────────────────────────────────────
import { createSmtpRelay } from './smtp-relay';
const smtpServers: any[] = [];

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
    const header = await fetchServerHeader(token);
    res.render('routes', { layout: 'application', ...data, ...header, endpointCounts: data.endpoint_counts || { total: 0, http: 0, smtp: 0, address: 0 }, title: 'Routes', active: 'routes', email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

app.get('/portal/endpoints/:type', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  const type = ['http', 'smtp', 'address'].includes(req.params.type) ? req.params.type : 'http';
  res.redirect(`/portal/routes/add?endpoint=${type}`);
});

app.get('/portal/routes/add', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes, domainRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/domains`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const domainData = domainRes.ok ? await domainRes.json() : { domains: [] };
    const header = await fetchServerHeader(token);
    res.render('add-route', { layout: 'application', ...header, domains: domainData.domains || [], endpoint: (req.query.endpoint as string) || '', title: 'Add Route', active: 'routes', email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

app.get('/portal/routes/:id/edit', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes, routeRes, domainRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/routes`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/domains`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const routeData = routeRes.ok ? await routeRes.json() : { routes: [] };
    const domainData = domainRes.ok ? await domainRes.json() : { domains: [] };
    const route = (routeData.routes || []).find((r: any) => r.id === req.params.id);
    if (!route) return res.redirect('/portal/routes');
    const header = await fetchServerHeader(token);
    res.render('add-route', { layout: 'application', ...header, domains: domainData.domains || [], route, endpoint: (route.endpoint_type || '').toLowerCase(), title: 'Edit Route', active: 'routes', email: userData.user?.email || '', token });
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
    const header = await fetchServerHeader(token);
    res.render('webhooks', { layout: 'application', ...header, ...data, title: 'Webhooks', active: 'webhooks', email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

app.get('/portal/webhooks/add', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const userRes = await fetch(`http://localhost:${config.api.port}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const header = await fetchServerHeader(token);
    res.render('add-webhook', { layout: 'application', ...header, title: 'Add Webhook', active: 'webhooks', email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

app.get('/portal/webhooks/:id/edit', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes, webhookRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/webhooks/${req.params.id}`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    if (!webhookRes.ok) return res.redirect('/portal/webhooks');
    const userData = await userRes.json();
    const webhook = await webhookRes.json();
    const header = await fetchServerHeader(token);
    res.render('add-webhook', { layout: 'application', ...header, webhook, title: 'Edit Webhook', active: 'webhooks', email: userData.user?.email || '', token });
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
    const header = await fetchServerHeader(token);
    res.render('track-domains', { layout: 'application', ...header, ...data, title: 'Tracking Domains', active: 'track-domains', email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

app.get('/portal/track-domains/add', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes, domainRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/domains`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const domainData = domainRes.ok ? await domainRes.json() : { domains: [] };
    const header = await fetchServerHeader(token);
    res.render('add-track-domain', { layout: 'application', ...header, domains: domainData.domains || [], title: 'Add Tracking Domain', active: 'track-domains', email: userData.user?.email || '', token });
  } catch { res.redirect('/login'); }
});

app.get('/portal/track-domains/:id/edit', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes, domainRes, tdRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/domains`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/track-domains/${req.params.id}`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    if (!tdRes.ok) return res.redirect('/portal/track-domains');
    const userData = await userRes.json();
    const domainData = domainRes.ok ? await domainRes.json() : { domains: [] };
    const trackDomain = await tdRes.json();
    const header = await fetchServerHeader(token);
    res.render('add-track-domain', { layout: 'application', ...header, domains: domainData.domains || [], trackDomain, title: 'Edit Tracking Domain', active: 'track-domains', email: userData.user?.email || '', token });
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
    const header = await fetchServerHeader(token);
    res.render('pool', { layout: 'application', ...data, title: 'Subdomain Pool', activeNav: 'pool', email: userData.user?.email || '', token, ...header });
  } catch { res.redirect('/login'); }
});

app.get('/portal/servers', async (req, res) => {
  const token = getToken(req);
  if (!token) return res.redirect('/login');
  try {
    const base = `http://localhost:${config.api.port}`;
    const [userRes, dataRes] = await Promise.all([
      fetch(`${base}/api/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
      fetch(`${base}/api/portal/servers`, { headers: { 'Authorization': `Bearer ${token}` } }),
    ]);
    if (userRes.status === 401) { res.clearCookie('token'); return res.redirect('/login'); }
    const userData = await userRes.json();
    const data = dataRes.ok ? await dataRes.json() : { servers: [] };
    res.render('servers', { layout: 'application', servers: data.servers, title: 'Servers', active: 'servers', email: userData.user?.email || '', token });
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

    // Start bounce handler on port 2525 (forwarded from port 25 via iptables)
    startBounceHandler(2525);

    app.listen(config.api.port, config.api.host, () => {
      console.log(`Mailcouse server running on ${config.api.host}:${config.api.port}`);
      console.log(`Health: http://localhost:${config.api.port}/health`);
      console.log(`UI: http://localhost:${config.api.port}/login`);
    });

    Object.entries(config.platform.smtpPorts).forEach(([tier, port]) => {
      const server = createSmtpRelay(tier);
      server.listen(port, () => {
        console.log(`SMTP relay [${tier}] listening on port ${port}`);
      });
      smtpServers.push(server);
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
    stopBounceHandler();
    console.log('Bounce handler stopped');
    for (const server of smtpServers) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    console.log(`SMTP relays stopped (${smtpServers.length} servers)`);
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
