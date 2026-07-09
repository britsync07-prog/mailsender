// Unit tests for updater

// Mock dependencies
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { incrementCounters, getCounterValues } from '../updater';
import { query } from '../../db/connection';

const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Updater', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('incrementCounters', () => {
    it('should increment subdomain counters', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      await incrementCounters({
        subdomain_id: 'sub-1',
        job_id: 'job-1',
        timestamp: new Date(),
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('emails_sent_today'),
        ['sub-1']
      );
    });

    it('should increment IP counters', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      await incrementCounters({
        ip_id: 'ip-1',
        job_id: 'job-1',
        timestamp: new Date(),
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('emails_today'),
        ['ip-1']
      );
    });

    it('should increment lead counters', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      await incrementCounters({
        lead_id: 'lead-1',
        job_id: 'job-1',
        timestamp: new Date(),
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('send_count'),
        expect.arrayContaining([expect.any(Date), 'lead-1'])
      );
    });

    it('should update send job status', async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] });

      await incrementCounters({
        job_id: 'job-1',
        timestamp: new Date(),
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('sent'),
        expect.arrayContaining([expect.any(Date), 'job-1'])
      );
    });
  });

  describe('getCounterValues', () => {
    it('should return counter values', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ emails_sent_today: 50, total_sent: 1000 }],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      const values = await getCounterValues('sub-1');

      expect(values).not.toBeNull();
      expect(values?.emails_sent_today).toBe(50);
      expect(values?.total_sent).toBe(1000);
    });

    it('should return null if not found', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 0,
        command: '',
        oid: 0,
        fields: [],
      });

      const values = await getCounterValues('nonexistent');
      expect(values).toBeNull();
    });
  });
});
