// Unit tests for ICP scorer

import { scoreLeadICP, batchScoreLeads, getICPCriteria } from '../icp-scorer';

describe('ICP Scorer', () => {
  describe('scoreLeadICP', () => {
    it('should score qualified lead highly', () => {
      const result = scoreLeadICP({
        id: '1',
        email: 'john@company.com',
        job_title: 'CISO',
        company: 'Cyber Corp',
        industry: 'cybersecurity',
      });

      expect(result.qualified).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(60);
      expect(result.criteria.isDecisionMaker).toBe(true);
    });

    it('should score disqualified lead low', () => {
      const result = scoreLeadICP({
        id: '2',
        email: 'test@example.com',
      });

      expect(result.qualified).toBe(false);
      expect(result.score).toBeLessThan(60);
    });

    it('should detect decision makers', () => {
      const result = scoreLeadICP({
        id: '3',
        email: 'test@company.com',
        job_title: 'Mortgage Broker',
        company: 'ABC Lending',
        industry: 'mortgage',
      });

      expect(result.criteria.isDecisionMaker).toBe(true);
    });

    it('should handle missing job title', () => {
      const result = scoreLeadICP({
        id: '4',
        email: 'test@company.com',
        company: 'Test Corp',
      });

      expect(result.criteria.hasJobTitle).toBe(false);
      expect(result.criteria.isDecisionMaker).toBe(false);
    });

    it('should handle missing company', () => {
      const result = scoreLeadICP({
        id: '5',
        email: 'test@company.com',
        job_title: 'Manager',
      });

      expect(result.criteria.hasCompany).toBe(false);
    });

    it('should provide reason for disqualification', () => {
      const result = scoreLeadICP({
        id: '6',
        email: 'test@example.com',
      });

      expect(result.reason).toBeDefined();
      expect(result.reason).toContain('Missing');
    });
  });

  describe('batchScoreLeads', () => {
    it('should batch score leads', () => {
      const leads = [
        { id: '1', email: 'a@company.com', job_title: 'CISO', company: 'Cyber Inc', industry: 'cybersecurity' as const },
        { id: '2', email: 'b@company.com', job_title: 'CEO', company: 'Tech Corp', industry: 'cybersecurity' as const },
        { id: '3', email: 'c@example.com' },
      ];

      const result = batchScoreLeads(leads);

      expect(result.qualified).toBeGreaterThanOrEqual(2);
      expect(result.disqualified).toBeGreaterThanOrEqual(1);
      expect(result.results).toHaveLength(3);
    });
  });

  describe('getICPCriteria', () => {
    it('should return criteria for industry', () => {
      const criteria = getICPCriteria('cybersecurity');

      expect(criteria.industry).toBe('cybersecurity');
      expect(criteria.requiredCriteria).toHaveLength(4);
      expect(criteria.passThreshold).toBe(60);
    });

    it('should return criteria for mortgage', () => {
      const criteria = getICPCriteria('mortgage');

      expect(criteria.industry).toBe('mortgage');
      expect(criteria.scoringWeights.decision_maker).toBe(30);
    });
  });
});
