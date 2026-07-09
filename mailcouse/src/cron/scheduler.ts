import { CronJobConfig, CronJobResult, CRON_SCHEDULES } from './types';
import { runMidnightReset } from './midnight-reset';
import { generateDailyReport } from './daily-report';
import { generateWeeklyReport } from './weekly-report';
import { checkDeadLetterQueue } from './dead-letter-review';
import { checkDomainExpiry } from './domain-expiry-check';
import { checkAllIPsBlacklist } from '../monitoring/mxtoolbox-client';
import { checkAllDomainsPostmaster } from '../monitoring/postmaster-client';
import { checkAndRetireDomains } from '../monitoring/domain-retirement';
import { checkAndReplaceIPs } from '../monitoring/ip-replacement';
import { createAlert, sendAlert } from '../monitoring/alert-dispatcher';

interface HandlerResult {
  success: boolean;
  message: string;
  duration_ms: number;
}

function wrapHandler(name: string, fn: () => Promise<any>): () => Promise<CronJobResult> {
  return async () => {
    const started_at = new Date();
    try {
      const result = await fn();
      return {
        job_name: name as any,
        started_at,
        completed_at: new Date(),
        success: true,
        duration_ms: Date.now() - started_at.getTime(),
        message: result.message || `${name} completed: ${JSON.stringify(result)}`,
      };
    } catch (error) {
      return {
        job_name: name as any,
        started_at,
        completed_at: new Date(),
        success: false,
        duration_ms: Date.now() - started_at.getTime(),
        message: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

const jobHandlers: Record<string, () => Promise<CronJobResult>> = {
  midnight_reset: wrapHandler('midnight_reset', runMidnightReset),
  daily_report: wrapHandler('daily_report', generateDailyReport),
  weekly_report: wrapHandler('weekly_report', generateWeeklyReport),
  dead_letter_review: wrapHandler('dead_letter_review', checkDeadLetterQueue),
  domain_expiry_check: wrapHandler('domain_expiry_check', checkDomainExpiry),
  ip_blacklist_check: wrapHandler('ip_blacklist_check', async () => {
    const result = await checkAllIPsBlacklist();
    if (result.blacklisted > 0) {
      const alert = createAlert('warning', 'IP Blacklist Check', result.blacklisted, 0,
        `${result.blacklisted} IP(s) found blacklisted`);
      await sendAlert(alert);
    }
    return { message: `Checked ${result.checked} IPs, ${result.blacklisted} blacklisted` };
  }),
  postmaster_pull: wrapHandler('postmaster_pull', async () => {
    const result = await checkAllDomainsPostmaster();
    return { message: `Checked ${result.checked} domains, ${result.flagged} flagged` };
  }),
  yahoo_postmaster_pull: wrapHandler('yahoo_postmaster_pull', async () => {
    return { message: 'Yahoo Postmaster pull completed (stub)' };
  }),
  microsoft_snds_pull: wrapHandler('microsoft_snds_pull', async () => {
    return { message: 'Microsoft SNDS pull completed (stub)' };
  }),
  domain_health_eval: wrapHandler('domain_health_eval', async () => {
    const result = await checkAndRetireDomains();
    return { message: `Checked domains: ${result.checked}, retired: ${result.retired}` };
  }),
  warmup_health: wrapHandler('warmup_health', async () => {
    return { message: 'Warmup health check completed (stub)' };
  }),
  reserve_pool_check: wrapHandler('reserve_pool_check', async () => {
    const result = await checkAndReplaceIPs();
    return { message: `Reserve pool check: ${result.checked} checked, ${result.replaced} replaced` };
  }),
  suppression_backup: wrapHandler('suppression_backup', async () => {
    return { message: 'Suppression backup completed (stub)' };
  }),
  rdp_heartbeat: wrapHandler('rdp_heartbeat', async () => {
    return { message: 'RDP heartbeat check completed (stub)' };
  }),
};

const executionHistory: CronJobResult[] = [];

export async function executeJob(jobName: string): Promise<CronJobResult> {
  const handler = jobHandlers[jobName];
  if (!handler) {
    return {
      job_name: jobName as any,
      started_at: new Date(),
      completed_at: new Date(),
      success: false,
      duration_ms: 0,
      message: `Unknown job: ${jobName}`,
    };
  }

  const result = await handler();
  executionHistory.push(result);

  if (executionHistory.length > 100) {
    executionHistory.shift();
  }

  return result;
}

export function getJobConfigs(): CronJobConfig[] {
  return CRON_SCHEDULES;
}

export function getExecutionHistory(limit: number = 20): CronJobResult[] {
  return executionHistory.slice(-limit);
}

export function getJobStats(): {
  total_executions: number;
  successful: number;
  failed: number;
  avg_duration_ms: number;
} {
  const total = executionHistory.length;
  const successful = executionHistory.filter((r) => r.success).length;
  const failed = total - successful;
  const avgDuration = total > 0
    ? executionHistory.reduce((sum, r) => sum + r.duration_ms, 0) / total
    : 0;

  return {
    total_executions: total,
    successful,
    failed,
    avg_duration_ms: Math.round(avgDuration),
  };
}

export function validateCronExpression(expression: string): boolean {
  const parts = expression.split(' ');
  if (parts.length !== 5) return false;
  for (const part of parts) {
    if (!/^[\d\*\/\-\,]+$/.test(part)) return false;
  }
  return true;
}

export function getNextExecution(expression: string): Date {
  const now = new Date();
  return new Date(now.getTime() + 60000);
}
