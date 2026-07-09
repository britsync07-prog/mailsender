// RSA-2048 key pair generation

import { generateKeyPairSync } from 'crypto';
import { DKIMKeyPair } from './types';

/**
 * Generate a new DKIM key pair
 */
export function generateKeyPair(selector?: string): DKIMKeyPair {
  // Generate RSA 2048-bit key pair
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  // Generate selector if not provided
  const dkimSelector = selector || generateSelector();

  return {
    publicKey: publicKey.trim(),
    privateKey: privateKey.trim(),
    selector: dkimSelector,
  };
}

/**
 * Generate a random DKIM selector
 */
function generateSelector(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let selector = '';
  for (let i = 0; i < 8; i++) {
    selector += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return selector;
}

/**
 * Extract public key in base64 format for DNS
 */
export function extractPublicKeyBase64(publicKeyPem: string): string {
  // Remove PEM headers and footers
  const pemBody = publicKeyPem
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s/g, '');

  return pemBody;
}

/**
 * Get DNS record for DKIM
 */
export function getDKIMDNSRecord(
  publicKeyPem: string,
  selector: string,
  domain: string
): { name: string; value: string } {
  const publicKeyBase64 = extractPublicKeyBase64(publicKeyPem);

  return {
    name: `${selector}._domainkey.${domain}`,
    value: `v=DKIM1; k=rsa; p=${publicKeyBase64}`,
  };
}
