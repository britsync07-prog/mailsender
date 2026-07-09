// Configuration for mailcouse

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function requiredEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    console.warn(`Warning: ${name} not set, using default`);
    return '';
  }
  return val;
}

export const config = {
  // Database
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    name: process.env.DB_NAME || 'mailcouse',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    ssl: process.env.DB_SSL === 'true',
  },

  // Redis Queue
  redis: {
    primaryHost: process.env.REDIS_PRIMARY_HOST || 'localhost',
    backupHost: process.env.REDIS_BACKUP_HOST || '',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || '',
    tls: process.env.REDIS_TLS === 'true',
  },

  // API
  api: {
    port: parseInt(process.env.API_PORT || '3000'),
    host: process.env.API_HOST || '0.0.0.0',
  },

  // Import settings
  import: {
    maxBatchSize: parseInt(process.env.IMPORT_MAX_BATCH || '1000'),
    allowedIndustries: ['smart_homes', 'mortgage', 'cybersecurity'] as const,
    allowedSources: [
      'prospeo',
      'blitz',
      'google_maps',
      'disco_like',
      'competitor_engagers',
      'csv_import',
      'manual',
    ] as const,
  },

  // API Keys (for source integrations)
  apiKeys: {
    prospeo: process.env.PROSPEO_API_KEY || '',
    blitz: process.env.BLITZ_API_KEY || '',
    rapidapi: process.env.RAPIDAPI_KEY || '',
    discoLike: process.env.DISCOLIKE_API_KEY || '',
  },

  // Cloudflare DNS
  cloudflare: {
    apiToken: process.env.CLOUDFLARE_API_TOKEN || '',
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
  },

  // Monitoring
  monitoring: {
    mxtoolboxApiKey: process.env.MXTOOLBOX_API_KEY || '',
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  },

  // Warmup
  warmup: {
    apiKey: process.env.WARMBOX_API_KEY || '',
    accountId: process.env.WARMBOX_ACCOUNT_ID || '',
    apiUrl: process.env.WARMUP_API_URL || 'https://api.warmbox.com/v1',
  },

  // DKIM encryption
  dkim: {
    encryptionKey: process.env.DKIM_ENCRYPTION_KEY || '',
  },

  // Send limits (TSD §2)
  limits: {
    emailsPerSmtpPerDay: 10,
    smtpsPerDomain: 200,
    emailsPerDomainPerDay: 2000,
    maxRetries: 3,
    backoffDelaysMs: [300000, 900000, 2700000], // 5min, 15min, 45min
    jobTtlHours: 72,
  },

  // Validation
  validation: {
    roleBasedPrefixes: [
      'admin', 'info', 'support', 'noreply', 'no-reply',
      'sales', 'webmaster', 'postmaster', 'hostmaster',
      'abuse', 'noc', 'security', 'billing', 'help',
      'office', 'hr', 'marketing', 'press', 'legal',
      'team', 'staff', 'contact', 'enquiries', 'hello',
      'mail', 'service', 'orders', 'returns',
    ],
    disposableDomainsPath: path.resolve(
      __dirname,
      '../../source/disposable-email-providers/disposable-email-providers.json'
    ),
  },
};

export type Config = typeof config;
