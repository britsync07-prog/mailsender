// Stage 6: SMTP Handshake (RCPT TO verification)

import * as net from 'net';
import { StageResult, MXRecord, SMTPConfig } from '../types';

// Default SMTP configuration
const DEFAULT_CONFIG: SMTPConfig = {
  from_domain: 'mailcheck.example.com',
  from_email: 'verify@mailcheck.example.com',
  timeout_ms: 10000,
  max_retries: 2,
};

/**
 * Validate email via SMTP handshake (EHLO -> MAIL FROM -> RCPT TO)
 */
export async function validateSMTPHandshake(
  email: string,
  mxRecords: MXRecord[],
  config: Partial<SMTPConfig> = {}
): Promise<StageResult & { smtp_response?: string }> {
  const startTime = Date.now();
  const smtpConfig = { ...DEFAULT_CONFIG, ...config };

  try {
    if (!mxRecords || mxRecords.length === 0) {
      return {
        stage: 'smtp_handshake',
        passed: false,
        error: 'No MX records available for SMTP handshake',
        duration_ms: Date.now() - startTime,
      };
    }

    // Try each MX server until one responds
    for (const mx of mxRecords) {
      try {
        const result = await performSMTPHandshake(
          mx.exchange,
          smtpConfig.from_email,
          email,
          smtpConfig.timeout_ms
        );

        if (result.connected) {
          // 250 = mailbox exists
          const passed = result.responseCode === 250;

          return {
            stage: 'smtp_handshake',
            passed,
            error: passed ? undefined : `SMTP response: ${result.responseCode} ${result.response}`,
            smtp_response: `${result.responseCode} ${result.response}`,
            duration_ms: Date.now() - startTime,
          };
        }
      } catch (error) {
        // Continue to next MX
        continue;
      }
    }

    // No MX responded
    return {
      stage: 'smtp_handshake',
      passed: false,
      error: 'No MX servers responded to SMTP handshake',
      duration_ms: Date.now() - startTime,
    };
  } catch (error) {
    return {
      stage: 'smtp_handshake',
      passed: false,
      error: `SMTP handshake error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Perform full SMTP handshake with a server
 */
function performSMTPHandshake(
  host: string,
  from: string,
  to: string,
  timeout: number
): Promise<{ connected: boolean; responseCode: number; response: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let response = '';
    let responseCode = 0;
    let step = 0;
    const commands = [
      `EHLO ${from.split('@')[1]}`,
      `MAIL FROM:<${from}>`,
      `RCPT TO:<${to}>`,
      'QUIT',
    ];

    const cleanup = () => {
      try {
        socket.destroy();
      } catch {}
    };

    socket.setTimeout(timeout);

    socket.on('timeout', () => {
      cleanup();
      resolve({ connected: false, responseCode: 0, response: 'Connection timeout' });
    });

    socket.on('error', (err) => {
      cleanup();
      resolve({ connected: false, responseCode: 0, response: err.message });
    });

    socket.on('connect', () => {
      // Wait for banner
    });

    socket.on('data', (data) => {
      response = data.toString();

      // Parse response code
      const codeMatch = response.match(/^(\d{3})/);
      if (codeMatch) {
        responseCode = parseInt(codeMatch[1], 10);
      }

      // Check if this is a continuation line
      if (response.match(/^\d{3}-/)) {
        return;
      }

      // Process based on current step
      if (step === 0) {
        // Got banner, send EHLO
        step = 1;
        socket.write(commands[0] + '\r\n');
      } else if (step === 1) {
        // EHLO response, send MAIL FROM
        step = 2;
        socket.write(commands[1] + '\r\n');
      } else if (step === 2) {
        // MAIL FROM response, send RCPT TO
        step = 3;
        socket.write(commands[2] + '\r\n');
      } else if (step === 3) {
        // RCPT TO response - this determines if email exists
        cleanup();
        resolve({ connected: true, responseCode, response });
      }
    });

    socket.on('close', () => {
      cleanup();
    });

    // Connect to port 25
    socket.connect(25, host);
  });
}
