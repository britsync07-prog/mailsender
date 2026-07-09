// Heartbeat sender

import { query } from '../db/connection';
import { WorkerInstance, WorkerStatus } from './types';

// Redis client
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
    return null;
  }
}

/**
 * Send heartbeat to database and Redis
 */
export async function sendHeartbeat(
  workerId: string,
  status: WorkerStatus,
  jobsProcessed: number,
  jobsFailed: number
): Promise<void> {
  // Update database
  await query(
    `UPDATE rdp_instances
     SET last_heartbeat = NOW(),
         jobs_processed = $1,
         jobs_failed = $2
     WHERE id = $3`,
    [jobsProcessed, jobsFailed, workerId]
  );

  // Update Redis for fast monitoring
  const redis = await getRedisClient();
  if (redis) {
    const heartbeat = {
      worker_id: workerId,
      timestamp: new Date().toISOString(),
      status,
      jobs_processed: jobsProcessed,
      jobs_failed: jobsFailed,
    };
    await redis.set(`worker:${workerId}:heartbeat`, JSON.stringify(heartbeat));
    await redis.expire(`worker:${workerId}:heartbeat`, 120); // 2 minute TTL
  }
}

/**
 * Start periodic heartbeat
 */
export function startHeartbeat(
  workerId: string,
  getStatus: () => WorkerStatus,
  getJobsProcessed: () => number,
  getJobsFailed: () => number,
  intervalMs: number = 60000
): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      await sendHeartbeat(
        workerId,
        getStatus(),
        getJobsProcessed(),
        getJobsFailed()
      );
    } catch (error) {
      console.error('Heartbeat failed:', error);
    }
  }, intervalMs);
}

/**
 * Check for workers with missed heartbeats
 */
export async function checkMissedHeartbeats(
  thresholdMinutes: number = 3
): Promise<WorkerInstance[]> {
  const result = await query<WorkerInstance>(
    `SELECT * FROM rdp_instances
     WHERE status = 'running'
       AND last_heartbeat < NOW() - INTERVAL '${thresholdMinutes} minutes'`
  );

  return result.rows;
}

/**
 * Get worker heartbeat from Redis
 */
export async function getWorkerHeartbeat(
  workerId: string
): Promise<{
  worker_id: string;
  timestamp: Date;
  status: string;
  jobs_processed: number;
  jobs_failed: number;
} | null> {
  const redis = await getRedisClient();
  if (!redis) return null;

  const data = await redis.get(`worker:${workerId}:heartbeat`);
  if (!data) return null;

  return JSON.parse(data);
}
