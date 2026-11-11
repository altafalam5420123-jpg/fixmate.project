const { Pool } = require('pg');

const CATEGORIES = [
  'Electrician',
  'Plumber',
  'AC Repair',
  'TV Repair',
  'Washing Machine',
  'Refrigerator',
  'RO & Water Purifier',
  'Microwave',
  'Carpenter',
  'Home Cleaning',
  'Pest Control',
  'Painting',
  'Appliance Installation',
  'General Home Maintenance',
  'Mechanic',
  'Home Tutor'
];

const SERVICES = [
  ['Electrician', 'Switch aur socket repair', 149, 4.8],
  ['Electrician', 'Fan install ya repair', 199, 4.8],
  ['Electrician', 'Inverter aur wiring check', 249, 4.7],
  ['Plumber', 'Tap aur leakage repair', 149, 4.8],
  ['Plumber', 'Bathroom fitting', 299, 4.7],
  ['Plumber', 'Water tank cleaning', 499, 4.8],
  ['AC Repair', 'Split AC service', 499, 4.9],
  ['AC Repair', 'AC gas refill', 1499, 4.7],
  ['TV Repair', 'TV diagnosis', 199, 4.7],
  ['TV Repair', 'TV wall mount', 349, 4.8],
  ['Mechanic', 'Bike service (pickup aur drop)', 399, 4.8],
  ['Mechanic', 'Car check-up', 599, 4.6],
  ['Home Tutor', 'Class 6 se 10 Maths aur Science', 1500, 4.9],
  ['Home Tutor', 'English aur coding basics', 1200, 4.8],
];

const DEFAULT_AMC_PLANS = [
  ['Split/Window AC Annual Shield', 'AC Repair', 12, 1499, 3, '3 Jet Pump Services, Coil Cleaning, Gas Pressure Check, Free Visiting Charge', 'Compressor replacement, copper pipe extensions, gas refill charges'],
  ['Washing Machine Care AMC', 'Washing Machine', 12, 999, 2, '2 Preventive Drain & Drum Cleanings, Sensor Check, Zero Visit Fee', 'PCB board replacement, outer tub physical damage'],
  ['RO Water Purifier Annual Plan', 'RO & Water Purifier', 12, 1299, 3, '2 Periodic Checkups + Sediment/Carbon Filter Cleaning, TDS Calibration', 'RO Membrane & Booster Pump cost (15% member discount applies)'],
  ['Home Electrical & Plumbing Protect', 'Electrician', 12, 899, 4, '4 Emergency Checkup Visits, MCB & Wiring Safety Audit, Zero Visit Charge', 'Major concealed rewiring, bathroom tiles dismantling']
];

const DEFAULT_SERVICE_AREAS = [
  ['826001', 'Dhanbad', 'Bank More / Saraidhela / Court More'],
  ['826004', 'Dhanbad', 'Bartand / Hirapur / Police Line'],
  ['826005', 'Dhanbad', 'Jharia / Bhuli / Katras Road'],
  ['828109', 'Dhanbad', 'Govindpur / ISM Campus Area'],
  ['828111', 'Dhanbad', 'Sindri / Baliapur Area']
];

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  phone VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('customer', 'worker', 'admin')),
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

