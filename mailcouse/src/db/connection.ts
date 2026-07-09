// Database connection for mailcouse — with retry, health, and graceful fallback

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { config } from '../config';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: config.db.host,
      port: config.db.port,
      database: config.db.name,
      user: config.db.user,
      password: config.db.password,
      ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
    });
  }
  return pool;
}

async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function query<T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let client: PoolClient | null = null;
    try {
      client = await getPool().connect();
      return await client.query<T>(text, params);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (client) {
        try { client.release(true); } catch {}
        client = null;
      }
      if (attempt < MAX_RETRIES) {
        console.warn(`DB query attempt ${attempt} failed, retrying in ${RETRY_DELAY_MS}ms: ${lastError.message}`);
        await wait(RETRY_DELAY_MS);
      }
    } finally {
      if (client) {
        try { client.release(); } catch {}
      }
    }
  }

  throw lastError || new Error('DB query failed after retries');
}

export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  let client: PoolClient | null = null;
  try {
    client = await getPool().connect();
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    throw e;
  } finally {
    if (client) {
      try { client.release(); } catch {}
    }
  }
}

export async function initializeDatabase(): Promise<void> {
  const fs = require('fs');
  const path = require('path');
  const schemaPath = path.resolve(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  const client = await getPool().connect();
  try {
    await client.query(schema);
    console.log('Database schema initialized successfully');
  } finally {
    client.release();
  }
}

export async function checkDatabaseHealth(): Promise<{
  connected: boolean;
  poolSize: number;
  idleCount: number;
  waitingCount: number;
  error?: string;
}> {
  try {
    const p = getPool();
    const result = await query('SELECT 1 as ok');
    return {
      connected: result.rows[0]?.ok === 1,
      poolSize: p.totalCount,
      idleCount: p.idleCount,
      waitingCount: p.waitingCount,
    };
  } catch (err) {
    return {
      connected: false,
      poolSize: 0,
      idleCount: 0,
      waitingCount: 0,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
