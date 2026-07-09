import { resolveMx } from 'dns';
import { promisify } from 'util';
import { SMTPConfig, SMTPSendResult, DEFAULT_SMTP_CONFIG, MXRecord } from './types';
import { classifyResponse, parseSMTPResponse } from './response-handler';
import { connect, release, remove, cleanStale } from './connection-pool';
import { logSession } from './session-logger';
import { EmailContent } from './email-builder';

const resolveMxAsync = promisify(resolveMx);

interface EmailInput {
  from: string;
  to: string;
  subdomain: string;
  ip_id: string;
  ip_address: string;
  job_id: string;
  content: string;
}

function buildMimeMessage(input: EmailInput, headers: Record<string, string>): string {
  const lines: string[] = [];
  lines.push(`From: ${input.from}`);
  lines.push(`To: ${input.to}`);
  lines.push(`Subject: ${headers['Subject'] || ''}`);
  lines.push(`Date: ${new Date().toUTCString()}`);
  lines.push(`Message-ID: <${input.job_id}@${input.subdomain}>`);

  if (headers['List-Unsubscribe']) {
    lines.push(`List-Unsubscribe: <${headers['List-Unsubscribe']}>`);
  }
  if (headers['Precedence']) {
    lines.push(`Precedence: ${headers['Precedence']}`);
  }

  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/plain; charset=UTF-8');
  lines.push('Content-Transfer-Encoding: 7bit');
  lines.push('');
  lines.push(input.content);

  return lines.join('\r\n');
}

function buildMimeMessageFromEmailContent(email: EmailContent): string {
  const lines: string[] = [];
  for (const h of email.mimeHeaders) {
    lines.push(`${h.key}: ${h.value}`);
  }
  lines.push('');
  lines.push(email.body);
  return lines.join('\r\n');
}

export async function sendEmail(
  config: SMTPConfig,
  email: EmailInput,
  headers: Record<string, string> = {}
): Promise<SMTPSendResult> {
  const startTime = Date.now();

  try {
    const domain = email.to.split('@')[1];
    const mxRecords = await resolveMxAsync(domain);

    if (!mxRecords || mxRecords.length === 0) {
      return fail(0, 'No MX records found', false, startTime);
    }

    const sortedMX = mxRecords
      .map((r) => ({ priority: r.priority, exchange: r.exchange }))
      .sort((a, b) => a.priority - b.priority);

    for (const mx of sortedMX) {
      const result = await sendViaMX(mx, config, email, headers, startTime);

      await logSession({
        job_id: email.job_id,
        from: email.from,
        to: email.to,
        subdomain: email.subdomain,
        ip_address: email.ip_address,
        connected_at: new Date(startTime),
        sent_at: result.success ? new Date() : undefined,
        response_code: result.response_code,
        response_message: result.response_message,
        error: result.error,
        duration_ms: Date.now() - startTime,
        bytes_sent: email.content.length,
      });

      if (result.success || !result.retry) {
        return result;
      }
    }

    return fail(0, 'All MX servers failed', true, startTime);
  } catch (error) {
    return fail(0, error instanceof Error ? error.message : 'SMTP error', true, startTime);
  }
}

export async function sendEmailWithContent(
  config: SMTPConfig,
  email: EmailInput,
  emailContent: EmailContent
): Promise<SMTPSendResult> {
  const startTime = Date.now();

  try {
    const domain = email.to.split('@')[1];
    const mxRecords = await resolveMxAsync(domain);

    if (!mxRecords || mxRecords.length === 0) {
      return fail(0, 'No MX records found', false, startTime);
    }

    const sortedMX = mxRecords
      .map((r) => ({ priority: r.priority, exchange: r.exchange }))
      .sort((a, b) => a.priority - b.priority);

    for (const mx of sortedMX) {
      const result = await sendViaMXWithHeaders(mx, config, email, emailContent, startTime);

      await logSession({
        job_id: email.job_id,
        from: email.from,
        to: email.to,
        subdomain: email.subdomain,
        ip_address: email.ip_address,
        connected_at: new Date(startTime),
        sent_at: result.success ? new Date() : undefined,
        response_code: result.response_code,
        response_message: result.response_message,
        error: result.error,
        duration_ms: Date.now() - startTime,
        bytes_sent: emailContent.body.length,
      });

      if (result.success || !result.retry) {
        return result;
      }
    }

    return fail(0, 'All MX servers failed', true, startTime);
  } catch (error) {
    return fail(0, error instanceof Error ? error.message : 'SMTP error', true, startTime);
  }
}

