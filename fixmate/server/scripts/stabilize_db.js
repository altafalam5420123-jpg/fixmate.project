/**
 * Phase 1: Database Stabilization & Schema Extension
 * Adds enterprise tables without altering or deleting any existing records.
 */
const path = require('path');
const serverDir = path.resolve('fixmate/server');
require(path.join(serverDir, 'node_modules', 'dotenv')).config({ path: path.join(serverDir, '.env') });
const { Pool } = require(path.join(serverDir, 'node_modules', 'pg'));

const EXTENDED_CATEGORIES = [
  { name: 'Electrician', slug: 'electrician', icon: 'zap', description: 'Switch, fan, wiring, inverter & appliance repair' },
  { name: 'Plumber', slug: 'plumber', icon: 'droplet', description: 'Tap leakage, pipe fitting, water tank & bathroom' },
  { name: 'AC Repair', slug: 'ac-repair', icon: 'wind', description: 'Split & window AC service, gas refill, installation' },
  { name: 'TV Repair', slug: 'tv-repair', icon: 'tv', description: 'LED/LCD TV repair, wall mounting & diagnosis' },
  { name: 'Washing Machine', slug: 'washing-machine', icon: 'disc', description: 'Front/top load washing machine repair & spin check' },
  { name: 'Refrigerator', slug: 'refrigerator', icon: 'box', description: 'Single & double door fridge cooling and gas refill' },
  { name: 'RO & Water Purifier', slug: 'ro-purifier', icon: 'filter', description: 'Filter replacement, membrane service & installation' },
  { name: 'Microwave', slug: 'microwave', icon: 'radio', description: 'Heating issues, keypad and turntable repair' },
  { name: 'Carpenter', slug: 'carpenter', icon: 'tool', description: 'Furniture repair, door locks, hinges & custom woodwork' },
  { name: 'Home Cleaning', slug: 'home-cleaning', icon: 'sparkles', description: 'Deep home cleaning, bathroom & kitchen scrubbing' },
  { name: 'Pest Control', slug: 'pest-control', icon: 'shield', description: 'Cockroach, termite, mosquito & bedbug treatment' },
  { name: 'Painting', slug: 'painting', icon: 'brush', description: 'Interior/exterior wall painting & waterproof coating' },
  { name: 'Appliance Installation', slug: 'appliance-installation', icon: 'cpu', description: 'Chimney, geyser, TV, AC & purifier installation' },
  { name: 'General Home Maintenance', slug: 'general-maintenance', icon: 'home', description: 'Drilling, hanging, door repair & miscellaneous fixes' },
  { name: 'Mechanic', slug: 'mechanic', icon: 'truck', description: 'Bike service, car check-up, puncture & breakdown assistance' },
  { name: 'Home Tutor', slug: 'home-tutor', icon: 'book', description: 'Maths, Science, English & Coding basics home tutors' }
];

const EXTENDED_SERVICES = [
  ['Washing Machine', 'Washing machine check-up & repair', 249, 4.8],
  ['Washing Machine', 'Spin/motor breakdown fix', 399, 4.7],
  ['Refrigerator', 'Single door fridge repair', 299, 4.8],
  ['Refrigerator', 'Double door / Frost free service', 399, 4.9],
  ['RO & Water Purifier', 'RO general service & filter clean', 299, 4.8],
  ['RO & Water Purifier', 'Complete filter replacement', 899, 4.9],
  ['Microwave', 'Microwave heating diagnosis', 249, 4.7],
  ['Carpenter', 'Door lock & handle repair', 199, 4.8],
  ['Carpenter', 'Furniture & bed repair', 349, 4.7],
  ['Home Cleaning', 'Full house deep cleaning (1-2 BHK)', 1499, 4.9],
  ['Home Cleaning', 'Bathroom deep cleaning (1 unit)', 399, 4.8],
  ['Pest Control', 'General pest control (Cockroach/Ants)', 799, 4.8],
  ['Painting', '1 Room wall touch-up & painting', 1999, 4.7],
  ['Appliance Installation', 'Geyser installation', 349, 4.8],
  ['Appliance Installation', 'Kitchen chimney installation', 499, 4.9],
  ['General Home Maintenance', 'Minor repairs (drill, hang, latch)', 199, 4.8]
];

