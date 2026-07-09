// Unit tests for rotation

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

jest.mock('../registration', () => ({
  updateWorkerStatus: jest.fn(),
}));

import { startDrain, isDrainComplete, completeDrain, provisionNewWorker, getWorkersNeedingRotation, getRotationStats } from '../rotation';
import { query } from '../../db/connection';
import { updateWorkerStatus } from '../registration';

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockUpdateWorkerStatus = updateWorkerStatus as jest.MockedFunction<typeof updateWorkerStatus>;

describe('Rotation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('startDrain', () => {
    it('should start drain and return in-progress count', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ count: '5' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await startDrain('worker-1');

      expect(result.worker_id).toBe('worker-1');
      expect(result.in_progress_jobs).toBe(5);
      expect(mockUpdateWorkerStatus).toHaveBeenCalledWith('worker-1', 'draining');
    });
  });

  describe('isDrainComplete', () => {
    it('should return true when drain complete', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ count: '0' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await isDrainComplete('worker-1');
      expect(result).toBe(true);
    });

    it('should return false when jobs still processing', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ count: '3' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await isDrainComplete('worker-1');
      expect(result).toBe(false);
    });
  });

  describe('provisionNewWorker', () => {
    it('should provision new worker', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ id: 'new-worker-1' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await provisionNewWorker('aws');

      expect(result.worker_id).toBe('new-worker-1');
      expect(result.machine_id).toBeDefined();
      expect(result.public_ip).toBeDefined();
    });
  });

  describe('getRotationStats', () => {
    it('should return rotation statistics', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '50' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '10' }], rowCount: 1, command: '', oid: 0, fields: [] })
        .mockResolvedValueOnce({ rows: [{ count: '5' }], rowCount: 1, command: '', oid: 0, fields: [] });

      const stats = await getRotationStats();

      expect(stats.total_workers).toBe(50);
      expect(stats.needing_rotation).toBe(10);
      expect(stats.recently_rotated).toBe(5);
    });
  });
});
