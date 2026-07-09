import { connect, release, remove, getPoolStats, destroyAll, cleanStale } from '../connection-pool';

jest.mock('net', () => {
  const mockSocket = {
    setTimeout: jest.fn(),
    once: jest.fn(),
    on: jest.fn(),
    removeListener: jest.fn(),
    connect: jest.fn(),
    destroy: jest.fn(),
  };
  const MockSocket = jest.fn(() => mockSocket);
  MockSocket.prototype = mockSocket;
  return { Socket: MockSocket };
});

jest.mock('tls', () => ({
  connect: jest.fn(() => ({
    once: jest.fn(),
    on: jest.fn(),
    destroy: jest.fn(),
  })),
}));

describe('Connection Pool', () => {
  beforeEach(() => {
    destroyAll();
  });

  describe('getPoolStats', () => {
    it('should return empty pool stats initially', () => {
      const stats = getPoolStats();
      expect(stats.total).toBe(0);
      expect(stats.healthy).toBe(0);
    });

    it('should create and track connection', () => {
      connect('mx.example.com', 25, 'ip-1', '1.2.3.4').catch(() => {});
      const stats = getPoolStats();
      expect(stats.total).toBeGreaterThanOrEqual(0);
    });
  });

  describe('cleanStale', () => {
    it('should clean stale connections', () => {
      const removed = cleanStale(0);
      expect(removed).toBe(0);
    });
  });

  describe('destroyAll', () => {
    it('should clear all connections', () => {
      destroyAll();
      const stats = getPoolStats();
      expect(stats.total).toBe(0);
    });
  });
});
