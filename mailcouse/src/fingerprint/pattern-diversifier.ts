import { DEFAULT_PATTERN_CONFIG, PatternDiversifierConfig, SendCadence, TimingDecision } from './types';

let config: PatternDiversifierConfig = DEFAULT_PATTERN_CONFIG;
const cadences = new Map<string, SendCadence>();

export function configurePatternDiversifier(cfg: Partial<PatternDiversifierConfig>): void {
  config = { ...config, ...cfg };
}

export function resetPatternDiversifier(): void {
  config = DEFAULT_PATTERN_CONFIG;
  cadences.clear();
}

function cadenceKey(subdomainId: string, ipId: string): string {
  return `${subdomainId}:${ipId}`;
}

function getOrCreateCadence(subdomainId: string, ipId: string): SendCadence {
  const key = cadenceKey(subdomainId, ipId);
  if (!cadences.has(key)) {
    cadences.set(key, {
      subdomainId,
      ipId,
      lastSendAt: 0,
      burstCount: 0,
      burstStartAt: 0,
      dailySent: 0,
    });
  }
  return cadences.get(key)!;
}

function calculateDelay(cad: SendCadence): number {
  const baseDelay = config.baseDelayMs;
  const jitter = baseDelay * (config.jitterPercent / 100) * Math.random() * 2 - baseDelay * (config.jitterPercent / 100);
  return Math.max(1000, Math.round(baseDelay + jitter));
}

function decideBurst(cad: SendCadence): TimingDecision {
  const now = Date.now();

  if (cad.burstCount > 0 && now - cad.burstStartAt < config.burstCooldownMs) {
    cad.burstCount--;
    return { delayMs: Math.floor(Math.random() * 5000) + 1000, burstRemaining: cad.burstCount };
  }

  const burstSize = Math.floor(Math.random() * (config.maxBurstSize - config.minBurstSize + 1)) + config.minBurstSize;
  cad.burstCount = burstSize - 1;
  cad.burstStartAt = now;

  return { delayMs: calculateDelay(cad), burstRemaining: cad.burstCount };
}

export function decideTiming(subdomainId: string, ipId: string): TimingDecision {
  const cad = getOrCreateCadence(subdomainId, ipId);
  const now = Date.now();
  const elapsed = now - cad.lastSendAt;

  cad.dailySent++;

  if (cad.lastSendAt === 0) {
    cad.lastSendAt = now;
    return { delayMs: 0, burstRemaining: 0 };
  }

  if (Math.random() < 0.3) {
    cad.lastSendAt = now;
    return decideBurst(cad);
  }

  let delay = calculateDelay(cad);

  if (elapsed < config.baseDelayMs * 0.5) {
    delay = Math.max(delay, config.baseDelayMs - elapsed);
  }

  cad.lastSendAt = now;
  return { delayMs: delay, burstRemaining: 0 };
}

export function getDailyVolumeTarget(totalCapacity: number): number {
  switch (config.dailyShape) {
    case 'linear_ramp': {
      return Math.floor(totalCapacity * 0.5);
    }
    case 'bell_curve': {
      const peak = Math.floor(totalCapacity * 0.7);
      const min = Math.floor(totalCapacity * 0.3);
      return Math.floor(Math.random() * (peak - min + 1)) + min;
    }
    case 'random_walk': {
      return Math.floor(totalCapacity * (0.3 + Math.random() * 0.5));
    }
    case 'uniform': {
      return Math.floor(totalCapacity * 0.6);
    }
    default:
      return Math.floor(totalCapacity * 0.6);
  }
}

export function shouldDelaySend(scheduledAt: string | undefined): number {
  if (!scheduledAt) return 0;
  const scheduled = new Date(scheduledAt).getTime();
  const now = Date.now();
  return Math.max(0, scheduled - now);
}

export function getCadenceStats(): {
  activeCadences: number;
  totalDailySent: number;
} {
  let totalDailySent = 0;
  for (const [, cad] of cadences) {
    totalDailySent += cad.dailySent;
  }
  return {
    activeCadences: cadences.size,
    totalDailySent,
  };
}
