const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/app');
const { openDb } = require('../src/db');

const JWT_SECRET = 'test-secret-at-least-32-characters-long';

function makeToken(user) {
  return jwt.sign({ id: user.id, tokenVersion: user.token_version ?? 0 }, JWT_SECRET, { expiresIn: '1h' });
}

test('Multi-Role RBAC: Operations role permissions and admin boundary isolation', async () => {
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.OTP_HMAC_KEY = 'test-otp-hmac-key-over-32-characters';
  process.env.DEV_SHOW_OTP = '1';
  process.env.ALLOW_DEMO_TOPUP = '1';

  const db = openDb(':memory:');
  const app = createApp(db);
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const request = async (path, { method = 'GET', token, body } = {}) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };

  try {
    // Seed users with different roles
    const adminRes = await db.query(
      "INSERT INTO users (phone, name, role, skill, wallet) VALUES ('9000000001', 'Super Admin', 'admin', NULL, 0) RETURNING *"
    );
    const adminUser = adminRes.rows[0];
    const adminToken = makeToken(adminUser);

    const opsRes = await db.query(
      "INSERT INTO users (phone, name, role, skill, wallet) VALUES ('9000000002', 'Support Staff', 'operations', NULL, 0) RETURNING *"
    );
    const opsUser = opsRes.rows[0];
    const opsToken = makeToken(opsUser);

    const custRes = await db.query(
      "INSERT INTO users (phone, name, role, skill, wallet) VALUES ('9000000003', 'Ramesh Customer', 'customer', NULL, 500) RETURNING *"
    );
    const custUser = custRes.rows[0];
    const custToken = makeToken(custUser);

    const workerRes = await db.query(
      "INSERT INTO users (phone, name, role, skill, wallet, online) VALUES ('9000000004', 'Suresh Electrician', 'worker', 'Electrician', 0, 1) RETURNING *"
    );
    const workerUser = workerRes.rows[0];
    const workerToken = makeToken(workerUser);

    // Seed a booking
    const svc = await db.queryOne("SELECT id FROM services WHERE cat = 'Electrician' LIMIT 1");
    const bookRes = await db.query(
      "INSERT INTO bookings (customer_id, service_id, slot, address, pay, status, start_code, total) VALUES ($1, $2, 'Today 4 PM', 'Dhanbad Court More', 'cash', 'requested', '1234', 199) RETURNING *",
      [custUser.id, svc.id]
    );
    const booking = bookRes.rows[0];

    // 1. Operations can view /api/operations/overview
    const opsOverview = await request('/api/operations/overview', { token: opsToken });
    assert.equal(opsOverview.status, 200);
    assert.equal(typeof opsOverview.data.stats.total_bookings, 'number');
    assert.equal(opsOverview.data.stats.pending_requests, 1);
    assert.equal(opsOverview.data.stats.online_providers, 1);

    // 2. Customer and Worker are strictly BLOCKED (403) from operations overview
    const custBlock = await request('/api/operations/overview', { token: custToken });
    assert.equal(custBlock.status, 403);
    const wrkBlock = await request('/api/operations/overview', { token: workerToken });
    assert.equal(wrkBlock.status, 403);

    // 3. Operations can view bookings and assign technicians
    const opsBookings = await request('/api/admin/bookings', { token: opsToken });
    assert.equal(opsBookings.status, 200);
    assert.ok(Array.isArray(opsBookings.data.bookings));

    const assignRes = await request(`/api/admin/bookings/${booking.id}/assign`, {
      method: 'POST',
      token: opsToken,
      body: { worker_id: workerUser.id },
    });
    assert.equal(assignRes.status, 200);
    assert.equal(assignRes.data.booking.worker_id, workerUser.id);
    assert.equal(assignRes.data.booking.status, 'assigned');

    // 4. CRUCIAL SECURITY RULE: Operations CANNOT access financial analytics / platform profits
    const opsFinancialBlock = await request('/api/admin/analytics', { token: opsToken });
    assert.equal(opsFinancialBlock.status, 403); // Strict isolation!

    // But Admin CAN access financial analytics
    const adminAnalytics = await request('/api/admin/analytics', { token: adminToken });
    assert.equal(adminAnalytics.status, 200);

    // 5. Operations can cancel booking if requested
    const cancelRes = await request(`/api/operations/bookings/${booking.id}/cancel`, {
      method: 'POST',
      token: opsToken,
      body: { reason: 'Customer requested reschedule to next week' },
    });
    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.data.booking.status, 'cancelled');
  } finally {
    server.close();
    await db.close();
  }
});
