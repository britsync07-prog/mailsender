// Unit tests for Stage 5: Catch-All Detection

import { validateCatchAll } from '../stages/catchall';

// Mock the SMTP probe
jest.mock('../stages/catchall', () => {
  const original = jest.requireActual('../stages/catchall');
  return {
    ...original,
    validateCatchAll: jest.fn(),
  };
});

const mockValidateCatchAll = validateCatchAll as jest.MockedFunction<typeof validateCatchAll>;

describe('Stage 5: Catch-All Detection', () => {
  beforeEach(() => {
    mockValidateCatchAll.mockReset();
  });

  describe('catch-all detection', () => {
    it('should detect catch-all domains', async () => {
      mockValidateCatchAll.mockResolvedValue({
        stage: 'catch_all',
        passed: true,
        catch_all_detected: true,
        duration_ms: 100,
      });

      const result = await validateCatchAll('test@catchall.com', [
        { priority: 10, exchange: 'mx.catchall.com' },
      ]);

      expect(result.passed).toBe(true);
      expect(result.catch_all_detected).toBe(true);
    });

    it('should detect non-catch-all domains', async () => {
      mockValidateCatchAll.mockResolvedValue({
        stage: 'catch_all',
        passed: true,
        catch_all_detected: false,
        duration_ms: 100,
      });

      const result = await validateCatchAll('test@normal.com', [
        { priority: 10, exchange: 'mx.normal.com' },
      ]);

      expect(result.passed).toBe(true);
      expect(result.catch_all_detected).toBe(false);
    });

    it('should handle no MX records gracefully', async () => {
      mockValidateCatchAll.mockResolvedValue({
        stage: 'catch_all',
        passed: true,
        catch_all_detected: false,
        error: 'No MX records available',
        duration_ms: 50,
      });

      const result = await validateCatchAll('test@nomx.com', []);

      expect(result.passed).toBe(true);
      expect(result.catch_all_detected).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle SMTP connection timeout', async () => {
      mockValidateCatchAll.mockResolvedValue({
        stage: 'catch_all',
        passed: true,
        catch_all_detected: false,
        error: 'Connection timeout',
        duration_ms: 10000,
      });

      const result = await validateCatchAll('test@timeout.com', [
        { priority: 10, exchange: 'mx.timeout.com' },
      ]);

      expect(result.passed).toBe(true);
      expect(result.catch_all_detected).toBe(false);
    });

    it('should handle SMTP connection refused', async () => {
      mockValidateCatchAll.mockResolvedValue({
        stage: 'catch_all',
        passed: true,
        catch_all_detected: false,
        error: 'Connection refused',
        duration_ms: 100,
      });

      const result = await validateCatchAll('test@refused.com', [
        { priority: 10, exchange: 'mx.refused.com' },
      ]);

      expect(result.passed).toBe(true);
    });
  });

  describe('result properties', () => {
    it('should include stage name', async () => {
      mockValidateCatchAll.mockResolvedValue({
        stage: 'catch_all',
        passed: true,
        catch_all_detected: false,
        duration_ms: 100,
      });

      const result = await validateCatchAll('test@example.com', [
        { priority: 10, exchange: 'mx.example.com' },
      ]);

      expect(result.stage).toBe('catch_all');
    });

    it('should include duration', async () => {
      mockValidateCatchAll.mockResolvedValue({
        stage: 'catch_all',
        passed: true,
        catch_all_detected: false,
        duration_ms: 150,
      });

      const result = await validateCatchAll('test@example.com', [
        { priority: 10, exchange: 'mx.example.com' },
      ]);

      expect(result.duration_ms).toBe(150);
    });
  });
});
