// Unit tests for suppression cache

// Mock database first
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

// Mock Redis - must be before import
const mockRedisInstance = {
  ping: jest.fn().mockResolvedValue('PONG'),
  sadd: jest.fn().mockResolvedValue(1),
  srem: jest.fn().mockResolvedValue(1),
  sismember: jest.fn().mockResolvedValue(0),
  smembers: jest.fn().mockResolvedValue([]),
  scard: jest.fn().mockResolvedValue(0),
  del: jest.fn().mockResolvedValue(1),
  pipeline: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue([[null, 0], [null, 0]]),
  on: jest.fn(),
};

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => mockRedisInstance);
});

import { addToCache, removeFromCache, isInCache, batchCheckCache, getCacheSize, clearCache, syncCacheFromDB } from '../cache';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Suppression Cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('addToCache', () => {
    it('should add email to cache', async () => {
      await addToCache('test@example.com');
      expect(mockRedisInstance.sadd).toHaveBeenCalled();
    });

    it('should normalize email to lowercase', async () => {
      await addToCache('Test@Example.COM');
      expect(mockRedisInstance.sadd).toHaveBeenCalledWith(
        expect.any(String),
        'test@example.com'
      );
    });
  });

  describe('removeFromCache', () => {
    it('should remove email from cache', async () => {
      await removeFromCache('test@example.com');
      expect(mockRedisInstance.srem).toHaveBeenCalled();
    });
  });

  describe('isInCache', () => {
    it('should check if email is in cache', async () => {
      mockRedisInstance.sismember.mockResolvedValue(1);

      const result = await isInCache('test@example.com');

      expect(result).toBe(true);
      expect(mockRedisInstance.sismember).toHaveBeenCalled();
    });

    it('should return false for email not in cache', async () => {
      mockRedisInstance.sismember.mockResolvedValue(0);

      const result = await isInCache('notincache@example.com');

      expect(result).toBe(false);
    });
  });

  describe('batchCheckCache', () => {
    it('should batch check emails', async () => {
      mockRedisInstance.exec.mockResolvedValue([[null, 0], [null, 1]]);

      const result = await batchCheckCache([
        'user1@example.com',
        'user2@example.com',
      ]);

      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(2);
      expect(result.get('user1@example.com')).toBe(false);
      expect(result.get('user2@example.com')).toBe(true);
    });
  });

  describe('getCacheSize', () => {
    it('should return cache size', async () => {
      mockRedisInstance.scard.mockResolvedValue(42);

      const size = await getCacheSize();

      expect(size).toBe(42);
    });
  });

  describe('clearCache', () => {
    it('should clear entire cache', async () => {
      await clearCache();
      expect(mockRedisInstance.del).toHaveBeenCalled();
    });
  });

  describe('syncCacheFromDB', () => {
    it('should sync cache from database', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { email: 'user1@example.com' },
          { email: 'user2@example.com' },
        ],
        rowCount: 2,
        command: '',
        oid: 0,
        fields: [],
      });

      const count = await syncCacheFromDB();

      expect(count).toBe(2);
      expect(mockRedisInstance.del).toHaveBeenCalled();
      expect(mockRedisInstance.sadd).toHaveBeenCalled();
    });

    it('should handle empty database', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      });

      const count = await syncCacheFromDB();

      expect(count).toBe(0);
    });
  });
});
