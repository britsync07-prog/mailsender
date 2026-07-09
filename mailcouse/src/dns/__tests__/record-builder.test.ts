import { buildSPFRecord, buildDMARCRecord, buildDKIMRecordSpec } from '../record-builder';

describe('DNS Record Builder', () => {
  describe('buildSPFRecord', () => {
    it('should build SPF record with IPs', () => {
      const record = buildSPFRecord('example.com', {
        ipAddresses: ['1.2.3.4', '5.6.7.8'],
        policy: '~all',
      });

      expect(record.name).toBe('example.com');
      expect(record.type).toBe('TXT');
      expect(record.content).toContain('v=spf1');
      expect(record.content).toContain('ip4:1.2.3.4');
      expect(record.content).toContain('ip4:5.6.7.8');
      expect(record.content).toContain('~all');
    });

    it('should build SPF record with include domains', () => {
      const record = buildSPFRecord('example.com', {
        ipAddresses: [],
        includeDomains: ['_spf.google.com'],
        policy: '-all',
      });

      expect(record.content).toContain('include:_spf.google.com');
      expect(record.content).toContain('-all');
    });

    it('should default to softfail', () => {
      const record = buildSPFRecord('example.com', { ipAddresses: [], policy: '~all' });
      expect(record.content).toContain('~all');
    });

    it('should set TTL to 300', () => {
      const record = buildSPFRecord('example.com', { ipAddresses: [], policy: '~all' });
      expect(record.ttl).toBe(300);
    });
  });

  describe('buildDMARCRecord', () => {
    it('should build DMARC record with reject policy', () => {
      const record = buildDMARCRecord('example.com', { policy: 'reject' });

      expect(record.name).toBe('_dmarc.example.com');
      expect(record.type).toBe('TXT');
      expect(record.content).toContain('v=DMARC1');
      expect(record.content).toContain('p=reject');
    });

    it('should build DMARC record with all options', () => {
      const record = buildDMARCRecord('example.com', {
        policy: 'quarantine',
        subdomainPolicy: 'quarantine',
        aggregateReportUri: 'dmarc@example.com',
        forensicReportUri: 'dmarc-forensic@example.com',
        percentage: 50,
        alignmentDkim: 'r',
        alignmentSpf: 's',
      });

      expect(record.content).toContain('p=quarantine');
      expect(record.content).toContain('sp=quarantine');
      expect(record.content).toContain('rua=mailto:dmarc@example.com');
      expect(record.content).toContain('ruf=mailto:dmarc-forensic@example.com');
      expect(record.content).toContain('pct=50');
      expect(record.content).toContain('adkim=r');
      expect(record.content).toContain('aspf=s');
    });

    it('should build DMARC record with none policy', () => {
      const record = buildDMARCRecord('example.com', { policy: 'none' });
      expect(record.content).toContain('p=none');
    });

    it('should omit optional fields when not provided', () => {
      const record = buildDMARCRecord('example.com', { policy: 'none' });
      expect(record.content).not.toContain('sp=');
      expect(record.content).not.toContain('rua=');
      expect(record.content).not.toContain('pct=');
    });
  });

  describe('buildDKIMRecordSpec', () => {
    it('should build DKIM DNS record spec', () => {
      const record = buildDKIMRecordSpec('example.com', 's1', 'base64publickey');

      expect(record.name).toBe('s1._domainkey.example.com');
      expect(record.type).toBe('TXT');
      expect(record.content).toBe('v=DKIM1; k=rsa; p=base64publickey');
      expect(record.ttl).toBe(300);
    });
  });
});
