import { DEFAULT_THREAD_CONFIG, ThreadConfig, Thread, ThreadMessage, ThreadHeaders, ThreadStatus, ThreadStore } from './types';
import { query } from '../db/connection';

let config: ThreadConfig = DEFAULT_THREAD_CONFIG;

const inMemoryThreads = new Map<string, Thread>();
const inMemoryMessages = new Map<string, ThreadMessage[]>();

export function configureThreading(cfg: Partial<ThreadConfig>): void {
  config = { ...config, ...cfg };
}

export function resetThreading(): void {
  config = DEFAULT_THREAD_CONFIG;
  inMemoryThreads.clear();
  inMemoryMessages.clear();
}

function threadLookupKey(leadId: string, subdomainId: string): string {
  return `${leadId}:${subdomainId}`;
}

function randomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getOrCreateThread(
  leadId: string,
  leadEmail: string,
  subject: string,
  subdomainId: string,
  topic?: string
): Promise<Thread> {
  const key = threadLookupKey(leadId, subdomainId);

  let thread = inMemoryThreads.get(key);
  if (thread && thread.status === 'active') {
    return thread;
  }

  if (config.trackInDatabase) {
    const existing = await query<{
      id: string; lead_id: string; subject: string; topic?: string;
      subdomain_id: string; created_at: Date; last_activity_at: Date;
      message_count: number; status: string;
    }>(
      `SELECT id, lead_id, subject, topic, subdomain_id, created_at,
              last_activity_at, message_count, status
       FROM email_threads
       WHERE lead_id = $1 AND subdomain_id = $2 AND status = 'active'`,
      [leadId, subdomainId]
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      thread = {
        id: row.id,
        leadId: row.lead_id,
        leadEmail,
        subject: row.subject,
        topic: row.topic,
        subdomainId: row.subdomain_id,
        createdAt: row.created_at,
        lastActivityAt: row.last_activity_at,
        messageCount: row.message_count,
        status: row.status as ThreadStatus,
      };
      inMemoryThreads.set(key, thread);
      return thread;
    }
  }

  const threadId = randomUUID();
  thread = {
    id: threadId,
    leadId,
    leadEmail,
    subject,
    topic,
    subdomainId,
    createdAt: new Date(),
    lastActivityAt: new Date(),
    messageCount: 0,
    status: 'active',
  };

  inMemoryThreads.set(key, thread);

  if (config.trackInDatabase) {
    await query(
      `INSERT INTO email_threads (id, lead_id, lead_email, subject, topic, subdomain_id, created_at, last_activity_at, message_count, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT DO NOTHING`,
      [threadId, leadId, leadEmail, subject, topic || null, subdomainId, thread.createdAt, thread.lastActivityAt, 0, 'active']
    );
  }

  return thread;
}

