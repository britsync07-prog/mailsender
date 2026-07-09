import { query } from '../db/connection';
import { addMessageToThread, getOrCreateThread, closeThread } from './manager';
import { ReplyData, ReplyClassification } from '../reply/types';

export interface ReplyEnrichment {
  threadId?: string;
  threadDepth: number;
  threadAgeHours: number;
  isFollowUp: boolean;
}

export async function enrichReplyWithThread(reply: ReplyData): Promise<ReplyEnrichment> {
  const enrichment: ReplyEnrichment = {
    threadDepth: 0,
    threadAgeHours: 0,
    isFollowUp: false,
  };

  try {
    if (!reply.message_id && !reply.subject) {
      return enrichment;
    }

    const thread = await resolveThreadFromReply(reply);
    if (!thread) return enrichment;

    enrichment.threadId = thread.id;
    enrichment.threadDepth = thread.messageCount;
    enrichment.threadAgeHours = (Date.now() - thread.createdAt.getTime()) / 3600000;
    enrichment.isFollowUp = thread.messageCount > 1;

    await addMessageToThread(
      thread.id,
      `reply-${Date.now()}`,
      reply.message_id || `reply-${Date.now()}@unknown`,
      reply.from,
      '',
      reply.subject,
      reply.body.substring(0, 200),
      'inbound',
      undefined,
      undefined
    );

    if (reply.classification === 'negative' || reply.classification === 'unsubscribe') {
      await closeThread(reply.lead_id, reply.subdomain_id || '');
    }

    return enrichment;
  } catch {
    return enrichment;
  }
}

async function resolveThreadFromReply(reply: ReplyData): Promise<{
  id: string; messageCount: number; createdAt: Date;
} | undefined> {
  if (reply.message_id) {
    const dbResult = await query<{ thread_id: string }>(
      `SELECT thread_id FROM thread_messages WHERE message_id = $1 AND direction = 'outbound' LIMIT 1`,
      [reply.message_id]
    );
    if (dbResult.rows.length > 0) {
      const threadId = dbResult.rows[0].thread_id;
      const threadResult = await query<{ message_count: number; created_at: Date }>(
        'SELECT message_count, created_at FROM email_threads WHERE id = $1',
        [threadId]
      );
      if (threadResult.rows.length > 0) {
        return {
          id: threadId,
          messageCount: parseInt(String(threadResult.rows[0].message_count)),
          createdAt: threadResult.rows[0].created_at,
        };
      }
    }
  }

  const thread = await getOrCreateThread(
    reply.lead_id,
    reply.from,
    reply.subject,
    reply.subdomain_id || ''
  );

  return {
    id: thread.id,
    messageCount: thread.messageCount,
    createdAt: thread.createdAt,
  };
}

export async function updateCRMWithReply(
  leadId: string,
  reply: ReplyData,
  enrichment: ReplyEnrichment
): Promise<void> {
  try {
    const now = new Date();

    await query(
      `UPDATE leads SET
        status = 'replied',
        replied_at = $1,
        last_contacted_at = $1,
        reply_count = reply_count + 1,
        engagement_score = CASE
          WHEN $2 = 'positive' THEN LEAST(engagement_score + 20, 100)
          WHEN $2 = 'neutral' THEN LEAST(engagement_score + 5, 100)
          WHEN $2 = 'negative' THEN GREATEST(engagement_score - 15, 0)
          ELSE engagement_score
        END
      WHERE id = $3`,
      [now, reply.classification || 'unknown', leadId]
    );

    await query(
      `INSERT INTO crm_entries (id, lead_id, type, content, source, metadata, created_at)
       VALUES ($1, $2, 'reply', $3, 'email', $4, $5)`,
      [
        randomUUID(), leadId,
        reply.body.substring(0, 1000),
        JSON.stringify({
          subject: reply.subject,
          classification: reply.classification,
          thread_id: enrichment.threadId,
          thread_depth: enrichment.threadDepth,
          is_follow_up: enrichment.isFollowUp,
        }),
        now,
      ]
    );
  } catch {
  }
}

export async function getReplyChain(leadId: string, subdomainId: string): Promise<{
  messages: Array<{ direction: string; subject: string; sentAt: Date; bodySnippet: string }>;
  threadDepth: number;
}> {
  try {
    const result = await query<{
      direction: string; subject: string; sent_at: Date; body_snippet: string;
    }>(
      `SELECT tm.direction, tm.subject, tm.sent_at, tm.body_snippet
       FROM thread_messages tm
       JOIN email_threads et ON tm.thread_id = et.id
       WHERE et.lead_id = $1 AND et.subdomain_id = $2
       ORDER BY tm.sent_at ASC`,
      [leadId, subdomainId]
    );

    return {
      messages: result.rows.map((r) => ({
        direction: r.direction,
        subject: r.subject,
        sentAt: r.sent_at,
        bodySnippet: r.body_snippet,
      })),
      threadDepth: result.rows.length,
    };
  } catch {
    return { messages: [], threadDepth: 0 };
  }
}

function randomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
