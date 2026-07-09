// SMTP session transcript logging

import { query } from '../db/connection';
import { SMTPSessionLog } from './types';

/**
 * Log SMTP session
 */
export async function logSession(session: SMTPSessionLog): Promise<void> {
  await query(
    `INSERT INTO smtp_logs (job_id, from_address, to_address, subdomain, ip_address, connected_at, sent_at, response_code, response_message, error, duration_ms, bytes_sent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      session.job_id,
      session.from,
      session.to,
      session.subdomain,
      session.ip_address,
      session.connected_at,
      session.sent_at || null,
      session.response_code || null,
      session.response_message || null,
      session.error || null,
      session.duration_ms,
      session.bytes_sent || null,
    ]
  );
}

/**
 * Get session logs for a job
 */
export async function getSessionLogs(jobId: string): Promise<SMTPSessionLog[]> {
  const result = await query<SMTPSessionLog>(
    'SELECT * FROM smtp_logs WHERE job_id = $1 ORDER BY connected_at',
    [jobId]
  );

  return result.rows;
}

/**
 * Get recent session logs
 */
export async function getRecentLogs(limit: number = 100): Promise<SMTPSessionLog[]> {
  const result = await query<SMTPSessionLog>(
    'SELECT * FROM smtp_logs ORDER BY connected_at DESC LIMIT $1',
    [limit]
  );

  return result.rows;
}

/**
 * Get SMTP statistics
 */
export async function getSMTPStats(): Promise<{
  total_sent: number;
  success_rate: number;
  avg_duration_ms: number;
  by_response_code: { code: number; count: number }[];
}> {
  const totalResult = await query<{ total: number; success: number; avg_duration: number }>(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE response_code >= 200 AND response_code < 300) as success,
       AVG(duration_ms) as avg_duration
     FROM smtp_logs`
  );

  const codeResult = await query<{ code: number; count: number }>(
    'SELECT response_code as code, COUNT(*) as count FROM smtp_logs WHERE response_code IS NOT NULL GROUP BY response_code'
  );

  const stats = totalResult.rows[0] || { total: 0, success: 0, avg_duration: 0 };

  return {
    total_sent: parseInt(String(stats.total)),
    success_rate: stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : 0,
    avg_duration_ms: Math.round(stats.avg_duration || 0),
    by_response_code: codeResult.rows.map((r) => ({
      code: r.code,
      count: parseInt(String(r.count)),
    })),
  };
}
