// Weekly sweep cron job for non-engagers

import { checkNonEngagers, getNonEngagerStats } from './checker';
import { batchCalculateScores } from './scorer';

export interface SweepResult {
  timestamp: Date;
  scores_calculated: {
    total: number;
    high: number;
    medium: number;
    low: number;
    duration_ms: number;
  };
  non_engagers: {
    total_checked: number;
    found: number;
    suppressed: number;
    skipped: number;
    duration_ms: number;
  };
  stats: {
    total_leads: number;
    total_senders: number;
    non_engagers: number;
    engaged: number;
    suppressed: number;
  };
  total_duration_ms: number;
}

/**
 * Run the weekly non-engager sweep
 * Should be called every Sunday at midnight UTC
 */
export async function runWeeklySweep(): Promise<SweepResult> {
  const startTime = Date.now();
  console.log('Starting weekly non-engager sweep...');

  // Step 1: Calculate engagement scores for all leads
  console.log('Calculating engagement scores...');
  const scores = await batchCalculateScores();
  console.log(`Scores calculated: ${scores.total} leads (${scores.high} high, ${scores.medium} medium, ${scores.low} low)`);

  // Step 2: Check and suppress non-engagers
  console.log('Checking for non-engagers...');
  const nonEngagers = await checkNonEngagers();
  console.log(`Non-engagers: ${nonEngagers.non_engagers_found} found, ${nonEngagers.non_engagers_suppressed} suppressed`);

  // Step 3: Get final statistics
  const stats = await getNonEngagerStats();

  const totalDuration = Date.now() - startTime;
  console.log(`Sweep completed in ${totalDuration}ms`);

  return {
    timestamp: new Date(),
    scores_calculated: scores,
    non_engagers: {
      total_checked: nonEngagers.total_checked,
      found: nonEngagers.non_engagers_found,
      suppressed: nonEngagers.non_engagers_suppressed,
      skipped: nonEngagers.leads_skipped,
      duration_ms: nonEngagers.duration_ms,
    },
    stats,
    total_duration_ms: totalDuration,
  };
}

/**
 * Format sweep result for logging
 */
export function formatSweepResult(result: SweepResult): string {
  return [
    `=== Weekly Non-Engager Sweep Report ===`,
    `Timestamp: ${result.timestamp.toISOString()}`,
    ``,
    `--- Engagement Scores ---`,
    `Total leads scored: ${result.scores_calculated.total}`,
    `High priority (>50): ${result.scores_calculated.high}`,
    `Medium priority (20-50): ${result.scores_calculated.medium}`,
    `Low priority (<20): ${result.scores_calculated.low}`,
    `Score calculation time: ${result.scores_calculated.duration_ms}ms`,
    ``,
    `--- Non-Engager Detection ---`,
    `Leads checked: ${result.non_engagers.total_checked}`,
    `Non-engagers found: ${result.non_engagers.found}`,
    `Successfully suppressed: ${result.non_engagers.suppressed}`,
    `Skipped (errors): ${result.non_engagers.skipped}`,
    `Detection time: ${result.non_engagers.duration_ms}ms`,
    ``,
    `--- Final Statistics ---`,
    `Total leads: ${result.stats.total_leads}`,
    `Active senders: ${result.stats.total_senders}`,
    `Non-engagers remaining: ${result.stats.non_engagers}`,
    `Engaged leads: ${result.stats.engaged}`,
    `Total suppressed: ${result.stats.suppressed}`,
    ``,
    `Total sweep duration: ${result.total_duration_ms}ms`,
    `=====================================`,
  ].join('\n');
}