async function sendViaMX(
  mx: MXRecord,
  config: SMTPConfig,
  email: EmailInput,
  headers: Record<string, string>,
  startTime: number
): Promise<SMTPSendResult> {
  let conn;
  try {
    conn = await connect(mx.exchange, config.port, email.ip_id, email.ip_address, config, config.require_tls);
  } catch (err) {
    return fail(0, err instanceof Error ? err.message : 'Connection failed', true, startTime);
  }

  const socket = conn.socket;
  const mimeMessage = buildMimeMessage(email, headers);

  return new Promise((resolve) => {
    let response = '';
    let step = 0;
    let tlsUpgraded = false;

    const doCleanup = (healthy: boolean) => {
      if (conn) {
        release(conn, healthy);
      }
    };

    socket.setTimeout(config.timeout_ms);

    socket.on('timeout', () => {
      doCleanup(false);
      remove(email.ip_id, email.ip_address, mx.exchange);
      resolve(fail(0, 'Connection timeout', true, startTime));
    });

    socket.on('error', (err) => {
      doCleanup(false);
      remove(email.ip_id, email.ip_address, mx.exchange);
      resolve(fail(0, err.message, true, startTime));
    });

    const writeCommand = (cmd: string) => {
      socket.write(cmd + '\r\n');
    };

    socket.on('data', (data) => {
      response = data.toString();

      const parsed = parseSMTPResponse(response);

      if (response.match(/^\d{3}-/)) {
        return;
      }

      if (step === 0) {
        step = 1;
        writeCommand(`EHLO ${email.subdomain}`);
      } else if (step === 1) {
        if (!tlsUpgraded && config.require_tls && response.includes('STARTTLS')) {
          writeCommand('STARTTLS');
          step = 5;
        } else if (!tlsUpgraded && config.require_tls && !response.includes('STARTTLS')) {
          doCleanup(false);
          resolve(fail(0, 'STARTTLS not advertised', true, startTime));
        } else {
          step = 2;
          writeCommand(`MAIL FROM:<${email.from}>`);
        }
      } else if (step === 5) {
        if (parsed.code === 220) {
          tlsUpgraded = true;
          step = 1;
        } else {
          doCleanup(false);
          resolve(fail(parsed.code, `STARTTLS failed: ${parsed.message}`, true, startTime));
        }
      } else if (step === 2) {
        if (parsed.code === 250) {
          step = 3;
          writeCommand(`RCPT TO:<${email.to}>`);
        } else {
          doCleanup(true);
          const c = classifyResponse(parsed.code, parsed.message);
          resolve(fail(parsed.code, `MAIL FROM rejected: ${parsed.message}`, c.should_retry, startTime, c.should_suppress));
        }
      } else if (step === 3) {
        if (parsed.code === 250 || parsed.code === 251) {
          step = 4;
          writeCommand('DATA');
        } else {
          doCleanup(true);
          const c = classifyResponse(parsed.code, parsed.message);
          resolve(fail(parsed.code, `RCPT TO rejected: ${parsed.message}`, c.should_retry, startTime, c.should_suppress));
        }
      } else if (step === 4) {
        if (parsed.code === 354) {
          socket.write(mimeMessage + '\r\n.\r\n');
          step = 6;
        } else {
          doCleanup(false);
          resolve(fail(parsed.code, `DATA rejected: ${parsed.message}`, false, startTime));
        }
      } else if (step === 6) {
        doCleanup(parsed.code >= 200 && parsed.code < 500);
          const c = classifyResponse(parsed.code, parsed.message);
          resolve({
            success: c.type === 'success',
            response_code: parsed.code,
            response_message: parsed.message,
            retry: c.should_retry,
            should_suppress: c.should_suppress,
            duration_ms: Date.now() - startTime,
          });
      }
    });
  });
}

