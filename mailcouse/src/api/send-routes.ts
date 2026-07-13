import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import * as dns from 'dns';
import * as net from 'net';
import { randomUUID, createSign, createHash } from 'crypto';
import { getDKIMPrivateKey } from '../dkim/key-store';
import { DEFAULT_DKIM_HEADERS, DKIM_ALGORITHM, DKIM_VERSION } from '../dkim/types';

const router = Router();

function getLastCode(response: string): { code: number; msg: string; isFinal: boolean } | null {
  const lines = response.trim().split('\r\n');
  if (lines.length === 0) return null;
  const lastLine = lines[lines.length - 1];
  const m = lastLine.match(/^(\d{3})([ -])(.*)/);
  if (!m) return null;
  return { code: parseInt(m[1]), msg: m[3], isFinal: m[2] === ' ' };
}

function smtpSend(host: string, port: number, from: string, to: string, message: string): Promise<{ success: boolean; code: number; message: string }> {
  return new Promise((resolve, reject) => {
    const s = new net.Socket();
    let buf = '';
    let step = 0;
    let settled = false;

    const done = (err?: any, result?: { success: boolean; code: number; message: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      s.destroy();
      if (err) reject(err);
      else if (result) resolve(result);
    };

    const timer = setTimeout(() => done(new Error('SMTP total timeout')), 15000);

    const tryProcess = () => {
      const parsed = getLastCode(buf);
      if (!parsed || !parsed.isFinal) return;

      const { code, msg } = parsed;
      try {
        if (step === 0) {
          if (code === 220) { step = 1; s.write(`EHLO mail\r\n`); buf = ''; }
          else { done(null, { success: false, code, message: msg }); }
        } else if (step === 1) { step = 2; s.write(`MAIL FROM:<${from}>\r\n`); buf = ''; }
        else if (step === 2) {
          if (code === 250) { step = 3; s.write(`RCPT TO:<${to}>\r\n`); buf = ''; }
          else { done(null, { success: false, code, message: msg }); }
        } else if (step === 3) {
          if (code === 250) { step = 4; s.write(`DATA\r\n`); buf = ''; }
          else { done(null, { success: false, code, message: msg }); }
        } else if (step === 4) {
          if (code === 354) { s.write(`${message}\r\n.\r\n`); step = 5; buf = ''; }
          else { done(null, { success: false, code, message: msg }); }
        } else if (step === 5) { done(null, { success: code >= 200 && code < 300, code, message: msg }); }
      } catch (e: any) { done(e); }
    };

    s.on('connect', () => {});
    s.on('data', (data: Buffer) => {
      buf += data.toString();
      tryProcess();
    });
    s.on('error', (err) => done(err));
    s.on('timeout', () => done(new Error('SMTP idle timeout')));
    s.connect(port, host);
  });
}

router.post('/', async (req: Request, res: Response) => {
  const startTime = Date.now();
  try {
    const { to, subject, body, from_name } = req.body;
    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'to, subject, and body required' });
    }

    const pool = new Pool({
      host: 'localhost', port: 5433, database: 'mailcouse',
      user: 'mailcouse', password: 'postgres',
      max: 2, connectionTimeoutMillis: 5000,
    });

    const dbResult = await pool.query(
      `SELECT s.id, s.subdomain, s.sender_name, d.domain as root_domain
       FROM subdomains s JOIN domains d ON s.domain_id = d.id
       WHERE s.status = 'active' AND s.emails_sent_today < s.daily_limit
       ORDER BY s.emails_sent_today ASC LIMIT 1`
    );
    await pool.end();

    if (dbResult.rows.length === 0) {
      return res.status(503).json({ error: 'No available subdomains' });
    }

    const sub = dbResult.rows[0];
    const senderName = from_name || sub.sender_name;
    const localPart = senderName.replace(/\s+/g, '.').toLowerCase();

    const envelopeFrom = `${localPart}@${sub.root_domain}`;
    const headerFrom = `${senderName} <${localPart}@${sub.subdomain}>`;
    const msgId = `<${randomUUID()}@${sub.subdomain}>`;

    const headers: Record<string, string> = {
      from: headerFrom,
      to,
      subject,
      date: new Date().toUTCString(),
      'message-id': msgId,
      'list-unsubscribe': `<mailto:unsubscribe@${sub.root_domain}>`,
    };

    const keyData = await getDKIMPrivateKey(sub.id);
    if (keyData) {
      const signedHeaders = DEFAULT_DKIM_HEADERS.filter(h => headers[h] !== undefined);
      const headerList = signedHeaders.join(':');
      const headerString = signedHeaders.map(h => `${h}:${headers[h]}`).join('\r\n');
      const bodyHash = createHash('sha256').update(body).digest('base64');
      const sign = createSign('sha256');
      sign.update(headerString);
      const headerSignature = sign.sign(keyData.privateKey, 'base64');

      headers['dkim-signature'] = [
        `v=${DKIM_VERSION}`,
        `a=${DKIM_ALGORITHM}`,
        `d=${sub.root_domain}`,
        `s=${keyData.selector}`,
        `h=${headerList}`,
        `bh=${bodyHash}`,
        `b=${headerSignature}`,
      ].join('; ');
    }

    const headerLines: string[] = [];
    if (headers['dkim-signature']) {
      headerLines.push(`DKIM-Signature: ${headers['dkim-signature']}`);
    }
    for (const [k, v] of Object.entries(headers)) {
      if (k !== 'dkim-signature') headerLines.push(`${k}: ${v}`);
    }
    const message = headerLines.join('\r\n') + '\r\n\r\n' + body;

    const mxRecords = await dns.promises.resolveMx(to.split('@')[1]);
    if (!mxRecords || mxRecords.length === 0) {
      return res.status(502).json({ error: 'No MX records' });
    }
    mxRecords.sort((a, b) => a.priority - b.priority);

    let lastError: string | null = null;

    for (const mx of mxRecords) {
      try {
        const result = await smtpSend(mx.exchange, 25, envelopeFrom, to, message);
        if (result.success) {
          const updatePool = new Pool({
            host: 'localhost', port: 5433, database: 'mailcouse',
            user: 'mailcouse', password: 'postgres', max: 1,
          });
          await updatePool.query(
            `UPDATE subdomains SET emails_sent_today = emails_sent_today + 1, total_sent = total_sent + 1 WHERE id = $1`,
            [sub.id]
          );
          await updatePool.end();

          return res.json({
            success: true, response_code: result.code, response_message: result.message,
            from: headerFrom, envelope_from: envelopeFrom, subdomain: sub.subdomain,
            dkim: keyData ? 'signed' : 'unsigned',
            via_mx: mx.exchange, duration_ms: Date.now() - startTime,
          });
        }
        lastError = `${result.code} ${result.message}`;
      } catch (err: any) {
        lastError = err.message;
      }
    }

    return res.status(502).json({
      success: false, error: lastError || 'All MX servers failed',
      from: headerFrom, envelope_from: envelopeFrom, subdomain: sub.subdomain,
      duration_ms: Date.now() - startTime,
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'Send failed', message: error.message || 'Unknown error',
      duration_ms: Date.now() - startTime,
    });
  }
});

export default router;
