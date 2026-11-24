const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isMsg91Configured,
  getOtpExpiryMinutes,
  formatMobile,
  sendOtp,
  verifyOtp,
} = require('../src/msg91Service');
const { createApp } = require('../src/app');
const { openDb } = require('../src/db');

test('MSG91 Service: helper methods and environment detection', () => {
  const oldKey = process.env.MSG91_AUTH_KEY;
  const oldTpl = process.env.MSG91_TEMPLATE_ID;
  const oldExp = process.env.OTP_EXPIRY_MINUTES;

  try {
    delete process.env.MSG91_AUTH_KEY;
    delete process.env.MSG91_TEMPLATE_ID;
    assert.equal(isMsg91Configured(), false);

    process.env.MSG91_AUTH_KEY = 'test_key';
    assert.equal(isMsg91Configured(), false);

    process.env.MSG91_TEMPLATE_ID = 'test_tpl';
    assert.equal(isMsg91Configured(), true);

    delete process.env.OTP_EXPIRY_MINUTES;
    assert.equal(getOtpExpiryMinutes(), 5);

    process.env.OTP_EXPIRY_MINUTES = '10';
    assert.equal(getOtpExpiryMinutes(), 10);

    process.env.OTP_EXPIRY_MINUTES = 'invalid';
    assert.equal(getOtpExpiryMinutes(), 5);

    assert.equal(formatMobile('9876543210'), '919876543210');
    assert.equal(formatMobile('8603519486'), '918603519486');
    assert.equal(formatMobile('919876543210'), '919876543210');
    assert.throws(() => formatMobile('123'), /10 digit/);
  } finally {
    if (oldKey) process.env.MSG91_AUTH_KEY = oldKey; else delete process.env.MSG91_AUTH_KEY;
    if (oldTpl) process.env.MSG91_TEMPLATE_ID = oldTpl; else delete process.env.MSG91_TEMPLATE_ID;
    if (oldExp) process.env.OTP_EXPIRY_MINUTES = oldExp; else delete process.env.OTP_EXPIRY_MINUTES;
  }
});

test('MSG91 Service: sendOtp dispatches to MSG91 v5 API and handles errors', async () => {
  const originalFetch = global.fetch;
  process.env.MSG91_AUTH_KEY = 'test_auth_key_123';
  process.env.MSG91_TEMPLATE_ID = 'test_template_456';
  process.env.OTP_EXPIRY_MINUTES = '5';

  let capturedUrl = null;
  let capturedHeaders = null;

  try {
    // Mock successful MSG91 response
    global.fetch = async (url, options) => {
      capturedUrl = String(url);
      capturedHeaders = options.headers;
      return {
        ok: true,
        status: 200,
        json: async () => ({ type: 'success', message: 'req_msg91_789' }),
      };
    };

    const res = await sendOtp('9876543210');
    assert.equal(res.success, true);
    assert.equal(res.requestId, 'req_msg91_789');
    assert.ok(capturedUrl.includes('https://control.msg91.com/api/v5/otp'));
    assert.ok(capturedUrl.includes('mobile=919876543210'));
    assert.ok(capturedUrl.includes('template_id=test_template_456'));
    assert.ok(capturedUrl.includes('otp_expiry=5'));
    assert.equal(capturedHeaders.authkey, 'test_auth_key_123');

    // Mock MSG91 error response
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ type: 'error', message: 'Invalid template ID' }),
    });

    await assert.rejects(
      () => sendOtp('9876543210'),
      /SMS provider OTP nahi bhej saka: Invalid template ID/
    );
  } finally {
    global.fetch = originalFetch;
    delete process.env.MSG91_AUTH_KEY;
    delete process.env.MSG91_TEMPLATE_ID;
  }
});

test('MSG91 Service: verifyOtp strictly validates type === success and rejects wrong OTPs', async () => {
  const originalFetch = global.fetch;
  process.env.MSG91_AUTH_KEY = 'test_auth_key_123';

  let capturedUrl = null;

  try {
    // 1. Correct OTP
    global.fetch = async (url) => {
      capturedUrl = String(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ type: 'success', message: 'OTP verified success' }),
      };
    };

    const successRes = await verifyOtp('9876543210', '654321');
    assert.equal(successRes.success, true);
    assert.ok(capturedUrl.includes('otp=654321'));
    assert.ok(capturedUrl.includes('mobile=919876543210'));

    // 2. Wrong OTP (MSG91 returns HTTP 200 with type: 'error')
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ type: 'error', message: 'OTP not match' }),
    });

    const failRes = await verifyOtp('9876543210', '000000');
    assert.equal(failRes.success, false);
    assert.equal(failRes.message, 'OTP not match');

    // 3. Expired OTP
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ type: 'error', message: 'OTP expired' }),
    });

    const expRes = await verifyOtp('9876543210', '111111');
    assert.equal(expRes.success, false);
    assert.equal(expRes.message, 'OTP expired');
  } finally {
    global.fetch = originalFetch;
    delete process.env.MSG91_AUTH_KEY;
  }
});

