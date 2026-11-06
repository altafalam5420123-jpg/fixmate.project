require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');

async function updateNeonPhase4() {
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
    console.log('[Neon Phase 4] Connecting to Neon Cloud PostgreSQL...');
    const client = await pool.connect();
    console.log('[Neon Phase 4] Connected successfully.');

    // 1. Create complaints table
    console.log('[Neon Phase 4] Creating complaints table if not exists...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS complaints (
        id SERIAL PRIMARY KEY,
        booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
        customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category VARCHAR(50) NOT NULL,
        description TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_investigation', 'resolved', 'closed')),
        resolution_notes TEXT,
        refund_requested SMALLINT NOT NULL DEFAULT 0 CHECK (refund_requested IN (0, 1)),
        refund_amount INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS complaints_status_idx ON complaints(status, id DESC);
      CREATE INDEX IF NOT EXISTS complaints_customer_idx ON complaints(customer_id, id DESC);
    `);
    console.log('[Neon Phase 4] Complaints table and indexes verified.');

    // 2. Ensure Master Admin user exists
    console.log('[Neon Phase 4] Ensuring Master Admin user (9999999999)...');
    await client.query(`
      INSERT INTO users (phone, name, role, skill, wallet)
      VALUES ('9999999999', 'FixMate Master Admin', 'admin', NULL, 10000)
      ON CONFLICT (phone) DO UPDATE SET role = 'admin', name = 'FixMate Master Admin'
    `);
    console.log('[Neon Phase 4] Master Admin user verified.');

    // 3. Verify analytics aggregation query
    console.log('[Neon Phase 4] Running test analytics query on real DB records...');
    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE role = 'customer') AS total_customers,
        (SELECT COUNT(*) FROM users WHERE role = 'worker') AS total_workers,
        (SELECT COUNT(*) FROM users WHERE role = 'worker' AND id_verified = 1) AS verified_workers,
        (SELECT COUNT(*) FROM bookings) AS total_bookings,
        (SELECT COUNT(*) FROM complaints) AS total_complaints,
        (SELECT COALESCE(SUM(total), 0) FROM bookings WHERE paid = 1) AS total_revenue
    `);
    console.log('[Neon Phase 4] Analytics snapshot:', counts.rows[0]);

    client.release();
    await pool.end();
    console.log('[Neon Phase 4] Neon Cloud database is fully updated and verified for Phase 4!');
  } catch (err) {
    console.error('[Neon Phase 4 Error]:', err.message);
    process.exit(1);
  }
}

updateNeonPhase4();
