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

function parseField(field: string): number | null {
  if (!/^\d+$/.test(field)) return null;
  const v = parseInt(field, 10);
  return isNaN(v) ? null : v;
}

// Compute the most recent scheduled slot time (<= now) for a job.
// Returns null when the schedule does not match today (e.g. wrong day of week).
function latestSlot(config: CronJobConfig, now: Date): number | null {
  const parts = config.schedule.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minuteField, hourField, , , dowField] = parts;

  if (config.schedule === '* * * * *') return null;

  // Minute-step intervals ('*/15 * * * *') are handled by interval
  // logic in shouldRunNow, never by slot matching.
  if (minuteField.startsWith('*/')) return null;

  const minute = parseField(minuteField);
  if (minute === null || minute > 59) return null;

  const slot = new Date(now);
  slot.setMinutes(minute, 0, 0);

  // Hour-step schedules: '0 */6 * * *' -> fires every N hours at :minute
  const hourStepMatch = hourField.match(/^\*\/(\d+)$/);
  if (hourStepMatch) {
    const stepHours = parseInt(hourStepMatch[1], 10);
    if (isNaN(stepHours) || stepHours <= 0 || stepHours > 24) return null;
    let h = Math.floor(now.getHours() / stepHours) * stepHours;
    if (now.getTime() < new Date(new Date(slot).setHours(h)).getTime()) {
      h -= stepHours;
      if (h < 0) {
        h += 24;
        slot.setDate(slot.getDate() - 1);
      }
    }
    slot.setHours(h);
    return slot.getTime();
  }

  const hour = parseField(hourField);
  if (hour === null || hour > 23) return null;

  const dow = parseField(dowField);
  if (dow !== null && now.getDay() !== dow) return null;

  slot.setHours(hour);
  return slot.getTime();
}

export function shouldRunNow(config: CronJobConfig, lastRun: number, now: Date = new Date()): boolean {

  if (config.schedule === '* * * * *') {
    return (now.getTime() - lastRun) >= 60000;
  }

  // Minute-step intervals ('*/15 * * * *'): elapsed-time based
  const parts = config.schedule.trim().split(/\s+/);
  const minuteStepMatch = parts.length === 5 ? parts[0].match(/^\*\/(\d+)$/) : null;
  if (minuteStepMatch && parts[1] === '*') {
    const stepMin = parseInt(minuteStepMatch[1], 10);
    if (!isNaN(stepMin) && stepMin > 0 && stepMin <= 59) {
      return (now.getTime() - lastRun) >= stepMin * 60000;
    }
    return false;
  }

  // Fixed slots ('0 0 * * *', '30 6 * * 1', '0 */6 * * *'):
  // fire once per slot — due when now has reached the slot time and we
  // have not run since that slot began. Catches up missed ticks and is
  // safe across days/months (no HH:MM-only comparison).
  const slotTime = latestSlot(config, now);
  if (slotTime === null) return false;
  return now.getTime() >= slotTime && lastRun < slotTime;
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
