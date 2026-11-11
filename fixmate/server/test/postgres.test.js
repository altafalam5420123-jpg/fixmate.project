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

  // 7. Tool: request_booking_cancellation (must require explicit confirmed: true)
  const blockedCancel = await executeTool('request_booking_cancellation', { booking_id: booking.booking.id }, { db, user: testUser });
  assert.equal(blockedCancel.success, false);
  assert.equal(blockedCancel.needs_confirmation, true);

  const cancel = await executeTool('request_booking_cancellation', { booking_id: booking.booking.id, confirmed: true }, { db, user: testUser });
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

test('Phase 2 Customer Application: Booking with Coupon & Emergency, Reschedule, and Reviews', async () => {
  const jwt = require('jsonwebtoken');
  const { createApp } = require('../src/app');
  const db = openDb(':memory:');
  await db.initDb();

  // Seed user, worker, and coupon
  const custId = db.sqlite.prepare("INSERT INTO users (phone, name, role, skill, wallet) VALUES ('9222222222', 'Test Customer', 'customer', null, 2000)").run().lastInsertRowid;
  const workerId = db.sqlite.prepare("INSERT INTO users (phone, name, role, skill, wallet, online) VALUES ('9333333333', 'Test Worker', 'worker', 'Electrician', 500, 1)").run().lastInsertRowid;
  db.sqlite.prepare("INSERT INTO coupons (code, title, discount_type, discount_value, min_order_amount, max_discount, is_active) VALUES ('WELCOME50', '10% Off', 'percentage', 10, 100, 50, 1)").run();

  const custToken = jwt.sign({ id: Number(custId), tokenVersion: 0 }, process.env.JWT_SECRET || 'test-secret');
  const workerToken = jwt.sign({ id: Number(workerId), tokenVersion: 0 }, process.env.JWT_SECRET || 'test-secret');

  const server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${server.address().port}`;

  try {
    // 1. Create booking with coupon, issue description, photo, and emergency flag
    const bookRes = await fetch(`${base}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custToken}` },
      body: JSON.stringify({
        serviceId: 1, // Switch aur socket repair (₹149)
        slot: 'Abhi (60 min mein)',
        address: 'House 12, Saraidhela, Dhanbad',
        pay: 'wallet',
        issue_desc: 'Main switch sparking and burnt smell',
        photo_url: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
        coupon_code: 'WELCOME50',
        is_emergency: 1
      })
    });
    assert.equal(bookRes.status, 201);
    const bookData = await bookRes.json();
    assert.equal(bookData.success, true);
    const bId = bookData.booking.id;
    assert.equal(bookData.booking.coupon_code, 'WELCOME50');
    assert.ok(bookData.booking.discount_amount > 0);
    assert.equal(bookData.booking.is_emergency, 1);
    assert.equal(bookData.booking.issue_desc, 'Main switch sparking and burnt smell');

    // 2. Reschedule booking (while in requested status)
    const reschedRes = await fetch(`${base}/api/bookings/${bId}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custToken}` },
      body: JSON.stringify({ slot: 'Aaj 6 se 8 PM' })
    });
    assert.equal(reschedRes.status, 200);
    const reschedData = await reschedRes.json();
    assert.equal(reschedData.success, true);
    assert.equal(reschedData.booking.slot, 'Aaj 6 se 8 PM');

    // 3. Worker accepts, heads out, starts with code, quotes, customer approves, worker completes
    await fetch(`${base}/api/bookings/${bId}/accept`, { method: 'POST', headers: { Authorization: `Bearer ${workerToken}` } });
    await fetch(`${base}/api/bookings/${bId}/on-the-way`, { method: 'POST', headers: { Authorization: `Bearer ${workerToken}` } });
    
    // Reschedule should now fail because worker is on the way
    const invalidResched = await fetch(`${base}/api/bookings/${bId}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custToken}` },
      body: JSON.stringify({ slot: 'Kal subah' })
    });
    assert.equal(invalidResched.status, 409);

    // Complete flow
    await fetch(`${base}/api/bookings/${bId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerToken}` },
      body: JSON.stringify({ code: bookData.booking.start_code })
    });
    await fetch(`${base}/api/bookings/${bId}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerToken}` },
      body: JSON.stringify({ parts: 50 })
    });
    await fetch(`${base}/api/bookings/${bId}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${custToken}` } });
    await fetch(`${base}/api/bookings/${bId}/complete`, { method: 'POST', headers: { Authorization: `Bearer ${workerToken}` } });
    await fetch(`${base}/api/bookings/${bId}/pay`, { method: 'POST', headers: { Authorization: `Bearer ${custToken}` } });

    // 4. Customer submits review
    const reviewRes = await fetch(`${base}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custToken}` },
      body: JSON.stringify({
        booking_id: bId,
        rating: 5,
        comment: 'Very professional electrician, solved spark issue in 15 mins!'
      })
    });
    assert.equal(reviewRes.status, 201);
    const reviewData = await reviewRes.json();
    assert.equal(reviewData.success, true);

    // 5. Duplicate review blocked
    const dupReviewRes = await fetch(`${base}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custToken}` },
      body: JSON.stringify({ booking_id: bId, rating: 4, comment: 'Again' })
    });
    assert.equal(dupReviewRes.status, 409);

    // 6. Public service reviews
    const svcReviewsRes = await fetch(`${base}/api/reviews/service/1`);
    assert.equal(svcReviewsRes.status, 200);
    const svcReviewsData = await svcReviewsRes.json();
    assert.equal(svcReviewsData.success, true);
    assert.ok(svcReviewsData.reviews.length >= 1);
    assert.equal(svcReviewsData.reviews[0].rating, 5);
    assert.equal(svcReviewsData.reviews[0].customer_name, 'Test Customer');
  } finally {
    server.close();
    await db.close();
  }
});

test('Phase 3 Technician Application: Worker Stats, Profile, Photo Proof, and Reviews', async () => {
  const jwt = require('jsonwebtoken');
  const { createApp } = require('../src/app');
  const db = openDb(':memory:');
  await db.initDb();

  const custId = db.sqlite.prepare("INSERT INTO users (phone, name, role, skill, wallet) VALUES ('9444444444', 'Phase3 Customer', 'customer', null, 3000)").run().lastInsertRowid;
  const workerId = db.sqlite.prepare("INSERT INTO users (phone, name, role, skill, wallet, online, experience_years, service_areas) VALUES ('9555555555', 'Expert Tech', 'worker', 'Plumber', 0, 1, 5, 'Saraidhela, Dhanbad')").run().lastInsertRowid;

  const custToken = jwt.sign({ id: Number(custId), tokenVersion: 0 }, process.env.JWT_SECRET || 'test-secret');
  const workerToken = jwt.sign({ id: Number(workerId), tokenVersion: 0 }, process.env.JWT_SECRET || 'test-secret');

  const server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${server.address().port}`;

  try {
    // 1. Worker Stats (Initial)
    const statsRes = await fetch(`${base}/api/worker/stats`, {
      headers: { Authorization: `Bearer ${workerToken}` }
    });
    assert.equal(statsRes.status, 200);
    const statsData = await statsRes.json();
    assert.equal(statsData.success, true);
    assert.equal(statsData.stats.completed_jobs, 0);

    // 2. Role Security Check: Customer cannot access worker stats
    const custDenyRes = await fetch(`${base}/api/worker/stats`, {
      headers: { Authorization: `Bearer ${custToken}` }
    });
    assert.equal(custDenyRes.status, 403);

    // 3. Worker Profile Update
    const profRes = await fetch(`${base}/api/worker/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerToken}` },
      body: JSON.stringify({
        experience_years: 7,
        service_areas: 'Saraidhela, Bank More, Hirapur',
        id_document_url: 'data:image/png;base64,AadhaarVerified'
      })
    });
    assert.equal(profRes.status, 200);
    const profData = await profRes.json();
    assert.equal(profData.success, true);
    assert.equal(profData.user.experience_years, 7);
    assert.equal(profData.user.service_areas, 'Saraidhela, Bank More, Hirapur');

    // 4. Booking Flow with Start and Complete Photo Proof
    const bookRes = await fetch(`${base}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custToken}` },
      body: JSON.stringify({
        serviceId: 4, // Tap aur leakage repair (Plumber, ₹149)
        slot: 'Aaj 6 se 8 PM',
        address: 'House 5, Hirapur, Dhanbad',
        pay: 'wallet'
      })
    });
    const bookData = await bookRes.json();
    const bId = bookData.booking.id;

    // Worker accepts and travels
    await fetch(`${base}/api/bookings/${bId}/accept`, { method: 'POST', headers: { Authorization: `Bearer ${workerToken}` } });
    await fetch(`${base}/api/bookings/${bId}/on-the-way`, { method: 'POST', headers: { Authorization: `Bearer ${workerToken}` } });

    // Worker starts with 4-digit code and attaches start inspection photo
    const startRes = await fetch(`${base}/api/bookings/${bId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerToken}` },
      body: JSON.stringify({
        code: bookData.booking.start_code,
        start_photo_url: 'data:image/jpeg;base64,startPhotoData'
      })
    });
    assert.equal(startRes.status, 200);
    const startData = await startRes.json();
    assert.equal(startData.booking.status, 'inspecting');

    // Quote and customer approval
    await fetch(`${base}/api/bookings/${bId}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerToken}` },
      body: JSON.stringify({ parts: 100 })
    });
    await fetch(`${base}/api/bookings/${bId}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${custToken}` } });

    // Worker completes job and attaches completion photo proof
    const compRes = await fetch(`${base}/api/bookings/${bId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerToken}` },
      body: JSON.stringify({
        complete_photo_url: 'data:image/jpeg;base64,completePhotoData'
      })
    });
    assert.equal(compRes.status, 200);
    const compData = await compRes.json();
    assert.equal(compData.booking.status, 'completed');

    // Customer pays
    await fetch(`${base}/api/bookings/${bId}/pay`, { method: 'POST', headers: { Authorization: `Bearer ${custToken}` } });

    // Customer leaves 5-star review
    await fetch(`${base}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custToken}` },
      body: JSON.stringify({
        booking_id: bId,
        rating: 5,
        comment: 'Super fast plumbing fix! Highly recommend.'
      })
    });

    // 5. Worker checks updated stats & reviews list
    const finalStatsRes = await fetch(`${base}/api/worker/stats`, {
      headers: { Authorization: `Bearer ${workerToken}` }
    });
    const finalStatsData = await finalStatsRes.json();
    assert.equal(finalStatsData.stats.completed_jobs, 1);
    assert.ok(finalStatsData.stats.total_earnings > 0);
    assert.equal(finalStatsData.stats.avg_rating, 5);

    const workerReviewsRes = await fetch(`${base}/api/worker/reviews`, {
      headers: { Authorization: `Bearer ${workerToken}` }
    });
    const workerReviewsData = await workerReviewsRes.json();
    assert.equal(workerReviewsData.reviews.length, 1);
    assert.equal(workerReviewsData.reviews[0].comment, 'Super fast plumbing fix! Highly recommend.');
  } finally {
    server.close();
    await db.close();
  }
});

