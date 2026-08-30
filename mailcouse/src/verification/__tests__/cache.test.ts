import { getCachedResult, setCachedResult, clearVerificationCache } from '../cache';
import { VerificationResult } from '../types';

describe('Verification Cache', () => {
  beforeEach(async () => {
    await clearVerificationCache();
  });

  it('should store and retrieve a verification result', async () => {
    const email = 'test@example.com';
    const result: VerificationResult = {
      email,
      valid: true,
      syntax_valid: true,
      has_mx_records: true,
      smtp_verified: true,
      reachable: 'yes',
      disposable: false,
      role_account: false,
      free_provider: false,
      catch_all: false,
      suggestion: null,
      decision: 'allow',
      reason: 'Valid recipient',
    };

    await setCachedResult(email, result);
    const cached = await getCachedResult(email);

    expect(cached).toBeDefined();
    expect(cached?.email).toBe(email);
    expect(cached?.decision).toBe('allow');
    expect(cached?.valid).toBe(true);
  });

  it('should return null for non-existent cache key', async () => {
    const cached = await getCachedResult('nonexistent@example.com');
    expect(cached).toBeNull();
  });

  it('should normalize email addresses for cache lookup (case insensitive)', async () => {
    const result: VerificationResult = {
      email: 'user@example.com',
      valid: true,
      syntax_valid: true,
      has_mx_records: true,
      smtp_verified: true,
      reachable: 'yes',
      disposable: false,
      role_account: false,
      free_provider: false,
      catch_all: false,
      suggestion: null,
      decision: 'allow',
      reason: 'Valid',
    };

    await setCachedResult('User@Example.COM', result);
    const cached = await getCachedResult('USER@example.com');

    expect(cached).toBeDefined();
    expect(cached?.email).toBe('user@example.com');
  });
});
