// Unit tests for validation pipeline

import { validateLead, validateLeads, updateLeadValidation } from '../pipeline';

// Mock all stage modules
jest.mock('../stages/syntax');
jest.mock('../stages/mx');
jest.mock('../stages/disposable');
jest.mock('../stages/role-based');
jest.mock('../stages/catchall');
jest.mock('../stages/smtp-handshake');
jest.mock('../../db/connection', () => ({
  query: jest.fn(),
}));

import { validateSyntax } from '../stages/syntax';
import { validateMX } from '../stages/mx';
import { validateDisposable } from '../stages/disposable';
import { validateRoleBased } from '../stages/role-based';
import { validateCatchAll } from '../stages/catchall';
import { validateSMTPHandshake } from '../stages/smtp-handshake';
import { query } from '../../db/connection';

const mockValidateSyntax = validateSyntax as jest.MockedFunction<typeof validateSyntax>;
const mockValidateMX = validateMX as jest.MockedFunction<typeof validateMX>;
const mockValidateDisposable = validateDisposable as jest.MockedFunction<typeof validateDisposable>;
const mockValidateRoleBased = validateRoleBased as jest.MockedFunction<typeof validateRoleBased>;
const mockValidateCatchAll = validateCatchAll as jest.MockedFunction<typeof validateCatchAll>;
const mockValidateSMTPHandshake = validateSMTPHandshake as jest.MockedFunction<typeof validateSMTPHandshake>;
const mockQuery = query as jest.MockedFunction<typeof query>;

