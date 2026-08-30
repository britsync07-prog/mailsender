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

async function runMigrations(): Promise<void> {
  const migrations = [
    `ALTER TABLE servers ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMP`,
    `ALTER TABLE servers ADD COLUMN IF NOT EXISTS suspension_reason TEXT`,
    `ALTER TABLE servers ADD COLUMN IF NOT EXISTS mode VARCHAR(20) NOT NULL DEFAULT 'live'`,
    `ALTER TABLE servers ADD COLUMN IF NOT EXISTS send_limit INTEGER`,
    `ALTER TABLE customer_domains ADD COLUMN IF NOT EXISTS verification_method VARCHAR(20) NOT NULL DEFAULT 'DNS'`,
    `ALTER TABLE customer_domains ADD COLUMN IF NOT EXISTS dkim_identifier_string VARCHAR(10)`,
    `ALTER TABLE customer_domains ADD COLUMN IF NOT EXISTS spf_error TEXT`,
    `ALTER TABLE customer_domains ADD COLUMN IF NOT EXISTS dkim_error TEXT`,
    `ALTER TABLE customer_domains ADD COLUMN IF NOT EXISTS mx_error TEXT`,
    `ALTER TABLE customer_domains ADD COLUMN IF NOT EXISTS return_path_error TEXT`,
    `ALTER TABLE customer_domains ADD COLUMN IF NOT EXISTS dkim_observed_selector VARCHAR(255)`,
    `ALTER TABLE customer_domains ADD COLUMN IF NOT EXISTS dkim_observed_name VARCHAR(512)`,
    `ALTER TABLE customer_domains ADD COLUMN IF NOT EXISTS dkim_observed_value TEXT`,
    `ALTER TABLE customer_domains ADD COLUMN IF NOT EXISTS spf_observed_record TEXT`,
    `ALTER TABLE customer_domains ADD COLUMN IF NOT EXISTS use_for_any BOOLEAN NOT NULL DEFAULT false`,
    `ALTER TABLE smtp_credentials ADD COLUMN IF NOT EXISTS tier VARCHAR(20) NOT NULL DEFAULT 'mass_mail'`,
    `ALTER TABLE smtp_credentials ADD COLUMN IF NOT EXISTS allowed_from_email VARCHAR(320)`,
    `ALTER TABLE smtp_credentials ADD COLUMN IF NOT EXISTS default_from_name VARCHAR(255)`,
    `CREATE TABLE IF NOT EXISTS mailbox_accounts (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      customer_domain_id UUID REFERENCES customer_domains(id) ON DELETE SET NULL,
      email VARCHAR(320) NOT NULL,
      display_name VARCHAR(255),
      password_hash VARCHAR(255) NOT NULL,
      quota_mb INTEGER NOT NULL DEFAULT 1024,
      active BOOLEAN NOT NULL DEFAULT true,
      imap_enabled BOOLEAN NOT NULL DEFAULT true,
      last_login_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(organization_id, email)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mailbox_accounts_org_id ON mailbox_accounts(organization_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mailbox_accounts_email ON mailbox_accounts(LOWER(email))`,
    `CREATE TABLE IF NOT EXISTS mailbox_aliases (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      mailbox_id UUID NOT NULL REFERENCES mailbox_accounts(id) ON DELETE CASCADE,
      address VARCHAR(320) NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(organization_id, address)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mailbox_aliases_mailbox_id ON mailbox_aliases(mailbox_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mailbox_aliases_address ON mailbox_aliases(LOWER(address))`,
    `CREATE TABLE IF NOT EXISTS mailbox_folders (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      mailbox_id UUID NOT NULL REFERENCES mailbox_accounts(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      special_use VARCHAR(50),
      uid_validity INTEGER NOT NULL DEFAULT floor(extract(epoch from now())),
      uid_next INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(mailbox_id, name)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mailbox_folders_mailbox_id ON mailbox_folders(mailbox_id)`,
    `CREATE TABLE IF NOT EXISTS mailbox_messages (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      mailbox_id UUID NOT NULL REFERENCES mailbox_accounts(id) ON DELETE CASCADE,
      folder_id UUID NOT NULL REFERENCES mailbox_folders(id) ON DELETE CASCADE,
      uid INTEGER NOT NULL,
      raw_source TEXT NOT NULL,
      headers_json JSONB,
      subject TEXT,
      from_text TEXT,
      to_text TEXT,
      body_text TEXT,
      body_html TEXT,
      internal_date TIMESTAMP NOT NULL DEFAULT NOW(),
      size INTEGER NOT NULL DEFAULT 0,
      flags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(folder_id, uid)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mailbox_messages_mailbox_id ON mailbox_messages(mailbox_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mailbox_messages_folder_uid ON mailbox_messages(folder_id, uid)`,
    `CREATE INDEX IF NOT EXISTS idx_mailbox_messages_flags ON mailbox_messages USING GIN(flags)`,
    `CREATE TABLE IF NOT EXISTS mailbox_auth_logs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      mailbox_id UUID REFERENCES mailbox_accounts(id) ON DELETE SET NULL,
      email VARCHAR(320),
      protocol VARCHAR(20) NOT NULL DEFAULT 'imap',
      remote_addr VARCHAR(128),
      success BOOLEAN NOT NULL,
      details TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mailbox_auth_logs_mailbox_id ON mailbox_auth_logs(mailbox_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mailbox_auth_logs_created_at ON mailbox_auth_logs(created_at)`,
    `ALTER TABLE mailbox_accounts ADD COLUMN IF NOT EXISTS smtp_enabled BOOLEAN NOT NULL DEFAULT true`,
    `ALTER TABLE mailbox_accounts ADD COLUMN IF NOT EXISTS smtp_tier VARCHAR(20) NOT NULL DEFAULT 'personal'`,
    `ALTER TABLE servers ADD COLUMN IF NOT EXISTS spam_threshold DECIMAL(8,2) NOT NULL DEFAULT 5`,
    `ALTER TABLE servers ADD COLUMN IF NOT EXISTS spam_failure_threshold DECIMAL(8,2) NOT NULL DEFAULT 20`,
    `ALTER TABLE sent_messages ADD COLUMN IF NOT EXISTS spam_score DECIMAL(8,2)`,
    `ALTER TABLE sent_messages ADD COLUMN IF NOT EXISTS spam_status VARCHAR(20) NOT NULL DEFAULT 'not_checked'`,
    `ALTER TABLE sent_messages ADD COLUMN IF NOT EXISTS tag VARCHAR(255)`,
    `ALTER TABLE sent_messages ADD COLUMN IF NOT EXISTS spam_checks JSONB`,
    `ALTER TABLE routes ADD COLUMN IF NOT EXISTS spam_mode VARCHAR(20) NOT NULL DEFAULT 'Mark'`,
    `ALTER TABLE routes ADD COLUMN IF NOT EXISTS mode VARCHAR(20) NOT NULL DEFAULT 'Endpoint'`,
    `ALTER TABLE customer_domains DROP CONSTRAINT IF EXISTS customer_domains_domain_key`,
    `CREATE UNIQUE INDEX IF NOT EXISTS customer_domains_org_domain_key ON customer_domains (organization_id, LOWER(domain))`,
    `ALTER TABLE suppression_list ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'suppressed'`,
    `ALTER TABLE suppression_list ADD COLUMN IF NOT EXISTS first_seen TIMESTAMP NOT NULL DEFAULT NOW()`,
    `ALTER TABLE suppression_list ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP NOT NULL DEFAULT NOW()`,
    `ALTER TABLE suppression_list ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP`,
    `CREATE INDEX IF NOT EXISTS idx_suppression_status ON suppression_list(status)`,
    `CREATE INDEX IF NOT EXISTS idx_suppression_expires_at ON suppression_list(expires_at)`,
  ];
  const client = await getPool().connect();
  try {
    for (const sql of migrations) {
      await client.query(sql);
    }
    console.log('Database migrations applied successfully');
  } finally {
    client.release();
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
  await runMigrations();
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
