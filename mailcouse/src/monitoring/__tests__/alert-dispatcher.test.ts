// Unit tests for alert dispatcher

import { createAlert, sendTelegramAlert, sendSlackAlert } from '../alert-dispatcher';

// Mock fetch
global.fetch = jest.fn();

describe('Alert Dispatcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_CHAT_ID = '123456';
    process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/test';
  });

  afterEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.SLACK_WEBHOOK_URL;
  });

  describe('createAlert', () => {
    it('should create alert object', () => {
      const alert = createAlert(
        'critical',
        'Domain Retirement',
        1,
        0,
        'Domain retired',
        'example.com'
      );

      expect(alert.severity).toBe('critical');
      expect(alert.metric).toBe('Domain Retirement');
      expect(alert.domain).toBe('example.com');
      expect(alert.timestamp).toBeDefined();
      expect(alert.acknowledged).toBe(false);
    });
  });

  describe('sendTelegramAlert', () => {
    it('should send alert via Telegram', async () => {
      (fetch as jest.Mock).mockResolvedValue({ ok: true });

      const alert = createAlert('critical', 'Test', 1, 0, 'Test message');
      const result = await sendTelegramAlert(alert);

      expect(result).toBe(true);
      expect(fetch).toHaveBeenCalled();
    });

    it('should return false when credentials missing', async () => {
      delete process.env.TELEGRAM_BOT_TOKEN;

      const alert = createAlert('critical', 'Test', 1, 0, 'Test message');
      const result = await sendTelegramAlert(alert);

      expect(result).toBe(false);
    });
  });

  describe('sendSlackAlert', () => {
    it('should send alert via Slack', async () => {
      (fetch as jest.Mock).mockResolvedValue({ ok: true });

      const alert = createAlert('warning', 'Test', 50, 70, 'Test message');
      const result = await sendSlackAlert(alert);

      expect(result).toBe(true);
      expect(fetch).toHaveBeenCalled();
    });

    it('should return false when webhook missing', async () => {
      delete process.env.SLACK_WEBHOOK_URL;

      const alert = createAlert('warning', 'Test', 50, 70, 'Test message');
      const result = await sendSlackAlert(alert);

      expect(result).toBe(false);
    });
  });
});