describe('Validation Pipeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateLead', () => {
    it('should validate a valid email through all stages', async () => {
      // Mock all stages to pass
      mockValidateSyntax.mockReturnValue({
        stage: 'syntax',
        passed: true,
        duration_ms: 1,
      });

      mockValidateMX.mockResolvedValue({
        stage: 'mx',
        passed: true,
        mx_records: [{ priority: 10, exchange: 'mx.example.com' }],
        duration_ms: 50,
      });

      mockValidateDisposable.mockReturnValue({
        stage: 'disposable',
        passed: true,
        duration_ms: 1,
      });

      mockValidateRoleBased.mockReturnValue({
        stage: 'role_based',
        passed: true,
        duration_ms: 1,
      });

      mockValidateCatchAll.mockResolvedValue({
        stage: 'catch_all',
        passed: true,
        catch_all_detected: false,
        duration_ms: 100,
      });

      mockValidateSMTPHandshake.mockResolvedValue({
        stage: 'smtp_handshake',
        passed: true,
        smtp_response: '250 OK',
        duration_ms: 100,
      });

      const result = await validateLead({
        id: 'test-id',
        email: 'user@example.com',
      });

      expect(result.result).toBe('valid');
      expect(result.stages).toHaveLength(6);
      expect(result.stages.every((s) => s.passed)).toBe(true);
    });

    it('should fail at syntax stage for invalid email', async () => {
      mockValidateSyntax.mockReturnValue({
        stage: 'syntax',
        passed: false,
        error: 'Invalid format',
        duration_ms: 1,
      });

      const result = await validateLead({
        id: 'test-id',
        email: 'invalid-email',
      });

      expect(result.result).toBe('invalid');
      expect(result.stages).toHaveLength(1);
      expect(result.stages[0].stage).toBe('syntax');
    });

    it('should fail at MX stage for domain without MX', async () => {
      mockValidateSyntax.mockReturnValue({
        stage: 'syntax',
        passed: true,
        duration_ms: 1,
      });

      mockValidateMX.mockResolvedValue({
        stage: 'mx',
        passed: false,
        error: 'No MX records',
        duration_ms: 50,
      });

      const result = await validateLead({
        id: 'test-id',
        email: 'user@nomx.com',
      });

      expect(result.result).toBe('invalid');
      expect(result.stages).toHaveLength(2);
      expect(result.stages[1].stage).toBe('mx');
    });

    it('should fail at disposable stage for disposable email', async () => {
      mockValidateSyntax.mockReturnValue({
        stage: 'syntax',
        passed: true,
        duration_ms: 1,
      });

      mockValidateMX.mockResolvedValue({
        stage: 'mx',
        passed: true,
        mx_records: [{ priority: 10, exchange: 'mx.mailinator.com' }],
        duration_ms: 50,
      });

      mockValidateDisposable.mockReturnValue({
        stage: 'disposable',
        passed: false,
        error: 'Disposable domain',
        duration_ms: 1,
      });

      const result = await validateLead({
        id: 'test-id',
        email: 'test@mailinator.com',
      });

      expect(result.result).toBe('disposable');
      expect(result.stages).toHaveLength(3);
    });

    it('should fail at role-based stage for role email', async () => {
      mockValidateSyntax.mockReturnValue({
        stage: 'syntax',
        passed: true,
        duration_ms: 1,
      });

      mockValidateMX.mockResolvedValue({
        stage: 'mx',
        passed: true,
        mx_records: [{ priority: 10, exchange: 'mx.example.com' }],
        duration_ms: 50,
      });

      mockValidateDisposable.mockReturnValue({
        stage: 'disposable',
        passed: true,
        duration_ms: 1,
      });

      mockValidateRoleBased.mockReturnValue({
        stage: 'role_based',
        passed: false,
        error: 'Role-based email',
        duration_ms: 1,
      });

      const result = await validateLead({
        id: 'test-id',
        email: 'admin@example.com',
      });

      expect(result.result).toBe('role_based');
      expect(result.stages).toHaveLength(4);
    });

    it('should detect catch-all domains', async () => {
      mockValidateSyntax.mockReturnValue({
        stage: 'syntax',
        passed: true,
        duration_ms: 1,
      });

      mockValidateMX.mockResolvedValue({
        stage: 'mx',
        passed: true,
        mx_records: [{ priority: 10, exchange: 'mx.example.com' }],
        duration_ms: 50,
      });

      mockValidateDisposable.mockReturnValue({
        stage: 'disposable',
        passed: true,
        duration_ms: 1,
      });

      mockValidateRoleBased.mockReturnValue({
        stage: 'role_based',
        passed: true,
        duration_ms: 1,
      });

      mockValidateCatchAll.mockResolvedValue({
        stage: 'catch_all',
        passed: true,
        catch_all_detected: true,
        duration_ms: 100,
      });

      mockValidateSMTPHandshake.mockResolvedValue({
        stage: 'smtp_handshake',
        passed: true,
        smtp_response: '250 OK',
        duration_ms: 100,
      });

      const result = await validateLead({
        id: 'test-id',
        email: 'user@catchall.com',
      });

      expect(result.result).toBe('catch_all');
      expect(result.catch_all_detected).toBe(true);
    });
  });

  describe('validateLeads', () => {
    it('should validate multiple leads', async () => {
      mockValidateSyntax.mockReturnValue({
        stage: 'syntax',
        passed: true,
        duration_ms: 1,
      });

      mockValidateMX.mockResolvedValue({
        stage: 'mx',
        passed: true,
        mx_records: [{ priority: 10, exchange: 'mx.example.com' }],
        duration_ms: 50,
      });

      mockValidateDisposable.mockReturnValue({
        stage: 'disposable',
        passed: true,
        duration_ms: 1,
      });

      mockValidateRoleBased.mockReturnValue({
        stage: 'role_based',
        passed: true,
        duration_ms: 1,
      });

      mockValidateCatchAll.mockResolvedValue({
        stage: 'catch_all',
        passed: true,
        catch_all_detected: false,
        duration_ms: 100,
      });

      mockValidateSMTPHandshake.mockResolvedValue({
        stage: 'smtp_handshake',
        passed: true,
        smtp_response: '250 OK',
        duration_ms: 100,
      });

      const leads = [
        { id: '1', email: 'user1@example.com' },
        { id: '2', email: 'user2@example.com' },
        { id: '3', email: 'user3@example.com' },
      ];

      const results = await validateLeads(leads);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.result === 'valid')).toBe(true);
    });
  });

  describe('updateLeadValidation', () => {
    it('should update lead as valid', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      await updateLeadValidation('lead-id', {
        lead_id: 'lead-id',
        email: 'user@example.com',
        result: 'valid',
        stages: [],
        total_duration_ms: 100,
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE leads'),
        [true, 'valid', 'lead-id']
      );
    });

    it('should update lead as invalid', async () => {
      mockQuery.mockResolvedValue({
        rows: [],
        rowCount: 1,
        command: '',
        oid: 0,
        fields: [],
      });

      await updateLeadValidation('lead-id', {
        lead_id: 'lead-id',
        email: 'user@example.com',
        result: 'invalid',
        stages: [],
        total_duration_ms: 100,
      });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE leads'),
        [false, 'invalid', 'lead-id']
      );
    });
  });
});
