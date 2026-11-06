/**
 * FixMate PostgreSQL Database Inspector
 * Run anytime with: npm run check:db
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

async function inspectDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL .env mein nahi mila!');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('====================================================');
    console.log('       FIXMATE NEON POSTGRESQL INSPECTOR            ');
    console.log('====================================================');

    const dbInfo = await pool.query('SELECT current_database() as db, current_user as user, version()');
    console.log(`Connected Database : ${dbInfo.rows[0].db}`);
    console.log(`Database User     : ${dbInfo.rows[0].user}`);
    console.log(`Engine Version    : ${dbInfo.rows[0].version.split(' on ')[0]}`);

    // Table Counts
    console.log('\n--- [1] ALL TABLES & ROW COUNTS ---');
    const tables = ['services', 'users', 'bookings', 'wallet_tx', 'otps', 'otp_rate_limits', 'otp_daily_limits', 'payment_orders'];
    for (const t of tables) {
      try {
        const res = await pool.query(`SELECT COUNT(*) as c FROM ${t}`);
        console.log(`  • ${t.padEnd(20)} : ${res.rows[0].c} rows`);
      } catch (e) {
        console.log(`  • ${t.padEnd(20)} : (Table not created yet)`);
      }
    }

    // Users
    console.log('\n--- [2] REGISTERED USERS ---');
    const users = await pool.query('SELECT id, name, phone, role, skill, wallet FROM users ORDER BY id');
    users.rows.forEach(u => {
      const extra = u.role === 'worker' ? `(Skill: ${u.skill})` : '';
      console.log(`  [ID: ${u.id}] ${u.name.padEnd(30)} | Phone: ${u.phone} | Role: ${u.role.padEnd(8)} | Wallet: ₹${String(u.wallet).padEnd(5)} ${extra}`);
    });

    // Recent Bookings
    console.log('\n--- [3] RECENT BOOKINGS ---');
    const bookings = await pool.query(`
      SELECT b.id, s.name as service, b.status, b.slot, b.address, b.pay, b.start_code, b.total
      FROM bookings b
      JOIN services s ON s.id = b.service_id
      ORDER BY b.id DESC
      LIMIT 5
    `);
    if (bookings.rows.length === 0) {
      console.log('  Koi booking nahi hai abhi.');
    } else {
      bookings.rows.forEach(b => {
        console.log(`  [#${b.id}] ${b.service.padEnd(26)} | Status: ${b.status.padEnd(12)} | Slot: ${b.slot.padEnd(22)} | Code: ${b.start_code} | Total: ₹${b.total}`);
      });
    }

    // Services Sample
    console.log('\n--- [4] SERVICES CATALOG (Sample) ---');
    const services = await pool.query('SELECT id, cat, name, price, rating FROM services ORDER BY id LIMIT 6');
    services.rows.forEach(s => {
      console.log(`  [#${s.id}] [${s.cat.padEnd(12)}] ${s.name.padEnd(30)} | ₹${s.price} | ⭐ ${s.rating}`);
    });

    console.log('\n====================================================');
    console.log(' Database is active, healthy, and synced with FixMate!');
    console.log('====================================================\n');
  } catch (err) {
    console.error('Database inspection failed:', err.message);
  } finally {
    await pool.end();
  }
}

inspectDatabase();