test('Phase 4 Admin Dashboard: Analytics, Verification, Assignment, Pricing, and Complaints', async () => {
  const jwt = require('jsonwebtoken');
  const { createApp } = require('../src/app');
  const db = openDb(':memory:');
  await db.initDb();

  const custId = db.sqlite.prepare("INSERT INTO users (phone, name, role, skill, wallet) VALUES ('9333333333', 'P4 Customer', 'customer', null, 2000)").run().lastInsertRowid;
  const workerId = db.sqlite.prepare("INSERT INTO users (phone, name, role, skill, wallet, online, id_verified) VALUES ('9222222222', 'P4 Electrician', 'worker', 'Electrician', 0, 1, 0)").run().lastInsertRowid;
  const adminId = db.sqlite.prepare("INSERT INTO users (phone, name, role, skill, wallet) VALUES ('9111111111', 'P4 Master Admin', 'admin', null, 5000)").run().lastInsertRowid;

  const custToken = jwt.sign({ id: Number(custId), tokenVersion: 0 }, process.env.JWT_SECRET || 'test-secret');
  const workerToken = jwt.sign({ id: Number(workerId), tokenVersion: 0 }, process.env.JWT_SECRET || 'test-secret');
  const adminToken = jwt.sign({ id: Number(adminId), tokenVersion: 0 }, process.env.JWT_SECRET || 'test-secret');

  const server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${server.address().port}`;

  try {
    // 1. Role Protection Check: Customer & Worker cannot access Admin Analytics (403 Forbidden)
    const custDeny = await fetch(`${base}/api/admin/analytics`, {
      headers: { Authorization: `Bearer ${custToken}` }
    });
    assert.equal(custDeny.status, 403);

    const workerDeny = await fetch(`${base}/api/admin/analytics`, {
      headers: { Authorization: `Bearer ${workerToken}` }
    });
    assert.equal(workerDeny.status, 403);

    // 2. Admin Analytics Access (200 OK)
    const adminAnalyticsRes = await fetch(`${base}/api/admin/analytics`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(adminAnalyticsRes.status, 200);
    const analyticsData = await adminAnalyticsRes.json();
    assert.equal(analyticsData.success, true);
    assert.ok(analyticsData.analytics.total_customers >= 1);
    assert.ok(analyticsData.analytics.total_workers >= 1);

    // 3. Admin Technician ID Verification
    const verifyRes = await fetch(`${base}/api/admin/technicians/${workerId}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ verified: true })
    });
    assert.equal(verifyRes.status, 200);
    const verifyData = await verifyRes.json();
    assert.equal(verifyData.success, true);
    assert.equal(verifyData.user.id_verified, 1);

    // 4. Customer Creates Booking
    const bookRes = await fetch(`${base}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custToken}` },
      body: JSON.stringify({
        serviceId: 1, // Switch aur socket repair (Electrician, ₹149)
        slot: 'Aaj 4 se 6 PM',
        address: 'Steel Gate, Dhanbad',
        pay: 'wallet'
      })
    });
    const bookData = await bookRes.json();
    const bId = bookData.booking.id;
    assert.equal(bookData.booking.status, 'requested');

    // 5. Admin Manual Assignment of Technician to Requested Booking
    const assignRes = await fetch(`${base}/api/admin/bookings/${bId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ worker_id: Number(workerId) })
    });
    assert.equal(assignRes.status, 200);
    const assignData = await assignRes.json();
    assert.equal(assignData.booking.status, 'assigned');
    assert.equal(assignData.booking.worker_id, Number(workerId));

    // 6. Admin Service Catalog: Add Service & Update Pricing
    const addSvcRes = await fetch(`${base}/api/admin/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        cat: 'Electrician',
        name: 'Smart Home Automation Wiring',
        price: 999,
        rating: 5.0
      })
    });
    assert.equal(addSvcRes.status, 201);
    const addSvcData = await addSvcRes.json();
    assert.equal(addSvcData.service.name, 'Smart Home Automation Wiring');
    assert.equal(addSvcData.service.price, 999);
    const newSvcId = addSvcData.service.id;

    // Update service pricing
    const updateSvcRes = await fetch(`${base}/api/admin/services/${newSvcId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ price: 1199 })
    });
    assert.equal(updateSvcRes.status, 200);
    const updateSvcData = await updateSvcRes.json();
    assert.equal(updateSvcData.service.price, 1199);

    // 7. Admin Coupon Management: Create & Deactivate
    const addCouponRes = await fetch(`${base}/api/admin/coupons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        code: 'FESTIVE100',
        title: 'Diwali Special ₹100 Off',
        discount_type: 'flat',
        discount_value: 100,
        min_order_amount: 400
      })
    });
    assert.equal(addCouponRes.status, 201);
    const couponData = await addCouponRes.json();
    assert.equal(couponData.coupon.code, 'FESTIVE100');

    // Deactivate coupon
    const delCouponRes = await fetch(`${base}/api/admin/coupons/${couponData.coupon.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(delCouponRes.status, 200);

    // 8. Customer Files Complaint Support Ticket
    const complaintRes = await fetch(`${base}/api/complaints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custToken}` },
      body: JSON.stringify({
        booking_id: bId,
        category: 'Delay in Service',
        description: 'Technician was 30 minutes late for the appointment.',
        refund_requested: true
      })
    });
    assert.equal(complaintRes.status, 201);
    const complaintData = await complaintRes.json();
    assert.ok(complaintData.ticket_id);

    // Customer checks my complaints
    const myComplaintsRes = await fetch(`${base}/api/complaints/my`, {
      headers: { Authorization: `Bearer ${custToken}` }
    });
    const myComplaintsData = await myComplaintsRes.json();
    assert.equal(myComplaintsData.complaints.length, 1);
    assert.equal(myComplaintsData.complaints[0].status, 'open');

    // 9. Admin Views Complaints and Resolves with Refund
    const adminComplaintsRes = await fetch(`${base}/api/admin/complaints`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const adminComplaintsData = await adminComplaintsRes.json();
    assert.equal(adminComplaintsData.complaints.length, 1);

    const custWalletBefore = (await db.queryOne('SELECT wallet FROM users WHERE id = $1', [custId])).wallet;

    const resolveRes = await fetch(`${base}/api/admin/complaints/${complaintData.ticket_id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        status: 'resolved',
        resolution_notes: 'Apology accepted. ₹100 courtesy refund credited to FixMate wallet.',
        refund_amount: 100
      })
    });
    assert.equal(resolveRes.status, 200);
    const resolveData = await resolveRes.json();
    assert.equal(resolveData.complaint.status, 'resolved');
    assert.equal(resolveData.complaint.refund_amount, 100);

    const custWalletAfter = (await db.queryOne('SELECT wallet FROM users WHERE id = $1', [custId])).wallet;
    assert.equal(custWalletAfter, custWalletBefore + 100);
  } finally {
    server.close();
    await db.close();
  }
});

