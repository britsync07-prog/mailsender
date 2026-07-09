// CRM integration for positive replies

import { query } from '../db/connection';
import { CRMForwardPayload } from './types';

/**
 * Forward positive reply to CRM
 */
export async function forwardToCRM(
  payload: CRMForwardPayload
): Promise<{ success: boolean; crm_entry_id?: string; error?: string }> {
  try {
    // Check for duplicate CRM entry
    const existing = await query<{ id: string }>(
      `SELECT id FROM crm_entries
       WHERE lead_id = $1 AND reply_timestamp = $2`,
      [payload.lead_id, payload.reply_timestamp]
    );

    if (existing.rows.length > 0) {
      return {
        success: true,
        crm_entry_id: existing.rows[0].id,
      };
    }

    // Insert into CRM entries table
    const result = await query<{ id: string }>(
      `INSERT INTO crm_entries
       (id, lead_id, lead_email, lead_name, lead_company, reply_subject, reply_body, reply_from, reply_timestamp, subdomain_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
       RETURNING id`,
      [
        randomUUID(),
        payload.lead_id,
        payload.lead_email,
        payload.lead_name || null,
        payload.lead_company || null,
        payload.reply_subject,
        payload.reply_body,
        payload.reply_from,
        payload.reply_timestamp,
        payload.subdomain_id || null,
      ]
    );

    return {
      success: true,
      crm_entry_id: result.rows[0]?.id,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'CRM forward failed',
    };
  }
}

/**
 * Get CRM entries for a lead
 */
export async function getCRMEntries(
  leadId: string
): Promise<{
  id: string;
  reply_subject: string;
  reply_body: string;
  reply_from: string;
  reply_timestamp: Date;
}[]> {
  const result = await query<{
    id: string;
    reply_subject: string;
    reply_body: string;
    reply_from: string;
    reply_timestamp: Date;
  }>(
    `SELECT id, reply_subject, reply_body, reply_from, reply_timestamp
     FROM crm_entries
     WHERE lead_id = $1
     ORDER BY reply_timestamp DESC`,
    [leadId]
  );

  return result.rows;
}

/**
 * Get recent CRM entries
 */
export async function getRecentCRMEntries(
  limit: number = 50
): Promise<{
  id: string;
  lead_email: string;
  lead_name?: string;
  reply_subject: string;
  reply_timestamp: Date;
}[]> {
  const result = await query<{
    id: string;
    lead_email: string;
    lead_name?: string;
    reply_subject: string;
    reply_timestamp: Date;
  }>(
    `SELECT id, lead_email, lead_name, reply_subject, reply_timestamp
     FROM crm_entries
     ORDER BY reply_timestamp DESC
     LIMIT $1`,
    [limit]
  );

  return result.rows;
}

/**
 * Get CRM statistics
 */
export async function getCRMStats(): Promise<{
  total_forwards: number;
  by_lead: number;
  today_forwards: number;
}> {
  const totalResult = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM crm_entries'
  );

  const leadResult = await query<{ count: number }>(
    'SELECT COUNT(DISTINCT lead_id) as count FROM crm_entries'
  );

  const todayResult = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM crm_entries WHERE created_at >= CURRENT_DATE"
  );

  return {
    total_forwards: parseInt(String(totalResult.rows[0]?.count || '0')),
    by_lead: parseInt(String(leadResult.rows[0]?.count || '0')),
    today_forwards: parseInt(String(todayResult.rows[0]?.count || '0')),
  };
}

function randomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
