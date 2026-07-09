// Unit tests for classifier

import { classifyReply, isUnsubscribeRequest, isPositiveReply, isOutOfOffice } from '../classifier';

describe('Classifier', () => {
  describe('classifyReply', () => {
    it('should classify positive reply', () => {
      const result = classifyReply('Re: Meeting', 'I am interested in your offer. Let us schedule a call.');
      expect(result.classification).toBe('positive');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should classify neutral reply', () => {
      const result = classifyReply('Question', 'What are your pricing options?');
      expect(result.classification).toBe('neutral');
    });

    it('should classify negative reply', () => {
      const result = classifyReply('Re: Offer', 'Not for me. Not now. Not a fit for our company.');
      expect(result.classification).toBe('negative');
    });

    it('should classify unsubscribe', () => {
      const result = classifyReply('Re: Offer', 'Unsubscribe me from this list. Remove me.');
      expect(result.classification).toBe('unsubscribe');
    });

    it('should classify out of office', () => {
      const result = classifyReply('Auto-Reply', 'I am out of office until next week.');
      expect(result.classification).toBe('ooo');
    });

    it('should return unknown for unmatched content', () => {
      const result = classifyReply('Random Subject', 'Random content without keywords.');
      expect(result.classification).toBe('unknown');
    });
  });

  describe('isUnsubscribeRequest', () => {
    it('should detect unsubscribe requests', () => {
      expect(isUnsubscribeRequest('Re: Offer', 'Unsubscribe me from list. Remove me.')).toBe(true);
    });

    it('should not detect non-unsubscribe replies', () => {
      expect(isUnsubscribeRequest('Re: Meeting', 'Sounds good')).toBe(false);
    });
  });

  describe('isPositiveReply', () => {
    it('should detect positive replies', () => {
      expect(isPositiveReply('Re: Offer', 'I am interested')).toBe(true);
    });

    it('should not detect non-positive replies', () => {
      expect(isPositiveReply('Unsubscribe', 'Remove me')).toBe(false);
    });
  });

  describe('isOutOfOffice', () => {
    it('should detect out of office replies', () => {
      expect(isOutOfOffice('Auto-Reply', 'I am out of office')).toBe(true);
    });

    it('should not detect non-ooo replies', () => {
      expect(isOutOfOffice('Re: Meeting', 'Let us talk')).toBe(false);
    });
  });
});
