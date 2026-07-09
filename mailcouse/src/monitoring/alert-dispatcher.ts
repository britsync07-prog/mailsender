// Telegram/Slack alert delivery

import { Alert, AlertSeverity } from './types';

/**
 * Send alert via Telegram
 */
export async function sendTelegramAlert(alert: Alert): Promise<boolean> {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
      console.warn('Telegram credentials not configured');
      return false;
    }

    const emoji = alert.severity === 'critical' ? '🔴' : alert.severity === 'warning' ? '🟡' : '🟢';
    const message = [
      `${emoji} *${alert.severity.toUpperCase()}*`,
      `Metric: ${alert.metric}`,
      alert.domain ? `Domain: ${alert.domain}` : '',
      alert.ip ? `IP: ${alert.ip}` : '',
      `Value: ${alert.current_value} (Threshold: ${alert.threshold})`,
      alert.message,
      `Time: ${alert.timestamp.toISOString()}`,
    ].filter(Boolean).join('\n');

    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'Markdown',
        }),
      }
    );

    return response.ok;
  } catch (error) {
    console.error('Failed to send Telegram alert:', error);
    return false;
  }
}

/**
 * Send alert via Slack webhook
 */
export async function sendSlackAlert(alert: Alert): Promise<boolean> {
  try {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;

    if (!webhookUrl) {
      console.warn('Slack webhook not configured');
      return false;
    }

    const color = alert.severity === 'critical' ? '#ff0000' : alert.severity === 'warning' ? '#ffcc00' : '#00cc00';
    const message = {
      attachments: [
        {
          color,
          title: `${alert.severity.toUpperCase()}: ${alert.metric}`,
          fields: [
            { title: 'Domain', value: alert.domain || 'N/A', short: true },
            { title: 'IP', value: alert.ip || 'N/A', short: true },
            { title: 'Value', value: String(alert.current_value), short: true },
            { title: 'Threshold', value: String(alert.threshold), short: true },
            { title: 'Message', value: alert.message, short: false },
          ],
          timestamp: Math.floor(alert.timestamp.getTime() / 1000),
        },
      ],
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });

    return response.ok;
  } catch (error) {
    console.error('Failed to send Slack alert:', error);
    return false;
  }
}

/**
 * Send alert to configured channel
 */
export async function sendAlert(alert: Alert): Promise<boolean> {
  // Try Telegram first, then Slack
  const telegramSent = await sendTelegramAlert(alert);
  if (telegramSent) return true;

  const slackSent = await sendSlackAlert(alert);
  return slackSent;
}

/**
 * Create alert object
 */
export function createAlert(
  severity: AlertSeverity,
  metric: string,
  currentValue: number,
  threshold: number,
  message: string,
  domain?: string,
  ip?: string
): Alert {
  return {
    id: randomUUID(),
    severity,
    metric,
    domain,
    ip,
    current_value: currentValue,
    threshold,
    message,
    timestamp: new Date(),
    acknowledged: false,
  };
}

function randomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
