// DKIM signature generation

import { createSign, createHash } from 'crypto';
import { DKIMSignature, DKIMSignResult, DKIMConfig, DEFAULT_DKIM_HEADERS, DKIM_ALGORITHM, DKIM_VERSION } from './types';
import { getDKIMPrivateKey } from './key-store';

/**
 * Sign email with DKIM
 */
export async function signEmail(
  subdomainId: string,
  headers: Record<string, string>,
  body: string
): Promise<DKIMSignResult> {
  try {
    // Get DKIM private key
    const keyData = await getDKIMPrivateKey(subdomainId);
    if (!keyData) {
      return {
        success: false,
        error: 'DKIM keys not found for subdomain',
      };
    }

    const { privateKey, selector } = keyData;

    // Get domain from headers
    const fromHeader = headers.from || '';
    const domainMatch = fromHeader.match(/@([^>]+)/);
    if (!domainMatch) {
      return {
        success: false,
        error: 'Cannot extract domain from From header',
      };
    }
    const domain = domainMatch[1];

    // Generate DKIM signature
    const signature = generateDKIMSignature(
      privateKey,
      selector,
      domain,
      headers,
      body
    );

    return {
      success: true,
      signature,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Signing failed',
    };
  }
}

/**
 * Generate DKIM signature string
 */
function generateDKIMSignature(
  privateKey: string,
  selector: string,
  domain: string,
  headers: Record<string, string>,
  body: string
): string {
  // Signed headers
  const signedHeaders = DEFAULT_DKIM_HEADERS.filter((h) => headers[h] !== undefined);
  const headerList = signedHeaders.join(':');

  // Create header string for signing
  const headerString = signedHeaders
    .map((h) => `${h}:${headers[h]}`)
    .join('\r\n');

  // Body hash (simple canonicalization)
  const bodyHash = createHash('sha256')
    .update(body)
    .digest('base64');

  // Sign headers
  const sign = createSign('sha256');
  sign.update(headerString);
  const headerSignature = sign.sign(privateKey, 'base64');

  // Build DKIM-Signature header
  const dkimSignature = [
    `v=${DKIM_VERSION}`,
    `a=${DKIM_ALGORITHM}`,
    `d=${domain}`,
    `s=${selector}`,
    `h=${headerList}`,
    `bh=${bodyHash}`,
    `b=${headerSignature}`,
  ].join('; ');

  return dkimSignature;
}

/**
 * Verify DKIM signature (for testing)
 */
export function verifyDKIMSignature(
  publicKey: string,
  headers: Record<string, string>,
  body: string,
  signatureHeader: string
): boolean {
  try {
    // Parse DKIM-Signature
    const parts = parseDKIMSignature(signatureHeader);
    if (!parts) return false;

    // Reconstruct signed headers
    const signedHeaders = parts.h.split(':');
    const headerString = signedHeaders
      .map((h) => `${h}:${headers[h]}`)
      .join('\r\n');

    // Verify signature
    const verify = require('crypto').createVerify('sha256');
    verify.update(headerString);
    return verify.verify(publicKey, parts.b, 'base64');
  } catch (error) {
    return false;
  }
}

/**
 * Parse DKIM-Signature header
 */
function parseDKIMSignature(signature: string): {
  v: string;
  a: string;
  d: string;
  s: string;
  h: string;
  bh: string;
  b: string;
} | null {
  try {
    const parts: Record<string, string> = {};
    const segments = signature.split(';');

    for (const segment of segments) {
      const [key, value] = segment.trim().split('=');
      if (key && value) {
        parts[key.trim()] = value.trim();
      }
    }

    return {
      v: parts.v || '',
      a: parts.a || '',
      d: parts.d || '',
      s: parts.s || '',
      h: parts.h || '',
      bh: parts.bh || '',
      b: parts.b || '',
    };
  } catch (error) {
    return null;
  }
}
