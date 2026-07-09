// Eager scheduling with timezone awareness

import { ScheduleConfig, DEFAULT_SCHEDULE_CONFIG } from './types';

export { DEFAULT_SCHEDULE_CONFIG } from './types';

/**
 * Calculate next send time based on schedule config
 */
export function calculateNextSendTime(
  config: ScheduleConfig = DEFAULT_SCHEDULE_CONFIG,
  fromTime: Date = new Date()
): Date {
  const { timezone, send_window_start, send_window_end, send_days, delay_between_sends } = config;

  // Convert to target timezone
  const options: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  };

  const formatter = new Intl.DateTimeFormat('en-US', options);
  const parts = formatter.formatToParts(fromTime);
  const currentHour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0');
  const currentMinute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0');

  // Get day of week in target timezone
  const dayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  });
  const dayName = dayFormatter.format(fromTime);
  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const currentDay = dayMap[dayName];

  // Check if we're in send window
  const isInSendWindow = currentHour >= send_window_start && currentHour < send_window_end;
  const isSendDay = send_days.includes(currentDay);

  let nextTime = new Date(fromTime);

  if (!isSendDay || !isInSendWindow) {
    // Find next send day
    let daysToAdd = 0;
    let checkDay = currentDay;

    if (!isInSendWindow && currentHour >= send_window_end) {
      // Past send window, move to next day
      daysToAdd = 1;
      checkDay = (currentDay + 1) % 7;
    }

    // Find next valid send day
    while (!send_days.includes(checkDay)) {
      daysToAdd++;
      checkDay = (checkDay + 1) % 7;
    }

    nextTime.setDate(nextTime.getDate() + daysToAdd);
    nextTime.setHours(send_window_start, 0, 0, 0);
  } else {
    // In send window, add random delay
    const delaySeconds = randomInt(delay_between_sends.min, delay_between_sends.max);
    nextTime.setSeconds(nextTime.getSeconds() + delaySeconds);
  }

  return nextTime;
}

/**
 * Generate scheduled send times for a batch of leads
 */
export function generateSchedule(
  count: number,
  config: ScheduleConfig = DEFAULT_SCHEDULE_CONFIG,
  startTime: Date = new Date()
): Date[] {
  const times: Date[] = [];
  let currentTime = startTime;

  for (let i = 0; i < count; i++) {
    currentTime = calculateNextSendTime(config, currentTime);
    times.push(new Date(currentTime));
    // Add delay for next calculation
    currentTime = new Date(currentTime.getTime() + 1000);
  }

  return times;
}

/**
 * Check if a given time is within send window
 */
export function isInSendWindow(
  time: Date,
  config: ScheduleConfig = DEFAULT_SCHEDULE_CONFIG
): boolean {
  const options: Intl.DateTimeFormatOptions = {
    timeZone: config.timezone,
    hour: 'numeric',
    hour12: false,
  };

  const formatter = new Intl.DateTimeFormat('en-US', options);
  const hour = parseInt(formatter.format(time));

  return hour >= config.send_window_start && hour < config.send_window_end;
}

/**
 * Check if a given day is a send day
 */
export function isSendDay(
  time: Date,
  config: ScheduleConfig = DEFAULT_SCHEDULE_CONFIG
): boolean {
  const dayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.timezone,
    weekday: 'short',
  });
  const dayName = dayFormatter.format(time);
  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  return config.send_days.includes(dayMap[dayName]);
}

/**
 * Get random integer between min and max (inclusive)
 */
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
