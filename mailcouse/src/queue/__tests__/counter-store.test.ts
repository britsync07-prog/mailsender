// Unit tests for counter store

// Mock Redis
const mockRedisInstance = {
  ping: jest.fn().mockResolvedValue('PONG'),
  get: jest.fn().mockResolvedValue('5'),
  incr: jest.fn().mockResolvedValue(6),
  expire: jest.fn().mockResolvedValue(1),
  keys: jest.fn().mockResolvedValue(['subdomain:1:sent_today', 'subdomain:2:sent_today']),
  del: jest.fn().mockResolvedValue(2),
  set: jest.fn().mockResolvedValue('OK'),
  on: jest.fn(),
};

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => mockRedisInstance);
});

import { getSubdomainCount, incrementSubdomainCount, getIPCount, incrementIPCount, resetAllSubdomainCounters, resetAllIPCounters } from '../counter-store';

describe('Counter Store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getSubdomainCount', () => {
    it('should get subdomain count from Redis', async () => {
      mockRedisInstance.get.mockResolvedValue('5');
      const count = await getSubdomainCount('sub-1');
      expect(count).toBe(5);
      expect(mockRedisInstance.get).toHaveBeenCalledWith('subdomain:sub-1:sent_today');
    });

    it('should return 0 when key does not exist', async () => {
      mockRedisInstance.get.mockResolvedValue(null);
      const count = await getSubdomainCount('sub-1');
      expect(count).toBe(0);
    });
  });

  describe('incrementSubdomainCount', () => {
    it('should increment subdomain count', async () => {
      mockRedisInstance.incr.mockResolvedValue(6);
      const count = await incrementSubdomainCount('sub-1');
      expect(count).toBe(6);
      expect(mockRedisInstance.incr).toHaveBeenCalledWith('subdomain:sub-1:sent_today');
    });

    it('should set TTL on key', async () => {
      await incrementSubdomainCount('sub-1');
      expect(mockRedisInstance.expire).toHaveBeenCalled();
    });
  });

  describe('getIPCount', () => {
    it('should get IP count from Redis', async () => {
      mockRedisInstance.get.mockResolvedValue('100');
      const count = await getIPCount('ip-1');
      expect(count).toBe(100);
    });
  });

  describe('incrementIPCount', () => {
    it('should increment IP count', async () => {
      mockRedisInstance.incr.mockResolvedValue(101);
      const count = await incrementIPCount('ip-1');
      expect(count).toBe(101);
    });
  });

  describe('resetAllSubdomainCounters', () => {
    it('should reset all subdomain counters', async () => {
      mockRedisInstance.keys.mockResolvedValue(['subdomain:1:sent_today', 'subdomain:2:sent_today']);
      const count = await resetAllSubdomainCounters();
      expect(count).toBe(2);
      expect(mockRedisInstance.del).toHaveBeenCalled();
    });

    it('should handle empty keys', async () => {
      mockRedisInstance.keys.mockResolvedValue([]);
      const count = await resetAllSubdomainCounters();
      expect(count).toBe(0);
    });
  });

  describe('resetAllIPCounters', () => {
    it('should reset all IP counters', async () => {
      mockRedisInstance.keys.mockResolvedValue(['ip:1:sent_today']);
      const count = await resetAllIPCounters();
      expect(count).toBe(1);
    });
  });
});
