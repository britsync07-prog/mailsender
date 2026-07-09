// Integration tests for Lead Ingestion

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

// Test database configuration
const TEST_DB_CONFIG = {
  host: process.env.TEST_DB_HOST || 'localhost',
  port: parseInt(process.env.TEST_DB_PORT || '5432'),
  database: process.env.TEST_DB_NAME || 'mailcouse_test',
  user: process.env.TEST_DB_USER || 'postgres',
  password: process.env.TEST_DB_PASSWORD || 'postgres',
};

let pool: Pool;

beforeAll(async () => {
  pool = new Pool(TEST_DB_CONFIG);

  // Create test database if it doesn't exist
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE DATABASE mailcouse_test
      WITH OWNER postgres
      TEMPLATE mailcouse
    `);
  } catch (e) {
    // Database might already exist
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  // Clean up test data
  const client = await pool.connect();
  try {
    await client.query('DELETE FROM leads WHERE email LIKE %test%');
    await client.query('DELETE FROM import_batches');
  } finally {
    client.release();
  }
});

describe('Lead Ingestion Integration', () => {
  it('should import leads and query them', async () => {
    const testEmail = `test-${uuidv4()}@example.com`;

    const client = await pool.connect();
    try {
      // Insert test lead
      const insertResult = await client.query(
        `INSERT INTO leads (email, first_name, last_name, company, job_title, industry, source, status, validated, send_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          testEmail,
          'John',
          'Doe',
          'Test Corp',
          'CTO',
          'cybersecurity',
          'csv_import',
          'pending',
          false,
          0,
        ]
      );

      expect(insertResult.rows).toHaveLength(1);
      const lead = insertResult.rows[0];

      expect(lead.id).toBeDefined();
      expect(lead.email).toBe(testEmail);
      expect(lead.industry).toBe('cybersecurity');
      expect(lead.status).toBe('pending');
      expect(lead.validated).toBe(false);
      expect(lead.send_count).toBe(0);

      // Query the lead
      const queryResult = await client.query(
        'SELECT * FROM leads WHERE email = $1',
        [testEmail]
      );

      expect(queryResult.rows).toHaveLength(1);
      expect(queryResult.rows[0].email).toBe(testEmail);
    } finally {
      client.release();
    }
  });

  it('should enforce unique email constraint', async () => {
    const testEmail = `unique-${uuidv4()}@example.com`;

    const client = await pool.connect();
    try {
      // Insert first lead
      await client.query(
        `INSERT INTO leads (email, industry, source, status, validated, send_count)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [testEmail, 'cybersecurity', 'csv_import', 'pending', false, 0]
      );

      // Try to insert duplicate
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

  it('should enforce NOT NULL on source field', async () => {
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

  it('should log import batches', async () => {
    const client = await pool.connect();
    try {
      const batchId = uuidv4();
      const now = new Date();

      const result = await client.query(
        `INSERT INTO import_batches (id, source, industry, total_received, total_imported, total_duplicates, total_invalid, started_at, completed_at, duration_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          batchId,
          'csv_import',
          'cybersecurity',
          100,
          95,
          3,
          2,
          now,
          new Date(now.getTime() + 5000),
          5000,
        ]
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].total_received).toBe(100);
      expect(result.rows[0].total_imported).toBe(95);
    } finally {
      client.release();
    }
  });

  it('should query leads by industry', async () => {
    const client = await pool.connect();
    try {
      // Insert test leads for different industries
      const industries = ['cybersecurity', 'mortgage', 'smart_homes'];
      for (const industry of industries) {
        await client.query(
          `INSERT INTO leads (email, industry, source, status, validated, send_count)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [`${industry}-${uuidv4()}@test.com`, industry, 'csv_import', 'pending', false, 0]
        );
      }

      // Query by industry
      const result = await client.query(
        'SELECT industry, COUNT(*) as count FROM leads WHERE email LIKE %test.com GROUP BY industry'
      );

      expect(result.rows.length).toBe(3);
    } finally {
      client.release();
    }
  });
});
