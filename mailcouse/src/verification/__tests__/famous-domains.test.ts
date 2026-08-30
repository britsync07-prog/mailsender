import { isFamousDomain, isEntireFamousDomain, FAMOUS_EMAIL_DOMAINS } from '../famous-domains';
import { verifyRecipient, clearCache } from '../service';
import * as db from '../../db/connection';
import * as childProcess from 'child_process';

jest.mock('../../db/connection');
jest.mock('child_process');

describe('Famous Domains Protection', () => {
  const mockQuery = db.query as jest.MockedFunction<typeof db.query>;
  const mockExecFile = childProcess.execFile as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    clearCache();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as any);
  });

  it('should identify entire famous domains and wildcard patterns correctly', () => {
    // Entire domains (should be protected from domain-wide suppression)
    expect(isEntireFamousDomain('gmail.com')).toBe(true);
    expect(isEntireFamousDomain('googlemail.com')).toBe(true);
    expect(isEntireFamousDomain('outlook.com')).toBe(true);
    expect(isEntireFamousDomain('hotmail.com')).toBe(true);
    expect(isEntireFamousDomain('yahoo.com')).toBe(true);
    expect(isEntireFamousDomain('icloud.com')).toBe(true);
    expect(isEntireFamousDomain('proton.me')).toBe(true);
    expect(isEntireFamousDomain('@gmail.com')).toBe(true);
    expect(isEntireFamousDomain('*@outlook.com')).toBe(true);

    // Individual email addresses (not entire domain)
    expect(isEntireFamousDomain('user@gmail.com')).toBe(false);
    expect(isEntireFamousDomain('john.doe@outlook.com')).toBe(false);

    // Unknown custom domain
    expect(isEntireFamousDomain('mycompany.org')).toBe(false);
    expect(isEntireFamousDomain('user@mycompany.org')).toBe(false);
  });

  it('should identify famous email providers for domain matching', () => {
    expect(isFamousDomain('user@gmail.com')).toBe(true);
    expect(isFamousDomain('user@googlemail.com')).toBe(true);
    expect(isFamousDomain('user@outlook.com')).toBe(true);
    expect(isFamousDomain('user@hotmail.com')).toBe(true);
    expect(isFamousDomain('user@live.com')).toBe(true);
    expect(isFamousDomain('user@yahoo.com')).toBe(true);
    expect(isFamousDomain('user@ymail.com')).toBe(true);
    expect(isFamousDomain('user@icloud.com')).toBe(true);
    expect(isFamousDomain('user@me.com')).toBe(true);
    expect(isFamousDomain('user@aol.com')).toBe(true);
    expect(isFamousDomain('user@zoho.com')).toBe(true);
    expect(isFamousDomain('user@proton.me')).toBe(true);
    expect(isFamousDomain('user@protonmail.com')).toBe(true);
    expect(isFamousDomain('user@comcast.net')).toBe(true);
    expect(isFamousDomain('user@att.net')).toBe(true);

    // Domain string only
    expect(isFamousDomain('gmail.com')).toBe(true);
    expect(isFamousDomain('yahoo.com')).toBe(true);

    // Custom corporate/private domain should return false
    expect(isFamousDomain('user@mycompany.org')).toBe(false);
    expect(isFamousDomain('user@customserver.io')).toBe(false);
  });

  it('should allow suppressing confirmed nonexistent individual user addresses', async () => {
    mockExecFile.mockImplementation((_bin: any, _args: any, _opts: any, callback: any) => {
      callback(null, JSON.stringify({
        email: 'confirmed-bad-user@gmail.com',
        valid: false,
        syntax_valid: true,
        has_mx_records: true,
        reachable: 'no',
        decision: 'block',
        reason: 'Recipient mailbox confirmed nonexistent',
      }));
    });

    const res = await verifyRecipient('confirmed-bad-user@gmail.com');
    expect(res.decision).toBe('block');

    // Verify that individual nonexistent user is recorded to suppression list
    const insertCalls = mockQuery.mock.calls.filter(call =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO suppression_list')
    );
    expect(insertCalls.length).toBe(1);
    expect(insertCalls[0][1]).toContain('confirmed-bad-user@gmail.com');
  });

  it('should add blocked custom domain addresses to suppression_list', async () => {
    mockExecFile.mockImplementation((_bin: any, _args: any, _opts: any, callback: any) => {
      callback(null, JSON.stringify({
        email: 'baduser@unknowncustomdomain123.com',
        valid: false,
        syntax_valid: true,
        has_mx_records: false,
        reachable: 'no',
        decision: 'block',
        reason: 'Domain has no MX records',
      }));
    });

    const res = await verifyRecipient('baduser@unknowncustomdomain123.com');
    expect(res.decision).toBe('block');

    // Verify that suppression INSERT was called for custom domain address
    const insertCalls = mockQuery.mock.calls.filter(call =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO suppression_list')
    );
    expect(insertCalls.length).toBe(1);
    expect(insertCalls[0][1]).toContain('baduser@unknowncustomdomain123.com');
  });
});
