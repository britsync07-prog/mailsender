// AI-powered reply classification

import { ReplyClassification, ClassificationResult, CLASSIFICATION_KEYWORDS } from './types';

/**
 * Classify reply using keyword matching (fallback for no AI)
 */
export function classifyReply(
  subject: string,
  body: string
): ClassificationResult {
  const lowerSubject = subject.toLowerCase();
  const lowerBody = body.toLowerCase();
  const combined = `${lowerSubject} ${lowerBody}`;

  // Priority order: unsubscribe > negative > positive > neutral > ooo > bounce
  const priorityOrder: ReplyClassification[] = [
    'unsubscribe',
    'negative',
    'positive',
    'neutral',
    'ooo',
    'bounce',
  ];

  for (const classification of priorityOrder) {
    const keywords = CLASSIFICATION_KEYWORDS[classification];
    if (!keywords || keywords.length === 0) continue;

    let matchCount = 0;
    for (const keyword of keywords) {
      if (combined.includes(keyword.toLowerCase())) {
        matchCount++;
      }
    }

    if (matchCount > 0) {
      const confidence = Math.min(matchCount / keywords.length, 1);
      return {
        classification,
        confidence,
        reasoning: `Matched ${matchCount} keyword(s) for ${classification}`,
      };
    }
  }

  return {
    classification: 'unknown',
    confidence: 0,
    reasoning: 'No keyword matches found',
  };
}

/**
 * Check if reply is an unsubscribe request
 */
export function isUnsubscribeRequest(subject: string, body: string): boolean {
  const result = classifyReply(subject, body);
  return result.classification === 'unsubscribe';
}

/**
 * Check if reply is positive
 */
export function isPositiveReply(subject: string, body: string): boolean {
  const result = classifyReply(subject, body);
  return result.classification === 'positive';
}

/**
 * Check if reply is out of office
 */
export function isOutOfOffice(subject: string, body: string): boolean {
  const result = classifyReply(subject, body);
  return result.classification === 'ooo';
}