export async function addMessageToThread(
  threadId: string,
  jobId: string,
  messageId: string,
  fromAddress: string,
  toAddress: string,
  subject: string,
  bodySnippet: string,
  direction: 'outbound' | 'inbound',
  inReplyTo?: string,
  references?: string[]
): Promise<ThreadMessage> {
  const msgId = randomUUID();
  const msg: ThreadMessage = {
    id: msgId,
    threadId,
    jobId,
    messageId,
    inReplyTo,
    references,
    fromAddress,
    toAddress,
    subject,
    bodySnippet,
    sentAt: new Date(),
    direction,
  };

  const msgs = inMemoryMessages.get(threadId) || [];
  msgs.push(msg);
  inMemoryMessages.set(threadId, msgs);

  for (const [, thread] of inMemoryThreads) {
    if (thread.id === threadId) {
      thread.messageCount = msgs.length;
      thread.lastActivityAt = new Date();
      break;
    }
  }

  if (config.trackInDatabase) {
    await query(
      `INSERT INTO thread_messages (id, thread_id, job_id, message_id, in_reply_to, references, from_address, to_address, subject, body_snippet, sent_at, direction)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [msgId, threadId, jobId, messageId, inReplyTo || null, references ? references.join(',') : null, fromAddress, toAddress, subject, bodySnippet, msg.sentAt, direction]
    );

    await query(
      `UPDATE email_threads SET message_count = message_count + 1, last_activity_at = NOW() WHERE id = $1`,
      [threadId]
    );
  }

  return msg;
}

export async function getThreadHeaders(
  leadId: string,
  subdomainId: string,
  jobId: string
): Promise<ThreadHeaders> {
  const messageId = `<${jobId}@${subdomainId}>`;

  const key = threadLookupKey(leadId, subdomainId);
  const thread = inMemoryThreads.get(key);

  if (!thread) {
    return { 'Message-ID': messageId };
  }

  const msgs = inMemoryMessages.get(thread.id) || [];
  const outboundMsgs = msgs.filter((m) => m.direction === 'outbound');
  const lastOutbound = outboundMsgs[outboundMsgs.length - 1];

  if (!lastOutbound) {
    return { 'Message-ID': messageId };
  }

  const inReplyTo = lastOutbound.messageId;
  const refs = lastOutbound.references || [];
  const allRefs = [...refs, lastOutbound.messageId].slice(-config.referenceChainMax);

  return {
    'In-Reply-To': inReplyTo,
    'References': allRefs.join(' '),
    'Message-ID': messageId,
  };
}

export async function storeOutboundThreadInfo(
  leadId: string,
  leadEmail: string,
  subject: string,
  subdomainId: string,
  jobId: string,
  fromAddress: string,
  toAddress: string,
  bodySnippet: string,
  topic?: string
): Promise<{ threadId: string; messageId: string; inReplyTo?: string; references?: string[] }> {
  const thread = await getOrCreateThread(leadId, leadEmail, subject, subdomainId, topic);
  const msgId = `<${jobId}@${subdomainId}>`;

  const headers = await getThreadHeaders(leadId, subdomainId, jobId);

  const msg = await addMessageToThread(
    thread.id, jobId, msgId, fromAddress, toAddress, subject, bodySnippet, 'outbound',
    headers['In-Reply-To'],
    headers['References'] ? headers['References'].split(' ') : undefined
  );

  return {
    threadId: thread.id,
    messageId: msgId,
    inReplyTo: msg.inReplyTo,
    references: msg.references,
  };
}

export async function closeThread(leadId: string, subdomainId: string): Promise<void> {
  const key = threadLookupKey(leadId, subdomainId);
  const thread = inMemoryThreads.get(key);
  if (thread) {
    thread.status = 'completed';
  }

  if (config.trackInDatabase) {
    await query(
      `UPDATE email_threads SET status = 'completed' WHERE lead_id = $1 AND subdomain_id = $2`,
      [leadId, subdomainId]
    );
  }
}

export async function getThreadStats(): Promise<{ totalThreads: number; activeThreads: number; totalMessages: number }> {
  let totalThreads = 0;
  let activeThreads = 0;
  let totalMessages = 0;

  for (const [, thread] of inMemoryThreads) {
    totalThreads++;
    if (thread.status === 'active') activeThreads++;
  }

  for (const [, msgs] of inMemoryMessages) {
    totalMessages += msgs.length;
  }

  return { totalThreads, activeThreads, totalMessages };
}

export const threadStore: ThreadStore = {
  getThread(leadId, subdomainId) {
    return inMemoryThreads.get(threadLookupKey(leadId, subdomainId));
  },
  getThreadById(threadId) {
    for (const [, thread] of inMemoryThreads) {
      if (thread.id === threadId) return thread;
    }
    return undefined;
  },
  createThread(leadId, leadEmail, subject, subdomainId, topic) {
    const id = randomUUID();
    const thread: Thread = {
      id, leadId, leadEmail, subject, topic, subdomainId,
      createdAt: new Date(), lastActivityAt: new Date(),
      messageCount: 0, status: 'active',
    };
    inMemoryThreads.set(threadLookupKey(leadId, subdomainId), thread);
    return thread;
  },
  addMessage(threadId, msg) {
    const msgs = inMemoryMessages.get(threadId) || [];
    msgs.push(msg);
    inMemoryMessages.set(threadId, msgs);
  },
  getThreadHeaders(leadId, subdomainId) {
    const key = threadLookupKey(leadId, subdomainId);
    const thread = inMemoryThreads.get(key);
    if (!thread) return { 'Message-ID': `<${randomUUID()}@${subdomainId}>` };
    const msgs = inMemoryMessages.get(thread.id) || [];
    const lastOutbound = msgs.filter((m) => m.direction === 'outbound').pop();
    if (!lastOutbound) return { 'Message-ID': `<${randomUUID()}@${subdomainId}>` };
    const refs = [...(lastOutbound.references || []), lastOutbound.messageId].slice(-10);
    return { 'In-Reply-To': lastOutbound.messageId, 'References': refs.join(' '), 'Message-ID': `<${randomUUID()}@${subdomainId}>` };
  },
  closeThread(leadId: string, subdomainId: string) {
    const t = inMemoryThreads.get(threadLookupKey(leadId, subdomainId));
    if (t) t.status = 'completed';
  },
  getStats() {
    let t = 0, a = 0, m = 0;
    for (const [, th] of inMemoryThreads) { t++; if (th.status === 'active') a++; }
    for (const [, ms] of inMemoryMessages) m += ms.length;
    return { totalThreads: t, activeThreads: a, totalMessages: m };
  },
};