async function sendViaMXWithHeaders(
  mx: MXRecord,
  config: SMTPConfig,
  email: EmailInput,
  emailContent: EmailContent,
  startTime: number
): Promise<SMTPSendResult> {
  let conn;
  try {
    conn = await connect(mx.exchange, config.port, email.ip_id, email.ip_address, config, config.require_tls);
  } catch (err) {
    return fail(0, err instanceof Error ? err.message : 'Connection failed', true, startTime);
  }

  const socket = conn.socket;
  const mimeMessage = buildMimeMessageFromEmailContent(emailContent);

  return new Promise((resolve) => {
    let response = '';
    let step = 0;
    let tlsUpgraded = false;

    const doCleanup = (healthy: boolean) => {
      if (conn) {
        release(conn, healthy);
      }
    };

    socket.setTimeout(config.timeout_ms);

    socket.on('timeout', () => {
      doCleanup(false);
      remove(email.ip_id, email.ip_address, mx.exchange);
      resolve(fail(0, 'Connection timeout', true, startTime));
    });

    socket.on('error', (err) => {
      doCleanup(false);
      remove(email.ip_id, email.ip_address, mx.exchange);
      resolve(fail(0, err.message, true, startTime));
    });

    const writeCommand = (cmd: string) => {
      socket.write(cmd + '\r\n');
    };

    socket.on('data', (data) => {
      response = data.toString();

      const parsed = parseSMTPResponse(response);

      if (response.match(/^\d{3}-/)) {
        return;
      }

      if (step === 0) {
        step = 1;
        writeCommand(`EHLO ${email.subdomain}`);
      } else if (step === 1) {
        if (!tlsUpgraded && config.require_tls && response.includes('STARTTLS')) {
          writeCommand('STARTTLS');
          step = 5;
        } else if (!tlsUpgraded && config.require_tls && !response.includes('STARTTLS')) {
          doCleanup(false);
          resolve(fail(0, 'STARTTLS not advertised', true, startTime));
        } else {
          step = 2;
          writeCommand(`MAIL FROM:<${email.from}>`);
        }
      } else if (step === 5) {
        if (parsed.code === 220) {
          tlsUpgraded = true;
          step = 1;
        } else {
          doCleanup(false);
          resolve(fail(parsed.code, `STARTTLS failed: ${parsed.message}`, true, startTime));
        }
      } else if (step === 2) {
        if (parsed.code === 250) {
          step = 3;
          writeCommand(`RCPT TO:<${email.to}>`);
        } else {
          doCleanup(true);
          const c = classifyResponse(parsed.code, parsed.message);
          resolve(fail(parsed.code, `MAIL FROM rejected: ${parsed.message}`, c.should_retry, startTime, c.should_suppress));
        }
      } else if (step === 3) {
        if (parsed.code === 250 || parsed.code === 251) {
          step = 4;
          writeCommand('DATA');
        } else {
          doCleanup(true);
          const c = classifyResponse(parsed.code, parsed.message);
          resolve(fail(parsed.code, `RCPT TO rejected: ${parsed.message}`, c.should_retry, startTime, c.should_suppress));
        }
      } else if (step === 4) {
        if (parsed.code === 354) {
          socket.write(mimeMessage + '\r\n.\r\n');
          step = 6;
        } else {
          doCleanup(false);
          resolve(fail(parsed.code, `DATA rejected: ${parsed.message}`, false, startTime));
        }
      } else if (step === 6) {
        doCleanup(parsed.code >= 200 && parsed.code < 500);
          const c = classifyResponse(parsed.code, parsed.message);
          resolve({
            success: c.type === 'success',
            response_code: parsed.code,
            response_message: parsed.message,
            retry: c.should_retry,
            should_suppress: c.should_suppress,
            duration_ms: Date.now() - startTime,
          });
      }
    });
  });
}

function fail(
  code: number,
  message: string,
  retry: boolean,
  startTime: number,
  suppress?: boolean
): SMTPSendResult {
  return {
    success: false,
    response_code: code,
    response_message: message,
    retry,
    should_suppress: suppress,
    error: message,
    duration_ms: Date.now() - startTime,
  };
}

export async function getSendStats(): Promise<{
  total_attempted: number;
  total_sent: number;
  total_failed: number;
  success_rate: number;
}> {
  return { total_attempted: 0, total_sent: 0, total_failed: 0, success_rate: 0 };
}
