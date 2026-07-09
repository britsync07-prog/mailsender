// Unit tests for payload builder

import { buildJobPayload, serializeJob, deserializeJob, validatePayload } from '../payload-builder';

describe('Payload Builder', () => {
  const mockLead = {
    id: 'lead-1',
    email: 'john@example.com',
    first_name: 'John',
    company: 'Acme Corp',
    industry: 'mortgage',
    pain_point: 'high cac',
    engagement_score: 50,
  };

  const mockSubdomain = {
    id: 'sub-1',
    subdomain: 's4j2.mortgage1.com',
    sender_name: 'Michael Chen',
  };

  const mockIP = {
    id: 'ip-1',
    ip_address: '1.2.3.4',
  };

  describe('buildJobPayload', () => {
    it('should build complete job payload', () => {
      const payload = buildJobPayload(mockLead, mockSubdomain, mockIP, 'template-1');

      expect(payload.job_id).toBeDefined();
      expect(payload.lead_id).toBe('lead-1');
      expect(payload.email).toBe('john@example.com');
      expect(payload.first_name).toBe('John');
      expect(payload.company).toBe('Acme Corp');
      expect(payload.industry).toBe('mortgage');
      expect(payload.subdomain_id).toBe('sub-1');
      expect(payload.subdomain).toBe('s4j2.mortgage1.com');
      expect(payload.ip_id).toBe('ip-1');
      expect(payload.sending_ip).toBe('1.2.3.4');
      expect(payload.template_id).toBe('template-1');
      expect(payload.sender_name).toBe('Michael Chen');
      expect(payload.attempt).toBe(1);
      expect(payload.queued_at).toBeDefined();
    });

    it('should normalize email to lowercase', () => {
      const lead = { ...mockLead, email: 'John@Example.COM' };
      const payload = buildJobPayload(lead, mockSubdomain, mockIP, 'template-1');
      expect(payload.email).toBe('john@example.com');
    });
  });

  describe('serializeJob / deserializeJob', () => {
    it('should serialize and deserialize payload', () => {
      const payload = buildJobPayload(mockLead, mockSubdomain, mockIP, 'template-1');
      const serialized = serializeJob(payload);
      const deserialized = deserializeJob(serialized);

      expect(deserialized).toEqual(payload);
    });
  });

  describe('validatePayload', () => {
    it('should validate correct payload', () => {
      const payload = buildJobPayload(mockLead, mockSubdomain, mockIP, 'template-1');
      const result = validatePayload(payload);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing required fields', () => {
      const result = validatePayload({});
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should detect invalid email', () => {
      const payload = buildJobPayload(mockLead, mockSubdomain, mockIP, 'template-1');
      payload.email = 'invalid';
      const result = validatePayload(payload);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid email format');
    });

    it('should detect invalid attempt number', () => {
      const payload = buildJobPayload(mockLead, mockSubdomain, mockIP, 'template-1');
      payload.attempt = 5;
      const result = validatePayload(payload);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Attempt must be between 1 and 3');
    });
  });
});
