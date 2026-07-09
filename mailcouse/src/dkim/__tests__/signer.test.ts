// Unit tests for signer

// Mock environment
process.env.DKIM_ENCRYPTION_KEY = 'test-encryption-key-32-chars-long!!';

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { signEmail, verifyDKIMSignature } from '../signer';
import { generateKeyPair } from '../key-generator';
import { encryptPrivateKey } from '../key-store';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Signer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('signEmail', () => {
    it('should sign email successfully', async () => {
      const keyPair = generateKeyPair('test-selector');
      const encrypted = encryptPrivateKey(keyPair.privateKey);

      mockQuery.mockResolvedValue({
        rows: [{ dkim_private_key: encrypted, dkim_selector: 'test-selector' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await signEmail('sub-1', {
        from: 'test@example.com',
        to: 'recipient@company.com',
        subject: 'Hello',
        date: new Date().toUTCString(),
        'message-id': '<test@example.com>',
      }, 'Test body');

      expect(result.success).toBe(true);
      expect(result.signature).toBeDefined();
      expect(result.signature).toContain('v=1');
      expect(result.signature).toContain('a=rsa-sha256');
    });

    it('should fail when keys not found', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await signEmail('nonexistent', {
        from: 'test@example.com',
      }, 'body');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('verifyDKIMSignature', () => {
    it('should verify valid signature', () => {
      const keyPair = generateKeyPair('test');
      const headers = {
        from: 'test@example.com',
        to: 'recipient@company.com',
        subject: 'Hello',
      };

      // Create signature manually for testing
      const crypto = require('crypto');
      const sign = crypto.createSign('sha256');
      sign.update('from:test@example.com\r\nto:recipient@company.com\r\nsubject:Hello');
      const signature = sign.sign(keyPair.privateKey, 'base64');

      const dkimSig = `v=1; a=rsa-sha256; d=example.com; s=test; h=from:to:subject; bh=test; b=${signature}`;

      const result = verifyDKIMSignature(keyPair.publicKey, headers, '', dkimSig);
      expect(result).toBe(true);
    });
  });
});
