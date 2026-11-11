require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');

async function updateNeonPhase6() {
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
    console.log('[Neon Phase 6] Connecting to Neon Cloud PostgreSQL...');
    const client = await pool.connect();
    console.log('[Neon Phase 6] Connected successfully.');

    console.log('[Neon Phase 6] Creating ai_messages conversation history table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_messages (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        cards_json TEXT,
        provider VARCHAR(30) DEFAULT 'fixmate-ai',
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS ai_messages_user_idx ON ai_messages(user_id, id DESC);
    `);

    const verify = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'ai_messages'
      ORDER BY ordinal_position;
    `);
    console.log('[Neon Phase 6] Verified ai_messages table schema:');
    verify.rows.forEach((r) => console.log(` - ${r.column_name} (${r.data_type})`));

    client.release();
    await pool.end();
    console.log('[Neon Phase 6] Neon Cloud database is fully updated and verified for Phase 6!');
  } catch (err) {
    console.error('[Neon Phase 6 Error]:', err.message);
    process.exit(1);
  }
}

updateNeonPhase6();

