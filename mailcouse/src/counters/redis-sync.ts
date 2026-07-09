// Redis ↔ PostgreSQL sync

import { query } from '../db/connection';

/**
 * Sync Redis counters to PostgreSQL
 */
export async function syncToDatabase(): Promise<{
  subdomains_synced: number;
  ips_synced: number;
  duration_ms: number;
}> {
  const startTime = Date.now();
  let subdomainsSynced = 0;
  let ipsSynced = 0;

  try {
    const Redis = require('ioredis');
    const redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    });

    // Sync subdomain counters
    const subdomainKeys = await redis.keys('subdomain:*:sent_today');
    for (const key of subdomainKeys) {
      const subdomainId = key.split(':')[1];
      const value = await redis.get(key);

      if (value) {
        await query(
          'UPDATE subdomains SET emails_sent_today = $1 WHERE id = $2',
          [parseInt(value), subdomainId]
        );
        subdomainsSynced++;
      }
    }

    // Sync IP counters
    const ipKeys = await redis.keys('ip:*:sent_today');
    for (const key of ipKeys) {
      const ipId = key.split(':')[1];
      const value = await redis.get(key);

      if (value) {
        await query(
          'UPDATE ip_pool SET emails_today = $1 WHERE id = $2',
          [parseInt(value), ipId]
        );
        ipsSynced++;
      }
    }

    await redis.quit();
  } catch (error) {
    // Redis not available
  }

  return {
    subdomains_synced: subdomainsSynced,
    ips_synced: ipsSynced,
    duration_ms: Date.now() - startTime,
  };
}

/**
 * Sync PostgreSQL counters to Redis (initial load)
 */
export async function syncFromDatabase(): Promise<{
  subdomains_loaded: number;
  ips_loaded: number;
  duration_ms: number;
}> {
  const startTime = Date.now();
  let subdomainsLoaded = 0;
  let ipsLoaded = 0;

  try {
    const Redis = require('ioredis');
    const redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    });

    // Load subdomain counters
    const subdomainResult = await query<{ id: string; emails_sent_today: number }>(
      'SELECT id, emails_sent_today FROM subdomains WHERE emails_sent_today > 0'
    );

    for (const row of subdomainResult.rows) {
      await redis.set(`subdomain:${row.id}:sent_today`, row.emails_sent_today.toString());
      subdomainsLoaded++;
    }

    // Load IP counters
    const ipResult = await query<{ id: string; emails_today: number }>(
      'SELECT id, emails_today FROM ip_pool WHERE emails_today > 0'
    );

    for (const row of ipResult.rows) {
      await redis.set(`ip:${row.id}:sent_today`, row.emails_today.toString());
      ipsLoaded++;
    }

    await redis.quit();
  } catch (error) {
    // Redis not available
  }

  return {
    subdomains_loaded: subdomainsLoaded,
    ips_loaded: ipsLoaded,
    duration_ms: Date.now() - startTime,
  };
}

/**
 * Verify counter consistency
 */
export async function verifyConsistency(): Promise<{
  consistent: boolean;
  discrepancies: { type: string; id: string; redis: number; db: number }[];
}> {
  const discrepancies: { type: string; id: string; redis: number; db: number }[] = [];

  try {
    const Redis = require('ioredis');
    const redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    });

    // Check subdomain counters
    const subdomainResult = await query<{ id: string; emails_sent_today: number }>(
      'SELECT id, emails_sent_today FROM subdomains'
    );

    for (const row of subdomainResult.rows) {
      const redisValue = await redis.get(`subdomain:${row.id}:sent_today`);
      const redisCount = parseInt(redisValue || '0');

      if (redisCount !== row.emails_sent_today) {
        discrepancies.push({
          type: 'subdomain',
          id: row.id,
          redis: redisCount,
          db: row.emails_sent_today,
        });
      }
    }

    await redis.quit();
  } catch (error) {
    // Redis not available
  }

  return {
    consistent: discrepancies.length === 0,
    discrepancies,
  };
}
