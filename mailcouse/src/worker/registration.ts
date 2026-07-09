// Worker registration on startup

import { randomUUID } from 'crypto';
import { query } from '../db/connection';
import { WorkerInstance, WorkerConfig, WorkerStatus } from './types';

/**
 * Register worker in database
 */
export async function registerWorker(config: WorkerConfig): Promise<WorkerInstance> {
  const id = randomUUID();

  const result = await query<WorkerInstance>(
    `INSERT INTO rdp_instances (id, machine_id, public_ip, provider, status, last_heartbeat, started_at)
     VALUES ($1, $2, $3, $4, 'running', NOW(), NOW())
     RETURNING *`,
    [id, config.machine_id, config.public_ip, config.provider]
  );

  return result.rows[0];
}

/**
 * Update worker status
 */
export async function updateWorkerStatus(
  workerId: string,
  status: WorkerStatus
): Promise<void> {
  await query(
    'UPDATE rdp_instances SET status = $1, last_heartbeat = NOW() WHERE id = $2',
    [status, workerId]
  );
}

/**
 * Deregister worker on shutdown
 */
export async function deregisterWorker(workerId: string): Promise<void> {
  await query(
    "UPDATE rdp_instances SET status = 'stopped' WHERE id = $1",
    [workerId]
  );
}

/**
 * Get worker instance by machine ID
 */
export async function getWorkerByMachineId(
  machineId: string
): Promise<WorkerInstance | null> {
  const result = await query<WorkerInstance>(
    'SELECT * FROM rdp_instances WHERE machine_id = $1',
    [machineId]
  );

  return result.rows[0] || null;
}

/**
 * Get all active workers
 */
export async function getActiveWorkers(): Promise<WorkerInstance[]> {
  const result = await query<WorkerInstance>(
    "SELECT * FROM rdp_instances WHERE status IN ('running', 'draining') ORDER BY started_at"
  );

  return result.rows;
}

/**
 * Get worker statistics
 */
export async function getWorkerStats(): Promise<{
  total: number;
  running: number;
  draining: number;
  stopped: number;
  total_processed: number;
  total_failed: number;
}> {
  const statusResult = await query<{ status: string; count: number }>(
    'SELECT status, COUNT(*) as count FROM rdp_instances GROUP BY status'
  );

  const statsResult = await query<{ total_processed: number; total_failed: number }>(
    'SELECT COALESCE(SUM(jobs_processed), 0) as total_processed, COALESCE(SUM(jobs_failed), 0) as total_failed FROM rdp_instances'
  );

  const stats = {
    total: 0,
    running: 0,
    draining: 0,
    stopped: 0,
    total_processed: 0,
    total_failed: 0,
  };

  for (const row of statusResult.rows) {
    const count = parseInt(String(row.count));
    stats.total += count;
    if (row.status === 'running') stats.running = count;
    if (row.status === 'draining') stats.draining = count;
    if (row.status === 'stopped') stats.stopped = count;
  }

  if (statsResult.rows.length > 0) {
    stats.total_processed = parseInt(String(statsResult.rows[0].total_processed));
    stats.total_failed = parseInt(String(statsResult.rows[0].total_failed));
  }

  return stats;
}
