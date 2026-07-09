// Main worker agent entry point

import { WorkerConfig, WorkerInstance, JobProcessingResult, DEFAULT_WORKER_CONFIG } from './types';
import { registerWorker, deregisterWorker, updateWorkerStatus } from './registration';
import { startHeartbeat } from './heartbeat';
import { processJob } from './processor';

// Worker state
let workerInstance: WorkerInstance | null = null;
let jobsProcessed = 0;
let jobsFailed = 0;
let isRunning = false;
let heartbeatTimer: NodeJS.Timeout | null = null;

// Redis client
let redisClient: any = null;
const QUEUE_NAME = 'email-send-queue';

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
    console.error('Redis connection failed:', error);
    return null;
  }
}

/**
 * Start the worker agent
 */
export async function startWorker(config: WorkerConfig = DEFAULT_WORKER_CONFIG): Promise<void> {
  console.log(`Starting worker agent: ${config.machine_id}`);

  // Register worker
  workerInstance = await registerWorker(config);
  console.log(`Worker registered: ${workerInstance.id}`);

  // Start heartbeat
  heartbeatTimer = startHeartbeat(
    workerInstance.id,
    () => isRunning ? 'running' : 'stopped',
    () => jobsProcessed,
    () => jobsFailed,
    config.heartbeat_interval_ms
  );

  // Start polling
  isRunning = true;
  await pollQueue(config);

  console.log(`Worker ${config.machine_id} stopped`);
}

/**
 * Stop the worker agent
 */
export async function stopWorker(): Promise<void> {
  console.log('Stopping worker agent...');
  isRunning = false;

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  if (workerInstance) {
    await deregisterWorker(workerInstance.id);
  }
}

/**
 * Poll Redis queue for jobs
 */
async function pollQueue(config: WorkerConfig): Promise<void> {
  const redis = await getRedisClient();
  if (!redis) {
    console.error('Redis not available, worker pausing...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    return;
  }

  const concurrency = config.concurrency || 1;
  const activeJobs = new Set<Promise<void>>();

  while (isRunning) {
    try {
      if (activeJobs.size >= concurrency) {
        await Promise.race(activeJobs);
        continue;
      }

      const result = await redis.bzpopmin(QUEUE_NAME, 1);

      if (result) {
        const [jobData] = result;
        const job = JSON.parse(jobData);

        const jobPromise = processJob(job).then((processingResult) => {
          if (processingResult.success) {
            jobsProcessed++;
          } else {
            jobsFailed++;
          }
          console.log(`Job ${processingResult.job_id}: ${processingResult.action} (${processingResult.duration_ms}ms)`);
        });

        activeJobs.add(jobPromise);
        jobPromise.finally(() => activeJobs.delete(jobPromise));
      }
    } catch (error) {
      console.error('Poll error:', error);
      await new Promise(resolve => setTimeout(resolve, config.poll_interval_ms));
    }
  }

  await Promise.all(activeJobs);
}

/**
 * Get worker status
 */
export function getWorkerStatus(): {
  instance: WorkerInstance | null;
  is_running: boolean;
  jobs_processed: number;
  jobs_failed: number;
} {
  return {
    instance: workerInstance,
    is_running: isRunning,
    jobs_processed: jobsProcessed,
    jobs_failed: jobsFailed,
  };
}

// Handle process signals
process.on('SIGINT', async () => {
  await stopWorker();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await stopWorker();
  process.exit(0);
});
