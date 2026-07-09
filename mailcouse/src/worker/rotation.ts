// RDP rotation and graceful drain

import { query } from '../db/connection';
import { updateWorkerStatus } from './registration';
import { DrainResult, WorkerInstance } from './types';

/**
 * Start graceful drain of a worker
 */
export async function startDrain(workerId: string): Promise<DrainResult> {
  const startTime = Date.now();

  // Update status to draining
  await updateWorkerStatus(workerId, 'draining');

  // Get in-progress job count
  const result = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM send_jobs WHERE rdp_id = $1 AND status = 'processing'",
    [workerId]
  );

  const inProgressJobs = parseInt(String(result.rows[0]?.count || '0'));

  return {
    worker_id: workerId,
    in_progress_jobs: inProgressJobs,
    drain_time_ms: 0,
    success: true,
  };
}

/**
 * Check if drain is complete
 */
export async function isDrainComplete(workerId: string): Promise<boolean> {
  const result = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM send_jobs WHERE rdp_id = $1 AND status = 'processing'",
    [workerId]
  );

  return parseInt(String(result.rows[0]?.count || '0')) === 0;
}

/**
 * Complete drain and stop worker
 */
export async function completeDrain(workerId: string): Promise<void> {
  await updateWorkerStatus(workerId, 'stopped');
}

/**
 * Provision new RDP worker
 */
export async function provisionNewWorker(
  provider: string
): Promise<{ worker_id: string; machine_id: string; public_ip: string }> {
  const machineId = `rdp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const publicIp = `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

  const result = await query<{ id: string }>(
    `INSERT INTO rdp_instances (id, machine_id, public_ip, provider, status, last_heartbeat, started_at)
     VALUES (uuid_generate_v4(), $1, $2, $3, 'running', NOW(), NOW())
     RETURNING id`,
    [machineId, publicIp, provider]
  );

  return {
    worker_id: result.rows[0].id,
    machine_id: machineId,
    public_ip: publicIp,
  };
}

/**
 * Check for workers needing rotation (4 days old)
 */
export async function getWorkersNeedingRotation(): Promise<WorkerInstance[]> {
  const result = await query<WorkerInstance>(
    `SELECT * FROM rdp_instances
     WHERE status = 'running'
       AND started_at < NOW() - INTERVAL '4 days'
     ORDER BY started_at`
  );

  return result.rows;
}

/**
 * Execute rotation: drain old, start new
 */
export async function executeRotation(
  oldWorkerId: string,
  provider: string
): Promise<{
  old_worker: { id: string; drain_result: DrainResult };
  new_worker: { worker_id: string; machine_id: string; public_ip: string };
}> {
  // Start drain of old worker
  const drainResult = await startDrain(oldWorkerId);

  // Provision new worker
  const newWorker = await provisionNewWorker(provider);

  return {
    old_worker: { id: oldWorkerId, drain_result: drainResult },
    new_worker: newWorker,
  };
}

/**
 * Get rotation statistics
 */
export async function getRotationStats(): Promise<{
  total_workers: number;
  needing_rotation: number;
  recently_rotated: number;
}> {
  const totalResult = await query<{ count: number }>(
    "SELECT COUNT(*) as count FROM rdp_instances WHERE status = 'running'"
  );

  const needingResult = await query<{ count: number }>(
    `SELECT COUNT(*) as count FROM rdp_instances
     WHERE status = 'running'
       AND started_at < NOW() - INTERVAL '4 days'`
  );

  const rotatedResult = await query<{ count: number }>(
    `SELECT COUNT(*) as count FROM rdp_instances
     WHERE status = 'stopped'
       AND started_at > NOW() - INTERVAL '7 days'`
  );

  return {
    total_workers: parseInt(String(totalResult.rows[0]?.count || '0')),
    needing_rotation: parseInt(String(needingResult.rows[0]?.count || '0')),
    recently_rotated: parseInt(String(rotatedResult.rows[0]?.count || '0')),
  };
}
