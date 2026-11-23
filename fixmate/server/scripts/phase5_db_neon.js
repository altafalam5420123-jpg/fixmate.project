require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');

async function updateNeonPhase5() {
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
    console.log('[Neon Phase 5] Connecting to Neon Cloud PostgreSQL...');
    const client = await pool.connect();
    console.log('[Neon Phase 5] Connected successfully.');

    console.log('[Neon Phase 5] Adding Phase 5 columns to bookings table...');
    await client.query(`
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS parts_desc TEXT;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS warranty_days INTEGER DEFAULT 30;
      ALTER TABLE bookings ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
    `);
    console.log('[Neon Phase 5] Columns parts_desc, warranty_days, completed_at verified.');

    // Verify bookings columns
    const cols = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'bookings'
        AND column_name IN ('parts_desc', 'warranty_days', 'completed_at', 'total', 'parts', 'discount_amount')
      ORDER BY column_name;
    `);
    console.log('[Neon Phase 5] Verified pricing and invoice columns:');
    cols.rows.forEach(r => console.log(` - ${r.column_name} (${r.data_type})`));

    client.release();
    await pool.end();
    console.log('[Neon Phase 5] Neon Cloud database is fully updated and verified for Phase 5!');
  } catch (err) {
    console.error('[Neon Phase 5 Error]:', err.message);
    process.exit(1);
  }
}

updateNeonPhase5();

