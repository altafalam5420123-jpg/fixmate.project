/**
 * Phase 2 Database Schema Verification & Neon Cloud Update
 * Idempotently verifies and adds Phase 2 columns to live PostgreSQL.
 */
const path = require('path');
const serverDir = path.resolve('fixmate/server');
require(path.join(serverDir, 'node_modules', 'dotenv')).config({ path: path.join(serverDir, '.env') });
const { Pool } = require(path.join(serverDir, 'node_modules', 'pg'));

async function updateNeonPhase2() {
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
    console.log('Connecting to Neon PostgreSQL for Phase 2 Schema Update...');
    await client.query('BEGIN');

    // Add Phase 2 columns to bookings
    console.log('Adding Phase 2 columns to bookings table...');
    await client.query(`
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS issue_desc TEXT;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS photo_url TEXT;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(30);
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS discount_amount INTEGER DEFAULT 0;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_emergency SMALLINT DEFAULT 0;
    `);

    // Ensure reviews table exists
    console.log('Verifying customer reviews table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id SERIAL PRIMARY KEY,
        booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
        customer_id INTEGER NOT NULL REFERENCES users(id),
        worker_id INTEGER REFERENCES users(id),
        rating NUMERIC(2, 1) NOT NULL CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        photos TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS reviews_worker_idx ON reviews(worker_id, id DESC);
    `);

    // Ensure booking_status_history table exists
    console.log('Verifying booking_status_history table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS booking_status_history (
        id SERIAL PRIMARY KEY,
        booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        old_status VARCHAR(30),
        new_status VARCHAR(30) NOT NULL,
        changed_by_user_id INTEGER REFERENCES users(id),
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS bsh_booking_idx ON booking_status_history(booking_id, id DESC);
    `);

    await client.query('COMMIT');
    console.log('✅ Neon PostgreSQL Phase 2 Schema is 100% verified and updated!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

updateNeonPhase2();
