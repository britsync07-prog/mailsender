import { verifyRecipient, clearCache } from '../service';
import * as db from '../../db/connection';
import * as childProcess from 'child_process';
import * as dns from 'dns';

jest.mock('../../db/connection');
jest.mock('child_process');
jest.mock('dns', () => ({
  promises: {
    resolveMx: jest.fn(),
  },
}));

describe('Pre-Send Email Recipient Verification (AfterShip Engine)', () => {
  const mockQuery = db.query as jest.MockedFunction<typeof db.query>;
  const mockExecFile = childProcess.execFile as unknown as jest.Mock;
  const mockResolveMx = dns.promises.resolveMx as jest.MockedFunction<typeof dns.promises.resolveMx>;

  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as any);
  });

  it('1. should block invalid email syntax immediately', async () => {
    const res = await verifyRecipient('invalid-syntax-email');
    expect(res.allowed).toBe(false);
    expect(res.decision).toBe('block');
    expect(res.reason).toContain('Invalid email syntax');
  });

  it('2. should block nonexistent domain (no MX records)', async () => {
    mockExecFile.mockImplementation((_bin: any, _args: any, _opts: any, callback: any) => {
      callback(null, JSON.stringify({
        email: 'user@nonexistent-domain-xyz123.com',
        valid: false,
        syntax_valid: true,
        has_mx_records: false,
        decision: 'block',
        reason: 'Domain has no MX records',
      }));
    });

    const res = await verifyRecipient('user@nonexistent-domain-xyz123.com');
    expect(res.allowed).toBe(false);
    expect(res.decision).toBe('block');
    expect(res.reason).toContain('no MX records');
  });

  it('3. should allow known valid email address', async () => {
    mockExecFile.mockImplementation((_bin: any, _args: any, _opts: any, callback: any) => {
      callback(null, JSON.stringify({
        email: 'user@noblecircle.online',
        valid: true,
        syntax_valid: true,
        has_mx_records: true,
        smtp_verified: true,
        reachable: 'yes',
        decision: 'allow',
        reason: 'Recipient address verified and deliverable',
      }));
    });

    const res = await verifyRecipient('user@noblecircle.online');
    expect(res.allowed).toBe(true);
    expect(res.decision).toBe('allow');
    expect(res.reason).toContain('deliverable');
  });

  it('4. should allow unknown SMTP reachability without falsely rejecting', async () => {
    mockExecFile.mockImplementation((_bin: any, _args: any, _opts: any, callback: any) => {
      callback(null, JSON.stringify({
        email: 'user@defensive-domain.com',
        valid: true,
        syntax_valid: true,
        has_mx_records: true,
        smtp_verified: true,
        reachable: 'unknown',
        decision: 'allow',
        reason: 'Address syntax and MX valid (unknown SMTP status allowed)',
      }));
    });

    const res = await verifyRecipient('user@defensive-domain.com');
    expect(res.allowed).toBe(true);
    expect(res.decision).toBe('allow');
  });

  it('5. should allow catch-all domain without assuming mailbox is invalid', async () => {
    mockExecFile.mockImplementation((_bin: any, _args: any, _opts: any, callback: any) => {
      callback(null, JSON.stringify({
        email: 'someone@catchall-domain.com',
        valid: true,
        syntax_valid: true,
        has_mx_records: true,
        catch_all: true,
        reachable: 'unknown',
        decision: 'allow',
        reason: 'Catch-all domain accepted',
      }));
    });

    const res = await verifyRecipient('someone@catchall-domain.com');
    expect(res.allowed).toBe(true);
    expect(res.decision).toBe('allow');
    expect(res.catch_all).toBe(true);
  });

  it('6. should block suppressed recipient before network calls', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ reason: 'hard_bounce' }],
      rowCount: 1,
    } as any);

    const res = await verifyRecipient('previously-bounced@example.com');
    expect(res.allowed).toBe(false);
    expect(res.decision).toBe('block');
    expect(res.reason).toContain('suppression list');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('7. should return typo suggestion when domain is misspelled', async () => {
    mockExecFile.mockImplementation((_bin: any, _args: any, _opts: any, callback: any) => {
      callback(null, JSON.stringify({
        email: 'user@gmai.com',
        valid: true,
        syntax_valid: true,
        has_mx_records: true,
        suggestion: 'gmail.com',
        decision: 'allow',
        reason: 'Address syntax and MX valid',
      }));
    });

    const res = await verifyRecipient('user@gmai.com');
    expect(res.suggestion).toBe('gmail.com');
  });

  it('8. should fail-safe gracefully when verifier tool encounters error', async () => {
    mockExecFile.mockImplementation((_bin: any, _args: any, _opts: any, callback: any) => {
      callback(new Error('Process timeout'));
    });
    mockResolveMx.mockResolvedValueOnce([{ exchange: 'mail.example.com', priority: 10 }] as any);

    const res = await verifyRecipient('valid-user@example.com');
    expect(res.allowed).toBe(true);
    expect(res.decision).toBe('allow');
    expect(res.reason).toContain('fallback allowed');
  });
});
