// Batch processing with concurrency control

import { validateLead, validateLeads, updateLeadValidation } from './pipeline';
import { PipelineResult, SMTPConfig } from './types';

interface Lead {
  id: string;
  email: string;
}

interface BatchOptions {
  concurrency: number;
  batchSize: number;
  onProgress?: (completed: number, total: number) => void;
  onBatchComplete?: (batchIndex: number, results: PipelineResult[]) => void;
}

const DEFAULT_OPTIONS: BatchOptions = {
  concurrency: 10,
  batchSize: 100,
};

/**
 * Process a batch of leads with concurrency control
 */
export async function processBatch(
  leads: Lead[],
  options: Partial<BatchOptions> = {},
  config: Partial<SMTPConfig> = {}
): Promise<{
  results: PipelineResult[];
  stats: {
    total: number;
    valid: number;
    invalid: number;
    disposable: number;
    role_based: number;
    catch_all: number;
    duration_ms: number;
  };
}> {
  const startTime = Date.now();
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const results: PipelineResult[] = [];

  // Split into batches
  const batches: Lead[][] = [];
  for (let i = 0; i < leads.length; i += opts.batchSize) {
    batches.push(leads.slice(i, i + opts.batchSize));
  }

  // Process batches with concurrency control
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];

    // Process batch with concurrency limit
    const batchResults = await processWithConcurrency(
      batch,
      opts.concurrency,
      config
    );

    results.push(...batchResults);

    // Update database for each result
    for (let i = 0; i < batch.length; i++) {
      await updateLeadValidation(batch[i].id, batchResults[i]);
    }

    // Report progress
    if (opts.onProgress) {
      opts.onProgress(results.length, leads.length);
    }

    if (opts.onBatchComplete) {
      opts.onBatchComplete(batchIndex, batchResults);
    }
  }

  // Calculate stats
  const stats = calculateStats(results, Date.now() - startTime);

  return { results, stats };
}

/**
 * Process items with concurrency limit
 */
async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  config: Partial<SMTPConfig>
): Promise<PipelineResult[]> {
  const results: PipelineResult[] = new Array(items.length);
  let nextIndex = 0;

  async function processNext(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index] as Lead;

      try {
        results[index] = await validateLead(item, config);
      } catch (error) {
        results[index] = {
          lead_id: item.id,
          email: item.email,
          result: 'invalid',
          stages: [],
          total_duration_ms: 0,
        };
      }
    }
  }

  // Create workers
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(processNext());
  }

  await Promise.all(workers);
  return results;
}

/**
 * Calculate validation statistics
 */
function calculateStats(
  results: PipelineResult[],
  totalDurationMs: number
): {
  total: number;
  valid: number;
  invalid: number;
  disposable: number;
  role_based: number;
  catch_all: number;
  duration_ms: number;
} {
  let valid = 0;
  let invalid = 0;
  let disposable = 0;
  let role_based = 0;
  let catch_all = 0;

  for (const result of results) {
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
    duration_ms: totalDurationMs,
  };
}

/**
 * Stream process large datasets in chunks
 */
export async function* streamProcess(
  leads: Lead[],
  chunkSize: number = 100,
  config: Partial<SMTPConfig> = {}
): AsyncGenerator<{
  chunk: PipelineResult[];
  progress: { completed: number; total: number };
}> {
  const total = leads.length;

  for (let i = 0; i < total; i += chunkSize) {
    const chunk = leads.slice(i, i + chunkSize);
    const results = await validateLeads(chunk, config);

    // Update database
    for (let j = 0; j < chunk.length; j++) {
      await updateLeadValidation(chunk[j].id, results[j]);
    }

    yield {
      chunk: results,
      progress: { completed: Math.min(i + chunkSize, total), total },
    };
  }
}
