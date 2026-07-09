import { resetThreading, getOrCreateThread, getThreadHeaders, storeOutboundThreadInfo, getThreadStats, closeThread } from '../manager';

jest.mock('../../db/connection', () => ({
  query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] }),
}));

describe('Threading Manager', () => {
  beforeEach(() => {
    resetThreading();
  });

  describe('getOrCreateThread', () => {
    it('should create a new thread', async () => {
      const thread = await getOrCreateThread('lead-1', 'a@b.com', 'Hello', 'sub-1');
      expect(thread.id).toBeTruthy();
      expect(thread.leadId).toBe('lead-1');
      expect(thread.leadEmail).toBe('a@b.com');
      expect(thread.subject).toBe('Hello');
      expect(thread.status).toBe('active');
    });

    it('should return existing thread for same lead+subdomain', async () => {
      const t1 = await getOrCreateThread('lead-1', 'a@b.com', 'Hello', 'sub-1');
      const t2 = await getOrCreateThread('lead-1', 'a@b.com', 'Hello', 'sub-1');
      expect(t2.id).toBe(t1.id);
    });
  });

  describe('getThreadHeaders', () => {
    it('should return basic headers when no thread', async () => {
      const headers = await getThreadHeaders('lead-x', 'sub-1', 'job-1');
      expect(headers['Message-ID']).toBe('<job-1@sub-1>');
      expect(headers['In-Reply-To']).toBeUndefined();
    });

    it('should return threading headers after message', async () => {
      await storeOutboundThreadInfo(
        'lead-1', 'a@b.com', 'Re: Hello', 'sub-1', 'job-1',
        'me@ex.com', 'you@ex.com', 'body'
      );

      const headers = await getThreadHeaders('lead-1', 'sub-1', 'job-2');
      expect(headers['Message-ID']).toBe('<job-2@sub-1>');
      expect(headers['In-Reply-To']).toBeTruthy();
    });
  });

  describe('storeOutboundThreadInfo', () => {
    it('should store thread info and return headers', async () => {
      const info = await storeOutboundThreadInfo(
        'lead-1', 'a@b.com', 'Hi there', 'sub-1', 'job-1',
        'from@ex.com', 'to@ex.com', 'short body'
      );

      expect(info.threadId).toBeTruthy();
      expect(info.messageId).toBe('<job-1@sub-1>');
      expect(info.inReplyTo).toBeUndefined();
    });

    it('should set inReplyTo on second message', async () => {
      await storeOutboundThreadInfo(
        'lead-1', 'a@b.com', 'Hello', 'sub-1', 'job-1',
        'a@ex.com', 'b@ex.com', 'first'
      );

      const info = await storeOutboundThreadInfo(
        'lead-1', 'a@b.com', 'Re: Hello', 'sub-1', 'job-2',
        'a@ex.com', 'b@ex.com', 'second'
      );

      expect(info.inReplyTo).toBeTruthy();
      expect(info.threadId).toBeTruthy();
    });
  });

  describe('closeThread', () => {
    it('should close a thread', async () => {
      await getOrCreateThread('lead-1', 'a@b.com', 'Hello', 'sub-1');
      await closeThread('lead-1', 'sub-1');

      const thread = await getOrCreateThread('lead-1', 'a@b.com', 'Hello', 'sub-1');
      expect(thread.status).toBe('active');
    });
  });

  describe('getThreadStats', () => {
    it('should return thread statistics', async () => {
      await getOrCreateThread('lead-1', 'a@b.com', 'Hi', 'sub-1');
      const stats = await getThreadStats();
      expect(stats.totalThreads).toBeGreaterThanOrEqual(1);
    });
  });
});
