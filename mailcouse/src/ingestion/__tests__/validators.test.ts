// Unit tests for validators.ts

import { validateLead, isRoleBasedEmail, normalizeEmail, validateBatch } from '../validators';
import { RawLead, LeadSource } from '../types';

describe('Validators', () => {
  describe('validateLead', () => {
    const validLead: RawLead = {
      email: 'john.doe@acme.com',
      first_name: 'John',
      last_name: 'Doe',
      company: 'Acme Corp',
      job_title: 'CTO',
      industry: 'cybersecurity',
      pain_point: 'High customer acquisition cost',
    };

    const validSource: LeadSource = 'prospeo';

    it('should validate a correct lead', () => {
      const result = validateLead(validLead, validSource);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject lead without email', () => {
      const lead = { ...validLead, email: '' };
      const result = validateLead(lead, validSource);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Email is required');
    });

    it('should reject invalid email format', () => {
      const lead = { ...validLead, email: 'not-an-email' };
      const result = validateLead(lead, validSource);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Invalid email format'))).toBe(true);
    });

    it('should reject lead without industry', () => {
      const lead = { ...validLead, industry: undefined as any };
      const result = validateLead(lead, validSource);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Industry is required');
    });

    it('should reject invalid industry', () => {
      const lead = { ...validLead, industry: 'invalid' as any };
      const result = validateLead(lead, validSource);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Invalid industry'))).toBe(true);
    });

    it('should accept all valid industries', () => {
      const industries = ['smart_homes', 'mortgage', 'cybersecurity'] as const;
      for (const industry of industries) {
        const lead = { ...validLead, industry };
        const result = validateLead(lead, validSource);
        expect(result.valid).toBe(true);
      }
    });

    it('should warn about free email providers', () => {
      const lead = { ...validLead, email: 'john@gmail.com' };
      const result = validateLead(lead, validSource);
      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.includes('free provider'))).toBe(true);
    });

    it('should reject email exceeding max length', () => {
      const longEmail = 'a'.repeat(310) + '@example.com'; // 322 characters total
      const lead = { ...validLead, email: longEmail };
      const result = validateLead(lead, validSource);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('maximum length'))).toBe(true);
    });

    it('should reject first_name exceeding max length', () => {
      const lead = { ...validLead, first_name: 'a'.repeat(101) };
      const result = validateLead(lead, validSource);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('First name'))).toBe(true);
    });

    it('should accept lead with minimal fields', () => {
      const minimalLead: RawLead = {
        email: 'test@example.com',
        industry: 'cybersecurity',
      };
      const result = validateLead(minimalLead, validSource);
      expect(result.valid).toBe(true);
    });
  });

  describe('isRoleBasedEmail', () => {
    it('should detect exact role-based prefixes', () => {
      expect(isRoleBasedEmail('admin@company.com')).toBe(true);
      expect(isRoleBasedEmail('info@company.com')).toBe(true);
      expect(isRoleBasedEmail('support@company.com')).toBe(true);
      expect(isRoleBasedEmail('noreply@company.com')).toBe(true);
      expect(isRoleBasedEmail('sales@company.com')).toBe(true);
    });

    it('should detect role-based prefixes with separators', () => {
      expect(isRoleBasedEmail('admin-team@company.com')).toBe(true);
      expect(isRoleBasedEmail('support.help@company.com')).toBe(true);
    });

    it('should not detect personal emails as role-based', () => {
      expect(isRoleBasedEmail('john.doe@company.com')).toBe(false);
      expect(isRoleBasedEmail('jane@company.com')).toBe(false);
    });

    it('should handle case insensitivity', () => {
      expect(isRoleBasedEmail('ADMIN@company.com')).toBe(true);
      expect(isRoleBasedEmail('INFO@company.com')).toBe(true);
    });
  });

  describe('normalizeEmail', () => {
    it('should lowercase email', () => {
      expect(normalizeEmail('John.Doe@Example.COM')).toBe('john.doe@example.com');
    });

    it('should trim whitespace', () => {
      expect(normalizeEmail('  test@example.com  ')).toBe('test@example.com');
    });
  });

  describe('validateBatch', () => {
    const source: LeadSource = 'prospeo';

    it('should separate valid and invalid leads', () => {
      const leads: RawLead[] = [
        { email: 'valid@example.com', industry: 'cybersecurity' },
        { email: 'invalid-email', industry: 'cybersecurity' },
        { email: 'another@example.com', industry: 'mortgage' },
      ];

      const result = validateBatch(leads, source);
      expect(result.valid).toHaveLength(2);
      expect(result.invalid).toHaveLength(1);
    });

    it('should return empty arrays for empty input', () => {
      const result = validateBatch([], source);
      expect(result.valid).toHaveLength(0);
      expect(result.invalid).toHaveLength(0);
    });
  });
});
