import { verifyEmailViaApi, checkVerifierHealth } from '../client';
import fetch from 'node-fetch';

jest.mock('node-fetch');
const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

describe('Verifier HTTP Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call verifier API and return verification result', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
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
        reason: 'Recipient address verified and deliverable',
      }),
    } as any);

    const res = await verifyEmailViaApi('user@example.com');
    expect(res.decision).toBe('allow');
    expect(res.valid).toBe(true);
    expect(res.has_mx_records).toBe(true);
    expect(mockFetch).toHaveBeenCalled();
  });

  it('should throw an error on non-200 HTTP response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Error',
    } as any);

    await expect(verifyEmailViaApi('user@example.com')).rejects.toThrow('Verifier HTTP 500');
  });

  it('should return true for checkVerifierHealth when /health responds 200', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
    } as any);

    const healthy = await checkVerifierHealth();
    expect(healthy).toBe(true);
  });

  it('should return false for checkVerifierHealth when /health fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const healthy = await checkVerifierHealth();
    expect(healthy).toBe(false);
  });
});
