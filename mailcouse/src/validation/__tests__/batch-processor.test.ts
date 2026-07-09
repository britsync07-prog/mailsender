// Unit tests for batch processor

import { processBatch } from '../batch-processor';

// Mock the pipeline module
jest.mock('../pipeline', () => ({
  validateLead: jest.fn(),
  updateLeadValidation: jest.fn(),
}));

import { validateLead, updateLeadValidation } from '../pipeline';

const mockValidateLead = validateLead as jest.MockedFunction<typeof validateLead>;
const mockUpdateLeadValidation = updateLeadValidation as jest.MockedFunction<typeof updateLeadValidation>;

describe('Batch Processor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('processBatch', () => {
    it('should process a batch of leads', async () => {
      mockValidateLead.mockResolvedValue({
        lead_id: 'test-id',
        email: 'user@example.com',
        result: 'valid',
        stages: [],
        total_duration_ms: 100,
      });

      mockUpdateLeadValidation.mockResolvedValue(undefined);

      const leads = [
        { id: '1', email: 'user1@example.com' },
        { id: '2', email: 'user2@example.com' },
        { id: '3', email: 'user3@example.com' },
      ];

      const result = await processBatch(leads, { concurrency: 2 });

      expect(result.results).toHaveLength(3);
      expect(result.stats.total).toBe(3);
      expect(result.stats.valid).toBe(3);
      expect(mockUpdateLeadValidation).toHaveBeenCalledTimes(3);
    });

    it('should handle mixed results', async () => {
      mockValidateLead
        .mockResolvedValueOnce({
          lead_id: '1',
          email: 'valid@example.com',
          result: 'valid',
          stages: [],
          total_duration_ms: 100,
        })
        .mockResolvedValueOnce({
          lead_id: '2',
          email: 'invalid@example.com',
          result: 'invalid',
          stages: [],
          total_duration_ms: 100,
        })
        .mockResolvedValueOnce({
          lead_id: '3',
          email: 'disposable@mailinator.com',
          result: 'disposable',
          stages: [],
          total_duration_ms: 100,
        });

      mockUpdateLeadValidation.mockResolvedValue(undefined);

      const leads = [
        { id: '1', email: 'valid@example.com' },
        { id: '2', email: 'invalid@example.com' },
        { id: '3', email: 'disposable@mailinator.com' },
      ];

      const result = await processBatch(leads);

      expect(result.stats.valid).toBe(1);
      expect(result.stats.invalid).toBe(1);
      expect(result.stats.disposable).toBe(1);
    });

    it('should report progress', async () => {
      mockValidateLead.mockResolvedValue({
        lead_id: 'test-id',
        email: 'user@example.com',
        result: 'valid',
        stages: [],
        total_duration_ms: 100,
      });

      mockUpdateLeadValidation.mockResolvedValue(undefined);

      const onProgress = jest.fn();
      const leads = [
        { id: '1', email: 'user1@example.com' },
        { id: '2', email: 'user2@example.com' },
      ];

      await processBatch(leads, { onProgress });

      expect(onProgress).toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalledWith(
        expect.any(Number),
        2
      );
    });

    it('should handle batch completion callback', async () => {
      mockValidateLead.mockResolvedValue({
        lead_id: 'test-id',
        email: 'user@example.com',
        result: 'valid',
        stages: [],
        total_duration_ms: 100,
      });

      mockUpdateLeadValidation.mockResolvedValue(undefined);

      const onBatchComplete = jest.fn();
      const leads = [{ id: '1', email: 'user1@example.com' }];

      await processBatch(leads, { batchSize: 1, onBatchComplete });

      expect(onBatchComplete).toHaveBeenCalled();
    });

    it('should respect concurrency limit', async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      mockValidateLead.mockImplementation(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 10));
        concurrent--;
        return {
          lead_id: 'test-id',
          email: 'user@example.com',
          result: 'valid',
          stages: [],
          total_duration_ms: 10,
        };
      });

      mockUpdateLeadValidation.mockResolvedValue(undefined);

      const leads = Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        email: `user${i}@example.com`,
      }));

      await processBatch(leads, { concurrency: 3 });

      expect(maxConcurrent).toBeLessThanOrEqual(3);
    });
  });

  describe('error handling', () => {
    it('should handle validation errors gracefully', async () => {
      mockValidateLead.mockRejectedValue(new Error('Network error'));
      mockUpdateLeadValidation.mockResolvedValue(undefined);

      const leads = [{ id: '1', email: 'user@example.com' }];

      const result = await processBatch(leads);

      expect(result.results).toHaveLength(1);
      expect(result.results[0].result).toBe('invalid');
    });
  });
});
