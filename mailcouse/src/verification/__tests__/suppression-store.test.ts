import { isSuppressed, addSuppression, removeSuppression, resetSchemaEnsuredForTesting } from '../suppression-store';
import * as db from '../../db/connection';

jest.mock('../../db/connection');

describe('Suppression Store', () => {
  const mockQuery = db.query as jest.MockedFunction<typeof db.query>;

  beforeEach(() => {
    jest.clearAllMocks();
    resetSchemaEnsuredForTesting();
  });

  it('should return suppressed=false when email not in suppression list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any); // migration
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any); // select

    const res = await isSuppressed('clean@example.com');
    expect(res.suppressed).toBe(false);
  });

  it('should return suppressed=true when email is in suppression list with hard_bounce', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any); // migration
    mockQuery.mockResolvedValueOnce({
      rows: [{
        email: 'bounced@example.com',
        reason: '550 User unknown',
        status: 'hard_bounce',
        first_seen: new Date(),
        last_seen: new Date(),
      }],
      rowCount: 1,
    } as any);

    const res = await isSuppressed('bounced@example.com');
    expect(res.suppressed).toBe(true);
    expect(res.status).toBe('hard_bounce');
    expect(res.reason).toBe('550 User unknown');
  });

  it('should return suppressed=false if suppression has expired', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any); // migration
    mockQuery.mockResolvedValueOnce({
      rows: [{
        email: 'expired@example.com',
        reason: 'temporary_block',
        status: 'suppressed',
        first_seen: new Date(),
        last_seen: new Date(),
        expires_at: new Date(Date.now() - 100000), // in the past
      }],
      rowCount: 1,
    } as any);

    const res = await isSuppressed('expired@example.com');
    expect(res.suppressed).toBe(false);
  });

  it('should call query to insert or update suppression entry', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);

    await addSuppression({
      email: 'bad@example.com',
      reason: 'Mailbox does not exist',
      status: 'hard_bounce',
    });

    expect(mockQuery).toHaveBeenCalled();
    const lastCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 1];
    expect(lastCall[0]).toContain('INSERT INTO suppression_list');
    expect(lastCall[1]).toContain('bad@example.com');
    expect(lastCall[1]).toContain('Mailbox does not exist');
    expect(lastCall[1]).toContain('hard_bounce');
  });
});
