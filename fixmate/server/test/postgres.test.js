const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { openDb, CATEGORIES, SERVICES } = require('../src/db');
const { executeTool } = require('../src/aiTools');
const { migrateData } = require('../scripts/migrate_sqlite_to_pg');

test('PostgreSQL Database Module: Exports & Constants', () => {
  assert.ok(Array.isArray(CATEGORIES));
  assert.equal(CATEGORIES.length, 16);
  assert.ok(CATEGORIES.includes('Electrician'));
  assert.ok(CATEGORIES.includes('Plumber'));
  assert.ok(CATEGORIES.includes('Washing Machine'));
  assert.ok(CATEGORIES.includes('Refrigerator'));
  assert.ok(Array.isArray(SERVICES));
  assert.equal(SERVICES.length, 14);
});

test('PostgreSQL Database Module: In-memory Adapter & Query Execution', async () => {
  const db = openDb(':memory:');
  await db.initDb();

  // Test query
  const services = await db.query('SELECT * FROM services WHERE cat = $1 ORDER BY id', ['Electrician']);
  assert.ok(services.rows.length >= 3);
  assert.equal(services.rows[0].cat, 'Electrician');

  // Test queryOne
  const first = await db.queryOne('SELECT * FROM services WHERE id = $1', [1]);
  assert.ok(first);
  assert.equal(first.id, 1);

  // Test transaction
  await db.transaction(async (tx) => {
    const userRes = await tx.query(
      'INSERT INTO users (phone, name, role, skill, wallet) VALUES ($1, $2, $3, $4, 500) RETURNING id',
      ['9999999999', 'Postgres Test User', 'customer', null]
    );
    assert.ok(userRes.rows[0].id);

    const insertedUser = await tx.queryOne('SELECT * FROM users WHERE phone = $1', ['9999999999']);
    assert.equal(insertedUser.name, 'Postgres Test User');
    assert.equal(insertedUser.wallet, 500);
  });

  const checkUser = await db.queryOne('SELECT * FROM users WHERE phone = $1', ['9999999999']);
  assert.equal(checkUser.phone, '9999999999');

  await db.close();
});

test('AI Voice & Chat Assistant: Database Tool Execution with PostgreSQL Adapter', async () => {
  const db = openDb(':memory:');
  await db.initDb();

  // 1. Tool: search_services
  const search = await executeTool('search_services', { query: 'fan', category: 'Electrician' }, { db, user: null });
  assert.equal(search.success, true);
  assert.ok(search.services.length > 0);
  assert.equal(search.services[0].category, 'Electrician');

  // 2. Tool: get_service_details
  const details = await executeTool('get_service_details', { service_id: 1 }, { db, user: null });
  assert.equal(details.success, true);
  assert.ok(details.service);
  assert.equal(details.service.id, 1);

  // 3. Tool: check_availability
  const avail = await executeTool('check_availability', { category: 'Electrician' }, { db, user: null });
  assert.equal(avail.success, true);
  assert.ok(avail.available_slots.length > 0);

  // 4. Tool: get_estimated_price
  const price = await executeTool('get_estimated_price', { service_id: 1, problem_description: 'Fan noisy' }, { db, user: null });
  assert.equal(price.success, true);
  assert.ok(price.inspection_visit_fee);

  // Create a customer user for booking tools
  const userRes = await db.query(
    'INSERT INTO users (phone, name, role, skill, wallet) VALUES ($1, $2, $3, $4, 1000) RETURNING id',
    ['9888888888', 'AI Customer', 'customer', null]
  );
  const testUser = { id: userRes.rows[0].id, role: 'customer', phone: '9888888888', name: 'AI Customer' };

  // 5. Tool: create_booking
  const booking = await executeTool('create_booking', {
    service_id: 1,
    slot: 'Abhi (60 min mein)',
    address: 'Dhanbad Station Road',
    pay_method: 'wallet',
    confirmed: true
  }, { db, user: testUser });

  assert.equal(booking.success, true);
  assert.ok(booking.booking.id);
  assert.equal(booking.booking.status, 'requested');

  // 6. Tool: get_booking_status
  const status = await executeTool('get_booking_status', { booking_id: booking.booking.id }, { db, user: testUser });
  assert.equal(status.success, true);
  assert.equal(status.bookings.length, 1);
  assert.equal(status.bookings[0].booking_id, booking.booking.id);

  // 7. Tool: request_booking_cancellation
  const cancel = await executeTool('request_booking_cancellation', { booking_id: booking.booking.id }, { db, user: testUser });
  assert.equal(cancel.success, true);
  assert.equal(cancel.cancelled, true);

  await db.close();
});

