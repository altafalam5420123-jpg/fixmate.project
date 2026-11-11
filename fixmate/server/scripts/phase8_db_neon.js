require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { openDb } = require('../src/db');

async function updateNeonPhase8() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not found in server/.env');
    process.exit(1);
  }

  const db = openDb();
  try {
    console.log('[Neon Phase 8] Running initDb() against Neon Cloud PostgreSQL...');
    await db.initDb();

    const tables = await db.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('amc_plans', 'amc_subscriptions', 'family_members', 'service_reminders', 'service_areas')
      ORDER BY table_name;
    `);
    console.log('[Neon Phase 8] Verified Phase 8 tables:');
    tables.rows.forEach((r) => console.log(` - ${r.table_name}`));

    const bCols = await db.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'bookings'
        AND column_name IN ('emergency_fee', 'family_member_name', 'amc_subscription_id')
      ORDER BY column_name;
    `);
    console.log('[Neon Phase 8] Verified Phase 8 booking columns:');
    bCols.rows.forEach((r) => console.log(` - ${r.column_name} (${r.data_type})`));

    const amcCnt = await db.queryOne('SELECT COUNT(*) AS c FROM amc_plans');
    const areaCnt = await db.queryOne('SELECT COUNT(*) AS c FROM service_areas');
    console.log(`[Neon Phase 8] Seed counts -> AMC Plans: ${amcCnt.c}, Service Areas: ${areaCnt.c}`);
    console.log('[Neon Phase 8] Neon Cloud database is fully updated and verified for Phase 8!');
  } catch (err) {
    console.error('[Neon Phase 8 Error]:', err.message);
    process.exit(1);
  } finally {
    await db.close();
  }
}

updateNeonPhase8();

