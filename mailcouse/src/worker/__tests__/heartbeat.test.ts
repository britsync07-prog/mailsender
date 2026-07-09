// Unit tests for heartbeat

// Mock Redis
const mockRedisInstance = {
  ping: jest.fn().mockResolvedValue('PONG'),
  set: jest.fn().mockResolvedValue('OK'),
  expire: jest.fn().mockResolvedValue(1),
  get: jest.fn().mockResolvedValue(null),
  on: jest.fn(),
};

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => mockRedisInstance);
});

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { sendHeartbeat, checkMissedHeartbeats, getWorkerHeartbeat } from '../heartbeat';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Heartbeat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sendHeartbeat', () => {
    it('should send heartbeat to database and Redis', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      await sendHeartbeat('worker-1', 'running', 100, 5);

      expect(mockQuery).toHaveBeenCalled();
      expect(mockRedisInstance.set).toHaveBeenCalled();
    });
  });

  describe('checkMissedHeartbeats', () => {
    it('should find workers with missed heartbeats', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { id: 'worker-1', machine_id: 'rdp-1', status: 'running', last_heartbeat: new Date(Date.now() - 300000) },
        ],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await checkMissedHeartbeats(3);

      expect(result).toHaveLength(1);
      expect(result[0].machine_id).toBe('rdp-1');
    });

    it('should return empty array if no missed heartbeats', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await checkMissedHeartbeats(3);
      expect(result).toHaveLength(0);
    });
  });

  describe('getWorkerHeartbeat', () => {
    it('should get heartbeat from Redis', async () => {
      const heartbeat = {
        worker_id: 'worker-1',
        timestamp: new Date().toISOString(),
        status: 'running',
        jobs_processed: 100,
        jobs_failed: 5,
      };
      mockRedisInstance.get.mockResolvedValue(JSON.stringify(heartbeat));

      const result = await getWorkerHeartbeat('worker-1');

      expect(result).not.toBeNull();
      expect(result?.worker_id).toBe('worker-1');
    });

    it('should return null if no heartbeat', async () => {
      mockRedisInstance.get.mockResolvedValue(null);

      const result = await getWorkerHeartbeat('nonexistent');
      expect(result).toBeNull();
    });
  });
});
