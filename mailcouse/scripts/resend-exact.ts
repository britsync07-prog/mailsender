import nodemailer from 'nodemailer';
import * as dns from 'dns';
import * as net from 'net';
import { getDomainDKIMPrivateKey } from '../src/dkim/key-store';
import { query, closePool } from '../src/db/connection';

const ORG_ID = '0b7a91a3-7924-4353-baa5-fcec67f2e168';
const CUSTOMER_DOMAIN_ID = 'c431952f-776c-4bc7-97d7-43ba3e0e47d1';
const ORIGINAL_MESSAGE_ID = '<23a656d9-c099-4589-97c9-1018e2f0011a@britsyncai.com>';
const FROM = 'test@britsyncai.com';
const TO = process.argv[2] || 'mehedy303@gmail.com';
const ENV_FROM = `bounce+${ORG_ID.slice(0, 8)}@live.noblecircle.online`;
const DATE = new Date('2026-08-04T17:09:05Z');

const MESSAGE = {
  from: FROM,
  to: TO,
  subject: 'Test Message at 8/4/2026, 7:09:00 PM',
  text: 'This is a message to test the delivery of messages through Postal.',
  messageId: ORIGINAL_MESSAGE_ID,
  date: DATE,
};

function getLastCode(response: string): { code: number; msg: string; isFinal: boolean } | null {
  const lines = response.trim().split('\r\n');
  const lastLine = lines[lines.length - 1];
  const m = lastLine.match(/^(\d{3})([ -])(.*)/);
  if (!m) return null;
  return { code: parseInt(m[1]), msg: m[3], isFinal: m[2] === ' ' };
}

function deliverToMX(mxHost: string, port: number, envelopeFrom: string, to: string, message: string): Promise<{ success: boolean; code: number; message: string }> {
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
        switch (step) {
          case 0:
            if (code === 220) { step = 1; s.write(`EHLO live.noblecircle.online\r\n`); buf = ''; }
            else done(null, { success: false, code, message: msg });
            break;
          case 1: step = 2; s.write(`MAIL FROM:<${envelopeFrom}>\r\n`); buf = ''; break;
          case 2:
            if (code === 250) { step = 3; s.write(`RCPT TO:<${to}>\r\n`); buf = ''; }
            else done(null, { success: false, code, message: msg });
            break;
          case 3:
            if (code === 250) { step = 4; s.write(`DATA\r\n`); buf = ''; }
            else done(null, { success: false, code, message: msg });
            break;
          case 4:
            if (code === 354) { s.write(`${message}\r\n.\r\n`); step = 5; buf = ''; }
            else done(null, { success: false, code, message: msg });
            break;
          case 5: done(null, { success: code >= 200 && code < 300, code, message: msg }); break;
        }
      } catch (e: any) { done(e); }
    };

    s.on('data', (data: Buffer) => { buf += data.toString(); tryProcess(); });
    s.on('error', (err) => done(err));
    s.on('timeout', () => done(new Error('SMTP idle timeout')));
    s.setTimeout(15000);
    s.connect({ port, host: mxHost, family: 4 });
  });
}

async function main() {
  const keyData = await getDomainDKIMPrivateKey(CUSTOMER_DOMAIN_ID);
  if (!keyData) throw new Error('No DKIM key found');
  const dkim = {
    domainName: 'britsyncai.com',
    keySelector: keyData.selector,
    privateKey: keyData.privateKey,
  };

  const mxs = (await dns.promises.resolveMx(TO.split('@')[1])).sort((a, b) => a.priority - b.priority);
  if (mxs.length === 0) throw new Error('No MX records');

  let rendered = '';
  const capture = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: '\r\n',
    dkim,
  });
  const infoCapture = await capture.sendMail({ ...MESSAGE });
  rendered = (infoCapture.message as Buffer).toString('utf-8');
  capture.close();

  const receivedHeader = 'Received: from web-ui (103.132.176.4) by live.noblecircle.online with HTTP;\r\n Tue, 04 Aug 2026 17:09:05 GMT\r\n';
  const rawMessage = receivedHeader + rendered;

  const preferred = mxs.find(m => m.exchange.startsWith('alt1.gmail')) || mxs[0];
  const orderedMxs = [preferred, ...mxs.filter(m => m !== preferred)];

  let lastError: any = null;
  let smtpResponse = '';
  let usedMx = '';
  for (const mx of orderedMxs) {
    const transporter = nodemailer.createTransport({
      host: mx.exchange,
      port: 25,
      secure: false,
      tls: { rejectUnauthorized: false },
    });
    try {
      const info = await transporter.sendMail({
        raw: rawMessage,
        envelope: { from: ENV_FROM, to: [TO] },
      });
      transporter.close();
      smtpResponse = info.response;
      usedMx = mx.exchange;
      break;
    } catch (err: any) {
      transporter.close();
      lastError = err;
    }
  }
  if (!smtpResponse) throw lastError;

  const originalStyleDetails = `${usedMx}: ${smtpResponse.replace(/\s+/g, ' ').trim()}`;

  const raw = rawMessage;
  const msgResult = await query(
    `INSERT INTO sent_messages (organization_id, customer_domain_id, mail_from, rcpt_to, subject, body_text, raw_headers, size, status, message_id, scope)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'outgoing')
     RETURNING id`,
    [ORG_ID, CUSTOMER_DOMAIN_ID, FROM, TO, MESSAGE.subject, MESSAGE.text, raw, Buffer.byteLength(raw, 'utf-8'), 'sent', ORIGINAL_MESSAGE_ID]
  );
  const sentMessageId = msgResult.rows[0].id;

  await query(
    `INSERT INTO delivery_attempts (sent_message_id, organization_id, rcpt_to, status, smtp_code, details, created_at)
     VALUES ($1, $2, $3, 'delivered', 250, $4, NOW())`,
    [sentMessageId, ORG_ID, TO, originalStyleDetails]
  );

  console.log(JSON.stringify({
    to: TO,
    message_id: ORIGINAL_MESSAGE_ID,
    size: Buffer.byteLength(raw, 'utf-8'),
    sent_message_id: sentMessageId,
    smtp_response: originalStyleDetails,
  }, null, 2));
}

main()
  .catch((err) => { console.error('FAILED:', err); process.exit(1); })
  .finally(() => closePool().catch(() => {}));
