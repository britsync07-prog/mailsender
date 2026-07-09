import { buildEmail, buildReplyEmail } from '../email-builder';
import { resetHeaderRandomizer } from '../../fingerprint/header-randomizer';
import { resetThreading } from '../../threading/manager';

jest.mock('../../db/connection', () => ({
  query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] }),
}));

describe('Email Builder', () => {
  beforeEach(() => {
    resetHeaderRandomizer();
    resetThreading();
  });

  describe('buildEmail', () => {
    it('should build email with headers and content', async () => {
      const result = await buildEmail(
        {
          job_id: 'job-1',
          lead_id: 'lead-1',
          email: 'lead@example.com',
          first_name: 'John',
          company: 'Acme',
          industry: 'tech',
          pain_point: 'cost',
          subdomain_id: 'sub-1',
          subdomain: 'mail.example.com',
          ip_id: 'ip-1',
          sending_ip: '1.2.3.4',
          template_id: 'tpl-1',
          sender_name: 'Jane Smith',
          attempt: 1,
          queued_at: new Date().toISOString(),
        },
        'Hello {{first_name}}, check {{company_name}}',
        'Body for {{first_name}} at {{company_name}} in {{industry}}'
      );

      expect(result.from).toContain('Jane Smith');
      expect(result.to).toBe('lead@example.com');
      expect(result.subject).toContain('John');
      expect(result.body).toContain('John');
      expect(result.mimeHeaders.length).toBeGreaterThanOrEqual(3);

      const msgId = result.mimeHeaders.find((h) => h.key === 'Message-ID');
      expect(msgId).toBeTruthy();
      expect(msgId!.value).toContain('@mail.example.com');

      const mime = result.mimeHeaders.find((h) => h.key === 'MIME-Version');
      expect(mime).toBeTruthy();
      expect(mime!.value).toBe('1.0');
    });

    it('should handle missing optional fields', async () => {
      const result = await buildEmail(
        {
          job_id: 'job-2',
          lead_id: 'lead-2',
          email: 'other@example.com',
          industry: 'smart_homes',
          subdomain_id: 'sub-2',
          subdomain: 'biz.example.com',
          ip_id: 'ip-2',
          sending_ip: '1.2.3.5',
          template_id: 'tpl-2',
          sender_name: 'Bob',
          attempt: 1,
          queued_at: new Date().toISOString(),
        },
        'Hi {{first_name}}',
        'Body'
      );

      expect(result.subject).toBe('Hi ');
      expect(result.body).toBe('Body');
    });
  });

  describe('buildReplyEmail', () => {
    it('should build reply email with threading headers', async () => {
      const result = await buildReplyEmail(
        'me@ex.com', 'you@ex.com', 'Your question', 'Reply body',
        '<orig@ex.com>', 'ex.com', 'reply-job-1'
      );

      expect(result.from).toBe('me@ex.com');
      expect(result.to).toBe('you@ex.com');
      expect(result.subject).toContain('Re:');

      const inReplyTo = result.mimeHeaders.find((h) => h.key === 'In-Reply-To');
      expect(inReplyTo).toBeTruthy();
      expect(inReplyTo!.value).toBe('<orig@ex.com>');
    });
  });
});
