// Main reply processing orchestrator

import { query } from '../db/connection';
import { classifyReply } from './classifier';
import { forwardToCRM } from './crm-forwarder';
import { ReplyData, ReplyClassification } from './types';

/**
 * Process a single reply
 */
export async function processReply(
  reply: ReplyData
): Promise<{
  processed: boolean;
  classification: ReplyClassification;
  action: string;
  error?: string;
}> {
  try {
    // Classify the reply
    const classification = classifyReply(reply.subject, reply.body);

    // Store the reply
    await storeReply(reply, classification.classification);

    // Update subdomain reply count
    if (reply.subdomain_id) {
      await query(
        'UPDATE subdomains SET reply_count = reply_count + 1 WHERE id = $1',
        [reply.subdomain_id]
      );
    }

    // Route based on classification
    switch (classification.classification) {
      case 'positive':
        await handlePositiveReply(reply);
        return {
          processed: true,
          classification: 'positive',
          action: 'forwarded_to_crm',
        };

      case 'negative':
      case 'unsubscribe':
        await handleNegativeReply(reply);
        return {
          processed: true,
          classification: classification.classification,
          action: 'suppressed',
        };

      case 'neutral':
        await handleNeutralReply(reply);
        return {
          processed: true,
          classification: 'neutral',
          action: 'logged_for_review',
        };

      case 'ooo':
        return {
          processed: true,
          classification: 'ooo',
          action: 'ignored',
        };

      default:
        return {
          processed: true,
          classification: 'unknown',
          action: 'logged',
        };
    }
  } catch (error) {
    return {
      processed: false,
      classification: 'unknown',
      action: 'error',
      error: error instanceof Error ? error.message : 'Processing failed',
    };
  }
}

/**
 * Handle positive reply
 */
async function handlePositiveReply(reply: ReplyData): Promise<void> {
  // Update lead status
  await query(
    `UPDATE leads
     SET status = 'replied',
         replied_at = $1
     WHERE id = $2`,
    [reply.timestamp, reply.lead_id]
  );

  // Forward to CRM
  await forwardToCRM({
    lead_id: reply.lead_id,
    lead_email: reply.from,
    reply_subject: reply.subject,
    reply_body: reply.body,
    reply_from: reply.from,
    reply_timestamp: reply.timestamp,
    subdomain_id: reply.subdomain_id,
  });
}

/**
 * Handle negative reply (treat as unsubscribe)
 */
async function handleNegativeReply(reply: ReplyData): Promise<void> {
  // Get lead email
  const leadResult = await query<{ email: string }>(
    'SELECT email FROM leads WHERE id = $1',
    [reply.lead_id]
  );

  if (leadResult.rows.length > 0) {
    // Add to suppression list
    await query(
      `INSERT INTO suppression_list (id, email, reason, suppressed_at, source_subdomain_id)
       VALUES ($1, $2, 'unsubscribe', NOW(), $3)
       ON CONFLICT (email) DO NOTHING`,
      [randomUUID(), leadResult.rows[0].email, reply.subdomain_id || null]
    );

    // Update lead status
    await query(
      `UPDATE leads SET status = 'suppressed' WHERE id = $1`,
      [reply.lead_id]
    );
  }
}

/**
 * Handle neutral reply
 */
async function handleNeutralReply(reply: ReplyData): Promise<void> {
  // Log for review - no suppression
  await query(
    `UPDATE leads
     SET engagement_score = engagement_score + 5
     WHERE id = $1`,
    [reply.lead_id]
  );
}

/**
 * Store reply in database
 */
async function storeReply(
  reply: ReplyData,
  classification: ReplyClassification
): Promise<void> {
  await query(
    `INSERT INTO reply_events
     (id, lead_id, subdomain_id, message_id, subject, body, from_address, classification, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      randomUUID(),
      reply.lead_id,
      reply.subdomain_id || null,
      reply.message_id || null,
      reply.subject,
      reply.body,
      reply.from,
      classification,
      reply.timestamp,
    ]
  );
}

/**
 * Process batch of replies
 */
export async function processReplyBatch(
  replies: ReplyData[]
): Promise<{
  total: number;
  processed: number;
  positive: number;
  negative: number;
  neutral: number;
  errors: { index: number; error: string }[];
}> {
  let processed = 0;
  let positive = 0;
  let negative = 0;
  let neutral = 0;
  const errors: { index: number; error: string }[] = [];

  for (let i = 0; i < replies.length; i++) {
    const result = await processReply(replies[i]);

    if (result.processed) {
      processed++;
      if (result.classification === 'positive') positive++;
      if (result.classification === 'negative' || result.classification === 'unsubscribe') negative++;
      if (result.classification === 'neutral') neutral++;
    } else {
      errors.push({ index: i, error: result.error || 'Unknown error' });
    }
  }

  return {
    total: replies.length,
    processed,
    positive,
    negative,
    neutral,
    errors,
  };
}

/**
 * Get reply statistics
 */
export async function getReplyStats(): Promise<{
  total_replies: number;
  by_classification: { classification: string; count: number }[];
  positive_rate: number;
  subdomains_with_replies: number;
}> {
  const totalResult = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM reply_events'
  );

  const classResult = await query<{ classification: string; count: number }>(
    'SELECT classification, COUNT(*) as count FROM reply_events GROUP BY classification'
  );

  const positiveResult = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM reply_events WHERE classification = 'positive'"
  );

  const subdomainResult = await query<{ count: number }>(
    'SELECT COUNT(DISTINCT subdomain_id) as count FROM reply_events WHERE subdomain_id IS NOT NULL'
  );

  const total = parseInt(String(totalResult.rows[0]?.count || '0'));
  const positive = parseInt(String(positiveResult.rows[0]?.count || '0'));

  return {
    total_replies: total,
    by_classification: classResult.rows.map((r) => ({
      classification: r.classification,
      count: parseInt(String(r.count)),
    })),
    positive_rate: total > 0 ? Math.round((positive / total) * 100) : 0,
    subdomains_with_replies: parseInt(String(subdomainResult.rows[0]?.count || '0')),
  };
}

function randomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
