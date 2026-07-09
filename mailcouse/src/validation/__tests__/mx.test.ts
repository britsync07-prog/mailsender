// Unit tests for Stage 2: MX Record Lookup

import { validateMX, getBestMX, hasBackupMX } from '../stages/mx';

describe('Stage 2: MX Record Lookup', () => {
  // Skip network tests in CI
  const skipNetwork = process.env.CI === 'true';

  describe('live MX lookup', () => {
    if (skipNetwork) return; // Skip in CI
    it('should find MX records for gmail.com', async () => {
      const result = await validateMX('user@gmail.com');
      expect(result.passed).toBe(true);
      expect(result.mx_records).toBeDefined();
      expect(result.mx_records!.length).toBeGreaterThan(0);
    });

    it('should find MX records for outlook.com', async () => {
      const result = await validateMX('user@outlook.com');
      expect(result.passed).toBe(true);
      expect(result.mx_records).toBeDefined();
    });

    it('should fail for domain without MX records', async () => {
      const result = await validateMX('user@nonexistent-domain-12345.com');
      expect(result.passed).toBe(false);
      expect(result.error).toContain('No MX records');
    });

    it('should fail for invalid email format', async () => {
      const result = await validateMX('notanemail');
      expect(result.passed).toBe(false);
      expect(result.error).toContain('Invalid email');
    });
  });

  describe('getBestMX', () => {
    it('should return lowest priority MX', () => {
      const mxRecords = [
        { priority: 10, exchange: 'mx1.example.com' },
        { priority: 5, exchange: 'mx2.example.com' },
        { priority: 20, exchange: 'mx3.example.com' },
      ];

      const best = getBestMX(mxRecords);
      expect(best).toBeDefined();
      expect(best!.priority).toBe(5);
      expect(best!.exchange).toBe('mx2.example.com');
    });

    it('should return null for empty array', () => {
      const best = getBestMX([]);
      expect(best).toBeNull();
    });

    it('should return null for null input', () => {
      const best = getBestMX(null as any);
      expect(best).toBeNull();
    });
  });

  describe('hasBackupMX', () => {
    it('should return true when multiple MX records', () => {
      const mxRecords = [
        { priority: 10, exchange: 'mx1.example.com' },
        { priority: 20, exchange: 'mx2.example.com' },
      ];
      expect(hasBackupMX(mxRecords)).toBe(true);
    });

    it('should return false for single MX record', () => {
      const mxRecords = [{ priority: 10, exchange: 'mx1.example.com' }];
      expect(hasBackupMX(mxRecords)).toBe(false);
    });
  });

  describe('performance', () => {
    it('should complete MX lookup in under 5 seconds', async () => {
      if (skipNetwork) return; // Skip in CI
      const start = Date.now();
      await validateMX('user@gmail.com');
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(5000);
    });
  });
});
