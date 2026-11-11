require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');

async function updateNeonPhase7() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL not found in server/.env');
    process.exit(1);
  }

  const isSsl = connectionString.includes('neon.tech') || connectionString.includes('sslmode=require');
  const pool = new Pool({
    connectionString,
    ssl: isSsl ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('[Neon Phase 7] Connecting to Neon Cloud PostgreSQL...');
    const client = await pool.connect();
    console.log('[Neon Phase 7] Connected successfully.');

    console.log('[Neon Phase 7] Adding Phase 7 live tracking columns and notifications schema...');
    await client.query(`
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_lat NUMERIC(10, 7);
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_lng NUMERIC(10, 7);
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS worker_lat NUMERIC(10, 7);
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS worker_lng NUMERIC(10, 7);
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS tracking_active SMALLINT DEFAULT 0;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS eta_minutes INTEGER;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ;

      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
        title VARCHAR(150) NOT NULL DEFAULT 'FixMate Update',
        body TEXT NOT NULL,
        type VARCHAR(30) DEFAULT 'booking_status',
        data_json TEXT,
        is_read SMALLINT NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
        dedupe_key VARCHAR(100),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title VARCHAR(150) NOT NULL DEFAULT 'FixMate Update';
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type VARCHAR(30) DEFAULT 'booking_status';
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_read SMALLINT NOT NULL DEFAULT 0;
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(100);
      ALTER TABLE notifications ADD COLUMN IF NOT EXISTS data_json TEXT;

      DROP INDEX IF EXISTS notifications_dedupe_idx;
      CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_dedupe_uidx ON notifications(user_id, dedupe_key);
      CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, id DESC);
    `);

    const cols = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'bookings'
        AND column_name IN ('customer_lat', 'customer_lng', 'worker_lat', 'worker_lng', 'tracking_active', 'eta_minutes', 'location_updated_at')
      ORDER BY column_name;
    `);
    console.log('[Neon Phase 7] Verified booking tracking columns:');
    cols.rows.forEach((r) => console.log(` - ${r.column_name} (${r.data_type})`));

    const nCols = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'notifications'
      ORDER BY ordinal_position;
    `);
    console.log('[Neon Phase 7] Verified notifications table schema:');
    nCols.rows.forEach((r) => console.log(` - ${r.column_name} (${r.data_type})`));

    client.release();
    await pool.end();
    console.log('[Neon Phase 7] Neon Cloud database is fully updated and verified for Phase 7!');
  } catch (err) {
    console.error('[Neon Phase 7 Error]:', err.message);
    process.exit(1);
  }
}

updateNeonPhase7();
