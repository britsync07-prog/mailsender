// Integration tests for Lead Ingestion (requires PostgreSQL)

import { Pool } from 'pg';
import crypto from 'crypto';
const uuidv4 = () => crypto.randomUUID();

const TEST_DB_CONFIG = {
  host: process.env.TEST_DB_HOST || 'localhost',
  port: parseInt(process.env.TEST_DB_PORT || '5432'),
  database: process.env.TEST_DB_NAME || 'mailcouse_test',
  user: process.env.TEST_DB_USER || 'postgres',
  password: process.env.TEST_DB_PASSWORD || 'postgres',
};

let pool: Pool;
let dbAvailable = false;

beforeAll(async () => {
  pool = new Pool(TEST_DB_CONFIG);
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    dbAvailable = true;
  } catch {
    console.warn('PostgreSQL not available - skipping integration tests');
    dbAvailable = false;
  }
});

afterAll(async () => {
  if (pool) await pool.end();
});

beforeEach(async () => {
  if (!dbAvailable) return;
  const client = await pool.connect();
  try {
    await client.query("DELETE FROM leads WHERE email LIKE '%test%'");
    await client.query('DELETE FROM import_batches');
  } finally {
    client.release();
  }
});

describe('Lead Ingestion Integration', () => {
  (dbAvailable ? it : xit)('should import leads and query them', async () => {
    const testEmail = `test-${uuidv4()}@example.com`;

    const client = await pool.connect();
    try {
      const insertResult = await client.query(
        `INSERT INTO leads (email, first_name, last_name, company, job_title, industry, source, status, validated, send_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [testEmail, 'John', 'Doe', 'Test Corp', 'CTO', 'cybersecurity', 'csv_import', 'pending', false, 0]
      );

      expect(insertResult.rows).toHaveLength(1);
      const lead = insertResult.rows[0];

      expect(lead.id).toBeDefined();
      expect(lead.email).toBe(testEmail);
      expect(lead.industry).toBe('cybersecurity');
      expect(lead.status).toBe('pending');
      expect(lead.validated).toBe(false);
      expect(lead.send_count).toBe(0);

      const queryResult = await client.query('SELECT * FROM leads WHERE email = $1', [testEmail]);
      expect(queryResult.rows).toHaveLength(1);
      expect(queryResult.rows[0].email).toBe(testEmail);
    } finally {
      client.release();
    }
  });

  (dbAvailable ? it : xit)('should enforce unique email constraint', async () => {
    const testEmail = `unique-${uuidv4()}@example.com`;

    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO leads (email, industry, source, status, validated, send_count)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [testEmail, 'cybersecurity', 'csv_import', 'pending', false, 0]
      );

      await expect(
        client.query(
          `INSERT INTO leads (email, industry, source, status, validated, send_count)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [testEmail, 'mortgage', 'prospeo', 'pending', false, 0]
        )
      ).rejects.toThrow();
    } finally {
      client.release();
    }
  });

  (dbAvailable ? it : xit)('should enforce NOT NULL on source field', async () => {
    const client = await pool.connect();
    try {
      await expect(
        client.query(
          `INSERT INTO leads (email, industry, source, status, validated, send_count)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          ['test@example.com', 'cybersecurity', null, 'pending', false, 0]
        )
      ).rejects.toThrow();
    } finally {
      client.release();
    }
  });

  (dbAvailable ? it : xit)('should log import batches', async () => {
    const client = await pool.connect();
    try {
      const now = new Date();

      const result = await client.query(
        `INSERT INTO import_batches (source, industry, total_received, total_imported, total_duplicates, total_invalid, started_at, completed_at, duration_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        ['csv_import', 'cybersecurity', 100, 95, 3, 2, now, new Date(now.getTime() + 5000), 5000]
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].total_received).toBe(100);
      expect(result.rows[0].total_imported).toBe(95);
    } finally {
      client.release();
    }
  });

  (dbAvailable ? it : xit)('should query leads by industry', async () => {
    const client = await pool.connect();
    try {
      const industries = ['cybersecurity', 'mortgage', 'smart_homes'];
      for (const industry of industries) {
        await client.query(
          `INSERT INTO leads (email, industry, source, status, validated, send_count)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [`${industry}-${uuidv4()}@test.com`, industry, 'csv_import', 'pending', false, 0]
        );
      }

      const result = await client.query(
        "SELECT industry, COUNT(*) as count FROM leads WHERE email LIKE '%test.com' GROUP BY industry"
      );

      expect(result.rows.length).toBe(3);
    } finally {
      client.release();
    }
  });
});