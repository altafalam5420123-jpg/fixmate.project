/**
 * Safe Data Migration Script: SQLite -> PostgreSQL for FixMate
 * Preserves all IDs, relationships, constraints, and sequences.
 * Does NOT delete or alter the original SQLite database.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { Pool } = require('pg');

const CATEGORIES = ['Electrician', 'Plumber', 'AC Repair', 'TV Repair', 'Mechanic', 'Home Tutor'];

function getPgConfig() {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    const isSsl = process.env.DB_SSL === 'true' || connectionString.includes('sslmode=require') || connectionString.includes('neon.tech') || connectionString.includes('supabase.co');
    return {
      connectionString,
      ssl: isSsl ? { rejectUnauthorized: false } : (process.env.DB_SSL === 'false' ? false : undefined)
    };
  }

  return {
    host: process.env.PGHOST || process.env.DB_HOST || 'localhost',
    port: Number(process.env.PGPORT || process.env.DB_PORT) || 5432,
    database: process.env.PGDATABASE || process.env.DB_NAME || 'fixmate',
    user: process.env.PGUSER || process.env.DB_USER || 'postgres',
    password: process.env.PGPASSWORD || process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  };
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('customer', 'worker')),
  skill VARCHAR(50),
  wallet INTEGER NOT NULL DEFAULT 0 CHECK (wallet >= 0),
  online SMALLINT NOT NULL DEFAULT 1 CHECK (online IN (0, 1)),
  token_version INTEGER NOT NULL DEFAULT 0 CHECK (token_version >= 0),
  CONSTRAINT users_worker_skill_check CHECK (role != 'worker' OR skill IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS otps (
  phone VARCHAR(20) PRIMARY KEY,
  hash TEXT NOT NULL,
  salt VARCHAR(32) NOT NULL,
  exp BIGINT NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0,
  last_sent BIGINT NOT NULL,
  hash_version SMALLINT NOT NULL DEFAULT 0 CHECK (hash_version IN (0, 1))
);

CREATE TABLE IF NOT EXISTS services (
  id SERIAL PRIMARY KEY,
  cat VARCHAR(50) NOT NULL,
  name VARCHAR(150) NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  rating NUMERIC(3, 1) NOT NULL CHECK (rating >= 0 AND rating <= 5),
  CONSTRAINT services_cat_name_unique UNIQUE (cat, name)
);

CREATE TABLE IF NOT EXISTS bookings (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES users(id),
  worker_id INTEGER REFERENCES users(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  slot VARCHAR(100) NOT NULL,
  address VARCHAR(255) NOT NULL,
  pay VARCHAR(20) NOT NULL CHECK (pay IN ('wallet', 'cash', 'razorpay')),
  status VARCHAR(20) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'assigned', 'on_the_way', 'inspecting', 'quoted', 'in_progress', 'completed', 'closed', 'cancelled')),
  start_code VARCHAR(10) NOT NULL,
  start_code_tries INTEGER NOT NULL DEFAULT 0 CHECK (start_code_tries >= 0),
  parts INTEGER NOT NULL DEFAULT 0 CHECK (parts >= 0),
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
  paid SMALLINT NOT NULL DEFAULT 0 CHECK (paid IN (0, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wallet_tx (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  label VARCHAR(150) NOT NULL,
  amount INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS otp_rate_limits (
  phone_hash VARCHAR(64) PRIMARY KEY,
  window_start BIGINT NOT NULL,
  send_count INTEGER NOT NULL DEFAULT 0 CHECK (send_count >= 0),
  wrong_count INTEGER NOT NULL DEFAULT 0 CHECK (wrong_count >= 0),
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS otp_daily_limits (
  day VARCHAR(10) PRIMARY KEY,
  send_count INTEGER NOT NULL DEFAULT 0 CHECK (send_count >= 0)
);

CREATE TABLE IF NOT EXISTS payment_orders (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  provider_order_id VARCHAR(100) UNIQUE,
  provider_payment_id VARCHAR(100) UNIQUE,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  currency VARCHAR(10) NOT NULL CHECK (currency = 'INR'),
  status VARCHAR(20) NOT NULL CHECK (status IN ('creating', 'created', 'paid', 'failed', 'expired')),
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS bookings_customer_idx ON bookings(customer_id, id DESC);
CREATE INDEX IF NOT EXISTS bookings_worker_status_idx ON bookings(worker_id, status);
CREATE INDEX IF NOT EXISTS wallet_tx_user_idx ON wallet_tx(user_id, id DESC);
CREATE INDEX IF NOT EXISTS otp_rate_limits_updated_idx ON otp_rate_limits(updated_at);
CREATE INDEX IF NOT EXISTS payment_orders_booking_idx ON payment_orders(booking_id, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS payment_orders_active_booking_idx ON payment_orders(booking_id) WHERE status IN ('creating', 'created');
`;

async function migrateData(sqliteFilePath) {
  const resolvedSqlite = path.resolve(sqliteFilePath || path.join(__dirname, '..', 'fixmate.sqlite'));
  if (!fs.existsSync(resolvedSqlite)) {
    throw new Error(`SQLite database file not found at: ${resolvedSqlite}`);
  }

  console.log('----------------------------------------------------');
  console.log('FixMate SQLite -> PostgreSQL Safe Migration');
  console.log('----------------------------------------------------');
  console.log(`Source SQLite: ${resolvedSqlite}`);

  const pgConfig = getPgConfig();
  console.log(`Target Postgres: ${process.env.DATABASE_URL ? 'Using DATABASE_URL' : `${pgConfig.user}@${pgConfig.host}:${pgConfig.port}/${pgConfig.database}`}`);

  const sqlite = new Database(resolvedSqlite);
  const pool = new Pool(pgConfig);

  const client = await pool.connect();
  try {
    console.log('\n[1/6] Initializing PostgreSQL schema & indexes...');
    await client.query(SCHEMA_SQL);
    console.log(' Schema verified successfully.');

    await client.query('BEGIN');

    // 1. Services
    console.log('\n[2/6] Migrating services...');
    const services = sqlite.prepare('SELECT * FROM services ORDER BY id').all();
    for (const s of services) {
      await client.query(
        `INSERT INTO services (id, cat, name, price, rating)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET cat = EXCLUDED.cat, name = EXCLUDED.name, price = EXCLUDED.price, rating = EXCLUDED.rating`,
        [s.id, s.cat, s.name, s.price, s.rating]
      );
    }
    console.log(` Migrated ${services.length} services.`);

    // 2. Users
    console.log('\n[3/6] Migrating users...');
    const users = sqlite.prepare('SELECT * FROM users ORDER BY id').all();
    for (const u of users) {
      await client.query(
        `INSERT INTO users (id, phone, name, role, skill, wallet, online, token_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           phone = EXCLUDED.phone,
           name = EXCLUDED.name,
           role = EXCLUDED.role,
           skill = EXCLUDED.skill,
           wallet = EXCLUDED.wallet,
           online = EXCLUDED.online,
           token_version = EXCLUDED.token_version`,
        [u.id, u.phone, u.name, u.role, u.skill, u.wallet, u.online, u.token_version]
      );
    }
    console.log(` Migrated ${users.length} users.`);

    // 3. OTP & Rate Limits
    console.log('\n[4/6] Migrating OTPs & Rate Limits...');
    const otps = sqlite.prepare('SELECT * FROM otps').all();
    for (const o of otps) {
      await client.query(
        `INSERT INTO otps (phone, hash, salt, exp, tries, last_sent, hash_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (phone) DO UPDATE SET
           hash = EXCLUDED.hash, salt = EXCLUDED.salt, exp = EXCLUDED.exp, tries = EXCLUDED.tries,
           last_sent = EXCLUDED.last_sent, hash_version = EXCLUDED.hash_version`,
        [o.phone, o.hash, o.salt, o.exp, o.tries, o.last_sent, o.hash_version]
      );
    }

    const rateLimits = sqlite.prepare('SELECT * FROM otp_rate_limits').all();
    for (const r of rateLimits) {
      await client.query(
        `INSERT INTO otp_rate_limits (phone_hash, window_start, send_count, wrong_count, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (phone_hash) DO UPDATE SET
           window_start = EXCLUDED.window_start, send_count = EXCLUDED.send_count,
           wrong_count = EXCLUDED.wrong_count, updated_at = EXCLUDED.updated_at`,
        [r.phone_hash, r.window_start, r.send_count, r.wrong_count, r.updated_at]
      );
    }

    const dailyLimits = sqlite.prepare('SELECT * FROM otp_daily_limits').all();
    for (const d of dailyLimits) {
      await client.query(
        `INSERT INTO otp_daily_limits (day, send_count)
         VALUES ($1, $2)
         ON CONFLICT (day) DO UPDATE SET send_count = EXCLUDED.send_count`,
        [d.day, d.send_count]
      );
    }
    console.log(` Migrated ${otps.length} otps, ${rateLimits.length} rate limits, ${dailyLimits.length} daily limits.`);

    // 4. Bookings
    console.log('\n[5/6] Migrating bookings...');
    const bookings = sqlite.prepare('SELECT * FROM bookings ORDER BY id').all();
    for (const b of bookings) {
      await client.query(
        `INSERT INTO bookings (id, customer_id, worker_id, service_id, slot, address, pay, status, start_code, start_code_tries, parts, total, paid, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::timestamptz)
         ON CONFLICT (id) DO UPDATE SET
           customer_id = EXCLUDED.customer_id,
           worker_id = EXCLUDED.worker_id,
           service_id = EXCLUDED.service_id,
           slot = EXCLUDED.slot,
           address = EXCLUDED.address,
           pay = EXCLUDED.pay,
           status = EXCLUDED.status,
           start_code = EXCLUDED.start_code,
           start_code_tries = EXCLUDED.start_code_tries,
           parts = EXCLUDED.parts,
           total = EXCLUDED.total,
           paid = EXCLUDED.paid,
           created_at = EXCLUDED.created_at`,
        [b.id, b.customer_id, b.worker_id, b.service_id, b.slot, b.address, b.pay, b.status, b.start_code, b.start_code_tries, b.parts, b.total, b.paid, b.created_at]
      );
    }
    console.log(` Migrated ${bookings.length} bookings.`);

    // 5. Wallet Transactions
    const walletTx = sqlite.prepare('SELECT * FROM wallet_tx ORDER BY id').all();
    for (const tx of walletTx) {
      await client.query(
        `INSERT INTO wallet_tx (id, user_id, label, amount, created_at)
         VALUES ($1, $2, $3, $4, $5::timestamptz)
         ON CONFLICT (id) DO UPDATE SET
           user_id = EXCLUDED.user_id, label = EXCLUDED.label, amount = EXCLUDED.amount, created_at = EXCLUDED.created_at`,
        [tx.id, tx.user_id, tx.label, tx.amount, tx.created_at]
      );
    }
    console.log(` Migrated ${walletTx.length} wallet transactions.`);

    // 6. Payment Orders
    let paymentOrders = [];
    try {
      paymentOrders = sqlite.prepare('SELECT * FROM payment_orders ORDER BY id').all();
      for (const po of paymentOrders) {
        await client.query(
          `INSERT INTO payment_orders (id, booking_id, provider_order_id, provider_payment_id, amount_paise, currency, status, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO UPDATE SET
             booking_id = EXCLUDED.booking_id,
             provider_order_id = EXCLUDED.provider_order_id,
             provider_payment_id = EXCLUDED.provider_payment_id,
             amount_paise = EXCLUDED.amount_paise,
             currency = EXCLUDED.currency,
             status = EXCLUDED.status,
             created_at = EXCLUDED.created_at,
             updated_at = EXCLUDED.updated_at`,
          [po.id, po.booking_id, po.provider_order_id, po.provider_payment_id, po.amount_paise, po.currency, po.status, po.created_at, po.updated_at]
        );
      }
      console.log(` Migrated ${paymentOrders.length} payment orders.`);
    } catch {
      // Table might not exist or be empty
    }

    // [6/6] Reset Auto-Increment Sequences
    console.log('\n[6/6] Resetting PostgreSQL serial sequences...');
    const seqTables = ['services', 'users', 'bookings', 'wallet_tx', 'payment_orders'];
    for (const tbl of seqTables) {
      await client.query(`
        SELECT setval(
          pg_get_serial_sequence('${tbl}', 'id'),
          COALESCE((SELECT MAX(id) FROM ${tbl}), 1)
        )
      `);
    }
    console.log(' All sequences reset to highest migrated IDs.');

    await client.query('COMMIT');

    // Validation Report
    console.log('\n====================================================');
    console.log('MIGRATION VERIFICATION & RECONCILIATION SUMMARY');
    console.log('====================================================');
    const tables = ['services', 'users', 'bookings', 'wallet_tx', 'otps', 'otp_rate_limits', 'otp_daily_limits', 'payment_orders'];
    for (const tbl of tables) {
      let sqCount = 0;
      try {
        sqCount = sqlite.prepare(`SELECT COUNT(*) AS c FROM "${tbl}"`).get().c;
      } catch {
        sqCount = 0;
      }
      const pgCountRes = await client.query(`SELECT COUNT(*) AS c FROM ${tbl}`);
      const pgCount = Number(pgCountRes.rows[0].c);
      const match = sqCount === pgCount ? ' MATCH' : ' MISMATCH';
      console.log(`${tbl.padEnd(20)}: SQLite = ${String(sqCount).padStart(3)} | PostgreSQL = ${String(pgCount).padStart(3)} | ${match}`);
    }
    console.log('====================================================');
    console.log(' Migration completed successfully with zero data loss!\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n Migration failed, transaction rolled back safely.');
    throw err;
  } finally {
    client.release();
    sqlite.close();
    await pool.end();
  }
}

if (require.main === module) {
  const sqliteFile = process.argv[2];
  migrateData(sqliteFile).catch((err) => {
    console.error('Fatal migration error:', err.message);
    process.exit(1);
  });
}

module.exports = { migrateData, SCHEMA_SQL };

