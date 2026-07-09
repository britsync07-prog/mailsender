import { CRON_SCHEDULES, CronJobConfig, CronJobResult, CronJobName } from './types';
import { executeJob } from './scheduler';
import { createAlert, sendAlert } from '../monitoring/alert-dispatcher';

interface CronTask {
  config: CronJobConfig;
  lastRun: number;
  timer: ReturnType<typeof setInterval> | null;
}

const tasks = new Map<string, CronTask>();
let runnerInterval: ReturnType<typeof setInterval> | null = null;
let isShuttingDown = false;

function parseCronExpression(expr: string): {
  minute: number | null;
  hour: number | null;
  dayOfMonth: number | null;
  month: number | null;
  dayOfWeek: number | null;
} {
  const parts = expr.split(' ');
  return {
    minute: parts[0] === '*' ? null : parseInt(parts[0]),
    hour: parts[1] === '*' ? null : parseInt(parts[1]),
    dayOfMonth: parts[2] === '*' ? null : parseInt(parts[2]),
    month: parts[3] === '*' ? null : parseInt(parts[3]),
    dayOfWeek: parts[4] === '*' ? null : parseInt(parts[4]),
  };
}

function shouldRunNow(config: CronJobConfig, lastRun: number): boolean {
  const now = new Date();
  const lastRunDate = new Date(lastRun);

  const minuteMatches = config.schedule === '*' || config.schedule.startsWith('*');
  if (config.schedule === '* * * * *') {
    return (now.getTime() - lastRun) >= 60000;
  }

  const cron = parseCronExpression(config.schedule);

  if (cron.hour !== null && cron.minute !== null) {
    if (now.getHours() === lastRunDate.getHours() && now.getMinutes() === lastRunDate.getMinutes()) {
      return false;
    }
    if (cron.dayOfWeek !== null && now.getDay() !== cron.dayOfWeek) {
      return false;
    }
    return now.getHours() === cron.hour && now.getMinutes() === cron.minute;
  }

  if (config.schedule.includes('*/')) {
    const intervalMinutes = parseInt(config.schedule.split('*/')[1]);
    if (!isNaN(intervalMinutes)) {
      return (now.getTime() - lastRun) >= intervalMinutes * 60000;
    }
  }

  return false;
}

export async function startCronRunner(): Promise<void> {
  if (runnerInterval) return;

  for (const config of CRON_SCHEDULES) {
    if (config.enabled) {
      tasks.set(config.name, {
        config,
        lastRun: 0,
        timer: null,
      });
    }
  }

  console.log(`Cron runner started with ${tasks.size} tasks`);

  await checkAndRunJobs();

  runnerInterval = setInterval(checkAndRunJobs, 30000);
}

async function checkAndRunJobs(): Promise<void> {
  if (isShuttingDown) return;

  for (const [name, task] of tasks) {
    if (!task.config.enabled) continue;

    if (shouldRunNow(task.config, task.lastRun)) {
      runJob(name).catch((err) => {
        console.error(`Cron job ${name} failed:`, err);
      });
    }
  }
}

async function runJob(jobName: string): Promise<CronJobResult> {
  const task = tasks.get(jobName);
  if (!task) {
    return {
      job_name: jobName as CronJobName,
      started_at: new Date(),
      completed_at: new Date(),
      success: false,
      duration_ms: 0,
      message: `Unknown task: ${jobName}`,
    };
  }

  task.lastRun = Date.now();
  const result = await executeJob(jobName);

  if (!result.success) {
    const alert = createAlert(
      'warning',
      'Cron Job Failed',
      1,
      0,
      `Cron job "${jobName}" failed: ${result.message}`
    );
    await sendAlert(alert).catch(() => {});
  }

  return result;
}

export async function stopCronRunner(): Promise<void> {
  isShuttingDown = true;
  if (runnerInterval) {
    clearInterval(runnerInterval);
    runnerInterval = null;
  }
  tasks.clear();
}

export function getCronRunnerStatus(): {
  running: boolean;
  tasks: number;
  enabled: number;
  lastRuns: Record<string, number>;
} {
  let enabled = 0;
  const lastRuns: Record<string, number> = {};
  for (const [name, task] of tasks) {
    if (task.config.enabled) enabled++;
    lastRuns[name] = task.lastRun;
  }
  return {
    running: runnerInterval !== null,
    tasks: tasks.size,
    enabled,
    lastRuns,
  };
}
