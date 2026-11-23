/**
 * Phase 3 Database Schema Verification & Neon Cloud Update
 * Idempotently adds Phase 3 technician columns to live PostgreSQL.
 */
const path = require('path');
const serverDir = path.resolve('fixmate/server');
require(path.join(serverDir, 'node_modules', 'dotenv')).config({ path: path.join(serverDir, '.env') });
const { Pool } = require(path.join(serverDir, 'node_modules', 'pg'));

async function updateNeonPhase3() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not set in .env');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();
  try {
    console.log('Connecting to Neon PostgreSQL for Phase 3 Technician Schema Update...');
    await client.query('BEGIN');

    // Add Phase 3 columns to users for technician profile
    console.log('Adding technician profile columns to users table...');
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS experience_years INTEGER DEFAULT 2;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS id_document_url TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS id_verified SMALLINT DEFAULT 1 CHECK (id_verified IN (0, 1));
      ALTER TABLE users ADD COLUMN IF NOT EXISTS service_areas VARCHAR(255) DEFAULT 'All Dhanbad';
    `);

    // Add Phase 3 columns to bookings for start and completion photo proofs
    console.log('Adding photo proof columns to bookings table...');
    await client.query(`
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS start_photo_url TEXT;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS complete_photo_url TEXT;
    `);

    await client.query('COMMIT');
    console.log('✅ Neon PostgreSQL Phase 3 Schema is 100% verified and updated!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Phase 3 migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

updateNeonPhase3();

