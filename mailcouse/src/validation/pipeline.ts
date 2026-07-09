// Main validation pipeline orchestrator

import { query } from '../db/connection';
import { validateSyntax } from './stages/syntax';
import { validateMX, MXRecord } from './stages/mx';
import { validateDisposable } from './stages/disposable';
import { validateRoleBased } from './stages/role-based';
import { validateCatchAll } from './stages/catchall';
import { validateSMTPHandshake } from './stages/smtp-handshake';
import { PipelineResult, ValidationResult, StageResult, SMTPConfig } from './types';

interface Lead {
  id: string;
  email: string;
}

/**
 * Run a single lead through the full validation pipeline
 */
export async function validateLead(
  lead: Lead,
  config: Partial<SMTPConfig> = {}
): Promise<PipelineResult> {
  const startTime = Date.now();
  const stages: StageResult[] = [];
  let result: ValidationResult = 'invalid';
  let mxRecords: MXRecord[] | undefined;
  let catchAllDetected = false;
  let smtpResponse: string | undefined;

  try {
    // Stage 1: Syntax Check (synchronous, fast)
    const syntaxResult = validateSyntax(lead.email);
    stages.push(syntaxResult);

    if (!syntaxResult.passed) {
      return buildResult(lead, 'invalid', stages, startTime);
    }

    // Stage 2: MX Lookup (async, network call)
    const mxResult = await validateMX(lead.email);
    stages.push(mxResult);

    if (!mxResult.passed) {
      return buildResult(lead, 'invalid', stages, startTime);
    }

    mxRecords = mxResult.mx_records;

    // Stage 3: Disposable Domain Check (synchronous, fast)
    const disposableResult = validateDisposable(lead.email);
    stages.push(disposableResult);

    if (!disposableResult.passed) {
      return buildResult(lead, 'disposable', stages, startTime);
    }

    // Stage 4: Role-Based Detection (synchronous, fast)
    const roleResult = validateRoleBased(lead.email);
    stages.push(roleResult);

    if (!roleResult.passed) {
      return buildResult(lead, 'role_based', stages, startTime);
    }

    // Stage 5: Catch-All Detection (async, SMTP probe)
    const catchAllResult = await validateCatchAll(lead.email, mxRecords || [], config);
    stages.push(catchAllResult);
    catchAllDetected = catchAllResult.catch_all_detected;

    // Stage 6: SMTP Handshake (async, SMTP probe)
    const smtpResult = await validateSMTPHandshake(lead.email, mxRecords || [], config);
    stages.push(smtpResult);
    smtpResponse = smtpResult.smtp_response;

    if (!smtpResult.passed) {
      return buildResult(lead, 'invalid', stages, startTime, mxRecords, catchAllDetected, smtpResponse);
    }

    // All stages passed
    result = catchAllDetected ? 'catch_all' : 'valid';

    return buildResult(lead, result, stages, startTime, mxRecords, catchAllDetected, smtpResponse);
  } catch (error) {
    stages.push({
      stage: 'syntax',
      passed: false,
      error: `Pipeline error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      duration_ms: Date.now() - startTime,
    });

    return buildResult(lead, 'invalid', stages, startTime);
  }
}

/**
 * Validate multiple leads through the pipeline
 */
export async function validateLeads(
  leads: Lead[],
  config: Partial<SMTPConfig> = {}
): Promise<PipelineResult[]> {
  const results: PipelineResult[] = [];

  for (const lead of leads) {
    const result = await validateLead(lead, config);
    results.push(result);
  }

  return results;
}

/**
 * Update lead validation result in database
 */
export async function updateLeadValidation(
  leadId: string,
  result: PipelineResult
): Promise<void> {
  const isValid = result.result === 'valid' || result.result === 'catch_all';

  await query(
    `UPDATE leads
     SET validated = $1,
         validation_result = $2,
         status = CASE WHEN $1 = true THEN 'validated' ELSE 'suppressed' END
     WHERE id = $3`,
    [isValid, result.result, leadId]
  );
}

/**
 * Batch validate and update leads in database
 */
export async function validateAndUpdateLeads(
  leads: Lead[],
  config: Partial<SMTPConfig> = {}
): Promise<{
  total: number;
  valid: number;
  invalid: number;
  disposable: number;
  role_based: number;
  catch_all: number;
}> {
  const results = await validateLeads(leads, config);

  let valid = 0;
  let invalid = 0;
  let disposable = 0;
  let role_based = 0;
  let catch_all = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    await updateLeadValidation(leads[i].id, result);

    switch (result.result) {
      case 'valid':
        valid++;
        break;
      case 'invalid':
        invalid++;
        break;
      case 'disposable':
        disposable++;
        break;
      case 'role_based':
        role_based++;
        break;
      case 'catch_all':
        catch_all++;
        break;
    }
  }

  return {
    total: results.length,
    valid,
    invalid,
    disposable,
    role_based,
    catch_all,
  };
}

/**
 * Build pipeline result object
 */
function buildResult(
  lead: Lead,
  result: ValidationResult,
  stages: StageResult[],
  startTime: number,
  mxRecords?: MXRecord[],
  catchAllDetected?: boolean,
  smtpResponse?: string
): PipelineResult {
  return {
    lead_id: lead.id,
    email: lead.email,
    result,
    stages,
    total_duration_ms: Date.now() - startTime,
    mx_records: mxRecords,
    catch_all_detected: catchAllDetected,
    smtp_response: smtpResponse,
  };
}