test('Phase 5 Transparent Pricing & Digital Invoices: Parts Breakdown, Customer Quote Approval, and Tax Receipts', async () => {
  const jwt = require('jsonwebtoken');
  const { createApp } = require('../src/app');
  const db = openDb(':memory:');
  await db.initDb();

  const custId = db.sqlite.prepare("INSERT INTO users (phone, name, role, skill, wallet) VALUES ('9222222221', 'P5 Customer', 'customer', null, 5000)").run().lastInsertRowid;
  const otherCustId = db.sqlite.prepare("INSERT INTO users (phone, name, role, skill, wallet) VALUES ('9222222220', 'Stranger Customer', 'customer', null, 2000)").run().lastInsertRowid;
  const workerId = db.sqlite.prepare("INSERT INTO users (phone, name, role, skill, wallet, online, id_verified) VALUES ('9222222223', 'P5 AC Tech', 'worker', 'AC Repair', 0, 1, 1)").run().lastInsertRowid;
  const adminId = db.sqlite.prepare("INSERT INTO users (phone, name, role, skill, wallet) VALUES ('9222222224', 'P5 Admin', 'admin', null, 10000)").run().lastInsertRowid;

  const custToken = jwt.sign({ id: Number(custId), tokenVersion: 0 }, process.env.JWT_SECRET || 'test-secret');
  const strangerToken = jwt.sign({ id: Number(otherCustId), tokenVersion: 0 }, process.env.JWT_SECRET || 'test-secret');
  const workerToken = jwt.sign({ id: Number(workerId), tokenVersion: 0 }, process.env.JWT_SECRET || 'test-secret');
  const adminToken = jwt.sign({ id: Number(adminId), tokenVersion: 0 }, process.env.JWT_SECRET || 'test-secret');

  const server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${server.address().port}`;

  try {
    // 1. Customer creates AC repair booking (Service ID 7: Split AC service, ₹499)
    const bookRes = await fetch(`${base}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custToken}` },
      body: JSON.stringify({
        serviceId: 7,
        slot: 'Kal 10 se 12 AM',
        address: 'Sector 4, Bokaro / Dhanbad Road',
        pay: 'wallet',
        issue_desc: 'Cooling kam hai aur fan se noise aa rahi hai'
      })
    });
    const bookData = await bookRes.json();
    const bId = bookData.booking.id;
    assert.equal(bookData.booking.status, 'requested');

    // 2. Worker accepts, travels, and starts inspection
    await fetch(`${base}/api/bookings/${bId}/accept`, { method: 'POST', headers: { Authorization: `Bearer ${workerToken}` } });
    await fetch(`${base}/api/bookings/${bId}/on-the-way`, { method: 'POST', headers: { Authorization: `Bearer ${workerToken}` } });
    await fetch(`${base}/api/bookings/${bId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerToken}` },
      body: JSON.stringify({ code: bookData.booking.start_code })
    });

    // 3. Worker inspects and submits transparent quote with spare parts description
    const quoteRes = await fetch(`${base}/api/bookings/${bId}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerToken}` },
      body: JSON.stringify({
        parts: 450,
        parts_desc: '45uF Heavy Duty Run Capacitor replaced'
      })
    });
    assert.equal(quoteRes.status, 200);
    const quoteData = await quoteRes.json();
    assert.equal(quoteData.booking.status, 'quoted');
    assert.equal(quoteData.booking.parts, 450);
    assert.equal(quoteData.booking.total, 499 + 450);

    // 4. Customer approves the quote
    const approveRes = await fetch(`${base}/api/bookings/${bId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${custToken}` }
    });
    assert.equal(approveRes.status, 200);
    const approveData = await approveRes.json();
    assert.equal(approveData.booking.status, 'in_progress');

    // 5. Worker completes job
    const compRes = await fetch(`${base}/api/bookings/${bId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerToken}` },
      body: JSON.stringify({ complete_photo_url: 'data:image/jpeg;base64,acFixedProof' })
    });
    assert.equal(compRes.status, 200);

    // 6. Customer pays via wallet
    const payRes = await fetch(`${base}/api/bookings/${bId}/pay`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${custToken}` }
    });
    assert.equal(payRes.status, 200);

    // 7. Digital Invoice JSON API Verification
    const invRes = await fetch(`${base}/api/bookings/${bId}/invoice`, {
      headers: { Authorization: `Bearer ${custToken}` }
    });
    assert.equal(invRes.status, 200);
    const invData = await invRes.json();
    assert.equal(invData.success, true);
    assert.ok(invData.invoice.invoice_number.startsWith('INV-'));
    assert.equal(invData.invoice.total, 499 + 450);
    assert.equal(invData.invoice.paid, true);
    assert.equal(invData.invoice.payment_method, 'wallet');
    assert.ok(invData.invoice.items.length >= 2);
    assert.equal(invData.invoice.warranty.service_warranty_days, 30);
    assert.equal(invData.invoice.warranty.parts_warranty_days, 90);
    assert.ok(invData.invoice.gst.cgst_amount > 0);
    assert.ok(invData.invoice.gst.sgst_amount > 0);

    // Worker can also view invoice
    const workerInvRes = await fetch(`${base}/api/bookings/${bId}/invoice`, {
      headers: { Authorization: `Bearer ${workerToken}` }
    });
    assert.equal(workerInvRes.status, 200);

    // Admin can also view invoice
    const adminInvRes = await fetch(`${base}/api/bookings/${bId}/invoice`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    assert.equal(adminInvRes.status, 200);

    // Stranger customer is blocked from viewing this invoice
    const strangerInvRes = await fetch(`${base}/api/bookings/${bId}/invoice`, {
      headers: { Authorization: `Bearer ${strangerToken}` }
    });
    assert.equal(strangerInvRes.status, 403);

    // 8. Printable HTML Tax Invoice Endpoint Verification
    const htmlRes = await fetch(`${base}/api/bookings/${bId}/invoice/html`, {
      headers: { Authorization: `Bearer ${custToken}` }
    });
    assert.equal(htmlRes.status, 200);
    assert.ok(htmlRes.headers.get('content-type').includes('text/html'));
    const htmlText = await htmlRes.text();
    assert.ok(htmlText.includes('TAX INVOICE'));
    assert.ok(htmlText.includes('Fix<span>Mate</span>'));
    assert.ok(htmlText.includes(invData.invoice.invoice_number));
    assert.ok(htmlText.includes('30-Day FixMate Guarantee Certificate'));
    assert.ok(htmlText.includes('45uF Heavy Duty Run Capacitor'));
  } finally {
    server.close();
    await db.close();
  }
});

