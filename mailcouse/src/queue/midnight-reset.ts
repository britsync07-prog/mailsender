// Daily counter reset cron job

import { query } from '../db/connection';
import { resetAllSubdomainCounters, resetAllIPCounters } from './counter-store';

export interface ResetResult {
  timestamp: Date;
  subdomains_reset: number;
  ips_reset: number;
  database_reset: boolean;
  total_duration_ms: number;
}

/**
 * Run midnight UTC reset
 * Should be called at 00:00 UTC daily
 */
export async function runMidnightReset(): Promise<ResetResult> {
  const startTime = Date.now();
  console.log('Starting midnight UTC reset...');

  // Step 1: Reset Redis counters
  console.log('Resetting Redis counters...');
  const subdomainsReset = await resetAllSubdomainCounters();
  const ipsReset = await resetAllIPCounters();
  console.log(`Redis reset: ${subdomainsReset} subdomains, ${ipsReset} IPs`);

  // Step 2: Reset database counters
  console.log('Resetting database counters...');
  await query('UPDATE subdomains SET emails_sent_today = 0');
  await query('UPDATE ip_pool SET emails_today = 0');
  console.log('Database counters reset');

  // Step 3: Clear requeued jobs set
  try {
    const Redis = require('ioredis');
    const redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    });
    await redis.del('jobs:requeued');
    await redis.quit();
  } catch (error) {
    // Redis not available
  }

  const totalDuration = Date.now() - startTime;
  console.log(`Midnight reset completed in ${totalDuration}ms`);

  return {
    timestamp: new Date(),
    subdomains_reset: subdomainsReset,
    ips_reset: ipsReset,
    database_reset: true,
    total_duration_ms: totalDuration,
  };
}

/**
 * Format reset result for logging
 */
export function formatResetResult(result: ResetResult): string {
  return [
    `=== Midnight Reset Report ===`,
    `Timestamp: ${result.timestamp.toISOString()}`,
    ``,
    `Redis Counters Reset:`,
    `  Subdomains: ${result.subdomains_reset}`,
    `  IPs: ${result.ips_reset}`,
    ``,
    `Database Counters Reset: ${result.database_reset ? 'Yes' : 'No'}`,
    ``,
    `Total Duration: ${result.total_duration_ms}ms`,
    `============================`,
  ].join('\n');
}
