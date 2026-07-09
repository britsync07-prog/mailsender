export interface ThreadConfig {
  enabled: boolean;
  maxThreadAgeDays: number;
  maxMessagesPerThread: number;
  referenceChainMax: number;
  trackInDatabase: boolean;
}

export const DEFAULT_THREAD_CONFIG: ThreadConfig = {
  enabled: true,
  maxThreadAgeDays: 90,
  maxMessagesPerThread: 20,
  referenceChainMax: 10,
  trackInDatabase: true,
};

export interface Thread {
  id: string;
  leadId: string;
  leadEmail: string;
  subject: string;
  topic?: string;
  subdomainId: string;
  createdAt: Date;
  lastActivityAt: Date;
  messageCount: number;
  status: ThreadStatus;
}

export type ThreadStatus = 'active' | 'stale' | 'completed' | 'archived';

export interface ThreadMessage {
  id: string;
  threadId: string;
  jobId: string;
  messageId: string;
  inReplyTo?: string;
  references?: string[];
  fromAddress: string;
  toAddress: string;
  subject: string;
  bodySnippet: string;
  sentAt: Date;
  direction: 'outbound' | 'inbound';
}

export interface ThreadHeaders {
  'In-Reply-To'?: string;
  'References'?: string;
  'Message-ID': string;
}

export interface ThreadStore {
  getThread(leadId: string, subdomainId: string): Thread | undefined;
  getThreadById(threadId: string): Thread | undefined;
  createThread(leadId: string, leadEmail: string, subject: string, subdomainId: string, topic?: string): Thread;
  addMessage(threadId: string, msg: ThreadMessage): void;
  getThreadHeaders(leadId: string, subdomainId: string, jobId: string): ThreadHeaders;
  closeThread(leadId: string, subdomainId: string): void;
  getStats(): { totalThreads: number; activeThreads: number; totalMessages: number };
}