test('MSG91 End-to-End: Send, Verify, New User Registration and Login flow', async () => {
  const originalFetch = global.fetch;
  process.env.MSG91_AUTH_KEY = 'mock_auth_key';
  process.env.MSG91_TEMPLATE_ID = 'mock_template_id';
  process.env.OTP_EXPIRY_MINUTES = '5';
  process.env.NODE_ENV = 'production';
  process.env.JWT_SECRET = 'production-test-secret-with-more-than-32-chars';
  process.env.OTP_HMAC_KEY = 'production-otp-hmac-key-with-over-32-chars';
  process.env.CLIENT_ORIGIN = 'https://fixmate-server-hx4n.onrender.com';
  delete process.env.DEV_SHOW_OTP;
  delete process.env.ALLOW_DEMO_TOPUP;

  const validOtp = '555666';
  let verifyCalled = 0;

  global.fetch = async (url) => {
    const sUrl = String(url);
    if (sUrl.includes('/api/v5/otp/verify')) {
      verifyCalled++;
      if (sUrl.includes(`otp=${validOtp}`)) {
        return { ok: true, status: 200, json: async () => ({ type: 'success', message: 'OTP verified success' }) };
      }
      return { ok: true, status: 200, json: async () => ({ type: 'error', message: 'OTP not match' }) };
    }
    if (sUrl.includes('/api/v5/otp')) {
      return { ok: true, status: 200, json: async () => ({ type: 'success', message: 'req_ok' }) };
    }
    return originalFetch(url);
  };

  const db = openDb(':memory:');
  const app = createApp(db);
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const request = async (path, body) => {
    const res = await originalFetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };

  try {
    const testPhone = '9998887771';

    // 1. Send OTP
    const sendRes = await request('/api/auth/otp/send', { phone: testPhone });
    assert.equal(sendRes.status, 200);
    assert.equal(sendRes.data.message, 'OTP bhej diya');
    assert.equal(sendRes.data.devOtp, undefined); // In production MSG91, no devOtp exposed!

    // 2. Resend Cooldown (immediate resend blocked)
    const fastResend = await request('/api/auth/otp/send', { phone: testPhone });
    assert.equal(fastResend.status, 429);

    // 3. Verify with wrong OTP
    const wrongRes = await request('/api/auth/otp/verify', { phone: testPhone, otp: '123123' });
    assert.equal(wrongRes.status, 400);

    // 4. Verify with correct OTP for new user
    const step1 = await request('/api/auth/otp/verify', { phone: testPhone, otp: validOtp });
    assert.equal(step1.status, 400);
    assert.equal(step1.data.needsProfile, true);

    // 5. Complete Profile (name + role) - should succeed without calling MSG91 again
    const callsBeforeProfile = verifyCalled;
    const step2 = await request('/api/auth/otp/verify', {
      phone: testPhone,
      otp: validOtp,
      name: 'Rohan Sharma',
      role: 'customer',
    });
    assert.equal(step2.status, 200);
    assert.ok(step2.data.token);
    assert.equal(step2.data.user.name, 'Rohan Sharma');
    assert.equal(step2.data.isNew, true);
    assert.equal(verifyCalled, callsBeforeProfile); // Single-use MSG91 policy respected!

    // 6. Fast-forward: Existing user login
    // Send OTP again (advance last_sent in DB to bypass cooldown)
    await db.query('UPDATE otps SET last_sent = $1 WHERE phone = $2', [Date.now() - 25000, testPhone]);
    const sendAgain = await request('/api/auth/otp/send', { phone: testPhone });
    assert.equal(sendAgain.status, 200);

    // Existing user verifies OTP -> immediately logged in without needsProfile
    const existingLogin = await request('/api/auth/otp/verify', { phone: testPhone, otp: validOtp });
    assert.equal(existingLogin.status, 200);
    assert.ok(existingLogin.data.token);
    assert.equal(existingLogin.data.user.name, 'Rohan Sharma');
    assert.equal(existingLogin.data.isNew, false);
  } finally {
    server.close();
    await db.close();
    global.fetch = originalFetch;
    delete process.env.MSG91_AUTH_KEY;
    delete process.env.MSG91_TEMPLATE_ID;
    delete process.env.OTP_EXPIRY_MINUTES;
    process.env.NODE_ENV = 'development';
    process.env.DEV_SHOW_OTP = '1';
    process.env.ALLOW_DEMO_TOPUP = '1';
  }
});
