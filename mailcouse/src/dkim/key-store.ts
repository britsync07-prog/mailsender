// Encrypted key storage and retrieval

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { query } from '../db/connection';

// AES-256 configuration
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

/**
 * Get encryption key from environment
 */
function getEncryptionKey(): Buffer {
  const key = process.env.DKIM_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('DKIM_ENCRYPTION_KEY environment variable not set');
  }
  // Ensure key is 32 bytes for AES-256
  return Buffer.from(key.padEnd(32, '0').slice(0, 32));
}

/**
 * Encrypt private key
 */
export function encryptPrivateKey(privateKey: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(privateKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // Prepend IV to encrypted data
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt private key
 */
export function decryptPrivateKey(encryptedKey: string): string {
  const key = getEncryptionKey();
  const parts = encryptedKey.split(':');

  if (parts.length !== 2) {
    throw new Error('Invalid encrypted key format');
  }

  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Store DKIM key pair in database
 */
export async function storeDKIMKeys(
  subdomainId: string,
  privateKey: string,
  selector: string
): Promise<void> {
  const encryptedKey = encryptPrivateKey(privateKey);

  await query(
    `UPDATE subdomains
     SET dkim_private_key = $1, dkim_selector = $2
     WHERE id = $3`,
    [encryptedKey, selector, subdomainId]
  );
}

/**
 * Retrieve and decrypt DKIM private key
 */
export async function getDKIMPrivateKey(
  subdomainId: string
): Promise<{ privateKey: string; selector: string } | null> {
  const result = await query<{ dkim_private_key: string; dkim_selector: string }>(
    'SELECT dkim_private_key, dkim_selector FROM subdomains WHERE id = $1',
    [subdomainId]
  );

  if (result.rows.length === 0 || !result.rows[0].dkim_private_key) {
    return null;
  }

  const { dkim_private_key, dkim_selector } = result.rows[0];

  try {
    const privateKey = decryptPrivateKey(dkim_private_key);
    return {
      privateKey,
      selector: dkim_selector,
    };
  } catch (error) {
    console.error('Failed to decrypt DKIM key:', error);
    return null;
  }
}

/**
 * Retrieve and decrypt DKIM private key for a customer domain
 */
export async function getDomainDKIMPrivateKey(
  domainId: string
): Promise<{ privateKey: string; selector: string } | null> {
  const result = await query<{ dkim_private_key: string; dkim_selector: string }>(
    'SELECT dkim_private_key, dkim_selector FROM customer_domains WHERE id = $1',
    [domainId]
  );

  if (result.rows.length === 0 || !result.rows[0].dkim_private_key) {
    return null;
  }

  const { dkim_private_key, dkim_selector } = result.rows[0];

  try {
    const privateKey = decryptPrivateKey(dkim_private_key);
    return { privateKey, selector: dkim_selector };
  } catch (error) {
    console.error('Failed to decrypt domain DKIM key:', error);
    return null;
  }
}

/**
 * Check if subdomain has DKIM keys
 */
export async function hasDKIMKeys(subdomainId: string): Promise<boolean> {
  const result = await query<{ dkim_private_key: string }>(
    'SELECT dkim_private_key FROM subdomains WHERE id = $1',
    [subdomainId]
  );

  return result.rows.length > 0 && !!result.rows[0].dkim_private_key;
}
