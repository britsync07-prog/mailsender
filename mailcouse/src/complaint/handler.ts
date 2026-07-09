// Main complaint receiver

import { query } from '../db/connection';
import { parseARFNotification } from './arf-parser';
import { ComplaintData, ComplaintSource, COMPLAINT_THRESHOLDS } from './types';
import { updateDomainComplaintRate, shouldRetireDomain, retireDomain } from './domain-evaluator';

/**
 * Process a single complaint
 */
export async function processComplaint(
  rawMessage: string
): Promise<{
  processed: boolean;
  suppressed: boolean;
  domain_retired: boolean;
  error?: string;
}> {
  try {
    // Parse ARF notification
    const arf = parseARFNotification(rawMessage);
    if (!arf) {
      return {
        processed: false,
        suppressed: false,
        domain_retired: false,
        error: 'Failed to parse ARF notification',
      };
    }

    // Create complaint data
    const complaintData: ComplaintData = {
      complained_address: arf.complained_address,
      source_ip: arf.source_ip,
      source_domain: arf.source_domain,
      source: arf.source,
      timestamp: new Date(),
    };

    // Suppress the complained address
    const suppressed = await suppressComplaintAddress(complaintData);

    // Log complaint
    await logComplaint(complaintData);

    // Update subdomain complaint count
    if (complaintData.subdomain_id) {
      await query(
        'UPDATE subdomains SET complaint_count = complaint_count + 1 WHERE id = $1',
        [complaintData.subdomain_id]
      );
    }

    // Check if domain should be retired
    let domainRetired = false;
    if (complaintData.source_domain) {
      const domainResult = await query<{ id: string }>(
        'SELECT id FROM domains WHERE domain = $1',
        [complaintData.source_domain]
      );

      if (domainResult.rows.length > 0) {
        const domainId = domainResult.rows[0].id;

        // Update complaint rate
        await updateDomainComplaintRate(domainId);

        // Check retirement threshold
        const retirementCheck = await shouldRetireDomain(domainId);
        if (retirementCheck.should_retire) {
          await retireDomain(domainId, 'Complaint rate exceeded 0.1%');
          domainRetired = true;
        }
      }
    }

    return {
      processed: true,
      suppressed,
      domain_retired: domainRetired,
    };
  } catch (error) {
    return {
      processed: false,
      suppressed: false,
      domain_retired: false,
      error: error instanceof Error ? error.message : 'Processing failed',
    };
  }
}

/**
 * Suppress complained address
 */
async function suppressComplaintAddress(complaint: ComplaintData): Promise<boolean> {
  try {
    await query(
      `INSERT INTO suppression_list (id, email, reason, suppressed_at, source_subdomain_id)
       VALUES (uuid_generate_v4(), $1, 'spam_complaint', NOW(), $2)
       ON CONFLICT (email) DO NOTHING`,
      [complaint.complained_address.toLowerCase(), complaint.subdomain_id || null]
    );

    return true;
  } catch (error) {
    console.error('Failed to suppress complaint address:', error);
    return false;
  }
}

/**
 * Log complaint event
 */
async function logComplaint(complaint: ComplaintData): Promise<void> {
  await query(
    `INSERT INTO complaint_events (id, complained_address, source_ip, source_domain, source, subdomain_id, timestamp)
     VALUES (uuid_generate_v4(), $1, $2, $3, $4, $5, $6)`,
    [
      complaint.complained_address,
      complaint.source_ip || null,
      complaint.source_domain || null,
      complaint.source,
      complaint.subdomain_id || null,
      complaint.timestamp,
    ]
  );
}

/**
 * Process batch of complaints
 */
export async function processComplaintBatch(
  messages: string[]
): Promise<{
  total: number;
  processed: number;
  suppressed: number;
  domains_retired: number;
  errors: { index: number; error: string }[];
}> {
  let processed = 0;
  let suppressed = 0;
  let domainsRetired = 0;
  const errors: { index: number; error: string }[] = [];

  for (let i = 0; i < messages.length; i++) {
    const result = await processComplaint(messages[i]);

    if (result.processed) {
      processed++;
      if (result.suppressed) suppressed++;
      if (result.domain_retired) domainsRetired++;
    } else {
      errors.push({ index: i, error: result.error || 'Unknown error' });
    }
  }

  return {
    total: messages.length,
    processed,
    suppressed,
    domains_retired: domainsRetired,
    errors,
  };
}

/**
 * Get complaint statistics
 */
export async function getComplaintStats(): Promise<{
  total_complaints: number;
  by_source: { source: string; count: number }[];
  recent_complaints: { address: string; source: string; timestamp: Date }[];
}> {
  const totalResult = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM complaint_events'
  );

  const sourceResult = await query<{ source: string; count: number }>(
    'SELECT source, COUNT(*) as count FROM complaint_events GROUP BY source'
  );

  const recentResult = await query<{ complained_address: string; source: string; timestamp: Date }>(
    'SELECT complained_address, source, timestamp FROM complaint_events ORDER BY timestamp DESC LIMIT 10'
  );

  return {
    total_complaints: parseInt(String(totalResult.rows[0]?.count || '0')),
    by_source: sourceResult.rows.map((r) => ({
      source: r.source,
      count: parseInt(String(r.count)),
    })),
    recent_complaints: recentResult.rows.map((r) => ({
      address: r.complained_address,
      source: r.source,
      timestamp: r.timestamp,
    })),
  };
}
