// Unit tests for Stage 4: Role-Based Detection

import { validateRoleBased, isRoleBased, getRolePrefixes } from '../stages/role-based';

describe('Stage 4: Role-Based Detection', () => {
  describe('role-based email detection', () => {
    const roleBasedEmails = [
      'admin@company.com',
      'info@business.org',
      'support@service.com',
      'noreply@system.net',
      'sales@company.com',
      'webmaster@site.com',
      'postmaster@mail.com',
      'hostmaster@domain.com',
      'abuse@provider.com',
      'noc@network.com',
      'security@firm.com',
      'billing@service.com',
      'help@company.com',
      'office@business.com',
      'hr@company.com',
      'marketing@brand.com',
      'press@media.com',
      'legal@firm.com',
      'team@startup.com',
      'staff@org.com',
    ];

    it.each(roleBasedEmails)('should detect role-based: %s', (email) => {
      const result = validateRoleBased(email);
      expect(result.passed).toBe(false);
      expect(result.error).toContain('Role-based');
    });
  });

  describe('role-based with separators', () => {
    const roleBasedWithSeparators = [
      'admin-team@company.com',
      'support.help@service.com',
      'info.dept@business.org',
      'sales.us@company.com',
      'noreply-system@domain.com',
    ];

    it.each(roleBasedWithSeparators)('should detect: %s', (email) => {
      const result = validateRoleBased(email);
      expect(result.passed).toBe(false);
    });
  });

  describe('non-role-based emails', () => {
    const nonRoleBasedEmails = [
      'john@company.com',
      'jane.doe@business.org',
      'mike123@service.com',
      'sarah@startup.io',
      'alex.smith@corp.com',
    ];

    it.each(nonRoleBasedEmails)('should accept: %s', (email) => {
      const result = validateRoleBased(email);
      expect(result.passed).toBe(true);
    });
  });

  describe('isRoleBased', () => {
    it('should return true for known role prefixes', () => {
      expect(isRoleBased('admin')).toBe(true);
      expect(isRoleBased('info')).toBe(true);
      expect(isRoleBased('support')).toBe(true);
    });

    it('should return false for personal names', () => {
      expect(isRoleBased('john')).toBe(false);
      expect(isRoleBased('jane')).toBe(false);
    });

    it('should handle case insensitivity', () => {
      expect(isRoleBased('ADMIN')).toBe(true);
      expect(isRoleBased('INFO')).toBe(true);
    });
  });

  describe('getRolePrefixes', () => {
    it('should return list of role prefixes', () => {
      const prefixes = getRolePrefixes();
      expect(prefixes.length).toBeGreaterThan(20);
      expect(prefixes).toContain('admin');
      expect(prefixes).toContain('info');
      expect(prefixes).toContain('support');
    });
  });

  describe('performance', () => {
    it('should complete check in under 5ms', () => {
      const start = Date.now();
      validateRoleBased('test@example.com');
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(5);
    });
  });

  describe('edge cases', () => {
    it('should handle invalid email format', () => {
      const result = validateRoleBased('notanemail');
      expect(result.passed).toBe(false);
      expect(result.error).toContain('Invalid email');
    });

    it('should handle empty email', () => {
      const result = validateRoleBased('');
      expect(result.passed).toBe(false);
    });
  });
});
