// Stage 5: Catch-All Domain Detection

import * as net from 'net';
import * as tls from 'tls';
import { StageResult, MXRecord, SMTPConfig } from '../types';

// Default SMTP configuration
const DEFAULT_CONFIG: SMTPConfig = {
  from_domain: 'mailcheck.example.com',
  from_email: 'verify@mailcheck.example.com',
  timeout_ms: 10000,
  max_retries: 2,
};

/**
 * Validate if domain is catch-all via SMTP probe
 */
export async function validateCatchAll(
  email: string,
  mxRecords: MXRecord[],
  config: Partial<SMTPConfig> = {}
): Promise<StageResult & { catch_all_detected: boolean }> {
  const startTime = Date.now();
  const smtpConfig = { ...DEFAULT_CONFIG, ...config };

  try {
    if (!mxRecords || mxRecords.length === 0) {
      return {
        stage: 'catch_all',
        passed: true, // Not a failure, just can't test
        catch_all_detected: false,
        error: 'No MX records available for catch-all test',
        duration_ms: Date.now() - startTime,
      };
    }

    // Extract domain from email
    const domain = email.split('@')[1];

    // Generate random address for catch-all test
    const randomLocal = generateRandomString(16);
    const testEmail = `${randomLocal}@${domain}`;

    // Try each MX server
    for (const mx of mxRecords) {
      try {
        const result = await probeSMTP(mx.exchange, smtpConfig.from_email, testEmail, smtpConfig.timeout_ms);

        if (result.connected) {
          // If server accepts random address, it's catch-all
          const isCatchAll = result.responseCode === 250;

          return {
            stage: 'catch_all',
            passed: true, // Catch-all is not a failure
            catch_all_detected: isCatchAll,
            duration_ms: Date.now() - startTime,
          };
        }
      } catch (error) {
        // Continue to next MX
        continue;
      }
    }

    // If no MX responded, assume not catch-all
    return {
      stage: 'catch_all',
      passed: true,
      catch_all_detected: false,
      error: 'No MX servers responded to catch-all probe',
      duration_ms: Date.now() - startTime,
    };
  } catch (error) {
    return {
      stage: 'catch_all',
      passed: true, // Not a failure
      catch_all_detected: false,
      error: `Catch-all detection error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Probe SMTP server with a test email
 */
function probeSMTP(
  host: string,
  from: string,
  to: string,
  timeout: number
): Promise<{ connected: boolean; responseCode: number; response: string }> {
  return new Promise((resolve, reject) => {
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

      // Check if this is a continuation line (starts with digit-space)
      if (response.match(/^\d{3}-/)) {
        return; // Wait for more data
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
        // RCPT TO response - this is what we care about
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

/**
 * Generate random string for catch-all test
 */
function generateRandomString(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