-- Phase 1 & 2 Extended Tables
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  slug VARCHAR(100) NOT NULL UNIQUE,
  icon VARCHAR(50),
  description TEXT,
  is_active SMALLINT NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS addresses (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label VARCHAR(50) NOT NULL DEFAULT 'Home',
  address_line TEXT NOT NULL,
  landmark VARCHAR(150),
  city VARCHAR(100) NOT NULL DEFAULT 'Dhanbad',
  pincode VARCHAR(10) NOT NULL DEFAULT '826001',
  lat NUMERIC(10, 7),
  lng NUMERIC(10, 7),
  is_default SMALLINT NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS addresses_user_idx ON addresses(user_id, is_default DESC);

CREATE TABLE IF NOT EXISTS coupons (
  id SERIAL PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  title VARCHAR(150) NOT NULL,
  discount_type VARCHAR(20) NOT NULL CHECK (discount_type IN ('percentage', 'flat')),
  discount_value INTEGER NOT NULL CHECK (discount_value > 0),
  min_order_amount INTEGER NOT NULL DEFAULT 0 CHECK (min_order_amount >= 0),
  max_discount INTEGER CHECK (max_discount IS NULL OR max_discount > 0),
  usage_limit INTEGER DEFAULT 100,
  times_used INTEGER NOT NULL DEFAULT 0,
  valid_until TIMESTAMPTZ,
  is_active SMALLINT NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, id DESC);

-- Phase 8 Tables: AMC Plans, Subscriptions, Family Accounts, Service Reminders & Service Areas
CREATE TABLE IF NOT EXISTS amc_plans (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE,
  category VARCHAR(80) NOT NULL,
  description TEXT,
  validity_months INTEGER NOT NULL DEFAULT 12 CHECK (validity_months > 0),
  price INTEGER NOT NULL CHECK (price > 0),
  visits_included INTEGER NOT NULL DEFAULT 2 CHECK (visits_included > 0),
  inclusions TEXT,
  exclusions TEXT,
  is_active SMALLINT NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS amc_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES amc_plans(id),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  visits_used INTEGER NOT NULL DEFAULT 0 CHECK (visits_used >= 0),
  visits_total INTEGER NOT NULL CHECK (visits_total > 0),
  start_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  end_date TIMESTAMPTZ NOT NULL,
  price_paid INTEGER NOT NULL CHECK (price_paid >= 0),
  payment_method VARCHAR(20) NOT NULL DEFAULT 'wallet',
  auto_renew SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS amc_sub_user_idx ON amc_subscriptions(user_id, id DESC);

CREATE TABLE IF NOT EXISTS family_members (
  id SERIAL PRIMARY KEY,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_name VARCHAR(100) NOT NULL,
  member_phone VARCHAR(20) NOT NULL,
  relation VARCHAR(50) NOT NULL DEFAULT 'Family',
  can_book SMALLINT NOT NULL DEFAULT 1 CHECK (can_book IN (0, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS family_owner_idx ON family_members(owner_user_id, id DESC);

CREATE TABLE IF NOT EXISTS service_reminders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category VARCHAR(80) NOT NULL,
  title VARCHAR(150) NOT NULL,
  interval_months INTEGER NOT NULL DEFAULT 6 CHECK (interval_months > 0),
  next_due_date TIMESTAMPTZ NOT NULL,
  enabled SMALLINT NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS reminders_user_idx ON service_reminders(user_id, next_due_date ASC);

CREATE TABLE IF NOT EXISTS service_areas (
  id SERIAL PRIMARY KEY,
  pincode VARCHAR(10) NOT NULL UNIQUE,
  city VARCHAR(100) NOT NULL DEFAULT 'Dhanbad',
  area_name VARCHAR(150) NOT NULL,
  is_active SMALLINT NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

function getPoolConfig(customConfig = {}) {
  const connectionString = customConfig.connectionString || process.env.DATABASE_URL;

  if (connectionString) {
    const isSsl = process.env.DB_SSL === 'true' ||
      connectionString.includes('sslmode=require') ||
      connectionString.includes('neon.tech') ||
      connectionString.includes('supabase.co');

    return {
      connectionString,
      ssl: isSsl ? { rejectUnauthorized: false } : (process.env.DB_SSL === 'false' ? false : undefined),
      max: Number(process.env.DB_POOL_MAX) || 20,
      idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS) || 30000,
      connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 5000,
      ...customConfig
    };
  }

  return {
    host: customConfig.host || process.env.PGHOST || process.env.DB_HOST || 'localhost',
    port: Number(customConfig.port || process.env.PGPORT || process.env.DB_PORT) || 5432,
    database: customConfig.database || process.env.PGDATABASE || process.env.DB_NAME || 'fixmate',
    user: customConfig.user || process.env.PGUSER || process.env.DB_USER || 'postgres',
    password: customConfig.password !== undefined ? customConfig.password : (process.env.PGPASSWORD || process.env.DB_PASSWORD || ''),
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: Number(process.env.DB_POOL_MAX) || 20,
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS) || 30000,
    connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS) || 5000,
    ...customConfig
  };
}

function openMemoryDb() {
  const Database = require('better-sqlite3');
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');

  sqlite.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('customer', 'worker', 'admin')),
      skill TEXT,
      wallet INTEGER NOT NULL DEFAULT 0 CHECK (wallet >= 0),
      online INTEGER NOT NULL DEFAULT 1 CHECK (online IN (0, 1)),
      token_version INTEGER NOT NULL DEFAULT 0 CHECK (token_version >= 0),
      experience_years INTEGER DEFAULT 2,
      id_document_url TEXT,
      id_verified INTEGER DEFAULT 1,
      service_areas TEXT DEFAULT 'All Dhanbad',
      CHECK (role != 'worker' OR skill IS NOT NULL)
    );
    CREATE TABLE otps (
      phone TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      exp INTEGER NOT NULL,
      tries INTEGER NOT NULL DEFAULT 0,
      last_sent INTEGER NOT NULL,
      hash_version INTEGER NOT NULL DEFAULT 0 CHECK (hash_version IN (0, 1))
    );
    CREATE TABLE services (
      id INTEGER PRIMARY KEY,
      cat TEXT NOT NULL,
      name TEXT NOT NULL,
      price INTEGER NOT NULL CHECK (price >= 0),
      rating REAL NOT NULL CHECK (rating >= 0 AND rating <= 5),
      UNIQUE (cat, name)
    );
    CREATE TABLE bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES users(id),
      worker_id INTEGER REFERENCES users(id),
      service_id INTEGER NOT NULL REFERENCES services(id),
      slot TEXT NOT NULL,
      address TEXT NOT NULL,
      pay TEXT NOT NULL CHECK (pay IN ('wallet', 'cash', 'razorpay')),
      status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'assigned', 'on_the_way', 'inspecting', 'quoted', 'in_progress', 'completed', 'closed', 'cancelled')),
      start_code TEXT NOT NULL,
      start_code_tries INTEGER NOT NULL DEFAULT 0 CHECK (start_code_tries >= 0),
      parts INTEGER NOT NULL DEFAULT 0 CHECK (parts >= 0),
      total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
      paid INTEGER NOT NULL DEFAULT 0 CHECK (paid IN (0, 1)),
      issue_desc TEXT,
      photo_url TEXT,
      coupon_code TEXT,
      discount_amount INTEGER DEFAULT 0,
      is_emergency INTEGER DEFAULT 0,
      start_photo_url TEXT,
      complete_photo_url TEXT,
      parts_desc TEXT,
      warranty_days INTEGER DEFAULT 30,
      completed_at TEXT,
      customer_lat REAL,
      customer_lng REAL,
      worker_lat REAL,
      worker_lng REAL,
      tracking_active INTEGER DEFAULT 0,
      eta_minutes INTEGER,
      location_updated_at TEXT,
      emergency_fee INTEGER DEFAULT 0,
      family_member_name TEXT,
      amc_subscription_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      icon TEXT,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE addresses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      label TEXT NOT NULL DEFAULT 'Home',
      address_line TEXT NOT NULL,
      landmark TEXT,
      city TEXT NOT NULL DEFAULT 'Dhanbad',
      pincode TEXT NOT NULL DEFAULT '826001',
      lat REAL,
      lng REAL,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      discount_type TEXT NOT NULL,
      discount_value INTEGER NOT NULL,
      min_order_amount INTEGER NOT NULL DEFAULT 0,
      max_discount INTEGER,
      usage_limit INTEGER DEFAULT 100,
      times_used INTEGER NOT NULL DEFAULT 0,
      valid_until TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
      customer_id INTEGER NOT NULL REFERENCES users(id),
      worker_id INTEGER REFERENCES users(id),
      rating REAL NOT NULL CHECK (rating >= 1 AND rating <= 5),
      comment TEXT,
      photos TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE booking_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL REFERENCES bookings(id),
      old_status TEXT,
      new_status TEXT NOT NULL,
      changed_by_user_id INTEGER REFERENCES users(id),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE complaints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER REFERENCES bookings(id),
      customer_id INTEGER NOT NULL REFERENCES users(id),
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_investigation', 'resolved', 'closed')),
      resolution_notes TEXT,
      refund_requested INTEGER NOT NULL DEFAULT 0,
      refund_amount INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT
    );
    CREATE TABLE ai_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      cards_json TEXT,
      provider TEXT DEFAULT 'fixmate-ai',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'FixMate Update',
      body TEXT NOT NULL,
      type TEXT DEFAULT 'booking_status',
      data_json TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      dedupe_key TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, dedupe_key)
    );
    CREATE TABLE wallet_tx (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      label TEXT NOT NULL,
      amount INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE otp_rate_limits (
      phone_hash TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      send_count INTEGER NOT NULL DEFAULT 0 CHECK (send_count >= 0),
      wrong_count INTEGER NOT NULL DEFAULT 0 CHECK (wrong_count >= 0),
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE otp_daily_limits (
      day TEXT PRIMARY KEY,
      send_count INTEGER NOT NULL DEFAULT 0 CHECK (send_count >= 0)
    );
    CREATE TABLE payment_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL REFERENCES bookings(id),
      provider_order_id TEXT UNIQUE,
      provider_payment_id TEXT UNIQUE,
      amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
      currency TEXT NOT NULL CHECK (currency = 'INR'),
      status TEXT NOT NULL CHECK (status IN ('creating', 'created', 'paid', 'failed', 'expired')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE amc_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      description TEXT,
      validity_months INTEGER NOT NULL DEFAULT 12,
      price INTEGER NOT NULL,
      visits_included INTEGER NOT NULL DEFAULT 2,
      inclusions TEXT,
      exclusions TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE amc_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id INTEGER NOT NULL REFERENCES amc_plans(id),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
      visits_used INTEGER NOT NULL DEFAULT 0,
      visits_total INTEGER NOT NULL,
      start_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      end_date TEXT NOT NULL,
      price_paid INTEGER NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'wallet',
      auto_renew INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE family_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      member_name TEXT NOT NULL,
      member_phone TEXT NOT NULL,
      relation TEXT NOT NULL DEFAULT 'Family',
      can_book INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE service_reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      interval_months INTEGER NOT NULL DEFAULT 6,
      next_due_date TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE service_areas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pincode TEXT NOT NULL UNIQUE,
      city TEXT NOT NULL DEFAULT 'Dhanbad',
      area_name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const seed = sqlite.prepare('INSERT OR IGNORE INTO services (id, cat, name, price, rating) VALUES (?, ?, ?, ?, ?)');
  SERVICES.forEach((service, index) => seed.run(index + 1, ...service));

  const seedAmc = sqlite.prepare('INSERT OR IGNORE INTO amc_plans (id, name, category, validity_months, price, visits_included, inclusions, exclusions) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  DEFAULT_AMC_PLANS.forEach((p, idx) => seedAmc.run(idx + 1, ...p));

  const seedArea = sqlite.prepare('INSERT OR IGNORE INTO service_areas (pincode, city, area_name) VALUES (?, ?, ?)');
  DEFAULT_SERVICE_AREAS.forEach((a) => seedArea.run(...a));

  const runQuery = (sql, params = []) => {
    let cleanSql = sql
      .replace(/::[a-zA-Z_]+/g, '')
      .replace(/ILIKE/gi, 'LIKE');

    const expandedParams = [];
    cleanSql = cleanSql.replace(/\$(\d+)/g, (_, idx) => {
      const pIndex = parseInt(idx, 10) - 1;
      expandedParams.push(params[pIndex]);
      return '?';
    });

    const hasReturning = /RETURNING\s+/i.test(cleanSql);
    cleanSql = cleanSql.replace(/RETURNING\s+.*$/i, '').trim();

    const isSelect = /^\s*SELECT/i.test(cleanSql);
    if (isSelect) {
      const rows = sqlite.prepare(cleanSql).all(...expandedParams);
      return { rows, rowCount: rows.length };
    }

    const info = sqlite.prepare(cleanSql).run(...expandedParams);
    const rows = hasReturning ? [{ id: Number(info.lastInsertRowid) }] : [];
    return { rows, rowCount: info.changes };
  };

  return {
    isMemory: true,
    sqlite,
    prepare(sql) {
      return sqlite.prepare(sql);
    },
    pragma(...args) {
      return sqlite.pragma(...args);
    },
    exec(...args) {
      return sqlite.exec(...args);
    },
    async query(text, params = []) {
      return runQuery(text, params);
    },
    async queryOne(text, params = []) {
      const res = runQuery(text, params);
      return res.rows[0] || null;
    },
    async transaction(callback) {
      sqlite.exec('BEGIN');
      try {
        const tx = {
          query: async (text, params) => runQuery(text, params),
          queryOne: async (text, params) => {
            const res = runQuery(text, params);
            return res.rows[0] || null;
          }
        };
        const result = await callback(tx);
        sqlite.exec('COMMIT');
        return result;
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
    },
    async initDb() {
      return true;
    },
    async close() {
      sqlite.close();
    }
  };
}

let defaultDbInstance = null;

function openDb(config = {}) {
  if (config === ':memory:' || (typeof config === 'object' && config.memory)) {
    return openMemoryDb();
  }

  if (defaultDbInstance && Object.keys(config).length === 0) {
    return defaultDbInstance;
  }

  const poolConfig = getPoolConfig(config);
  const pool = new Pool(poolConfig);

  pool.on('error', (err) => {
    console.error('[PostgreSQL Pool Unexpected Error]:', err.message);
  });

  const db = {
    pool,

    async query(text, params = []) {
      try {
        return await pool.query(text, params);
      } catch (err) {
        console.error(`[PostgreSQL Query Error]: ${err.message}\nSQL: ${text}\nParams:`, params);
        throw err;
      }
    },

    async queryOne(text, params = []) {
      const res = await this.query(text, params);
      return res.rows[0] || null;
    },

    async transaction(callback) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tx = {
          client,
          query: (text, params) => client.query(text, params),
          queryOne: async (text, params) => {
            const res = await client.query(text, params);
            return res.rows[0] || null;
          }
        };
        const result = await callback(tx);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // ignore rollback error
        }
        throw err;
      } finally {
        client.release();
      }
    },

    async initDb() {
      try {
        await this.query(SCHEMA_SQL);

        // Additive non-breaking Phase 2 booking columns
        try {
          await this.query(`
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS issue_desc TEXT;
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS photo_url TEXT;
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(30);
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS discount_amount INTEGER DEFAULT 0;
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_emergency SMALLINT DEFAULT 0;
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS start_photo_url TEXT;
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS complete_photo_url TEXT;
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS parts_desc TEXT;
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS warranty_days INTEGER DEFAULT 30;
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_lat NUMERIC(10, 7);
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_lng NUMERIC(10, 7);
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS worker_lat NUMERIC(10, 7);
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS worker_lng NUMERIC(10, 7);
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS tracking_active SMALLINT DEFAULT 0;
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS eta_minutes INTEGER;
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ;
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS emergency_fee INTEGER DEFAULT 0;
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS family_member_name VARCHAR(100);
            ALTER TABLE bookings ADD COLUMN IF NOT EXISTS amc_subscription_id INTEGER;

            ALTER TABLE users ADD COLUMN IF NOT EXISTS experience_years INTEGER DEFAULT 2;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS id_document_url TEXT;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS id_verified SMALLINT DEFAULT 1;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS service_areas VARCHAR(255) DEFAULT 'All Dhanbad';

            ALTER TABLE notifications ADD COLUMN IF NOT EXISTS booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE;
            ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(100);
            ALTER TABLE notifications ADD COLUMN IF NOT EXISTS data_json TEXT;
            DROP INDEX IF EXISTS notifications_dedupe_idx;
            CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_dedupe_uidx ON notifications(user_id, dedupe_key);

            ALTER TABLE amc_plans ADD COLUMN IF NOT EXISTS inclusions TEXT;
            ALTER TABLE amc_plans ADD COLUMN IF NOT EXISTS exclusions TEXT;
          `);
        } catch (colErr) {
          console.warn('[PostgreSQL Init Notice] Column migration:', colErr.message);
        }

        // Check if services are seeded
        const serviceCount = await this.queryOne('SELECT COUNT(*) AS c FROM services');
        if (Number(serviceCount.c) === 0) {
          await this.transaction(async (tx) => {
            for (let i = 0; i < SERVICES.length; i++) {
              const [cat, name, price, rating] = SERVICES[i];
              await tx.query(
                `INSERT INTO services (id, cat, name, price, rating)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (id) DO UPDATE SET cat = EXCLUDED.cat, name = EXCLUDED.name, price = EXCLUDED.price, rating = EXCLUDED.rating`,
                [i + 1, cat, name, price, rating]
              );
            }
            await tx.query(`SELECT setval(pg_get_serial_sequence('services', 'id'), COALESCE((SELECT MAX(id) FROM services), 1))`);
          });
          console.log('[PostgreSQL] Seed services inserted successfully.');
        }

        // Ensure default Master Admin exists
        try {
          await this.query(`
            INSERT INTO users (phone, name, role, skill, wallet)
            VALUES ('9999999999', 'FixMate Master Admin', 'admin', NULL, 10000)
            ON CONFLICT (phone) DO UPDATE SET role = 'admin'
          `);
        } catch (adminErr) {
          console.warn('[PostgreSQL Init Notice] Admin seed:', adminErr.message);
        }

        // Seed AMC Plans if empty
        try {
          const amcCnt = await this.queryOne('SELECT COUNT(*) AS c FROM amc_plans');
          if (Number(amcCnt.c) === 0) {
            for (const p of DEFAULT_AMC_PLANS) {
              const exists = await this.queryOne('SELECT id FROM amc_plans WHERE name = $1', [p[0]]);
              if (!exists) {
                await this.query(
                  `INSERT INTO amc_plans (name, category, validity_months, price, visits_included, inclusions, exclusions)
                   VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                  p
                );
              }
            }
          }
          const areaCnt = await this.queryOne('SELECT COUNT(*) AS c FROM service_areas');
          if (Number(areaCnt.c) === 0) {
            for (const a of DEFAULT_SERVICE_AREAS) {
              await this.query(
                `INSERT INTO service_areas (pincode, city, area_name)
                 VALUES ($1, $2, $3) ON CONFLICT (pincode) DO NOTHING`,
                a
              );
            }
          }
        } catch (seedErr) {
          console.warn('[PostgreSQL Init Notice] Phase 8 seeds:', seedErr.message);
        }

        return true;
      } catch (err) {
        if (err.code === 'ECONNREFUSED') {
          console.error('\n[FixMate Database Connection Warning]');
          console.error(`PostgreSQL server se connection nahi ho paya (${poolConfig.host || 'localhost'}:${poolConfig.port || 5432}).`);
          console.error('Kripya apna PostgreSQL service start karein ya .env file mein DATABASE_URL set karein.\n');
        }
        throw err;
      }
    },

    async close() {
      await pool.end();
    }
  };

  if (Object.keys(config).length === 0) {
    defaultDbInstance = db;
  }

  return db;
}

function migrateSchema(db) {
  if (!db || typeof db.pragma !== 'function') return;
  let version = db.pragma('user_version', { simple: true });
  if (version < 1) {
    const migrate = db.transaction(() => {
      const ensureColumn = (table, name, definition) => {
        const columns = db.pragma(`table_info(${table})`);
        if (!columns.some((column) => column.name === name)) {
          db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
        }
      };
      ensureColumn('users', 'online', 'INTEGER NOT NULL DEFAULT 1 CHECK (online IN (0, 1))');
      ensureColumn('users', 'token_version', 'INTEGER NOT NULL DEFAULT 0 CHECK (token_version >= 0)');
      ensureColumn('otps', 'hash_version', 'INTEGER NOT NULL DEFAULT 0 CHECK (hash_version IN (0, 1))');
      ensureColumn('bookings', 'start_code_tries', 'INTEGER NOT NULL DEFAULT 0 CHECK (start_code_tries >= 0)');
      db.exec(`
        CREATE TABLE IF NOT EXISTS otp_rate_limits (
          phone_hash TEXT PRIMARY KEY,
          window_start INTEGER NOT NULL,
          send_count INTEGER NOT NULL DEFAULT 0 CHECK (send_count >= 0),
          wrong_count INTEGER NOT NULL DEFAULT 0 CHECK (wrong_count >= 0),
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS otp_rate_limits_updated_idx ON otp_rate_limits(updated_at);
        CREATE TABLE IF NOT EXISTS otp_daily_limits (
          day TEXT PRIMARY KEY,
          send_count INTEGER NOT NULL DEFAULT 0 CHECK (send_count >= 0)
        );
      `);
      db.pragma('user_version = 1');
    });
    migrate.immediate();
    version = 1;
  }

  if (version < 2) {
    const migrate = db.transaction(() => {
      db.exec(`
        DROP INDEX IF EXISTS bookings_customer_idx;
        DROP INDEX IF EXISTS bookings_worker_status_idx;
        CREATE TABLE bookings_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          customer_id INTEGER NOT NULL REFERENCES users(id),
          worker_id INTEGER REFERENCES users(id),
          service_id INTEGER NOT NULL REFERENCES services(id),
          slot TEXT NOT NULL,
          address TEXT NOT NULL,
          pay TEXT NOT NULL CHECK (pay IN ('wallet', 'cash', 'razorpay')),
          status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'assigned', 'on_the_way', 'inspecting', 'quoted', 'in_progress', 'completed', 'closed')),
          start_code TEXT NOT NULL,
          start_code_tries INTEGER NOT NULL DEFAULT 0 CHECK (start_code_tries >= 0),
          parts INTEGER NOT NULL DEFAULT 0 CHECK (parts >= 0),
          total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
          paid INTEGER NOT NULL DEFAULT 0 CHECK (paid IN (0, 1)),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO bookings_new(id,customer_id,worker_id,service_id,slot,address,pay,status,start_code,start_code_tries,parts,total,paid,created_at)
        SELECT id,customer_id,worker_id,service_id,slot,address,pay,status,start_code,start_code_tries,parts,total,paid,created_at FROM bookings;
        DROP TABLE bookings;
        ALTER TABLE bookings_new RENAME TO bookings;
        CREATE INDEX bookings_customer_idx ON bookings(customer_id, id DESC);
        CREATE INDEX bookings_worker_status_idx ON bookings(worker_id, status);
        CREATE TABLE payment_orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          booking_id INTEGER NOT NULL REFERENCES bookings(id),
          provider_order_id TEXT UNIQUE,
          provider_payment_id TEXT UNIQUE,
          amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
          currency TEXT NOT NULL CHECK (currency = 'INR'),
          status TEXT NOT NULL CHECK (status IN ('creating', 'created', 'paid', 'failed', 'expired')),
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX payment_orders_active_booking_idx ON payment_orders(booking_id)
          WHERE status IN ('creating', 'created');
        CREATE INDEX payment_orders_booking_idx ON payment_orders(booking_id, id DESC);
      `);
      db.pragma('user_version = 2');
    });
    migrate.immediate();
    version = 2;
  }
}

module.exports = {
  openDb,
  migrateSchema,
  CATEGORIES,
  SERVICES,
  SCHEMA_SQL
};
