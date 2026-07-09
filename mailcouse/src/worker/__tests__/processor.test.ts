jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../../queue/daily-limiter', () => ({
  recordSend: jest.fn(),
}));

jest.mock('../../smtp/sender', () => ({
  sendEmail: jest.fn().mockResolvedValue({
    success: true, response_code: 250, response_message: 'OK',
    retry: false, should_suppress: false, duration_ms: 100,
  }),
  sendEmailWithContent: jest.fn().mockResolvedValue({
    success: true, response_code: 250, response_message: 'OK',
    retry: false, should_suppress: false, duration_ms: 100,
  }),
}));

jest.mock('../../fingerprint/pattern-diversifier', () => {
  const actual = jest.requireActual('../../fingerprint/pattern-diversifier');
  return {
    ...actual,
    decideTiming: jest.fn().mockReturnValue({ delayMs: 0, burstRemaining: 0 }),
    shouldDelaySend: jest.fn().mockReturnValue(0),
  };
});

jest.mock('../../smtp/email-builder', () => ({
  buildEmail: jest.fn().mockResolvedValue({
    from: 'John Smith <mail.example.com>',
    to: 'test@example.com',
    subject: 'Hello John',
    body: 'Test body',
    mimeHeaders: [
      { key: 'From', value: 'John Smith <mail.example.com>' },
      { key: 'To', value: 'test@example.com' },
      { key: 'Subject', value: 'Hello John' },
      { key: 'Message-ID', value: '<job-1@mail.example.com>' },
      { key: 'MIME-Version', value: '1.0' },
      { key: 'Content-Type', value: 'text/plain; charset=UTF-8' },
    ],
  }),
}));

import { processJob } from '../processor';
import { query } from '../../db/connection';
import { recordSend } from '../../queue/daily-limiter';

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockRecordSend = recordSend as jest.MockedFunction<typeof recordSend>;

describe('Processor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('processJob', () => {
    it('should process job successfully', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });
      mockQuery.mockResolvedValueOnce({ rows: [{ emails_sent_today: 5, daily_limit: 10 }], rowCount: 1, command: '', oid: 0, fields: [] });
      mockQuery.mockResolvedValueOnce({ rows: [{ emails_today: 100 }], rowCount: 1, command: '', oid: 0, fields: [] });
      mockQuery.mockResolvedValueOnce({ rows: [{ subject: 'Hello {{first_name}}', body: 'Test body' }], rowCount: 1, command: '', oid: 0, fields: [] });
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await processJob({
        job_id: 'job-1', lead_id: 'lead-1', email: 'test@example.com',
        first_name: 'John', subdomain_id: 'sub-1', ip_id: 'ip-1',
        template_id: 'template-1', sender_name: 'John Smith',
        subdomain: 'mail.example.com', sending_ip: '1.2.3.4',
        attempt: 1, queued_at: new Date().toISOString(),
      } as any);

      expect(result.success).toBe(true);
      expect(result.action).toBe('sent');
    });

    it('should handle suppressed email', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'sup-1' }], rowCount: 1, command: '', oid: 0, fields: [] });
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await processJob({
        job_id: 'job-1', email: 'suppressed@example.com',
        subdomain_id: 'sub-1', ip_id: 'ip-1',
      } as any);

      expect(result.action).toBe('suppressed');
    }, 10000);

    it('should handle daily limit reached', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] });
      mockQuery.mockResolvedValueOnce({ rows: [{ emails_sent_today: 10, daily_limit: 10 }], rowCount: 1, command: '', oid: 0, fields: [] });
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      const result = await processJob({
        job_id: 'job-1', email: 'test@example.com',
        subdomain_id: 'sub-1', ip_id: 'ip-1',
      } as any);

      expect(result.action).toBe('requeued');
    }, 10000);
  });
});
