// Unit tests for classifier

import { classifyBounce, shouldSuppress, shouldRetry, getRetryDelayHours, getMaxRetries, checkBounceRateThreshold } from '../classifier';

describe('Classifier', () => {
  describe('classifyBounce', () => {
    it('should classify hard bounce', () => {
      const result = classifyBounce(550);
      expect(result.type).toBe('hard_bounce');
      expect(result.should_suppress).toBe(true);
      expect(result.should_retry).toBe(false);
    });

    it('should classify soft bounce', () => {
      const result = classifyBounce(450);
      expect(result.type).toBe('soft_bounce');
      expect(result.should_suppress).toBe(false);
      expect(result.should_retry).toBe(true);
      expect(result.retry_after_hours).toBe(24);
    });

    it('should classify policy block', () => {
      const result = classifyBounce(550, '5.7.1');
      expect(result.type).toBe('policy_block');
      expect(result.should_suppress).toBe(true);
    });

    it('should classify mailbox full', () => {
      const result = classifyBounce(452, '4.2.2');
      expect(result.type).toBe('mailbox_full');
      expect(result.should_retry).toBe(true);
      expect(result.max_retries).toBe(2);
    });

    it('should classify spam block', () => {
      const result = classifyBounce(521);
      expect(result.type).toBe('spam_block');
      expect(result.should_suppress).toBe(true);
    });

    it('should classify spam block from message', () => {
      const result = classifyBounce(550, undefined, 'Rejected as spam');
      expect(result.type).toBe('spam_block');
    });
  });

  describe('shouldSuppress', () => {
    it('should suppress hard bounces', () => {
      expect(shouldSuppress(550)).toBe(true);
    });

    it('should not suppress soft bounces', () => {
      expect(shouldSuppress(450)).toBe(false);
    });
  });

  describe('shouldRetry', () => {
    it('should retry soft bounces', () => {
      expect(shouldRetry(450)).toBe(true);
    });

    it('should not retry hard bounces', () => {
      expect(shouldRetry(550)).toBe(false);
    });
  });

  describe('getRetryDelayHours', () => {
    it('should return 24 hours for soft bounces', () => {
      expect(getRetryDelayHours(450)).toBe(24);
    });

    it('should return 0 for hard bounces', () => {
      expect(getRetryDelayHours(550)).toBe(0);
    });
  });

  describe('getMaxRetries', () => {
    it('should return 2 for soft bounces', () => {
      expect(getMaxRetries(450)).toBe(2);
    });

    it('should return 0 for hard bounces', () => {
      expect(getMaxRetries(550)).toBe(0);
    });
  });

  describe('checkBounceRateThreshold', () => {
    it('should detect threshold exceeded', () => {
      expect(checkBounceRateThreshold(4, 100)).toBe(true); // 4%
    });

    it('should detect threshold not exceeded', () => {
      expect(checkBounceRateThreshold(2, 100)).toBe(false); // 2%
    });

    it('should handle zero total', () => {
      expect(checkBounceRateThreshold(0, 0)).toBe(false);
    });
  });
});
