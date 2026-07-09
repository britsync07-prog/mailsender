// Main bounce receiver and processor

import { query } from '../db/connection';
import { parseBounceMessage } from './parser';
import { classifyBounce, shouldSuppress, shouldRetry } from './classifier';
import { suppressBouncedAddress, updateDomainBounceRate } from './suppressor';
import { BounceData, BounceType } from './types';

/**
 * Process a single bounce message
 */
export async function processBounce(
  rawMessage: string,
  subdomainId?: string
): Promise<{
  processed: boolean;
  bounce_type: BounceType;
  suppressed: boolean;
  error?: string;
}> {
  try {
    // Parse bounce message
    const parsed = parseBounceMessage(rawMessage);
    if (!parsed) {
      return {
        processed: false,
        bounce_type: 'unknown',
        suppressed: false,
        error: 'Failed to parse bounce message',
      };
    }

    // Classify bounce
    const classification = classifyBounce(
      parsed.smtp_code,
      parsed.diagnostic_code,
      parsed.message
    );

    // Create bounce data
    const bounceData: BounceData = {
      recipient: parsed.recipient,
      sender: parsed.sender,
      bounce_type: classification.type,
      smtp_code: parsed.smtp_code,
      diagnostic_code: parsed.diagnostic_code,
      message: parsed.message,
      timestamp: new Date(),
      subdomain_id: subdomainId,
    };

    // Suppress if needed
    let suppressed = false;
    if (classification.should_suppress) {
      const result = await suppressBouncedAddress(bounceData);
      suppressed = result.suppressed;
    }

    // Log bounce event
    await logBounceEvent(bounceData);

    return {
      processed: true,
      bounce_type: classification.type,
      suppressed,
    };
  } catch (error) {
    return {
      processed: false,
      bounce_type: 'unknown',
      suppressed: false,
      error: error instanceof Error ? error.message : 'Processing failed',
    };
  }
}

/**
 * Process batch of bounces
 */
export async function processBounceBatch(
  messages: { message: string; subdomain_id?: string }[]
): Promise<{
  total: number;
  processed: number;
  suppressed: number;
  by_type: Record<string, number>;
  errors: { index: number; error: string }[];
}> {
  let processed = 0;
  let suppressed = 0;
  const byType: Record<string, number> = {};
  const errors: { index: number; error: string }[] = [];

  for (let i = 0; i < messages.length; i++) {
    const { message, subdomain_id } = messages[i];
    const result = await processBounce(message, subdomain_id);

    if (result.processed) {
      processed++;
      if (result.suppressed) suppressed++;
      byType[result.bounce_type] = (byType[result.bounce_type] || 0) + 1;
    } else {
      errors.push({ index: i, error: result.error || 'Unknown error' });
    }
  }

  return {
    total: messages.length,
    processed,
    suppressed,
    by_type: byType,
    errors,
  };
}

/**
 * Log bounce event
 */
async function logBounceEvent(bounce: BounceData): Promise<void> {
  await query(
    `INSERT INTO bounce_events (id, recipient, bounce_type, smtp_code, diagnostic_code, message, subdomain_id, timestamp)
     VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7)`,
    [
      bounce.recipient,
      bounce.bounce_type,
      bounce.smtp_code,
      bounce.diagnostic_code || null,
      bounce.message,
      bounce.subdomain_id || null,
      bounce.timestamp,
    ]
  );
}

/**
 * Get bounce statistics
 */
export async function getBounceStats(): Promise<{
  total_bounces: number;
  by_type: { type: string; count: number }[];
  bounce_rate_7d: number;
  domains_exceeding_threshold: { domain: string; bounce_rate: number }[];
}> {
  const totalResult = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM bounce_events'
  );

  const typeResult = await query<{ bounce_type: string; count: number }>(
    'SELECT bounce_type, COUNT(*) as count FROM bounce_events GROUP BY bounce_type'
  );

  // Calculate 7-day bounce rate
  const rateResult = await query<{ total: number; bounced: number }>(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE status = 'bounced') as bounced
     FROM send_jobs
     WHERE sent_at >= NOW() - INTERVAL '7 days'`
  );

  const rateStats = rateResult.rows[0] || { total: 0, bounced: 0 };
  const bounceRate7d = rateStats.total > 0 ? rateStats.bounced / rateStats.total : 0;

  // Domains exceeding threshold
  const domainResult = await query<{ domain: string; bounce_rate: number }>(
    `SELECT d.domain, 
            CASE WHEN COUNT(*) > 0 
                 THEN COUNT(*) FILTER (WHERE sj.status = 'bounced')::float / COUNT(*)
                 ELSE 0 
            END as bounce_rate
     FROM domains d
     JOIN subdomains s ON d.id = s.domain_id
     JOIN send_jobs sj ON s.id = sj.subdomain_id
     WHERE sj.sent_at >= NOW() - INTERVAL '7 days'
     GROUP BY d.id, d.domain
     HAVING COUNT(*) FILTER (WHERE sj.status = 'bounced')::float / COUNT(*) > 0.03`
  );

  return {
    total_bounces: parseInt(String(totalResult.rows[0]?.count || '0')),
    by_type: typeResult.rows.map((r) => ({
      type: r.bounce_type,
      count: parseInt(String(r.count)),
    })),
    bounce_rate_7d: bounceRate7d,
    domains_exceeding_threshold: domainResult.rows.map((r) => ({
      domain: r.domain,
      bounce_rate: r.bounce_rate,
    })),
  };
}
