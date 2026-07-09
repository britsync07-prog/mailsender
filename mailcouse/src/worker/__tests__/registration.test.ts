// Unit tests for worker registration

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { registerWorker, updateWorkerStatus, deregisterWorker, getWorkerByMachineId, getActiveWorkers, getWorkerStats } from '../registration';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Worker Registration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registerWorker', () => {
    it('should register worker in database', async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          id: 'worker-1',
          machine_id: 'rdp-1',
          public_ip: '1.2.3.4',
          provider: 'aws',
          status: 'running',
          last_heartbeat: new Date(),
          started_at: new Date(),
        }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await registerWorker({
        machine_id: 'rdp-1',
        public_ip: '1.2.3.4',
        provider: 'aws',
        concurrency: 50,
        heartbeat_interval_ms: 60000,
        poll_interval_ms: 1000,
      });

      expect(result.id).toBe('worker-1');
      expect(result.machine_id).toBe('rdp-1');
    });
  });

  describe('updateWorkerStatus', () => {
    it('should update worker status', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      await updateWorkerStatus('worker-1', 'draining');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE rdp_instances'),
        ['draining', 'worker-1']
      );
    });
  });

  describe('deregisterWorker', () => {
    it('should deregister worker', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      await deregisterWorker('worker-1');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('stopped'),
        ['worker-1']
      );
    });
  });

  describe('getWorkerByMachineId', () => {
    it('should get worker by machine ID', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ id: 'worker-1', machine_id: 'rdp-1' }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await getWorkerByMachineId('rdp-1');
      expect(result).not.toBeNull();
      expect(result?.machine_id).toBe('rdp-1');
    });

    it('should return null if not found', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      });

      const result = await getWorkerByMachineId('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getWorkerStats', () => {
    it('should return worker statistics', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            { status: 'running', count: '50' },
            { status: 'stopped', count: '10' },
          ],
          rowCount: 2,
          command: '',
          oid: 0,
          fields: [],
        })
        .mockResolvedValueOnce({
          rows: [{ total_processed: 1000, total_failed: 50 }],
          rowCount: 1,
          command: '',
          oid: 0,
          fields: [],
        });

      const stats = await getWorkerStats();

      expect(stats.total).toBe(60);
      expect(stats.running).toBe(50);
      expect(stats.total_processed).toBe(1000);
    });
  });
});
