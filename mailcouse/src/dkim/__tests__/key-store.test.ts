// Unit tests for key store

// Mock environment
process.env.DKIM_ENCRYPTION_KEY = 'test-encryption-key-32-chars-long!!';

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { encryptPrivateKey, decryptPrivateKey, storeDKIMKeys, getDKIMPrivateKey, hasDKIMKeys } from '../key-store';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Key Store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('encryptPrivateKey / decryptPrivateKey', () => {
    it('should encrypt and decrypt private key', () => {
      const originalKey = '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...\n-----END PRIVATE KEY-----';

      const encrypted = encryptPrivateKey(originalKey);
      expect(encrypted).not.toBe(originalKey);
      expect(encrypted).toContain(':');

      const decrypted = decryptPrivateKey(encrypted);
      expect(decrypted).toBe(originalKey);
    });

    it('should produce different ciphertext each time', () => {
      const key = 'test-key';
      const encrypted1 = encryptPrivateKey(key);
      const encrypted2 = encryptPrivateKey(key);
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should throw on invalid encrypted format', () => {
      expect(() => decryptPrivateKey('invalid')).toThrow('Invalid encrypted key format');
    });
  });

  describe('storeDKIMKeys', () => {
    it('should store encrypted keys in database', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      await storeDKIMKeys('sub-1', 'private-key', 'selector1');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE subdomains'),
        expect.arrayContaining([expect.any(String), 'selector1', 'sub-1'])
      );
    });
  });

  describe('getDKIMPrivateKey', () => {
    it('should retrieve and decrypt private key', async () => {
      const originalKey = 'test-private-key';
      const encrypted = encryptPrivateKey(originalKey);

      mockQuery.mockResolvedValue({
        rows: [{ dkim_private_key: encrypted, dkim_selector: 'selector1' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await getDKIMPrivateKey('sub-1');

      expect(result).not.toBeNull();
      expect(result?.privateKey).toBe(originalKey);
      expect(result?.selector).toBe('selector1');
    });

    it('should return null if not found', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await getDKIMPrivateKey('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('hasDKIMKeys', () => {
    it('should return true if keys exist', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ dkim_private_key: 'encrypted-key' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await hasDKIMKeys('sub-1');
      expect(result).toBe(true);
    });

    it('should return false if no keys', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ dkim_private_key: null }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await hasDKIMKeys('sub-1');
      expect(result).toBe(false);
    });
  });
});
