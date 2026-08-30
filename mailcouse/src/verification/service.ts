import { execFile } from 'child_process';
import path from 'path';
import * as dns from 'dns';
import { config } from '../config';
import { query } from '../db/connection';
import { isEntireFamousDomain } from './famous-domains';

export interface PreSendVerificationResult {
  email: string;
  allowed: boolean;
  decision: 'allow' | 'block' | 'review';
  reason: string;
  suggestion?: string | null;
  source?: 'cache' | 'suppression' | 'verifier' | 'fallback';
  duration_ms?: number;
  syntax_valid?: boolean;
  has_mx_records?: boolean;
  smtp_verified?: boolean;
  reachable?: string;
  catch_all?: boolean;
  disposable?: boolean;
}

// In-memory cache for fast lookups
const memoryCache = new Map<string, { result: PreSendVerificationResult; expiresAt: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Runs the AfterShip/email-verifier Go tool on the recipient email.
 */
function runAfterShipVerifier(email: string): Promise<PreSendVerificationResult> {
  return new Promise((resolve, reject) => {
    const fs = require('fs');
    const isWindows = process.platform === 'win32';
    const binName = isWindows ? 'email-verifier.exe' : 'email-verifier';

    const candidatePaths = [
      path.resolve(__dirname, '../../dist/bin', binName),
      path.resolve(__dirname, '../../bin', binName),
      path.resolve(__dirname, '../../tools/email-verifier', binName),
      path.resolve(process.cwd(), 'dist/bin', binName),
      path.resolve(process.cwd(), 'bin', binName),
      path.resolve(process.cwd(), 'tools/email-verifier', binName),
    ];

    const resolvedBin = candidatePaths.find((p) => fs.existsSync(p));
    const toolDir = path.resolve(__dirname, '../../tools/email-verifier');

    const env = {
      ...process.env,
      DNS_HELO_HOSTNAME: config.dns.heloHostname,
      DNS_RETURN_PATH_DOMAIN: config.dns.returnPathDomain,
      DNS_SPF_INCLUDE: config.dns.spfInclude,
    };

    if (resolvedBin) {
      execFile(resolvedBin, [email], { env, timeout: 6000 }, (err, stdout) => {
        if (err || !stdout) return reject(err || new Error('Empty verifier output'));
        try {
          const parsed = JSON.parse(stdout.trim());
          resolve({
            email,
            allowed: parsed.decision === 'allow',
            decision: parsed.decision || 'allow',
            reason: parsed.reason || 'Verification complete',
            suggestion: parsed.suggestion || null,
            syntax_valid: parsed.syntax_valid,
            has_mx_records: parsed.has_mx_records,
            smtp_verified: parsed.smtp_verified,
            reachable: parsed.reachable,
            catch_all: parsed.catch_all,
            disposable: parsed.disposable,
          });
        } catch (parseErr) {
          reject(parseErr);
        }
      });
    } else {
      // Run with 'go run main.go'
      execFile('go', ['run', 'main.go', email], { cwd: toolDir, env, timeout: 8000 }, (err, stdout) => {
        if (err || !stdout) return reject(err || new Error('Empty verifier output'));
        try {
          const parsed = JSON.parse(stdout.trim());
          resolve({
            email,
            allowed: parsed.decision === 'allow',
            decision: parsed.decision || 'allow',
            reason: parsed.reason || 'Verification complete',
            suggestion: parsed.suggestion || null,
            syntax_valid: parsed.syntax_valid,
            has_mx_records: parsed.has_mx_records,
            smtp_verified: parsed.smtp_verified,
            reachable: parsed.reachable,
            catch_all: parsed.catch_all,
            disposable: parsed.disposable,
          });
        } catch (parseErr) {
          reject(parseErr);
        }
      });
    }
  });
}

/**
 * Pre-send email verification layer.
 * Verifies recipient using AfterShip/email-verifier before existing mail sending code executes.
 */
export async function verifyRecipient(email: string): Promise<PreSendVerificationResult> {
  const normalized = String(email || '').trim().toLowerCase();

  // 1. Basic syntax check
  if (!normalized || !normalized.includes('@')) {
    return {
      email: normalized,
      allowed: false,
      decision: 'block',
      source: 'verifier',
      reason: 'Invalid email syntax (missing @ or empty)',
    };
  }

  // 2. In-memory cache check
  const cached = memoryCache.get(normalized);
  if (cached && Date.now() < cached.expiresAt) {
    return { ...cached.result, source: 'cache' };
  }

  // 3. Suppression check in existing DB (if table exists)
  try {
    const supRes = await query('SELECT reason FROM suppression_list WHERE email = $1 LIMIT 1', [normalized]);
    if (supRes.rows.length > 0) {
      const result: PreSendVerificationResult = {
        email: normalized,
        allowed: false,
        decision: 'block',
        source: 'suppression',
        reason: `Recipient is on suppression list: ${supRes.rows[0].reason}`,
      };
      memoryCache.set(normalized, { result, expiresAt: Date.now() + CACHE_TTL_MS });
      return result;
    }
  } catch {}

  // 4. Run AfterShip verification engine
  try {
    const result = await runAfterShipVerifier(normalized);
    result.source = 'verifier';

    // Cache the result
    memoryCache.set(normalized, { result, expiresAt: Date.now() + CACHE_TTL_MS });

    // If confirmed nonexistent, record to suppression list (never suppress entire famous domains like gmail.com)
    if (result.decision === 'block' && (result.reachable === 'no' || !result.has_mx_records)) {
      if (!isEntireFamousDomain(normalized)) {
        try {
          await query(
            `INSERT INTO suppression_list (email, reason)
             VALUES ($1, $2) ON CONFLICT (email) DO NOTHING`,
            [normalized, result.reason]
          );
        } catch {}
      }
    }

    return result;
  } catch (err: any) {
    // 5. Fail-Safe: If Go CLI is unavailable or times out, perform standard fallback
    // Do NOT break existing email sending!
    try {
      const domain = normalized.split('@')[1];
      const mxRecords = await dns.promises.resolveMx(domain);
      if (!mxRecords || mxRecords.length === 0) {
        return {
          email: normalized,
          allowed: false,
          decision: 'block',
          source: 'fallback',
          reason: 'Domain has no MX records',
        };
      }
    } catch {
      return {
        email: normalized,
        allowed: false,
        decision: 'block',
        source: 'fallback',
        reason: 'Domain MX lookup failed (nonexistent domain)',
      };
    }

    // Default fail-safe: allow send through existing SMTP
    return {
      email: normalized,
      allowed: true,
      decision: 'allow',
      source: 'fallback',
      reason: 'Syntax and domain valid (verifier fallback allowed)',
    };
  }
}

/**
 * Clear in-memory verification cache.
 */
export function clearCache(): void {
  memoryCache.clear();
}
