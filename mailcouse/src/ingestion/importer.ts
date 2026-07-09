// Main import orchestrator for Plan 1 — Lead Ingestion

import { randomUUID } from 'crypto';
import { query, transaction } from '../db/connection';
import { normalizeEmail, validateLead } from './validators';
import { checkBatchDuplicates } from './deduplicator';
import {
  Lead,
  LeadImportRequest,
  LeadSource,
  Industry,
  RawLead,
  ImportResult,
  ImportError,
  ImportBatchLog,
} from './types';

/**
 * Main import function — imports a batch of leads into the database
 */
export async function importLeads(request: LeadImportRequest): Promise<ImportResult> {
  const startTime = Date.now();
  const { leads: rawLeads, source, industry: industryOverride } = request;

  const result: ImportResult = {
    total_received: rawLeads.length,
    total_imported: 0,
    total_duplicates: 0,
    total_invalid: 0,
    errors: [],
    imported_leads: [],
  };

  // Step 1: Validate all leads
  const validLeads: RawLead[] = [];
  for (const rawLead of rawLeads) {
    const validation = validateLead(rawLead, source);
    if (validation.valid) {
      // Apply industry override if provided
      if (industryOverride) {
        rawLead.industry = industryOverride;
      }
      validLeads.push(rawLead);
    } else {
      result.total_invalid++;
      result.errors.push({
        email: rawLead.email,
        reason: validation.errors.join('; '),
      });
    }
  }

  // Step 2: Check for duplicates
  const emails = validLeads.map((l) => normalizeEmail(l.email));
  const duplicateResults = await checkBatchDuplicates(emails);

  const uniqueLeads: RawLead[] = [];
  for (const lead of validLeads) {
    const dupResult = duplicateResults.get(lead.email);
    if (dupResult?.is_duplicate) {
      result.total_duplicates++;
      result.errors.push({
        email: lead.email,
        reason: `Duplicate of existing lead ${dupResult.existing_lead_id}`,
      });
    } else {
      uniqueLeads.push(lead);
    }
  }

  // Step 3: Insert unique leads
  if (uniqueLeads.length > 0) {
    const insertedLeads = await insertLeads(uniqueLeads, source);
    result.total_imported = insertedLeads.length;
    result.imported_leads = insertedLeads;
  }

  // Step 4: Log import batch
  const batchLog: ImportBatchLog = {
    id: randomUUID(),
    source,
    industry: industryOverride,
    total_received: rawLeads.length,
    total_imported: result.total_imported,
    total_duplicates: result.total_duplicates,
    total_invalid: result.total_invalid,
    started_at: new Date(startTime),
    completed_at: new Date(),
    duration_ms: Date.now() - startTime,
  };

  await logImportBatch(batchLog);

  return result;
}

/**
 * Insert leads into the database
 */
async function insertLeads(
  leads: RawLead[],
  source: LeadSource
): Promise<Lead[]> {
  const insertedLeads: Lead[] = [];

  // Process in batches of 100
  const batchSize = 100;
  for (let i = 0; i < leads.length; i += batchSize) {
    const batch = leads.slice(i, i + batchSize);

    const values: any[] = [];
    const placeholders: string[] = [];

    for (let j = 0; j < batch.length; j++) {
      const lead = batch[j];
      const offset = j * 11; // 11 fields per lead

      placeholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11})`
      );

      values.push(
        normalizeEmail(lead.email),
        lead.first_name || null,
        lead.last_name || null,
        lead.company || null,
        lead.job_title || null,
        lead.industry || 'cybersecurity',
        lead.pain_point || null,
        source,
        false, // validated
        'pending', // status
        0 // send_count
      );
    }

    const result = await query<Lead>(
      `INSERT INTO leads (email, first_name, last_name, company, job_title, industry, pain_point, source, validated, status, send_count)
       VALUES ${placeholders.join(', ')}
       RETURNING *`,
      values
    );

    insertedLeads.push(...result.rows);
  }

  return insertedLeads;
}

/**
 * Log import batch to database
 */
async function logImportBatch(batch: ImportBatchLog): Promise<void> {
  await query(
    `INSERT INTO import_batches (id, source, industry, total_received, total_imported, total_duplicates, total_invalid, started_at, completed_at, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      batch.id,
      batch.source,
      batch.industry,
      batch.total_received,
      batch.total_imported,
      batch.total_duplicates,
      batch.total_invalid,
      batch.started_at,
      batch.completed_at,
      batch.duration_ms,
    ]
  );
}

/**
 * Import leads from CSV data
 */
export async function importFromCSV(
  csvData: string,
  source: LeadSource,
  industry?: Industry
): Promise<ImportResult> {
  const lines = csvData.trim().split('\n');
  if (lines.length < 2) {
    throw new Error('CSV must have at least a header row and one data row');
  }

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const leads: RawLead[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length !== headers.length) continue;

    const lead: RawLead = {
      email: '',
      industry: industry || 'cybersecurity',
    };

    for (let j = 0; j < headers.length; j++) {
      const value = values[j].trim();
      // Normalize header: remove spaces, underscores, and lowercase
      const normalizedHeader = headers[j].replace(/[\s_-]/g, '');
      switch (normalizedHeader) {
        case 'email':
        case 'emailaddress':
          lead.email = value;
          break;
        case 'firstname':
        case 'first':
          lead.first_name = value || undefined;
          break;
        case 'lastname':
        case 'last':
          lead.last_name = value || undefined;
          break;
        case 'company':
        case 'companyname':
          lead.company = value || undefined;
          break;
        case 'jobtitle':
        case 'title':
          lead.job_title = value || undefined;
          break;
        case 'industry':
          if (['smart_homes', 'mortgage', 'cybersecurity'].includes(value)) {
            lead.industry = value as Industry;
          }
          break;
        case 'pain_point':
        case 'painpoint':
          lead.pain_point = value || undefined;
          break;
      }
    }

    if (lead.email) {
      leads.push(lead);
    }
  }

  return importLeads({ leads, source, industry });
}

/**
 * Parse a CSV line, handling quoted values
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

/**
 * Get import statistics
 */
export async function getImportStats(): Promise<{
  total_leads: number;
  by_industry: { industry: string; count: number }[];
  by_source: { source: string; count: number }[];
  by_status: { status: string; count: number }[];
  recent_batches: ImportBatchLog[];
}> {
  const totalResult = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM leads'
  );

  const industryResult = await query<{ industry: string; count: number }>(
    'SELECT industry, COUNT(*) as count FROM leads GROUP BY industry ORDER BY count DESC'
  );

  const sourceResult = await query<{ source: string; count: number }>(
    'SELECT source, COUNT(*) as count FROM leads GROUP BY source ORDER BY count DESC'
  );

  const statusResult = await query<{ status: string; count: number }>(
    'SELECT status, COUNT(*) as count FROM leads GROUP BY status ORDER BY count DESC'
  );

  const batchResult = await query<ImportBatchLog>(
    'SELECT * FROM import_batches ORDER BY started_at DESC LIMIT 10'
  );

  return {
    total_leads: parseInt(String(totalResult.rows[0]?.count || '0')),
    by_industry: industryResult.rows,
    by_source: sourceResult.rows,
    by_status: statusResult.rows,
    recent_batches: batchResult.rows,
  };
}
