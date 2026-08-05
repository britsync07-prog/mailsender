import { ACCEPTED_DELIVERY_LABEL, buildDashboardAlerts } from '../portal-routes';
import { query } from '../../db/connection';

jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../auth-middleware', () => ({
  authenticate: jest.fn((_req, _res, next) => next()),
  requireOrg: jest.fn((_req, _res, next) => next()),
}));

describe('dashboard diagnostics', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('turns Gmail 550 5.7.26 authentication failures into critical alerts', async () => {
    (query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          domain_id: 'domain-1',
          domain: 'britsyncai.com',
          smtp_code: 550,
          details: '550-5.7.26 Gmail requires all senders to authenticate with either SPF or DKIM',
          copies: 1,
          last_checked_at: new Date('2026-08-04T14:19:34Z'),
        }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const alerts = await buildDashboardAlerts('org-1');

    expect(alerts[0]).toMatchObject({
      severity: 'critical',
      title: 'Authentication failure for britsyncai.com',
      setup_url: '/portal/domains/domain-1/setup',
    });
    expect(alerts[0].cause).toContain('5.7.26');
  });

  it('warns when a Message-ID is reused in the last 24 hours', async () => {
    (query as jest.Mock)
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ message_id: '<same@britsyncai.com>', copies: 3, last_checked_at: new Date('2026-08-04T14:19:34Z') }],
      });

    const alerts = await buildDashboardAlerts('org-1');

    expect(alerts[0]).toMatchObject({
      severity: 'warning',
      title: 'Duplicate Message-ID detected',
    });
    expect(alerts[0].cause).toContain('3 messages reused <same@britsyncai.com>');
  });

  it('labels SMTP 250 as accepted, not inbox delivered', () => {
    expect(ACCEPTED_DELIVERY_LABEL).toBe('Accepted by recipient server');
    expect(ACCEPTED_DELIVERY_LABEL.toLowerCase()).not.toContain('inbox');
  });
});