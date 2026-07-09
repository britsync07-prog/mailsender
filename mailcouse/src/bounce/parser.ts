// Bounce message parsing (go-sisimai patterns)

import { ParsedBounce } from './types';

/**
 * Parse bounce message from raw email
 * Implements go-sisimai-style parsing patterns
 */
export function parseBounceMessage(rawMessage: string): ParsedBounce | null {
  try {
  // Extract recipient from bounce
  const recipient = extractRecipient(rawMessage) || 'unknown@unknown.com';

    // Extract sender
    const sender = extractSender(rawMessage);

    // Extract SMTP code
    const smtpCode = extractSMTPCode(rawMessage);

    // Extract diagnostic code
    const diagnosticCode = extractDiagnosticCode(rawMessage);

    // Extract message
    const message = extractMessage(rawMessage);

    // Extract MTA type
    const mtaType = extractMTAType(rawMessage);

    // Extract action
    const action = extractAction(rawMessage);

    // Extract status
    const status = extractStatus(rawMessage);

    return {
      recipient,
      sender,
      smtp_code: smtpCode,
      message,
      diagnostic_code: diagnosticCode,
      mta_type: mtaType,
      action,
      status,
    };
  } catch (error) {
    console.error('Failed to parse bounce message:', error);
    return null;
  }
}

/**
 * Extract recipient from bounce message
 */
function extractRecipient(message: string): string | null {
  // Try various patterns for recipient extraction
  const patterns = [
    /Original-Recipient:\s*<?([^>\s;]+)/i,
    /Final-Recipient:\s*<?([^>\s;]+)/i,
    /X-Failed-Recipients:\s*<?([^>\s;]+)/i,
    /<([^>]+)>.*(?:undeliverable|delivery failed|bounce)/i,
    /(?:undeliverable|delivery failed).*<([^>]+)>/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * Extract sender from bounce message
 */
function extractSender(message: string): string {
  const patterns = [
    /From:\s*<?([^>\s;]+)/i,
    /Return-Path:\s*<?([^>\s;]+)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return '';
}

/**
 * Extract SMTP code from bounce message
 */
function extractSMTPCode(message: string): number {
  // Look for SMTP error codes
  const patterns = [
    /(?:SMTP|smtp)\s+(?:error\s+)?(\d{3})/i,
    /(?:failed|failure|error)\s+(?:with\s+)?(?:code\s+)?(\d{3})/i,
    /(\d{3})\s+(?:\d\.\d\.\d\s+)?(?:User|Mailbox|Message|Service)/i,
    /^(\d{3})\s/gm,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      const code = parseInt(match[1], 10);
      if (code >= 400 && code <= 599) {
        return code;
      }
    }
  }

  return 0;
}

/**
 * Extract diagnostic code (e.g., 5.1.1)
 */
function extractDiagnosticCode(message: string): string | undefined {
  const match = message.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : undefined;
}

/**
 * Extract bounce message text
 */
function extractMessage(message: string): string {
  // Try to extract the main bounce description
  const patterns = [
    /(?:Diagnostic-Code|Message):\s*(.+)/i,
    /(?:Status|Action):\s*(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return match[1].trim().substring(0, 500);
    }
  }

  // Fallback: first 500 characters
  return message.substring(0, 500).replace(/\n/g, ' ').trim();
}

/**
 * Extract MTA type
 */
function extractMTAType(message: string): string | undefined {
  const patterns = [
    /X-Mailer:\s*(.+)/i,
    /Received:\s*from\s+(\S+)/i,
    /(?:Postfix|Sendmail|Exim|Exchange|Gmail)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return match[1]?.trim();
    }
  }

  return undefined;
}

/**
 * Extract action
 */
function extractAction(message: string): string | undefined {
  const match = message.match(/Action:\s*(.+)/i);
  return match ? match[1].trim() : undefined;
}

/**
 * Extract status
 */
function extractStatus(message: string): string | undefined {
  const match = message.match(/Status:\s*(.+)/i);
  return match ? match[1].trim() : undefined;
}
