// Email existence verification: syntax -> MX -> live SMTP RCPT probe -> catch-all detection

import * as dns from 'dns';
import * as net from 'net';
import * as crypto from 'crypto';
import { query } from '../db/connection';
import { config } from '../config';

export type VerifyStatus = 'valid' | 'invalid' | 'catch_all' | 'unknown';

export interface VerifyResult {
  email: string;
  status: VerifyStatus;
  smtpCode: number | null;
  mxHost: string | null;
  detail: string;
  cached?: boolean;
}

const SYNTAX_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com',
  'temp-mail.org', 'throwawaymail.com', 'yopmail.com', 'trashmail.com',
  'sharklasers.com', 'getnada.com', 'dispostable.com', 'fakeinbox.com',
]);

const VALID_TTL_HOURS = 24 * 7;
const UNRELIABLE_TTL_HOURS = 24;
const CONNECT_TIMEOUT_MS = 10000;
const CMD_TIMEOUT_MS = 12000;

interface Reply {
  code: number;
  text: string;
}

function connectWithTimeout(host: string, port: number, ip: string, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host: ip });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('connect timeout'));
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// Read one complete SMTP reply (handles multi-line "250-..." continuations)
function readReply(socket: net.Socket, timeoutMs: number): Promise<Reply> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('reply timeout'));
    }, timeoutMs);

    const onData = (chunk: Buffer) => {
      buf += chunk.toString('utf-8');
      const lines = buf.split(/\r?\n/);
      const lastComplete = lines.length > 1 ? lines[lines.length - 2] : '';
      if (/^\d{3} /.test(lastComplete)) {
        cleanup();
        const m = lastComplete.match(/^(\d{3}) (.*)$/);
        resolve({ code: parseInt(m![1], 10), text: buf.trim().slice(0, 500) });
      }
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onClose = () => {
      cleanup();
      reject(new Error('connection closed'));
    };

    function cleanup() {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    }

    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}

async function command(socket: net.Socket, cmd: string): Promise<Reply> {
  socket.write(cmd + '\r\n');
  return readReply(socket, CMD_TIMEOUT_MS);
}

async function resolveMxHosts(domain: string): Promise<{ exchange: string; ip: string }[]> {
  try {
    const records = await dns.promises.resolveMx(domain);
    if (!records || records.length === 0) return [];
    records.sort((a, b) => a.priority - b.priority);
    const out: { exchange: string; ip: string }[] = [];
    for (const r of records.slice(0, 3)) {
      let ip = r.exchange;
      try {
        const addrs = await dns.promises.resolve4(r.exchange);
        if (addrs.length > 0) ip = addrs[0];
      } catch { /* fall back to hostname */ }
      out.push({ exchange: r.exchange, ip });
    }
    return out;
  } catch {
    return [];
  }
}

// Full SMTP handshake up to RCPT TO for one address; returns definitive reply or null if undetermined
async function probeRcpt(
  mx: { exchange: string; ip: string },
  rcptEmail: string,
  extraRcpts: string[] = [],
): Promise<{ replies: Map<string, Reply>; error?: string } | null> {
  let socket: net.Socket | null = null;
  const helo = config.dns.heloHostname || 'live.noblecircle.online';
  const mailFrom = `verify@${config.dns.returnPathDomain}`;
  try {
    socket = await connectWithTimeout(mx.exchange, 25, mx.ip, CONNECT_TIMEOUT_MS);
    const banner = await readReply(socket, CMD_TIMEOUT_MS);
    if (banner.code !== 220) return { replies: new Map(), error: `banner ${banner.code}` };

    const ehlo = await command(socket, `EHLO ${helo}`);
    if (ehlo.code !== 250) return { replies: new Map(), error: `ehlo ${ehlo.code}` };

    const from = await command(socket, `MAIL FROM:<${mailFrom}>`);
    if (from.code !== 250) return { replies: new Map(), error: `mailfrom ${from.code}: ${from.text.slice(0, 120)}` };

    const targets = [rcptEmail, ...extraRcpts];
    const replies = new Map<string, Reply>();
    for (const t of targets) {
      const rcpt = await command(socket, `RCPT TO:<${t}>`);
      replies.set(t.toLowerCase(), rcpt);
      await command(socket, 'RSET').catch(() => ({ code: 250, text: '' }) as Reply);
      if (t !== targets[targets.length - 1]) {
        const mf = await command(socket, `MAIL FROM:<${mailFrom}>`);
        if (mf.code !== 250) break;
      }
    }
    return { replies };
  } catch (err: any) {
    return { replies: new Map(), error: String(err?.message || err) };
  } finally {
    try {
      if (socket && !socket.destroyed) {
        socket.write('QUIT\r\n');
        socket.destroy();
      }
    } catch { /* ignore */ }
  }
}

const INVALID_PATTERNS = /invalid recipient|recipient address rejected|access denied|unknown user|user unknown|no such (user|mailbox|recipient)|does not exist|mailbox not found|no mailbox here|recipient not found|address rejected|5\.1\.[01]/i;

async function getCached(email: string, force: boolean): Promise<VerifyResult | null> {
  if (force) return null;
  try {
    const r = await query<{ status: VerifyStatus; smtp_code: number | null; mx_host: string | null; detail: string; checked_at: Date }>(
      'SELECT status, smtp_code, mx_host, detail, checked_at FROM email_verifications WHERE email = $1',
      [email]
    );
    if (r.rows.length === 0) return null;
    const row = r.rows[0];
    const ageHours = (Date.now() - new Date(row.checked_at).getTime()) / 3600000;
    const ttl = row.status === 'valid' ? VALID_TTL_HOURS : UNRELIABLE_TTL_HOURS;
    if (ageHours > ttl) return null;
    return { email, status: row.status, smtpCode: row.smtp_code, mxHost: row.mx_host, detail: row.detail, cached: true };
  } catch {
    return null;
  }
}