async function stabilizeSchema() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL not found in .env');
  }

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  const client = await pool.connect();
  try {
    console.log('Connecting to Neon PostgreSQL for Phase 1 Stabilization...');

    await client.query('BEGIN');

    // 1. Extend user role check constraint to include 'admin'
    console.log('[1/7] Updating user role constraints to include admin...');
    try {
      await client.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check');
      await client.query("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('customer', 'worker', 'admin'))");
    } catch (e) {
      console.log('  Constraint update notice:', e.message);
    }

    // 2. Categories table
    console.log('[2/7] Creating categories table...');
    await client.query(`
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
    `);

    for (let i = 0; i < EXTENDED_CATEGORIES.length; i++) {
      const cat = EXTENDED_CATEGORIES[i];
      await client.query(
        `INSERT INTO categories (name, slug, icon, description, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name,
           icon = EXCLUDED.icon,
           description = EXCLUDED.description,
           sort_order = EXCLUDED.sort_order`,
        [cat.name, cat.slug, cat.icon, cat.description, i + 1]
      );
    }
    console.log(`  Seeded ${EXTENDED_CATEGORIES.length} active service categories.`);

    // 3. Customer Saved Addresses
    console.log('[3/7] Creating customer addresses table...');
    await client.query(`
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
    `);

    // 4. Booking Status History (Audit Trail)
    console.log('[4/7] Creating booking status history table...');
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

    // 5. Reviews and Ratings
    console.log('[5/7] Creating customer reviews table...');
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

    // 6. Complaints & Support Tickets
    console.log('[6/7] Creating complaints & support tickets table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS complaints (
        id SERIAL PRIMARY KEY,
        ticket_number VARCHAR(30) NOT NULL UNIQUE,
        booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
        customer_id INTEGER NOT NULL REFERENCES users(id),
        category VARCHAR(100) NOT NULL,
        description TEXT NOT NULL,
        photo_url TEXT,
        status VARCHAR(30) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'resolved', 'closed')),
        resolution_notes TEXT,
        assigned_admin_id INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS complaints_customer_idx ON complaints(customer_id, id DESC);
      CREATE INDEX IF NOT EXISTS complaints_status_idx ON complaints(status);
    `);

    // 7. Coupons, AMC Plans, Notifications, AI Logs
    console.log('[7/7] Creating coupons, AMC plans, notifications & AI logs tables...');
    await client.query(`
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

      CREATE TABLE IF NOT EXISTS amc_plans (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        category VARCHAR(100) NOT NULL,
        description TEXT,
        price INTEGER NOT NULL CHECK (price > 0),
        validity_months INTEGER NOT NULL DEFAULT 12,
        visits_included INTEGER NOT NULL DEFAULT 3,
        is_active SMALLINT NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        plan_id INTEGER NOT NULL REFERENCES amc_plans(id),
        address TEXT NOT NULL,
        visits_left INTEGER NOT NULL,
        start_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        end_date TIMESTAMPTZ NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(150) NOT NULL,
        body TEXT NOT NULL,
        type VARCHAR(50) NOT NULL DEFAULT 'info',
        data_json TEXT,
        is_read SMALLINT NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS notif_user_idx ON notifications(user_id, is_read, id DESC);

      CREATE TABLE IF NOT EXISTS ai_conversations (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(100) NOT NULL,
        user_id INTEGER REFERENCES users(id),
        role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS ai_conv_session_idx ON ai_conversations(session_id, id ASC);

      CREATE TABLE IF NOT EXISTS ai_tool_logs (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(100),
        tool_name VARCHAR(100) NOT NULL,
        args_json TEXT,
        result_json TEXT,
        user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed default sample coupon (WELCOME50: 10% off up to ₹50)
    await client.query(`
      INSERT INTO coupons (code, title, discount_type, discount_value, min_order_amount, max_discount, usage_limit, is_active)
      VALUES ('WELCOME50', 'New User Welcome Discount (10% off up to ₹50)', 'percentage', 10, 149, 50, 1000, 1)
      ON CONFLICT (code) DO NOTHING;
    `);

    // Seed new services into services table
    for (const s of EXTENDED_SERVICES) {
      await client.query(`
        INSERT INTO services (cat, name, price, rating)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (cat, name) DO NOTHING
      `, [s[0], s[1], s[2], s[3]]);
    }

    // Reset sequences
    await client.query(`SELECT setval(pg_get_serial_sequence('services', 'id'), COALESCE((SELECT MAX(id) FROM services), 1))`);
    await client.query(`SELECT setval(pg_get_serial_sequence('categories', 'id'), COALESCE((SELECT MAX(id) FROM categories), 1))`);

    await client.query('COMMIT');
    console.log('\n Phase 1 Database Stabilization completed successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(' Stabilization failed, rolled back safely:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

stabilizeSchema().catch(console.error);

