// Redis counter management for daily limits

// Redis client (lazy initialization)
let redisClient: any = null;

/**
 * Get or create Redis client
 */
async function getRedisClient(): Promise<any> {
  if (redisClient) return redisClient;

  try {
    const Redis = require('ioredis');
    redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD || undefined,
    });

    await redisClient.ping();
    return redisClient;
  } catch (error) {
    console.warn('Redis not available for counters');
    return null;
  }
}

/**
 * Get subdomain's emails sent today
 */
export async function getSubdomainCount(subdomainId: string): Promise<number> {
  const redis = await getRedisClient();
  if (redis) {
    const count = await redis.get(`subdomain:${subdomainId}:sent_today`);
    return parseInt(count || '0');
  }
  return 0;
}

/**
 * Increment subdomain's emails sent today
 */
export async function incrementSubdomainCount(subdomainId: string): Promise<number> {
  const redis = await getRedisClient();
  if (redis) {
    const key = `subdomain:${subdomainId}:sent_today`;
    const count = await redis.incr(key);
    // Set TTL to expire at midnight UTC
    await redis.expire(key, getSecondsUntilMidnight());
    return count;
  }
  return 0;
}

/**
 * Get IP's emails sent today
 */
export async function getIPCount(ipId: string): Promise<number> {
  const redis = await getRedisClient();
  if (redis) {
    const count = await redis.get(`ip:${ipId}:sent_today`);
    return parseInt(count || '0');
  }
  return 0;
}

/**
 * Increment IP's emails sent today
 */
export async function incrementIPCount(ipId: string): Promise<number> {
  const redis = await getRedisClient();
  if (redis) {
    const key = `ip:${ipId}:sent_today`;
    const count = await redis.incr(key);
    await redis.expire(key, getSecondsUntilMidnight());
    return count;
  }
  return 0;
}

/**
 * Reset all subdomain counters
 */
export async function resetAllSubdomainCounters(): Promise<number> {
  const redis = await getRedisClient();
  if (redis) {
    const keys = await redis.keys('subdomain:*:sent_today');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    return keys.length;
  }
  return 0;
}

/**
 * Reset all IP counters
 */
export async function resetAllIPCounters(): Promise<number> {
  const redis = await getRedisClient();
  if (redis) {
    const keys = await redis.keys('ip:*:sent_today');
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    return keys.length;
  }
  return 0;
}

/**
 * Get total daily volume
 */
export async function getTotalDailyVolume(): Promise<number> {
  const redis = await getRedisClient();
  if (redis) {
    const count = await redis.get('total:daily_volume');
    return parseInt(count || '0');
  }
  return 0;
}

/**
 * Increment total daily volume
 */
export async function incrementTotalDailyVolume(): Promise<number> {
  const redis = await getRedisClient();
  if (redis) {
    const key = 'total:daily_volume';
    const count = await redis.incr(key);
    await redis.expire(key, getSecondsUntilMidnight());
    return count;
  }
  return 0;
}

/**
 * Calculate seconds until midnight UTC
 */
function getSecondsUntilMidnight(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  return Math.floor((midnight.getTime() - now.getTime()) / 1000);
}