test('Phase 6 AI Voice Agent, Authenticated Session, Conversation History & Smart Service Finder', async () => {
  const jwt = require('jsonwebtoken');
  const { createApp } = require('../src/app');
  const db = openDb(':memory:');
  await db.initDb();

  const prevGemini = process.env.GEMINI_API_KEY;
  const prevOpenAI = process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const custId = Number(db.sqlite.prepare("INSERT INTO users (phone, name, role, skill, wallet) VALUES ('9876540001', 'AI Voice User', 'customer', null, 3000)").run().lastInsertRowid);
  const custToken = jwt.sign({ id: custId, tokenVersion: 0 }, process.env.JWT_SECRET || 'test-secret');

  const server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${server.address().port}`;

  try {
    // 1. Honest AI readiness status (Realtime WebRTC reported as BLOCKED when OPENAI_API_KEY unset)
    const statusRes = await fetch(`${base}/api/ai/status`);
    assert.equal(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.equal(statusData.success, true);
    assert.equal(statusData.realtime_webrtc, 'BLOCKED');
    assert.equal(statusData.speech_fallback, 'browser_web_speech_api');

    // 2. Session endpoint must reject unauthenticated callers (401)
    const unauthSession = await fetch(`${base}/api/ai/session`, { method: 'POST' });
    assert.equal(unauthSession.status, 401);

    // 3. Authenticated session returns 503 BLOCKED gracefully when OpenAI key is missing
    const authSession = await fetch(`${base}/api/ai/session`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${custToken}` }
    });
    assert.equal(authSession.status, 503);
    const authSessData = await authSession.json();
    assert.equal(authSessData.blocked, true);

    // 4. Smart Service Finder (Hindi / Hinglish problem phrases)
    const smartAcRes = await fetch(`${base}/api/services/smart-find`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'AC thandi hawa nahi de raha' })
    });
    assert.equal(smartAcRes.status, 200);
    const smartAcData = await smartAcRes.json();
    assert.equal(smartAcData.success, true);
    assert.equal(smartAcData.detected_category, 'AC Repair');
    assert.ok(smartAcData.possible_causes.length >= 2);
    assert.ok(smartAcData.recommended_services.length >= 1);

    const smartTapRes = await fetch(`${base}/api/services/smart-find`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'Bathroom ka tap leak kar raha hai' })
    });
    assert.equal(smartTapRes.status, 200);
    const smartTapData = await smartTapRes.json();
    assert.equal(smartTapData.detected_category, 'Plumber');

    // 5. Multi-turn Hinglish AI Chat with Follow-up Question & DB Persistence
    const chat1Res = await fetch(`${base}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custToken}` },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Meri washing machine se paani leak ho raha hai.' }]
      })
    });
    assert.equal(chat1Res.status, 200);
    const chat1 = await chat1Res.json();
    assert.equal(chat1.success, true);
    assert.ok(/front-load|top-load/i.test(chat1.reply));
    assert.ok(chat1.pendingBooking);

    // Confirm booking explicitly
    const chat2Res = await fetch(`${base}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custToken}` },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'Meri washing machine se paani leak ho raha hai.' },
          { role: 'assistant', content: chat1.reply },
          { role: 'user', content: 'Front-load hai, haan book kar do' }
        ],
        activeBookingState: { ...chat1.pendingBooking, pendingConfirmation: true }
      })
    });
    assert.equal(chat2Res.status, 200);
    const chat2 = await chat2Res.json();
    const createdCard = (chat2.cards || []).find(c => c.tool === 'create_booking' && c.result?.success);
    assert.ok(createdCard);
    const bookedId = createdCard.result.booking.id;

    // Reschedule confirmation check & execution via tool
    const reschedBlocked = await executeTool('reschedule_booking', { booking_id: bookedId, new_slot: 'Kal 10 se 12 AM' }, {
      db,
      user: { id: custId, role: 'customer' }
    });
    assert.equal(reschedBlocked.success, false);
    assert.equal(reschedBlocked.needs_confirmation, true);

    const reschedOk = await executeTool('reschedule_booking', { booking_id: bookedId, new_slot: 'Kal 10 se 12 AM', confirmed: true }, {
      db,
      user: { id: custId, role: 'customer' }
    });
    assert.equal(reschedOk.success, true);
    assert.equal(reschedOk.new_slot, 'Kal 10 se 12 AM');

    // Invoice explanation via AI Chat
    const invChatRes = await fetch(`${base}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custToken}` },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Mera invoice bill explain karo' }] })
    });
    assert.equal(invChatRes.status, 200);
    const invChat = await invChatRes.json();
    assert.ok(invChat.cards.some(c => c.tool === 'get_invoice_summary' && c.result?.success));

    // File complaint directly via AI Tool
    const compTool = await executeTool('file_complaint', {
      booking_id: bookedId,
      category: 'Delay in Service',
      description: 'Technician 20 minute late pahucha',
      refund_requested: false
    }, { db, user: { id: custId, role: 'customer' } });
    assert.equal(compTool.success, true);
    assert.ok(compTool.ticket_id);

    // Verify cancellation confirmation gate via AI Chat (first turn asks confirmation, does NOT cancel!)
    const cancelAskRes = await fetch(`${base}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custToken}` },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Cancel my booking' }] })
    });
    const cancelAsk = await cancelAskRes.json();
    assert.equal(cancelAsk.pendingBooking.pendingAction, 'cancel');
    const stillActive = db.sqlite.prepare('SELECT status FROM bookings WHERE id = ?').get(bookedId);
    assert.equal(stillActive.status, 'requested');

    // Confirm cancellation explicitly
    const cancelDoRes = await fetch(`${base}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custToken}` },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Haan confirm' }],
        activeBookingState: cancelAsk.pendingBooking
      })
    });
    const cancelDo = await cancelDoRes.json();
    assert.ok(cancelDo.cards.some(c => c.tool === 'request_booking_cancellation' && c.result?.cancelled));
    const afterCancel = db.sqlite.prepare('SELECT status FROM bookings WHERE id = ?').get(bookedId);
    assert.equal(afterCancel.status, 'cancelled');

    // 6. Conversation History DB Sync Check
    const histRes = await fetch(`${base}/api/ai/history`, {
      headers: { Authorization: `Bearer ${custToken}` }
    });
    assert.equal(histRes.status, 200);
    const histData = await histRes.json();
    assert.equal(histData.success, true);
    assert.ok(histData.messages.length >= 6);

    const delHistRes = await fetch(`${base}/api/ai/history`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${custToken}` }
    });
    assert.equal(delHistRes.status, 200);

    const emptyHistRes = await fetch(`${base}/api/ai/history`, {
      headers: { Authorization: `Bearer ${custToken}` }
    });
    const emptyHistData = await emptyHistRes.json();
    assert.equal(emptyHistData.messages.length, 0);
  } finally {
    if (prevGemini !== undefined) process.env.GEMINI_API_KEY = prevGemini;
    if (prevOpenAI !== undefined) process.env.OPENAI_API_KEY = prevOpenAI;
    server.close();
    await db.close();
  }
});

test('Phase 7 Live Technician Tracking: Active-Job Privacy Guardrails, Haversine ETA & Status Notifications', async () => {
  const jwt = require('jsonwebtoken');
  const { createApp } = require('../src/app');
  const db = openDb(':memory:');
  await db.initDb();

  const custId = Number(db.sqlite.prepare("INSERT INTO users (phone, name, role, skill, wallet) VALUES ('9876541001', 'Track Customer', 'customer', null, 3000)").run().lastInsertRowid);
  const strangerId = Number(db.sqlite.prepare("INSERT INTO users (phone, name, role, skill, wallet) VALUES ('9876541002', 'Stranger User', 'customer', null, 1000)").run().lastInsertRowid);
  const workerId = Number(db.sqlite.prepare("INSERT INTO users (phone, name, role, skill, wallet, online, id_verified) VALUES ('9876541003', 'Track Tech', 'worker', 'Electrician', 500, 1, 1)").run().lastInsertRowid);
  const otherWorkerId = Number(db.sqlite.prepare("INSERT INTO users (phone, name, role, skill, wallet, online) VALUES ('9876541004', 'Other Tech', 'worker', 'Electrician', 500, 1)").run().lastInsertRowid);

  const custToken = jwt.sign({ id: custId, tokenVersion: 0 }, process.env.JWT_SECRET || 'test-secret');
  const strangerToken = jwt.sign({ id: strangerId, tokenVersion: 0 }, process.env.JWT_SECRET || 'test-secret');
  const workerToken = jwt.sign({ id: workerId, tokenVersion: 0 }, process.env.JWT_SECRET || 'test-secret');
  const otherWorkerToken = jwt.sign({ id: otherWorkerId, tokenVersion: 0 }, process.env.JWT_SECRET || 'test-secret');

  const server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://localhost:${server.address().port}`;

  try {
    // 1. Customer books with GPS coordinates (Dhanbad Station Area)
    const bookRes = await fetch(`${base}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custToken}` },
      body: JSON.stringify({
        serviceId: 1,
        slot: 'Abhi (60 min mein)',
        address: 'Bank More, Dhanbad',
        pay: 'wallet',
        customer_lat: 23.7957,
        customer_lng: 86.4304
      })
    });
    assert.equal(bookRes.status, 201);
    const bData = await bookRes.json();
    const bId = bData.booking.id;
    const startCode = bData.booking.start_code;
    assert.equal(bData.booking.tracking_active, false);
    assert.equal(bData.booking.worker_lat, null);

    // 2. Worker accepts job & starts heading over
    await fetch(`${base}/api/bookings/${bId}/accept`, { method: 'POST', headers: { Authorization: `Bearer ${workerToken}` } });
    await fetch(`${base}/api/bookings/${bId}/on-the-way`, { method: 'POST', headers: { Authorization: `Bearer ${workerToken}` } });

    // Unassigned worker cannot spoof location
    const unauthPush = await fetch(`${base}/api/bookings/${bId}/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${otherWorkerToken}` },
      body: JSON.stringify({ lat: 23.805, lng: 86.440 })
    });
    assert.equal(unauthPush.status, 403);

    // 3. Assigned worker grants location permission & shares GPS (~1.4km away)
    const pushRes = await fetch(`${base}/api/bookings/${bId}/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerToken}` },
      body: JSON.stringify({ lat: 23.8050, lng: 86.4400 })
    });
    assert.equal(pushRes.status, 200);
    const pushData = await pushRes.json();
    assert.equal(pushData.tracking_active, true);
    assert.ok(pushData.worker_location.distance_km > 0.5);
    assert.ok(pushData.worker_location.eta_minutes >= 2);

    // Stranger customer blocked from reading tracking
    const strangerTrack = await fetch(`${base}/api/bookings/${bId}/tracking`, {
      headers: { Authorization: `Bearer ${strangerToken}` }
    });
    assert.equal(strangerTrack.status, 403);

    // Customer reads live tracking + timeline
    const trackRes = await fetch(`${base}/api/bookings/${bId}/tracking`, {
      headers: { Authorization: `Bearer ${custToken}` }
    });
    assert.equal(trackRes.status, 200);
    const trackData = await trackRes.json();
    assert.equal(trackData.tracking_active, true);
    assert.equal(trackData.is_active_job, true);
    assert.equal(trackData.worker_location.lat, 23.805);
    assert.ok(trackData.timeline.length >= 2);

    // 4. Worker pauses location sharing (stop: true)
    const stopRes = await fetch(`${base}/api/bookings/${bId}/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerToken}` },
      body: JSON.stringify({ stop: true })
    });
    assert.equal(stopRes.status, 200);
    const pausedTrack = await (await fetch(`${base}/api/bookings/${bId}/tracking`, {
      headers: { Authorization: `Bearer ${custToken}` }
    })).json();
    assert.equal(pausedTrack.tracking_active, false);
    assert.equal(pausedTrack.worker_location, null);

    // 5. Worker resumes close to customer -> triggers Arriving Soon notification
    await fetch(`${base}/api/bookings/${bId}/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerToken}` },
      body: JSON.stringify({ lat: 23.7960, lng: 86.4309 })
    });

    // 6. Complete booking lifecycle -> automatically wipes technician coordinates!
    await fetch(`${base}/api/bookings/${bId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerToken}` },
      body: JSON.stringify({ code: startCode })
    });
    await fetch(`${base}/api/bookings/${bId}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerToken}` },
      body: JSON.stringify({ parts: 0 })
    });
    await fetch(`${base}/api/bookings/${bId}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${custToken}` } });
    await fetch(`${base}/api/bookings/${bId}/complete`, { method: 'POST', headers: { Authorization: `Bearer ${workerToken}` } });

    // Privacy check: location MUST be null after job completion
    const postTrack = await (await fetch(`${base}/api/bookings/${bId}/tracking`, {
      headers: { Authorization: `Bearer ${custToken}` }
    })).json();
    assert.equal(postTrack.is_active_job, false);
    assert.equal(postTrack.tracking_active, false);
    assert.equal(postTrack.worker_location, null);

    // Worker can no longer stream coordinates after completion (409)
    const latePush = await fetch(`${base}/api/bookings/${bId}/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${workerToken}` },
      body: JSON.stringify({ lat: 23.79, lng: 86.43 })
    });
    assert.equal(latePush.status, 409);

    // 7. Notifications check (status notifications + arriving soon)
    const notifRes = await fetch(`${base}/api/notifications`, {
      headers: { Authorization: `Bearer ${custToken}` }
    });
    assert.equal(notifRes.status, 200);
    const notifData = await notifRes.json();
    assert.ok(notifData.notifications.length >= 4);
    assert.ok(notifData.unread_count >= 4);

    // Mark notifications as read
    await fetch(`${base}/api/notifications/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${custToken}` },
      body: JSON.stringify({})
    });
    const afterRead = await (await fetch(`${base}/api/notifications`, {
      headers: { Authorization: `Bearer ${custToken}` }
    })).json();
    assert.equal(afterRead.unread_count, 0);
  } finally {
    server.close();
    await db.close();
  }
});






