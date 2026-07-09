// ARF notification parsing

import { ARFNotification, ComplaintSource, COMPLAINT_SOURCES } from './types';

/**
 * Parse ARF (Abuse Reporting Format) notification
 */
export function parseARFNotification(rawMessage: string): ARFNotification | null {
  try {
    // Extract complained address
    const complainedAddress = extractComplainedAddress(rawMessage);
    if (!complainedAddress) return null;

    // Extract source IP
    const sourceIP = extractSourceIP(rawMessage);

    // Extract source domain
    const sourceDomain = extractSourceDomain(rawMessage);

    // Extract arrival date
    const arrivalDate = extractArrivalDate(rawMessage);

    // Extract original headers
    const originalHeaders = extractOriginalHeaders(rawMessage);

    // Determine source from domain
    const source = determineSource(sourceDomain);

    return {
      complained_address: complainedAddress,
      source_ip: sourceIP,
      source_domain: sourceDomain,
      arrival_date: arrivalDate,
      original_headers: originalHeaders,
      source,
    };
  } catch (error) {
    console.error('Failed to parse ARF notification:', error);
    return null;
  }
}

/**
 * Extract complained address from ARF message
 */
function extractComplainedAddress(message: string): string | null {
  const patterns = [
    /(?:Complained|Complaint).*?:\s*<?([^>\s;@]+@[^>\s;]+)/i,
    /(?:Original|Final)-Recipient:\s*<?([^>\s;]+)/i,
    /(?:X-Complaint)\s*:\s*<?([^>\s;]+)/i,
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
 * Extract source IP from ARF message
 */
function extractSourceIP(message: string): string | undefined {
  const patterns = [
    /(?:Source|Sending|Originating)-IP:\s*(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/i,
    /(?:IP|IPs?)(?:\s+Address)?:\s*(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return undefined;
}

/**
 * Extract source domain from ARF message
 */
function extractSourceDomain(message: string): string | undefined {
  const patterns = [
    /(?:Source|Sending|Domain):\s*(\S+)/i,
    /(?:From|Return-Path):\s*<?[^>@]*@([^>\s;]+)/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }

  return undefined;
}

/**
 * Extract arrival date from ARF message
 */
function extractArrivalDate(message: string): string | undefined {
  const match = message.match(/Arrival-Date:\s*(.+)/i);
  return match ? match[1].trim() : undefined;
}

/**
 * Extract original headers from ARF message
 */
function extractOriginalHeaders(message: string): string | undefined {
  const match = message.match(/(?:Original|Received)-Headers?:\s*([\s\S]*?)(?=\n(?:--|\n\n|$))/i);
  return match ? match[1].trim() : undefined;
}

/**
 * Determine complaint source from domain
 */
function determineSource(domain?: string): ComplaintSource {
  if (!domain) return 'unknown';

  const lowerDomain = domain.toLowerCase();
  for (const [pattern, source] of Object.entries(COMPLAINT_SOURCES)) {
    if (lowerDomain.includes(pattern)) {
      return source;
    }
  }

  return 'unknown';
}