test('Phase 1 API Extensions: Categories, Addresses, and Coupons', async () => {
  const jwt = require('jsonwebtoken');
  const { createApp } = require('../src/app');
  const db = openDb(':memory:');
  await db.initDb();

  // Create tables for test in-memory db
  db.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      icon TEXT,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS addresses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      label TEXT NOT NULL DEFAULT 'Home',
      address_line TEXT NOT NULL,
      landmark TEXT,
      city TEXT NOT NULL DEFAULT 'Dhanbad',
      pincode TEXT NOT NULL DEFAULT '826001',
      lat REAL,
      lng REAL,
      is_default INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      discount_type TEXT NOT NULL,
      discount_value INTEGER NOT NULL,
      min_order_amount INTEGER NOT NULL DEFAULT 0,
      max_discount INTEGER,
      usage_limit INTEGER DEFAULT 100,
      times_used INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    INSERT INTO categories (name, slug, icon, description, sort_order) VALUES ('Electrician', 'electrician', 'zap', 'Electrician in Dhanbad', 1);
    INSERT INTO coupons (code, title, discount_type, discount_value, min_order_amount, max_discount, is_active)
      VALUES ('WELCOME50', 'New User 10% Off', 'percentage', 10, 149, 50, 1);
  `);

  const server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${server.address().port}`;

  try {
    // 1. GET /api/categories
    const catRes = await fetch(`${base}/api/categories`);
    assert.equal(catRes.status, 200);
    const catData = await catRes.json();
    assert.equal(catData.success, true);
    assert.ok(catData.categories.length > 0);

    // 2. GET /api/coupons
    const couponRes = await fetch(`${base}/api/coupons`);
    assert.equal(couponRes.status, 200);
    const couponData = await couponRes.json();
    assert.equal(couponData.success, true);
    assert.ok(couponData.coupons.length > 0);
    assert.equal(couponData.coupons[0].code, 'WELCOME50');

    // 3. POST /api/coupons/apply
    const applyRes = await fetch(`${base}/api/coupons/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'WELCOME50', amount: 300 })
    });
    assert.equal(applyRes.status, 200);
    const applyData = await applyRes.json();
    assert.equal(applyData.valid, true);
    assert.equal(applyData.discount_amount, 30); // 10% of 300
    assert.equal(applyData.final_amount, 270);

    // 4. Addresses (authenticated customer)
    const custId = db.sqlite.prepare("INSERT INTO users (phone, name, role, skill, wallet) VALUES ('9111111111', 'Address User', 'customer', null, 500)").run().lastInsertRowid;
    const token = jwt.sign({ id: Number(custId), tokenVersion: 0 }, process.env.JWT_SECRET || 'test-secret');

    // Add address
    const addAddrRes = await fetch(`${base}/api/addresses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        label: 'Home',
        address_line: 'Near Bank More Chowk, Dhanbad',
        landmark: 'Opposite State Bank',
        city: 'Dhanbad',
        pincode: '826001',
        is_default: true
      })
    });
    assert.equal(addAddrRes.status, 201);
    const addAddrData = await addAddrRes.json();
    assert.equal(addAddrData.success, true);
    assert.ok(addAddrData.address.id);

    // Get addresses
    const getAddrRes = await fetch(`${base}/api/addresses`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(getAddrRes.status, 200);
    const getAddrData = await getAddrRes.json();
    assert.equal(getAddrData.success, true);
    assert.equal(getAddrData.addresses.length, 1);
    assert.equal(getAddrData.addresses[0].city, 'Dhanbad');

    // Delete address
    const delRes = await fetch(`${base}/api/addresses/${addAddrData.address.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(delRes.status, 200);
  } finally {
    server.close();
    await db.close();
  }
});