async function saveResult(res: VerifyResult, catchAllFlag: boolean): Promise<void> {
  try {
    await query(
      `INSERT INTO email_verifications (email, status, smtp_code, mx_host, detail, catch_all)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO UPDATE SET status = $2, smtp_code = $3, mx_host = $4, detail = $5, catch_all = $6, checked_at = NOW()`,
      [res.email, res.status, res.smtpCode, res.mxHost, res.detail.slice(0, 400), catchAllFlag]
    );
  } catch { /* cache write failures must never break verification */ }
}

// Mailboxes hosted on our own infrastructure: verify against DB (SMTP self-probe is unreliable)
async function checkLocalMailbox(email: string): Promise<VerifyResult | null> {
  const domain = email.split('@')[1];
  const ourDomains = new Set([config.dns.returnPathDomain, config.dns.heloHostname].map(d => String(d).toLowerCase()));
  try {
    const mb = await query<{ id: string }>('SELECT id FROM mailbox_accounts WHERE LOWER(email) = $1 AND active = true', [email]);
    if (mb.rows.length > 0) {
      return { email, status: 'valid', smtpCode: null, mxHost: 'local', detail: 'hosted mailbox exists' };
    }
    const alias = await query<{ id: string }>('SELECT id FROM mailbox_aliases WHERE LOWER(address) = $1 AND active = true', [email]);
    if (alias.rows.length > 0) {
      return { email, status: 'valid', smtpCode: null, mxHost: 'local', detail: 'hosted alias exists' };
    }
    if (ourDomains.has(domain)) {
      return { email, status: 'invalid', smtpCode: null, mxHost: 'local', detail: 'no such mailbox on our server' };
    }
  } catch { /* fall through to SMTP probe */ }
  return null;
}

export async function verifyEmailAddress(rawEmail: string, force = false): Promise<VerifyResult> {
  const email = String(rawEmail || '').trim().toLowerCase();

  const cached = await getCached(email, force);
  if (cached) return cached;

  if (!SYNTAX_RE.test(email)) {
    const res: VerifyResult = { email, status: 'invalid', smtpCode: null, mxHost: null, detail: 'invalid syntax' };
    await saveResult(res, false);
    return res;
  }

  const local = await checkLocalMailbox(email);
  if (local) {
    await saveResult(local, false);
    return local;
  }

  const domain = email.split('@')[1];
  if (DISPOSABLE_DOMAINS.has(domain)) {
    const res: VerifyResult = { email, status: 'invalid', smtpCode: null, mxHost: null, detail: 'disposable domain' };
    await saveResult(res, false);
    return res;
  }

  const mxHosts = await resolveMxHosts(domain);
  if (mxHosts.length === 0) {
    const res: VerifyResult = { email, status: 'invalid', smtpCode: null, mxHost: null, detail: 'no MX records' };
    await saveResult(res, false);
    return res;
  }

  const rndLocal = `no-reply-check-${crypto.randomBytes(6).toString('hex')}`;
  const catchAllAddress = `${rndLocal}@${domain}`;

  for (const mx of mxHosts) {
    const probe = await probeRcpt(mx, email, []);
    if (!probe) continue;
    const reply = probe.replies.get(email);
    if (!reply) continue;

    if (reply.code >= 200 && reply.code < 300) {
      // Accepted — distinguish real mailbox from catch-all domain
      const caProbe = await probeRcpt(mx, catchAllAddress, []);
      const caReply = caProbe?.replies.get(catchAllAddress);
      if (caReply && caReply.code >= 200 && caReply.code < 300) {
        const res: VerifyResult = { email, status: 'catch_all', smtpCode: reply.code, mxHost: mx.exchange, detail: `domain accepts all recipients (${caReply.code})` };
        await saveResult(res, true);
        return res;
      }
      const res: VerifyResult = { email, status: 'valid', smtpCode: reply.code, mxHost: mx.exchange, detail: reply.text.slice(0, 300) };
      await saveResult(res, false);
      return res;
    }

    if (reply.code >= 500 && reply.code < 600 && INVALID_PATTERNS.test(reply.text)) {
      const res: VerifyResult = { email, status: 'invalid', smtpCode: reply.code, mxHost: mx.exchange, detail: reply.text.replace(/\s+/g, ' ').slice(0, 300) };
      await saveResult(res, false);
      return res;
    }

    // 4xx / policy rejection at this MX — try next MX before giving up
    if (mx === mxHosts[mxHosts.length - 1]) {
      const res: VerifyResult = { email, status: 'unknown', smtpCode: reply.code, mxHost: mx.exchange, detail: reply.text.replace(/\s+/g, ' ').slice(0, 300) };
      await saveResult(res, false);
      return res;
    }
  }

  const res: VerifyResult = { email, status: 'unknown', smtpCode: null, mxHost: mxHosts[0]?.exchange || null, detail: 'could not determine (probe blocked)' };
  await saveResult(res, false);
  return res;
}

export async function verifyBatch(emails: string[], opts: { concurrency?: number; force?: boolean } = {}): Promise<VerifyResult[]> {
  const unique = Array.from(new Set(emails.map(e => String(e).trim().toLowerCase()).filter(Boolean)));
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, 10));
  const results: VerifyResult[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < unique.length) {
      const idx = cursor++;
      const res = await verifyEmailAddress(unique[idx], !!opts.force);
      results.push(res);
      // gentle pacing to avoid tripping gateway rate limits
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));
  return results;
}
