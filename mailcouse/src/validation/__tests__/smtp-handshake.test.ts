// Unit tests for Stage 6: SMTP Handshake

import { validateSMTPHandshake } from '../stages/smtp-handshake';

// Mock the SMTP handshake
jest.mock('../stages/smtp-handshake', () => {
  const original = jest.requireActual('../stages/smtp-handshake');
  return {
    ...original,
    validateSMTPHandshake: jest.fn(),
  };
});

const mockValidateSMTPHandshake = validateSMTPHandshake as jest.MockedFunction<typeof validateSMTPHandshake>;

describe('Stage 6: SMTP Handshake', () => {
  beforeEach(() => {
    mockValidateSMTPHandshake.mockReset();
  });

  describe('SMTP verification', () => {
    it('should verify valid email addresses', async () => {
      mockValidateSMTPHandshake.mockResolvedValue({
        stage: 'smtp_handshake',
        passed: true,
        smtp_response: '250 OK',
        duration_ms: 200,
      });

      const result = await validateSMTPHandshake('user@example.com', [
        { priority: 10, exchange: 'mx.example.com' },
      ]);

      expect(result.passed).toBe(true);
      expect(result.smtp_response).toBe('250 OK');
    });

    it('should reject invalid email addresses', async () => {
      mockValidateSMTPHandshake.mockResolvedValue({
        stage: 'smtp_handshake',
        passed: false,
        error: 'SMTP response: 550 User unknown',
        smtp_response: '550 User unknown',
        duration_ms: 200,
      });

      const result = await validateSMTPHandshake('invalid@example.com', [
        { priority: 10, exchange: 'mx.example.com' },
      ]);

      expect(result.passed).toBe(false);
      expect(result.error).toContain('550');
    });

    it('should handle multiple MX records', async () => {
      mockValidateSMTPHandshake.mockResolvedValue({
        stage: 'smtp_handshake',
        passed: true,
        smtp_response: '250 OK',
        duration_ms: 300,
      });

      const result = await validateSMTPHandshake('user@example.com', [
        { priority: 10, exchange: 'mx1.example.com' },
        { priority: 20, exchange: 'mx2.example.com' },
      ]);

      expect(result.passed).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle no MX records', async () => {
      mockValidateSMTPHandshake.mockResolvedValue({
        stage: 'smtp_handshake',
        passed: false,
        error: 'No MX records available',
        duration_ms: 10,
      });

      const result = await validateSMTPHandshake('user@example.com', []);

      expect(result.passed).toBe(false);
      expect(result.error).toContain('No MX records');
    });

    it('should handle connection timeout', async () => {
      mockValidateSMTPHandshake.mockResolvedValue({
        stage: 'smtp_handshake',
        passed: false,
        error: 'Connection timeout',
        duration_ms: 10000,
      });

      const result = await validateSMTPHandshake('user@example.com', [
        { priority: 10, exchange: 'mx.example.com' },
      ]);

      expect(result.passed).toBe(false);
    });

    it('should handle connection refused', async () => {
      mockValidateSMTPHandshake.mockResolvedValue({
        stage: 'smtp_handshake',
        passed: false,
        error: 'Connection refused',
        duration_ms: 100,
      });

      const result = await validateSMTPHandshake('user@example.com', [
        { priority: 10, exchange: 'mx.example.com' },
      ]);

      expect(result.passed).toBe(false);
    });
  });

  describe('result properties', () => {
    it('should include stage name', async () => {
      mockValidateSMTPHandshake.mockResolvedValue({
        stage: 'smtp_handshake',
        passed: true,
        duration_ms: 100,
      });

      const result = await validateSMTPHandshake('user@example.com', [
        { priority: 10, exchange: 'mx.example.com' },
      ]);

      expect(result.stage).toBe('smtp_handshake');
    });

    it('should include duration', async () => {
      mockValidateSMTPHandshake.mockResolvedValue({
        stage: 'smtp_handshake',
        passed: true,
        duration_ms: 250,
      });

      const result = await validateSMTPHandshake('user@example.com', [
        { priority: 10, exchange: 'mx.example.com' },
      ]);

      expect(result.duration_ms).toBe(250);
    });

    it('should include SMTP response when available', async () => {
      mockValidateSMTPHandshake.mockResolvedValue({
        stage: 'smtp_handshake',
        passed: true,
        smtp_response: '250 2.1.5 Ok',
        duration_ms: 150,
      });

      const result = await validateSMTPHandshake('user@example.com', [
        { priority: 10, exchange: 'mx.example.com' },
      ]);

      expect(result.smtp_response).toBe('250 2.1.5 Ok');
    });
  });
});
