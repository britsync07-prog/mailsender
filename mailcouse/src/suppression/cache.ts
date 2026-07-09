// Redis SET management and sync for suppression list

import { query } from '../db/connection';
import { SuppressionEntry, SuppressionReason } from './types';

// Redis client (lazy initialization)
let redisClient: any = null;
const REDIS_KEY = 'suppression:emails';

/**
 * Get or create Redis client
 */
async function getRedisClient(): Promise<any> {
  if (redisClient) return redisClient;

  try {
    // Try to import and connect to Redis
    const Redis = require('ioredis');
    redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD || undefined,
      retryStrategy: (times: number) => {
        if (times > 3) return null; // Stop retrying after 3 attempts
        return Math.min(times * 100, 3000);
      },
    });

    redisClient.on('error', (err: Error) => {
      console.error('Redis error:', err.message);
    });

    await redisClient.ping();
    console.log('Connected to Redis');
    return redisClient;
  } catch (error) {
    console.warn('Redis not available, using in-memory cache');
    redisClient = null;
    return null;
  }
}

// In-memory fallback cache
const memoryCache = new Set<string>();

/**
 * Add email to suppression cache
 */
export async function addToCache(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();

  const redis = await getRedisClient();
  if (redis) {
    await redis.sadd(REDIS_KEY, normalizedEmail);
  } else {
    memoryCache.add(normalizedEmail);
  }
}

/**
 * Remove email from suppression cache
 */
export async function removeFromCache(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();

  const redis = await getRedisClient();
  if (redis) {
    await redis.srem(REDIS_KEY, normalizedEmail);
  } else {
    memoryCache.delete(normalizedEmail);
  }
}

/**
 * Check if email is in suppression cache
 */
export async function isInCache(email: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase().trim();

  const redis = await getRedisClient();
  if (redis) {
    return (await redis.sismember(REDIS_KEY, normalizedEmail)) === 1;
  } else {
    return memoryCache.has(normalizedEmail);
  }
}

/**
 * Batch check emails in cache
 */
export async function batchCheckCache(emails: string[]): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();
  const normalizedEmails = emails.map((e) => e.toLowerCase().trim());

  const redis = await getRedisClient();
  if (redis) {
    // Pipeline for batch operation
    const pipeline = redis.pipeline();
    for (const email of normalizedEmails) {
      pipeline.sismember(REDIS_KEY, email);
    }
    const responses = await pipeline.exec();

    for (let i = 0; i < normalizedEmails.length; i++) {
      results.set(emails[i], responses[i][1] === 1);
    }
  } else {
    for (let i = 0; i < normalizedEmails.length; i++) {
      results.set(emails[i], memoryCache.has(normalizedEmails[i]));
    }
  }

  return results;
}

/**
 * Get all suppressed emails from cache
 */
export async function getAllFromCache(): Promise<string[]> {
  const redis = await getRedisClient();
  if (redis) {
    return await redis.smembers(REDIS_KEY);
  } else {
    return Array.from(memoryCache);
  }
}

/**
 * Get cache size
 */
export async function getCacheSize(): Promise<number> {
  const redis = await getRedisClient();
  if (redis) {
    return await redis.scard(REDIS_KEY);
  } else {
    return memoryCache.size;
  }
}

/**
 * Clear entire suppression cache
 */
export async function clearCache(): Promise<void> {
  const redis = await getRedisClient();
  if (redis) {
    await redis.del(REDIS_KEY);
  } else {
    memoryCache.clear();
  }
}

/**
 * Sync cache from PostgreSQL (full reconciliation)
 */
export async function syncCacheFromDB(): Promise<number> {
  const result = await query<{ email: string }>(
    'SELECT email FROM suppression_list'
  );

  const emails = result.rows.map((r) => r.email.toLowerCase().trim());

  const redis = await getRedisClient();
  if (redis) {
    // Clear and repopulate
    await redis.del(REDIS_KEY);
    if (emails.length > 0) {
      await redis.sadd(REDIS_KEY, ...emails);
    }
  } else {
    memoryCache.clear();
    for (const email of emails) {
      memoryCache.add(email);
    }
  }

  console.log(`Synced ${emails.length} suppressed emails to cache`);
  return emails.length;
}

/**
 * Check if Redis is available
 */
export async function isRedisAvailable(): Promise<boolean> {
  const redis = await getRedisClient();
  return redis !== null;
}
