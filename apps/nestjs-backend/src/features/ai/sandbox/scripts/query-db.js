#!/usr/bin/env node
/**
 * NOT USED AT THE MOMENT: the agents read through AiDataService (queryRecords /
 * getRecords tools) and no longer allow this script. Kept for reference.
 *
 * Execute a read-only SELECT query against the PostgreSQL database.
 *
 * Usage:
 *   node query-db.js '<json>'
 *
 * JSON fields:
 *   sql    {string}    required  — SELECT statement with $1, $2, ... placeholders
 *   params {array}     optional  — bound values for the placeholders
 *
 * Environment (first found wins):
 *   PRISMA_DATA_DATABASE_URL | PRISMA_META_DATABASE_URL | PRISMA_DATABASE_URL | DATABASE_URL
 *
 * Output: JSON { rows: [...], rowCount: N } to stdout
 */

(async () => {
  const raw = process.argv[2];
  if (!raw) {
    console.error('Usage: node query-db.js \'{"sql":"SELECT ...","params":[]}\'');
    process.exit(1);
  }

  let args;
  try {
    args = JSON.parse(raw);
  } catch {
    console.error('Invalid JSON argument');
    process.exit(1);
  }

  const { sql, params = [] } = args;

  if (!sql || typeof sql !== 'string') {
    console.error('sql is required and must be a string');
    process.exit(1);
  }

  if (!/^\s*SELECT\b/i.test(sql.trimStart())) {
    console.error('Only SELECT statements are allowed');
    process.exit(1);
  }

  const connectionString =
    process.env.PRISMA_DATA_DATABASE_URL ??
    process.env.PRISMA_META_DATABASE_URL ??
    process.env.PRISMA_DATABASE_URL ??
    process.env.DATABASE_URL;

  if (!connectionString) {
    console.error(
      'No database connection string found. Set PRISMA_DATA_DATABASE_URL, PRISMA_DATABASE_URL, or DATABASE_URL.'
    );
    process.exit(1);
  }

  const { Pool } = require('pg');
  const pool = new Pool({ connectionString });

  try {
    const result = await pool.query(sql, params);
    console.log(JSON.stringify({ rows: result.rows, rowCount: result.rowCount ?? 0 }, null, 2));
  } catch (err) {
    console.error(`Query failed: ${err.message}`);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
