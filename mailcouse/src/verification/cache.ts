import Redis from 'ioredis';
import { config } from '../config';
import { verifierConfig } from './config';
import { VerificationResult } from './types';

let redisClient: Redis | null = null;
const memoryCache = new Map<string, { result: VerificationResult; expiresAt: number }>();

function getRedis(): Redis | null {
  if (!verifierConfig.cacheEnabled) return null;
  if (redisClient) return redisClient;

  try {
    if (config.redis.primaryHost) {
      redisClient = new Redis({
        host: config.redis.primaryHost,
        port: config.redis.port,
        password: config.redis.password || undefined,
        tls: config.redis.tls ? {} : undefined,
        lazyConnect: true,
        connectTimeout: 2000,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null, // don't hang if redis is not running
      });

      redisClient.on('error', (err) => {
        // Silently fallback to memory cache if Redis is unavailable
      });
    }
  } catch {
    redisClient = null;
  }

  return redisClient;
}

const CACHE_PREFIX = 'email_verifier:result:';

/**
 * Retrieves a cached verification result if present and unexpired.
 */
export async function getCachedResult(email: string): Promise<VerificationResult | null> {
  if (!verifierConfig.cacheEnabled) return null;
  const normalized = email.toLowerCase().trim();

  // 1. Try Redis
  const redis = getRedis();
  if (redis && redis.status === 'ready') {
    try {
      const data = await redis.get(`${CACHE_PREFIX}${normalized}`);
      if (data) {
        return JSON.parse(data) as VerificationResult;
      }
    } catch {
      // Fallback to memory cache
    }
  }

  // 2. Memory Cache fallback
  const cached = memoryCache.get(normalized);
  if (cached) {
    if (Date.now() < cached.expiresAt) {
      return cached.result;
    }
    memoryCache.delete(normalized);
  }

  return null;
}

/**
 * Stores a verification result in cache with appropriate TTL based on decision/outcome.
 */
export async function setCachedResult(email: string, result: VerificationResult): Promise<void> {
  if (!verifierConfig.cacheEnabled) return;
  const normalized = email.toLowerCase().trim();

  // Determine TTL based on decision
  let ttlSeconds = verifierConfig.cacheTtlSuccessSec;
  if (result.decision === 'block' || !result.valid) {
    ttlSeconds = verifierConfig.cacheTtlNegativeSec;
  } else if (result.decision === 'review' || result.reachable === 'unknown') {
    ttlSeconds = verifierConfig.cacheTtlUnknownSec;
  }

  // 1. Store in Redis
  const redis = getRedis();
  if (redis && redis.status === 'ready') {
    try {
      await redis.set(
        `${CACHE_PREFIX}${normalized}`,
        JSON.stringify(result),
        'EX',
        ttlSeconds
      );
    } catch {
      // Fallback to memory cache
    }
  }

  // 2. Store in Memory Cache
  memoryCache.set(normalized, {
    result,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });

  // Periodically clean memory cache if it grows large
  if (memoryCache.size > 10000) {
    const now = Date.now();
    for (const [k, v] of memoryCache.entries()) {
      if (v.expiresAt <= now) {
        memoryCache.delete(k);
      }
    }
  }
}

/**
 * Clears the in-memory and Redis verification cache (useful for testing).
 */
export async function clearVerificationCache(): Promise<void> {
  memoryCache.clear();
  const redis = getRedis();
  if (redis && redis.status === 'ready') {
    try {
      const keys = await redis.keys(`${CACHE_PREFIX}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch {}
  }
}
