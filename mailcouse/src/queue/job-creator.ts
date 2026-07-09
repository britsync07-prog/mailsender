// Main job creation orchestrator

import { randomUUID } from 'crypto';
import { query } from '../db/connection';
import { buildJobPayload, serializeJob } from './payload-builder';
import { assignSubdomain } from './subdomain-assigner';
import { assignIP } from './ip-assigner';
import { calculateNextSendTime } from './scheduler';
import { JobPayload, JobCreationResult, ScheduleConfig, DEFAULT_SCHEDULE_CONFIG } from './types';
import { Industry } from '../segmentation/types';

// Redis client (lazy initialization)
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
    console.log('Connected to Redis for job queue');
    return redisClient;
  } catch (error) {
    console.warn('Redis not available for job queue');
    return null;
  }
}

/**
 * Create jobs for a batch of leads
 */
export async function createJobs(
  leads: { id: string; email: string; industry: Industry; engagement_score: number }[],
  templateId: string,
  scheduleConfig: ScheduleConfig = DEFAULT_SCHEDULE_CONFIG
): Promise<JobCreationResult> {
  const startTime = Date.now();
  const redis = await getRedisClient();

  let jobsCreated = 0;
  let jobsFailed = 0;
  const byIndustry: Record<string, number> = {};
  const errors: { lead_id: string; error: string }[] = [];

  for (const lead of leads) {
    try {
      // Get lead details
      const leadResult = await query<{
        id: string;
        email: string;
        first_name?: string;
        company?: string;
        industry: string;
        pain_point?: string;
        engagement_score: number;
      }>(
        'SELECT id, email, first_name, company, industry, pain_point, engagement_score FROM leads WHERE id = $1',
        [lead.id]
      );

      if (leadResult.rows.length === 0) {
        errors.push({ lead_id: lead.id, error: 'Lead not found' });
        jobsFailed++;
        continue;
      }

      const leadData = leadResult.rows[0];

      // Assign subdomain
      const subdomain = await assignSubdomain(leadData.industry as Industry);
      if (!subdomain) {
        errors.push({ lead_id: lead.id, error: 'No available subdomains' });
        jobsFailed++;
        continue;
      }

      // Assign IP
      const ip = await assignIP();
      if (!ip) {
        errors.push({ lead_id: lead.id, error: 'No available IPs' });
        jobsFailed++;
        continue;
      }

      // Build job payload
      const payload = buildJobPayload(leadData, subdomain, ip, templateId);

      // Calculate scheduled time
      const scheduledAt = calculateNextSendTime(scheduleConfig);
      payload.scheduled_at = scheduledAt.toISOString();

      // Store in database
      await query(
        `INSERT INTO send_jobs (id, lead_id, subdomain_id, ip_id, template_id, status, attempt_count, queued_at)
         VALUES ($1, $2, $3, $4, $5, 'queued', 1, NOW())`,
        [payload.job_id, payload.lead_id, payload.subdomain_id, payload.ip_id, payload.template_id]
      );

      // Update lead status
      await query(
        "UPDATE leads SET status = 'queued' WHERE id = $1",
        [lead.id]
      );

      // Push to Redis queue
      if (redis) {
        const priority = leadData.engagement_score; // Higher engagement = higher priority
        await redis.zadd(QUEUE_NAME, priority, serializeJob(payload));
      }

      // Track by industry
      byIndustry[leadData.industry] = (byIndustry[leadData.industry] || 0) + 1;
      jobsCreated++;
    } catch (error) {
      errors.push({
        lead_id: lead.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      jobsFailed++;
    }
  }

  return {
    total_leads: leads.length,
    jobs_created: jobsCreated,
    jobs_failed: jobsFailed,
    by_industry: byIndustry,
    errors,
    duration_ms: Date.now() - startTime,
  };
}

/**
 * Get queue depth
 */
export async function getQueueDepth(): Promise<number> {
  const redis = await getRedisClient();
  if (!redis) {
    // Fallback to database count
    const result = await query<{ count: number }>(
      "SELECT COUNT(*) as count FROM send_jobs WHERE status = 'queued'"
    );
    return parseInt(String(result.rows[0]?.count || '0'));
  }

  return await redis.zcard(QUEUE_NAME);
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
  depth: number;
  processing: number;
  sent_today: number;
  failed_today: number;
}> {
  const depth = await getQueueDepth();

  const processingResult = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM send_jobs WHERE status = 'processing'"
  );

  const sentResult = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM send_jobs WHERE status = 'sent' AND sent_at >= CURRENT_DATE"
  );

  const failedResult = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM send_jobs WHERE status = 'failed' AND failed_at >= CURRENT_DATE"
  );

  return {
    depth,
    processing: parseInt(String(processingResult.rows[0]?.count || '0')),
    sent_today: parseInt(String(sentResult.rows[0]?.count || '0')),
    failed_today: parseInt(String(failedResult.rows[0]?.count || '0')),
  };
}
