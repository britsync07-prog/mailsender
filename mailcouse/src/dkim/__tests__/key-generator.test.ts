// Unit tests for key generator

import { generateKeyPair, extractPublicKeyBase64, getDKIMDNSRecord } from '../key-generator';

describe('Key Generator', () => {
  describe('generateKeyPair', () => {
    it('should generate a valid key pair', () => {
      const keyPair = generateKeyPair();

      expect(keyPair.publicKey).toBeDefined();
      expect(keyPair.privateKey).toBeDefined();
      expect(keyPair.selector).toBeDefined();
      expect(keyPair.publicKey).toContain('BEGIN PUBLIC KEY');
      expect(keyPair.privateKey).toContain('BEGIN PRIVATE KEY');
    });

    it('should use provided selector', () => {
      const keyPair = generateKeyPair('myselector');
      expect(keyPair.selector).toBe('myselector');
    });

    it('should generate unique selectors', () => {
      const keyPair1 = generateKeyPair();
      const keyPair2 = generateKeyPair();
      // Selectors should be different (random)
      expect(keyPair1.selector).not.toBe(keyPair2.selector);
    });
  });

  describe('extractPublicKeyBase64', () => {
    it('should extract base64 from PEM', () => {
      const keyPair = generateKeyPair();
      const base64 = extractPublicKeyBase64(keyPair.publicKey);

      expect(base64).toBeDefined();
      expect(base64).not.toContain('BEGIN');
      expect(base64).not.toContain('END');
      expect(base64).not.toContain('\n');
    });
  });

  describe('getDKIMDNSRecord', () => {
    it('should generate DNS record', () => {
      const keyPair = generateKeyPair();
      const record = getDKIMDNSRecord(keyPair.publicKey, 'selector1', 'example.com');

      expect(record.name).toBe('selector1._domainkey.example.com');
      expect(record.value).toContain('v=DKIM1');
      expect(record.value).toContain('k=rsa');
      expect(record.value).toContain('p=');
    });
  });
});
