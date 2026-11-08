// FixMate API with PostgreSQL database
// Booking flow (state machine):
// requested -> assigned -> on_the_way -> inspecting -> quoted -> in_progress -> completed -> (paid)
//                                                         \-> closed (customer rejects quote, only visit fee due)
const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { openDb, CATEGORIES } = require('./db');
const { createAiRouter } = require('./aiRoutes');

const COMMISSION = 0.15; // platform cut from worker earnings
const VISIT_FEE = 99; // charged if customer rejects the quote
const CASHBACK = 0.05;
const OTP_TTL = 60_000, OTP_RESEND = 20_000, OTP_MAX_TRIES = 3;
const OTP_WINDOW = 60 * 60_000, OTP_PHONE_SEND_MAX = 5, OTP_PHONE_WRONG_MAX = 10;
const PROD = process.env.NODE_ENV === 'production';
const DEV_SHOW_OTP = process.env.DEV_SHOW_OTP === '1';
const ALLOW_DEMO_TOPUP = process.env.ALLOW_DEMO_TOPUP === '1';

const sha = (salt, v) => crypto.createHash('sha256').update(salt + v).digest('hex');
const otpHmac = (key, phone, value) => crypto.createHmac('sha256', key).update(`otp:${phone}:${value}`).digest('hex');
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const bad = (code, msg) => { throw new HttpError(code, msg); };

async function sendOtpSms(phone, otp) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER)
    bad(503, 'OTP SMS provider configure nahi hai');

  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const body = new URLSearchParams({
    To: `+91${phone}`,
    From: TWILIO_PHONE_NUMBER,
    Body: `FixMate OTP: ${otp}. Ye code 1 minute mein expire hoga. Kisi ke saath share na karein.`,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
  } catch {
    bad(502, 'SMS provider se connection nahi hua');
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) bad(502, 'SMS provider OTP nahi bhej saka. Provider settings check karo');
}

async function razorpayRequest(method, endpoint, body) {
  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = process.env;
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) bad(503, 'Razorpay payment service configure nahi hai');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(`https://api.razorpay.com/v1${endpoint}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64')}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
  } catch {
    bad(502, 'Razorpay se connection nahi hua');
  } finally {
    clearTimeout(timeout);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) bad(502, 'Razorpay request fail hui. Test keys aur account settings check karo');
  return data;
}

function createApp(db = openDb()) {
  const secret = process.env.JWT_SECRET || (PROD ? bad(500, 'JWT_SECRET required') : 'dev-secret-change-me');
  if (PROD && secret.length < 32) bad(500, 'JWT_SECRET must contain at least 32 characters');
  if (PROD && (DEV_SHOW_OTP || ALLOW_DEMO_TOPUP)) bad(500, 'Development-only flags are not allowed in production');
  const otpHmacKey = process.env.OTP_HMAC_KEY || (PROD ? bad(500, 'OTP_HMAC_KEY required') : secret);
  if (PROD && otpHmacKey.length < 32) bad(500, 'OTP_HMAC_KEY must contain at least 32 characters');
  const dailyOtpLimit = Number(process.env.OTP_DAILY_MAX || 1000);
  if (!Number.isSafeInteger(dailyOtpLimit) || dailyOtpLimit < 1) bad(500, 'OTP_DAILY_MAX must be a positive integer');
  const app = express();
  app.disable('x-powered-by');
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  app.use(express.json({ limit: '10kb' }));
  const allowedOrigins = (process.env.CLIENT_ORIGIN || '*').split(',').map((origin) => origin.trim()).filter(Boolean);
  if (PROD && (!allowedOrigins.length || allowedOrigins.includes('*'))) bad(500, 'CLIENT_ORIGIN must list explicit production origins');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
    if (PROD && req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (allowedOrigins.includes('*')) res.setHeader('Access-Control-Allow-Origin', '*');
    else if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.vary('Origin');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.static(path.join(__dirname, '../../client'))); // serves the frontend at /
  const h = (fn) => (req, res, next) => { try { Promise.resolve(fn(req, res, next)).catch(next); } catch (e) { next(e); } };
  const ok = (res, data = {}, code = 200) => res.status(code).json({ success: true, ...data });
  app.use('/api', rateLimit({ windowMs: 15 * 60_000, max: Number(process.env.API_RATE_MAX) || 300, standardHeaders: true, legacyHeaders: false }));

  const auth = (...roles) => async (req, res, next) => {
    try {
      const token = (req.headers.authorization || '').replace(/^Bearer /, '') || (req.query && typeof req.query.token === 'string' ? req.query.token : '');
      const p = jwt.verify(token, secret);
      const u = await db.queryOne('SELECT * FROM users WHERE id = $1', [p.id]);
      if (!u) return bad(401, 'Login karo');
      if (p.tokenVersion !== u.token_version) return bad(401, 'Login karo');
      if (roles.length && !roles.includes(u.role)) return bad(403, 'Ye action is role ke liye nahi hai');
      req.user = u;
      next();
    } catch (e) {
      next(e instanceof HttpError ? e : new HttpError(401, 'Login karo'));
    }
  };

  const authOptional = async (req, res, next) => {
    try {
      const token = (req.headers.authorization || '').replace(/^Bearer /, '') || (req.query && typeof req.query.token === 'string' ? req.query.token : '');
      if (!token) return next();
      const p = jwt.verify(token, secret);
      const u = await db.queryOne('SELECT * FROM users WHERE id = $1', [p.id]);
      if (u && p.tokenVersion === u.token_version) req.user = u;
      next();
    } catch {
      next();
    }
  };

  const pub = (u) => ({
    id: u.id,
    name: u.name,
    role: u.role,
    skill: u.skill,
    online: Boolean(u.online),
    phone: u.phone.slice(0, 2) + 'XXXXXX' + u.phone.slice(-2),
    experience_years: u.experience_years != null ? Number(u.experience_years) : 2,
    id_document_url: u.id_document_url || null,
    id_verified: u.id_verified != null ? Number(u.id_verified) : 1,
    service_areas: u.service_areas || 'All Dhanbad'
  });

  const credit = async (uid, label, amount, runner = db) => {
    await runner.query('UPDATE users SET wallet = wallet + $1 WHERE id = $2', [amount, uid]);
    await runner.query('INSERT INTO wallet_tx (user_id, label, amount) VALUES ($1, $2, $3)', [uid, label, amount]);
  };

  // ---------- Auth (OTP) ----------
  const otpLimiter = rateLimit({ windowMs: 60_000, max: +process.env.OTP_RATE_MAX || 10, standardHeaders: true, legacyHeaders: false,
    message: { success: false, message: 'Bahut zyada requests. Thodi der baad try karo' } });
  const PHONE = /^[6-9]\d{9}$/;
  const phoneHash = (phone) => crypto.createHmac('sha256', otpHmacKey).update(`rate:${phone}`).digest('hex');

  const consumeOtpSendBudget = async (phone) => {
    const now = Date.now(), day = new Date(now).toISOString().slice(0, 10), key = phoneHash(phone);
    await db.transaction(async (tx) => {
      await tx.query('DELETE FROM otp_rate_limits WHERE updated_at < $1', [now - 30 * 24 * 60 * 60_000]);
      let row = await tx.queryOne('SELECT * FROM otp_rate_limits WHERE phone_hash = $1', [key]);
      if (!row || now - Number(row.window_start) >= OTP_WINDOW) {
        await tx.query(`
          INSERT INTO otp_rate_limits (phone_hash, window_start, send_count, wrong_count, updated_at)
          VALUES ($1, $2, 0, 0, $3)
          ON CONFLICT (phone_hash) DO UPDATE SET
            window_start = EXCLUDED.window_start, send_count = 0, wrong_count = 0, updated_at = EXCLUDED.updated_at
        `, [key, now, now]);
        row = await tx.queryOne('SELECT * FROM otp_rate_limits WHERE phone_hash = $1', [key]);
      }
      if (row.send_count >= OTP_PHONE_SEND_MAX) bad(429, 'Is number par OTP limit poori ho gayi. Ek ghante baad try karo');
      const daily = await tx.queryOne('SELECT send_count FROM otp_daily_limits WHERE day = $1', [day]);
      if (daily && daily.send_count >= dailyOtpLimit) bad(429, 'Aaj OTP bhejne ki limit poori ho gayi');
      await tx.query('UPDATE otp_rate_limits SET send_count = send_count + 1, updated_at = $1 WHERE phone_hash = $2', [now, key]);
      await tx.query(`
        INSERT INTO otp_daily_limits (day, send_count) VALUES ($1, 1)
        ON CONFLICT (day) DO UPDATE SET send_count = otp_daily_limits.send_count + 1
      `, [day]);
      await tx.query('DELETE FROM otp_daily_limits WHERE day < $1', [day]);
    });
  };

  const recordWrongOtp = async (phone, otpRow) => {
    const now = Date.now(), key = phoneHash(phone);
    await db.transaction(async (tx) => {
      let row = await tx.queryOne('SELECT * FROM otp_rate_limits WHERE phone_hash = $1', [key]);
      if (!row || now - Number(row.window_start) >= OTP_WINDOW) {
        await tx.query(`
          INSERT INTO otp_rate_limits (phone_hash, window_start, send_count, wrong_count, updated_at)
          VALUES ($1, $2, 0, 0, $3)
          ON CONFLICT (phone_hash) DO UPDATE SET
            window_start = EXCLUDED.window_start, send_count = 0, wrong_count = 0, updated_at = EXCLUDED.updated_at
        `, [key, now, now]);
        row = await tx.queryOne('SELECT * FROM otp_rate_limits WHERE phone_hash = $1', [key]);
      }
      if (row.wrong_count >= OTP_PHONE_WRONG_MAX) bad(429, 'Is number par galat OTP tries ki limit poori ho gayi');
      const updated = await tx.query('UPDATE otps SET tries = tries + 1 WHERE phone = $1 AND hash = $2 AND tries < $3', [phone, otpRow.hash, OTP_MAX_TRIES]);
      if (updated.rowCount !== 1) bad(429, 'Naya OTP mangao');
      await tx.query('UPDATE otp_rate_limits SET wrong_count = wrong_count + 1, updated_at = $1 WHERE phone_hash = $2', [now, key]);
    });
  };

  app.post('/api/auth/otp/send', otpLimiter, h(async (req, res) => {
    const phone = String(req.body.phone || '');
    if (!PHONE.test(phone)) bad(400, 'Sahi 10 digit mobile number daalo');
    const showDevOtp = !PROD && DEV_SHOW_OTP;
    if (!showDevOtp && (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER))
      bad(503, 'OTP SMS provider configure nahi hai; local demo ke liye DEV_SHOW_OTP=1 set karo');
    const prev = await db.queryOne('SELECT last_sent FROM otps WHERE phone = $1', [phone]);
    if (prev && Date.now() - Number(prev.last_sent) < OTP_RESEND) bad(429, 'Thoda ruko, phir dobara OTP mangao');
    await consumeOtpSendBudget(phone);
    const otp = String(crypto.randomInt(100000, 1000000)), salt = crypto.randomBytes(8).toString('hex');
    await db.query(`
      INSERT INTO otps (phone, hash, salt, exp, tries, last_sent, hash_version)
      VALUES ($1, $2, $3, $4, 0, $5, 1)
      ON CONFLICT (phone) DO UPDATE SET
        hash = EXCLUDED.hash, salt = EXCLUDED.salt, exp = EXCLUDED.exp, tries = 0, last_sent = EXCLUDED.last_sent, hash_version = 1
    `, [phone, otpHmac(otpHmacKey, phone, otp), salt, Date.now() + OTP_TTL, Date.now()]);

    if (!showDevOtp) {
      try {
        await sendOtpSms(phone, otp);
      } catch (error) {
        await db.query('DELETE FROM otps WHERE phone = $1', [phone]);
        throw error;
      }
    }
    ok(res, { message: 'OTP bhej diya', ...(showDevOtp ? { devOtp: otp } : {}) });
  }));

  app.post('/api/auth/otp/verify', otpLimiter, h(async (req, res) => {
    const { phone, otp, name, role, skill } = req.body;
    const normalizedPhone = String(phone || '');
    const code = String(otp || '');
    if (!PHONE.test(normalizedPhone) || !/^\d{6}$/.test(code)) bad(400, 'Mobile number ya OTP sahi nahi hai');
    const row = await db.queryOne('SELECT * FROM otps WHERE phone = $1', [normalizedPhone]);
    if (!row) bad(400, 'Pehle OTP mangao');
    if (Date.now() > Number(row.exp)) bad(400, 'OTP expire ho gaya');
    if (row.tries >= OTP_MAX_TRIES) bad(429, '3 galat try ho gaye. Naya OTP mangao');
    const rate = await db.queryOne('SELECT window_start, wrong_count FROM otp_rate_limits WHERE phone_hash = $1', [phoneHash(normalizedPhone)]);
    if (rate && Date.now() - Number(rate.window_start) < OTP_WINDOW && rate.wrong_count >= OTP_PHONE_WRONG_MAX)
      bad(429, 'Is number par galat OTP tries ki limit poori ho gayi');
    const digest = row.hash_version === 1 ? otpHmac(otpHmacKey, normalizedPhone, code) : sha(row.salt, code);
    if (!same(row.hash, digest)) {
      await recordWrongOtp(normalizedPhone, row);
      bad(400, 'Galat OTP');
    }
    let user = await db.queryOne('SELECT * FROM users WHERE phone = $1', [row.phone]), isNew = false;
    if (!user) {
      // OTP stays valid so the client can resend the same OTP together with the profile.
      if (String(name || '').trim().length < 2 || !['customer', 'worker', 'admin'].includes(role))
        return res.status(400).json({ success: false, needsProfile: true, message: 'Naam aur role chuno' });
      if (role === 'worker' && !CATEGORIES.includes(skill)) bad(400, 'Worker ke liye sahi kaam chuno');
      const insRes = await db.query(
        'INSERT INTO users (phone, name, role, skill, wallet) VALUES ($1, $2, $3, $4, 0) RETURNING id',
        [row.phone, String(name).trim().slice(0, 60), role, role === 'worker' ? skill : null]
      );
      const id = insRes.rows[0].id;
      if (role === 'customer') await credit(id, 'Welcome bonus', 150);
      user = await db.queryOne('SELECT * FROM users WHERE id = $1', [id]);
      isNew = true;
    }
    await db.query('DELETE FROM otps WHERE phone = $1', [row.phone]);
    ok(res, { token: jwt.sign({ id: user.id, tokenVersion: user.token_version }, secret, { expiresIn: '7d' }), user: pub(user), isNew });
  }));

  app.get('/api/me', auth(), h((req, res) => ok(res, { user: pub(req.user), wallet: req.user.wallet })));

  app.post('/api/auth/logout-all', auth(), h(async (req, res) => {
    await db.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [req.user.id]);
    ok(res, { message: 'Sabhi devices se logout ho gaya' });
  }));

  app.post('/api/me/online', auth('worker'), h(async (req, res) => {
    if (typeof req.body.online !== 'boolean') bad(400, 'Online status sahi nahi hai');
    await db.query('UPDATE users SET online = $1 WHERE id = $2', [req.body.online ? 1 : 0, req.user.id]);
    ok(res, { online: req.body.online });
  }));

  // ---------- Worker / Technician Dashboard & Reviews ----------
  app.get('/api/worker/stats', auth('worker'), h(async (req, res) => {
    const uid = req.user.id;
    const completedRes = await db.queryOne(
      "SELECT COUNT(*) AS c FROM bookings WHERE worker_id = $1 AND status = 'completed'",
      [uid]
    );
    const activeRes = await db.queryOne(
      "SELECT COUNT(*) AS c FROM bookings WHERE worker_id = $1 AND status NOT IN ('completed', 'closed', 'cancelled')",
      [uid]
    );
    const totalEarningsRes = await db.queryOne(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM wallet_tx WHERE user_id = $1 AND amount > 0",
      [uid]
    );
    const ratingRes = await db.queryOne(
      "SELECT ROUND(AVG(rating)::numeric, 1) AS avg_rating, COUNT(*) AS review_count FROM reviews WHERE worker_id = $1",
      [uid]
    );

    ok(res, {
      stats: {
        completed_jobs: Number(completedRes ? completedRes.c : 0),
        active_jobs: Number(activeRes ? activeRes.c : 0),
        total_earnings: Number(totalEarningsRes ? totalEarningsRes.total : 0),
        avg_rating: ratingRes && ratingRes.avg_rating ? Number(ratingRes.avg_rating) : 4.8,
        review_count: Number(ratingRes ? ratingRes.review_count : 0)
      }
    });
  }));

  app.put('/api/worker/profile', auth('worker'), h(async (req, res) => {
    const { skill, experience_years, service_areas, id_document_url } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;

    if (skill && CATEGORIES.includes(skill)) {
      updates.push(`skill = $${idx++}`);
      values.push(skill);
    }
    if (experience_years !== undefined) {
      const exp = Math.max(0, Math.min(50, Number(experience_years) || 0));
      updates.push(`experience_years = $${idx++}`);
      values.push(exp);
    }
    if (service_areas) {
      updates.push(`service_areas = $${idx++}`);
      values.push(String(service_areas).trim().slice(0, 255));
    }
    if (id_document_url) {
      updates.push(`id_document_url = $${idx++}`);
      values.push(String(id_document_url).trim().slice(0, 100000));
    }

    if (updates.length > 0) {
      values.push(req.user.id);
      await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`, values);
    }

    const updatedUser = await db.queryOne('SELECT * FROM users WHERE id = $1', [req.user.id]);
    ok(res, { user: pub(updatedUser), message: 'Technician profile update ho gaya' });
  }));

  app.get('/api/worker/reviews', auth('worker'), h(async (req, res) => {
    try {
      const result = await db.query(
        `SELECT r.id, r.rating, r.comment, r.created_at, u.name AS customer_name, s.name AS service_name
         FROM reviews r
         JOIN bookings b ON b.id = r.booking_id
         JOIN services s ON s.id = b.service_id
         JOIN users u ON u.id = r.customer_id
         WHERE r.worker_id = $1
         ORDER BY r.id DESC LIMIT 50`,
        [req.user.id]
      );
      ok(res, { reviews: result.rows });
    } catch {
      ok(res, { reviews: [] });
    }
  }));

  // ---------- Services ----------
  app.get('/api/services', h(async (req, res) => {
    const { cat, q } = req.query;
    const result = await db.query(
      `SELECT * FROM services
       WHERE ($1::text IS NULL OR cat = $1)
         AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%')
       ORDER BY id`,
      [cat || null, q || null]
    );
    ok(res, { categories: CATEGORIES, services: result.rows });
  }));

  // ---------- Categories ----------
  app.get('/api/categories', h(async (req, res) => {
    let categories = [];
    try {
      const result = await db.query('SELECT id, name, slug, icon, description FROM categories WHERE is_active = 1 ORDER BY sort_order ASC, id ASC');
      categories = result.rows;
    } catch {
      categories = CATEGORIES.map((c, i) => ({ id: i + 1, name: c, slug: c.toLowerCase().replace(/[^a-z0-9]+/g, '-'), icon: 'tool', description: `${c} services in Dhanbad` }));
    }
    ok(res, { categories: categories.length ? categories : CATEGORIES.map((c, i) => ({ id: i + 1, name: c, slug: c.toLowerCase().replace(/[^a-z0-9]+/g, '-'), icon: 'tool' })) });
  }));

  // ---------- Customer Saved Addresses ----------
  app.get('/api/addresses', auth('customer'), h(async (req, res) => {
    try {
      const result = await db.query('SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, id DESC', [req.user.id]);
      ok(res, { addresses: result.rows });
    } catch {
      ok(res, { addresses: [] });
    }
  }));

  app.post('/api/addresses', auth('customer'), h(async (req, res) => {
    const { label, address_line, landmark, city, pincode, is_default } = req.body;
    if (!String(address_line || '').trim()) bad(400, 'Address line required hai');
    const lbl = String(label || 'Home').trim().slice(0, 50);
    const line = String(address_line).trim().slice(0, 300);
    const lmark = String(landmark || '').trim().slice(0, 150);
    const cty = String(city || 'Dhanbad').trim().slice(0, 100);
    const pin = String(pincode || '826001').trim().slice(0, 10);
    const def = is_default ? 1 : 0;

    await db.transaction(async (tx) => {
      if (def === 1) {
        await tx.query('UPDATE addresses SET is_default = 0 WHERE user_id = $1', [req.user.id]);
      }
      const ins = await tx.query(
        `INSERT INTO addresses (user_id, label, address_line, landmark, city, pincode, is_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [req.user.id, lbl, line, lmark, cty, pin, def]
      );
      const newAddress = await tx.queryOne('SELECT * FROM addresses WHERE id = $1', [ins.rows[0].id]);
      ok(res, { address: newAddress, message: 'Address save ho gaya' }, 201);
    });
  }));

  app.delete('/api/addresses/:id', auth('customer'), h(async (req, res) => {
    const id = Number(req.params.id);
    const r = await db.query('DELETE FROM addresses WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    if (r.rowCount === 0) bad(404, 'Address nahi mila');
    ok(res, { message: 'Address delete kar diya gaya' });
  }));

  // ---------- Coupons & Offers ----------
  app.get('/api/coupons', h(async (req, res) => {
    try {
      const result = await db.query('SELECT code, title, discount_type, discount_value, min_order_amount, max_discount FROM coupons WHERE is_active = 1 ORDER BY id DESC');
      ok(res, { coupons: result.rows });
    } catch {
      ok(res, { coupons: [] });
    }
  }));

  app.post('/api/coupons/apply', authOptional, h(async (req, res) => {
    const { code, amount } = req.body;
    if (!code || !amount) bad(400, 'Coupon code aur amount required hain');
    const orderAmt = Number(amount);
    if (!Number.isFinite(orderAmt) || orderAmt <= 0) bad(400, 'Valid amount daalein');

    const coupon = await db.queryOne('SELECT * FROM coupons WHERE UPPER(code) = UPPER($1) AND is_active = 1', [String(code).trim()]);
    if (!coupon) bad(404, 'Coupon invalid ya expired hai');

    if (orderAmt < coupon.min_order_amount) {
      bad(400, `Ye coupon minimum ₹${coupon.min_order_amount} ke order par hi valid hai`);
    }

    let discount = 0;
    if (coupon.discount_type === 'percentage') {
      discount = Math.round((orderAmt * coupon.discount_value) / 100);
      if (coupon.max_discount && discount > coupon.max_discount) {
        discount = coupon.max_discount;
      }
    } else {
      discount = Math.min(coupon.discount_value, orderAmt);
    }

    const finalAmount = Math.max(0, orderAmt - discount);
    ok(res, {
      valid: true,
      code: coupon.code,
      title: coupon.title,
      discount_amount: discount,
      final_amount: finalAmount
    });
  }));

  // ---------- Bookings ----------
  const LABEL = {
    requested: 'Booking confirm', assigned: 'Worker assign hua', on_the_way: 'Worker raste mein hai', inspecting: 'Worker jaanch kar raha hai',
    quoted: 'Quote taiyaar', in_progress: 'Kaam chal raha hai', completed: 'Kaam poora', closed: 'Quote reject, visit fee baaki', cancelled: 'Booking cancel hui'
  };

  const SELECT = `SELECT b.*, s.name AS service, s.cat, s.price,
    c.name AS customer_name, c.phone AS customer_phone,
    w.name AS worker_name, w.phone AS worker_phone, w.skill AS worker_skill, w.id_verified AS worker_verified,
    r.rating AS customer_rating, r.comment AS customer_comment, r.created_at AS reviewed_at
    FROM bookings b
    JOIN services s ON s.id = b.service_id
    JOIN users c ON c.id = b.customer_id
    LEFT JOIN users w ON w.id = b.worker_id
    LEFT JOIN reviews r ON r.booking_id = b.id`;

  const view = (b, u) => {
    const { start_code, customer_phone, worker_phone, ...rest } = b;
    const address = u.role === 'worker' && b.status === 'requested'
      ? 'Address accept karne ke baad milega'
      : b.address;
    const contactPhone = u.role === 'customer'
      ? (b.worker_id && !['requested', 'cancelled'].includes(b.status) ? worker_phone : null)
      : (b.worker_id === u.id && !['requested', 'cancelled'].includes(b.status) ? customer_phone : null);
    return { ...rest, address, contact_phone: contactPhone, label: LABEL[b.status] || b.status, ...(u.id === b.customer_id ? { start_code } : {}) };
  };

  const load = async (id) => (await db.queryOne(`${SELECT} WHERE b.id = $1`, [+id])) || bad(404, 'Booking nahi mili');
  const mine = (b, u) => { if (u.role === 'customer' ? b.customer_id !== u.id : b.worker_id !== u.id) bad(403, 'Ye booking tumhari nahi hai'); };

  const move = async (b, from, to, setFields = {}, actorId = null) => {
    const fields = ['status = $1'];
    const values = [to];
    let idx = 2;
    for (const [key, val] of Object.entries(setFields)) {
      fields.push(`${key} = $${idx++}`);
      values.push(val);
    }
    const idIdx = idx++;
    const statusIdx = idx++;
    values.push(b.id, from);
    const sql = `UPDATE bookings SET ${fields.join(', ')} WHERE id = $${idIdx} AND status = $${statusIdx}`;
    const r = await db.query(sql, values);
    if (r.rowCount !== 1) bad(409, `Abhi ye action possible nahi (status: ${b.status})`);
    try {
      await db.query(
        'INSERT INTO booking_status_history (booking_id, old_status, new_status, changed_by_user_id) VALUES ($1, $2, $3, $4)',
        [b.id, from, to, actorId]
      );
    } catch {
      // audit history failsafe
    }
  };

  app.post('/api/bookings', auth('customer'), h(async (req, res) => {
    const { serviceId, slot, address, pay, issue_desc, photo_url, coupon_code, discount_amount, is_emergency } = req.body;
    const s = (await db.queryOne('SELECT id, price FROM services WHERE id = $1', [+serviceId])) || bad(400, 'Service nahi mili');
    if (!String(slot || '').trim() || !String(address || '').trim()) bad(400, 'Slot aur address zaruri hain');
    if (!['wallet', 'cash', 'razorpay'].includes(pay)) bad(400, 'Payment wallet, cash ya online hona chahiye');
    const code = String(crypto.randomInt(1000, 10000));

    // Optional coupon discount validation
    let validDiscount = 0;
    let validCouponCode = null;
    if (coupon_code) {
      const cpn = await db.queryOne('SELECT * FROM coupons WHERE UPPER(code) = UPPER($1) AND is_active = 1', [String(coupon_code).trim()]);
      if (cpn && Number(s.price) >= cpn.min_order_amount) {
        validCouponCode = cpn.code;
        if (cpn.discount_type === 'percentage') {
          validDiscount = Math.round((s.price * cpn.discount_value) / 100);
          if (cpn.max_discount && validDiscount > cpn.max_discount) validDiscount = cpn.max_discount;
        } else {
          validDiscount = Math.min(cpn.discount_value, s.price);
        }
      }
    } else if (Number(discount_amount) > 0) {
      validDiscount = Number(discount_amount);
    }

    const desc = issue_desc ? String(issue_desc).trim().slice(0, 500) : null;
    const photo = photo_url ? String(photo_url).trim().slice(0, 100000) : null;
    const emergency = is_emergency ? 1 : 0;

    const ins = await db.query(
      `INSERT INTO bookings (customer_id, service_id, slot, address, pay, start_code, issue_desc, photo_url, coupon_code, discount_amount, is_emergency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [req.user.id, s.id, String(slot).slice(0, 60), String(address).slice(0, 200), pay, code, desc, photo, validCouponCode, validDiscount, emergency]
    );
    const id = ins.rows[0].id;
    ok(res, { booking: view(await load(id), req.user) }, 201);
  }));

  app.get('/api/bookings', auth(), h(async (req, res) => {
    const u = req.user;
    const result = u.role === 'customer'
      ? await db.query(`${SELECT} WHERE b.customer_id = $1 ORDER BY b.id DESC`, [u.id])
      : await db.query(`${SELECT} WHERE b.worker_id = $1 OR (b.status = 'requested' AND s.cat = $2) ORDER BY b.id DESC`, [u.id, u.skill]);
    ok(res, { bookings: result.rows.map((b) => view(b, u)) });
  }));

  app.get('/api/bookings/:id', auth(), h(async (req, res) => {
    const b = await load(req.params.id);
    if (!(b.customer_id === req.user.id || b.worker_id === req.user.id || (req.user.role === 'worker' && b.status === 'requested' && b.cat === req.user.skill)))
      bad(403, 'Ye booking tumhari nahi hai');
    ok(res, { booking: view(b, req.user) });
  }));

  const step = (routePath, role, from, to, fn) => app.post(`/api/bookings/:id/${routePath}`, auth(role), h(async (req, res) => {
    const b = await load(req.params.id);
    if (routePath !== 'accept') mine(b, req.user);
    const extra = (fn && await fn(b, req)) || {};
    await move(b, from, to, extra.setFields || {}, req.user ? req.user.id : null);
    ok(res, { booking: view(await load(b.id), req.user) });
  }));

  step('accept', 'worker', 'requested', 'assigned', (b, req) => {
    if (!req.user.online) bad(409, 'Pehle online aao');
    if (b.cat !== req.user.skill) bad(403, 'Ye kaam tumhare skill ka nahi hai');
    return { setFields: { worker_id: req.user.id } };
  });

  step('on-the-way', 'worker', 'assigned', 'on_the_way');

  step('start', 'worker', 'on_the_way', 'inspecting', async (b, req) => {
    if (b.status !== 'on_the_way') return;
    if (b.start_code_tries >= 5) bad(429, 'Start code ke 5 galat try ho gaye');
    if (!same(b.start_code, String(req.body.code || ''))) {
      await db.query(`UPDATE bookings SET start_code_tries = start_code_tries + 1 WHERE id = $1 AND status = 'on_the_way' AND start_code_tries < 5`, [b.id]);
      bad(400, 'Start code galat hai');
    }
    const photo = req.body.start_photo_url ? String(req.body.start_photo_url).trim().slice(0, 100000) : null;
    return photo ? { setFields: { start_photo_url: photo } } : {};
  });

  step('quote', 'worker', 'inspecting', 'quoted', (b, req) => {
    const parts = Number(req.body.parts ?? 0);
    if (!Number.isInteger(parts) || parts < 0 || parts > 20000) bad(400, 'Parts ka amount 0 se 20000 ke beech ho');
    if (b.cat === 'Home Tutor' && parts) bad(400, 'Tutor ke quote mein parts nahi hote');
    const parts_desc = req.body.parts_desc ? String(req.body.parts_desc).trim().slice(0, 300) : null;
    const discount = Number(b.discount_amount || 0);
    const subtotal = b.price + parts;
    const total = Math.max(0, subtotal - discount);
    return { setFields: { parts, parts_desc, total } };
  });

  step('approve', 'customer', 'quoted', 'in_progress');
  step('reject', 'customer', 'quoted', 'closed', () => ({ setFields: { total: VISIT_FEE } }));
  step('complete', 'worker', 'in_progress', 'completed', (b, req) => {
    const photo = req.body.complete_photo_url ? String(req.body.complete_photo_url).trim().slice(0, 100000) : null;
    const setFields = { completed_at: new Date().toISOString() };
    if (photo) setFields.complete_photo_url = photo;
    return { setFields };
  });

  app.post('/api/bookings/:id/cancel', auth('customer'), h(async (req, res) => {
    const b = await load(req.params.id);
    mine(b, req.user);
    if (!['requested', 'assigned'].includes(b.status)) {
      bad(409, 'Kaam shuru hone ya raste me hone ke baad cancel nahi ho sakta');
    }
    await move(b, b.status, 'cancelled', {}, req.user ? req.user.id : null);
    ok(res, { booking: view(await load(b.id), req.user), message: 'Booking cancel kar di gayi' });
  }));

  app.post('/api/bookings/:id/reschedule', auth('customer'), h(async (req, res) => {
    const { slot } = req.body;
    if (!slot || !String(slot).trim()) bad(400, 'Naya time slot chunein');
    const b = await load(req.params.id);
    mine(b, req.user);
    if (!['requested', 'assigned'].includes(b.status)) {
      bad(409, 'Worker ke nikalne ke baad slot reschedule nahi ho sakta');
    }
    const cleanSlot = String(slot).trim().slice(0, 60);
    await db.query('UPDATE bookings SET slot = $1 WHERE id = $2', [cleanSlot, b.id]);
    try {
      await db.query(
        'INSERT INTO booking_status_history (booking_id, old_status, new_status, changed_by_user_id, notes) VALUES ($1, $2, $3, $4, $5)',
        [b.id, b.status, b.status, req.user.id, 'Rescheduled to: ' + cleanSlot]
      );
    } catch {}
    ok(res, { booking: view(await load(b.id), req.user), message: 'Booking time slot update ho gaya' });
  }));

  app.post('/api/reviews', auth('customer'), h(async (req, res) => {
    const { booking_id, rating, comment } = req.body;
    const bId = Number(booking_id);
    if (!bId) bad(400, 'Booking ID required hai');
    const rVal = Number(rating);
    if (!Number.isFinite(rVal) || rVal < 1 || rVal > 5) bad(400, 'Rating 1 se 5 ke beech honi chahiye');

    const b = await load(bId);
    mine(b, req.user);
    if (b.status !== 'completed' && b.status !== 'closed') {
      bad(409, 'Sirf poore huye kaam par review de sakte hain');
    }

    const existing = await db.queryOne('SELECT id FROM reviews WHERE booking_id = $1', [b.id]);
    if (existing) bad(409, 'Aap is booking par pehle hi review de chuke hain');

    const cleanComment = comment ? String(comment).trim().slice(0, 500) : null;
    const ins = await db.query(
      `INSERT INTO reviews (booking_id, customer_id, worker_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [b.id, req.user.id, b.worker_id || null, rVal, cleanComment]
    );

    // Recalculate average rating for service
    try {
      const avgRes = await db.queryOne(
        `SELECT ROUND(AVG(r.rating)::numeric, 1) AS avg_rating
         FROM reviews r
         JOIN bookings bk ON bk.id = r.booking_id
         WHERE bk.service_id = $1`,
        [b.service_id]
      );
      if (avgRes && avgRes.avg_rating) {
        await db.query('UPDATE services SET rating = $1 WHERE id = $2', [avgRes.avg_rating, b.service_id]);
      }
    } catch {}

    ok(res, { message: 'Review submit ho gaya. Shukriya!', review_id: ins.rows[0].id }, 201);
  }));

  app.get('/api/reviews/service/:id', h(async (req, res) => {
    const sId = Number(req.params.id);
    try {
      const result = await db.query(
        `SELECT r.id, r.rating, r.comment, r.created_at, u.name AS customer_name
         FROM reviews r
         JOIN bookings b ON b.id = r.booking_id
         JOIN users u ON u.id = r.customer_id
         WHERE b.service_id = $1
         ORDER BY r.id DESC LIMIT 20`,
        [sId]
      );
      ok(res, { reviews: result.rows });
    } catch {
      ok(res, { reviews: [] });
    }
  }));

  app.post('/api/bookings/:id/pay', auth('customer'), h(async (req, res) => {
    const b = await load(req.params.id);
    mine(b, req.user);
    if (!['completed', 'closed'].includes(b.status)) bad(409, 'Kaam poora hone ke baad hi payment hoga');
    if (b.pay === 'razorpay') bad(409, 'Online payment Razorpay checkout se complete karo');

    await db.transaction(async (tx) => {
      const upd = await tx.query('UPDATE bookings SET paid = 1 WHERE id = $1 AND paid = 0', [b.id]);
      if (upd.rowCount !== 1) bad(409, 'Payment pehle hi ho chuki hai');
      if (b.pay === 'wallet') {
        const u = await tx.queryOne('SELECT wallet FROM users WHERE id = $1', [req.user.id]);
        if (u.wallet < b.total) bad(402, 'Wallet mein paise kam hain');
        await credit(req.user.id, b.service, -b.total, tx);
      }
      await credit(req.user.id, 'Cashback 5%', Math.floor(b.total * CASHBACK), tx);
      if (b.worker_id) {
        if (b.pay === 'wallet' || b.pay === 'razorpay') {
          await credit(b.worker_id, `Kamai: ${b.service}`, Math.floor(b.total * (1 - COMMISSION)), tx);
        } else if (b.pay === 'cash') {
          const w = await tx.queryOne('SELECT wallet FROM users WHERE id = $1', [b.worker_id]);
          const comm = Math.floor(b.total * COMMISSION);
          const deduct = Math.min(w ? w.wallet : 0, comm);
          if (deduct > 0) {
            await credit(b.worker_id, `Platform fee (15% Cash): ${b.service}`, -deduct, tx);
          }
        }
      }
    });

    ok(res, { booking: view(await load(b.id), req.user), message: 'Payment ho gaya' });
  }));

  app.post('/api/bookings/:id/payment/order', auth('customer'), h(async (req, res) => {
    const b = await load(req.params.id);
    mine(b, req.user);
    if (b.pay !== 'razorpay') bad(409, 'Ye booking Razorpay online payment ke liye nahi hai');
    if (!['completed', 'closed'].includes(b.status)) bad(409, 'Kaam poora hone ke baad hi payment hoga');
    if (b.paid) bad(409, 'Payment pehle hi ho chuki hai');
    if (!Number.isSafeInteger(b.total) || b.total < 1 || !Number.isSafeInteger(b.total * 100)) bad(400, 'Payment amount sahi nahi hai');
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) bad(503, 'Razorpay payment service configure nahi hai');

    const now = Date.now(), amountPaise = b.total * 100;
    const attempt = await db.transaction(async (tx) => {
      await tx.query(`UPDATE payment_orders SET status = 'expired', updated_at = $1 WHERE booking_id = $2 AND status = 'created' AND created_at < $3`, [now, b.id, now - 15 * 60_000]);
      await tx.query(`UPDATE payment_orders SET status = 'failed', updated_at = $1 WHERE booking_id = $2 AND status = 'creating' AND created_at < $3`, [now, b.id, now - 2 * 60_000]);
      const existing = await tx.queryOne(`SELECT id, provider_order_id, amount_paise, currency, status FROM payment_orders WHERE booking_id = $1 AND status IN ('creating', 'created')`, [b.id]);
      if (existing) {
        if (existing.status === 'creating') bad(409, 'Payment order ban raha hai. Thodi der baad try karo');
        return existing;
      }
      const ins = await tx.query(
        `INSERT INTO payment_orders (booking_id, amount_paise, currency, status, created_at, updated_at)
         VALUES ($1, $2, 'INR', 'creating', $3, $4) RETURNING id`,
        [b.id, amountPaise, now, now]
      );
      return { id: ins.rows[0].id, provider_order_id: null, amount_paise: amountPaise, currency: 'INR', status: 'creating' };
    });

    if (attempt.status === 'created') {
      return ok(res, { order: { id: attempt.provider_order_id, amount: attempt.amount_paise, currency: attempt.currency }, keyId: process.env.RAZORPAY_KEY_ID });
    }

    try {
      const order = await razorpayRequest('POST', '/orders', {
        amount: amountPaise,
        currency: 'INR',
        receipt: `fixmate-${b.id}-${attempt.id}`,
        notes: { booking_id: String(b.id) },
      });
      if (typeof order.id !== 'string' || order.amount !== amountPaise || order.currency !== 'INR')
        bad(502, 'Razorpay order details match nahi hue');
      await db.query(`UPDATE payment_orders SET provider_order_id = $1, status = 'created', updated_at = $2 WHERE id = $3 AND status = 'creating'`, [order.id, Date.now(), attempt.id]);
      ok(res, { order: { id: order.id, amount: amountPaise, currency: 'INR' }, keyId: process.env.RAZORPAY_KEY_ID });
    } catch (error) {
      await db.query(`UPDATE payment_orders SET status = 'failed', updated_at = $1 WHERE id = $2 AND status = 'creating'`, [Date.now(), attempt.id]);
      throw error;
    }
  }));

  app.post('/api/bookings/:id/payment/verify', auth('customer'), h(async (req, res) => {
    const b = await load(req.params.id);
    mine(b, req.user);
    if (b.pay !== 'razorpay') bad(409, 'Ye booking Razorpay online payment ke liye nahi hai');
    if (!['completed', 'closed'].includes(b.status)) bad(409, 'Kaam poora hone ke baad hi payment hoga');
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};
    if (typeof orderId !== 'string' || typeof paymentId !== 'string' || !/^[a-f0-9]{64}$/i.test(signature || ''))
      bad(400, 'Razorpay payment response sahi nahi hai');
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) bad(503, 'Razorpay payment service configure nahi hai');

    const order = (await db.queryOne('SELECT * FROM payment_orders WHERE booking_id = $1 AND provider_order_id = $2', [b.id, orderId]))
      || bad(404, 'Razorpay order nahi mila');
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
    if (!same(expected, signature.toLowerCase())) bad(400, 'Razorpay signature verify nahi hua');
    if (order.status === 'paid') {
      if (order.provider_payment_id !== paymentId) bad(409, 'Booking ki payment pehle hi ho chuki hai');
      return ok(res, { booking: view(await load(b.id), req.user), message: 'Payment pehle hi verify ho chuki hai' });
    }
    if (order.status !== 'created') bad(409, 'Razorpay order active nahi hai');

    const payment = await razorpayRequest('GET', `/payments/${encodeURIComponent(paymentId)}`);
    if (payment.id !== paymentId || payment.order_id !== orderId || payment.amount !== order.amount_paise || payment.currency !== 'INR' || payment.status !== 'captured')
      bad(402, 'Razorpay payment captured ya verify nahi hui');

    await db.transaction(async (tx) => {
      const current = await tx.queryOne('SELECT status, provider_payment_id FROM payment_orders WHERE id = $1', [order.id]);
      if (current.status === 'paid' && current.provider_payment_id === paymentId) return;
      if (current.status !== 'created') bad(409, 'Razorpay order active nahi hai');
      const updBooking = await tx.query('UPDATE bookings SET paid = 1 WHERE id = $1 AND paid = 0', [b.id]);
      if (updBooking.rowCount !== 1) bad(409, 'Booking payment pehle hi ho chuki hai');
      const updOrder = await tx.query(`UPDATE payment_orders SET status = 'paid', provider_payment_id = $1, updated_at = $2 WHERE id = $3 AND status = 'created'`, [paymentId, Date.now(), order.id]);
      if (updOrder.rowCount !== 1) bad(409, 'Payment already processed');
      await credit(b.customer_id, 'Cashback 5%', Math.floor(b.total * CASHBACK), tx);
      if (b.worker_id) {
        if (b.pay === 'wallet' || b.pay === 'razorpay') {
          await credit(b.worker_id, `Kamai: ${b.service}`, Math.floor(b.total * (1 - COMMISSION)), tx);
        } else if (b.pay === 'cash') {
          const w = await tx.queryOne('SELECT wallet FROM users WHERE id = $1', [b.worker_id]);
          const comm = Math.floor(b.total * COMMISSION);
          const deduct = Math.min(w ? w.wallet : 0, comm);
          if (deduct > 0) {
            await credit(b.worker_id, `Platform fee (15% Cash): ${b.service}`, -deduct, tx);
          }
        }
      }
    });

    ok(res, { booking: view(await load(b.id), req.user), message: 'Online payment verify ho gaya' });
  }));

  // ---------- Digital Invoices & Tax Receipts (Phase 5) ----------
  const canAccessInvoice = (b, u) => {
    if (!u) return false;
    if (u.role === 'admin') return true;
    if (u.id === b.customer_id) return true;
    if (u.id === b.worker_id) return true;
    return false;
  };

  function buildInvoiceData(b) {
    const isClosed = b.status === 'closed';
    const invoiceNo = `INV-${String(b.id).padStart(5, '0')}`;
    const dateObj = new Date(b.completed_at || b.created_at || Date.now());
    const dateStr = dateObj.toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric'
    });

    const items = [];
    if (isClosed) {
      items.push({
        title: 'Inspection & Visiting Fee (Quote rejected)',
        qty: 1,
        rate: VISIT_FEE,
        amount: VISIT_FEE
      });
    } else {
      items.push({
        title: `${b.service} (Base Labor & Service Charge)`,
        qty: 1,
        rate: b.price,
        amount: b.price
      });
      items.push({
        title: 'Inspection & Visiting Fee',
        qty: 1,
        rate: VISIT_FEE,
        amount: 0,
        note: '100% Free with Service (Waived)'
      });
      if (b.parts && b.parts > 0) {
        items.push({
          title: `Genuine Spare Parts: ${b.parts_desc || 'Replacement parts'}`,
          qty: 1,
          rate: b.parts,
          amount: b.parts
        });
      }
      if (b.is_emergency) {
        items.push({
          title: 'Priority Emergency Dispatch (Within 60 mins)',
          qty: 1,
          rate: 0,
          amount: 0,
          note: 'Complimentary Priority'
        });
      }
      if (b.discount_amount && b.discount_amount > 0) {
        items.push({
          title: `Special Promo Discount (${b.coupon_code || 'Offer'})`,
          qty: 1,
          rate: -b.discount_amount,
          amount: -b.discount_amount
        });
      }
    }

    const subtotal = isClosed ? VISIT_FEE : (b.price + (b.parts || 0));
    const discount = isClosed ? 0 : (b.discount_amount || 0);
    const finalPayable = isClosed ? VISIT_FEE : Math.max(0, subtotal - discount);

    // 18% GST calculation (included in total or itemized: 9% CGST + 9% SGST)
    const taxableAmount = Math.round((finalPayable / 1.18) * 100) / 100;
    const totalGst = Math.round((finalPayable - taxableAmount) * 100) / 100;
    const cgst = Math.round((totalGst / 2) * 100) / 100;
    const sgst = Math.round((totalGst / 2) * 100) / 100;

    const warrantyDays = isClosed ? 0 : (b.warranty_days || 30);
    const warrantyExpiry = new Date(Date.now() + warrantyDays * 24 * 60 * 60 * 1000).toLocaleDateString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric'
    });

    return {
      invoice_number: invoiceNo,
      date: dateStr,
      status: b.status,
      paid: Boolean(b.paid),
      payment_method: b.pay,
      customer: {
        id: b.customer_id,
        name: b.customer_name || 'FixMate Customer',
        phone: b.customer_phone || '9XXXXXXXXX',
        address: b.address
      },
      technician: b.worker_id ? {
        id: b.worker_id,
        name: b.worker_name || 'Verified Technician',
        phone: b.worker_phone || '',
        skill: b.worker_skill || b.cat,
        verified: Boolean(b.worker_verified)
      } : null,
      service: {
        name: b.service,
        category: b.cat,
        slot: b.slot
      },
      items,
      subtotal,
      discount,
      gst: {
        rate: '18%',
        cgst_rate: '9%',
        cgst_amount: cgst,
        sgst_rate: '9%',
        sgst_amount: sgst,
        total_tax: totalGst,
        taxable_value: taxableAmount
      },
      total: finalPayable,
      warranty: isClosed ? null : {
        service_warranty_days: warrantyDays,
        parts_warranty_days: (b.parts && b.parts > 0) ? 90 : 0,
        valid_until: warrantyExpiry,
        terms: '30 din ki free rework warranty labor par lagu hai. Genuine spare parts par 90 din replacement guarantee.'
      }
    };
  }

  app.get('/api/bookings/:id/invoice', auth(), h(async (req, res) => {
    const b = await load(req.params.id);
    if (!canAccessInvoice(b, req.user)) bad(403, 'Aapko is invoice ko dekhne ki anumati nahi hai');
    const invoice = buildInvoiceData(b);
    ok(res, { invoice });
  }));

  app.get('/api/bookings/:id/invoice/html', auth(), h(async (req, res) => {
    const b = await load(req.params.id);
    if (!canAccessInvoice(b, req.user)) bad(403, 'Aapko is invoice ko dekhne ki anumati nahi hai');
    const inv = buildInvoiceData(b);

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FixMate Invoice ${inv.invoice_number}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0F2537; background: #f8fafc; padding: 24px 16px; }
  .invoice-box { max-width: 720px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #006A60; padding-bottom: 20px; margin-bottom: 24px; }
  .logo { font-size: 26px; font-weight: 800; color: #006A60; letter-spacing: -0.5px; }
  .logo span { color: #FA6A00; }
  .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase; }
  .badge.paid { background: #E6F4EA; color: #1E824C; }
  .badge.unpaid { background: #FEF3C7; color: #D97706; }
  .details-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; font-size: 13.5px; line-height: 1.5; }
  .details-col b { color: #006A60; display: block; margin-bottom: 4px; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 13.5px; }
  th { background: #F0F4F8; color: #0F2537; text-align: left; padding: 10px 12px; font-weight: 700; border-top: 1px solid #CBD5E1; border-bottom: 1px solid #CBD5E1; }
  td { padding: 12px; border-bottom: 1px solid #E2EBF0; }
  .text-right { text-align: right; }
  .summary { margin-left: auto; width: 280px; margin-bottom: 24px; font-size: 13.5px; }
  .summary-row { display: flex; justify-content: space-between; padding: 6px 0; }
  .summary-row.total { border-top: 2px solid #0F2537; font-size: 17px; font-weight: 800; color: #006A60; padding-top: 10px; margin-top: 6px; }
  .warranty-box { background: #E2EFEF; border: 1.5px solid #006A60; border-radius: 12px; padding: 14px 18px; margin-bottom: 24px; }
  .warranty-box b { color: #004D40; font-size: 14px; display: block; margin-bottom: 4px; }
  .warranty-box p { font-size: 12.5px; color: #334E68; }
  .footer { text-align: center; border-top: 1px solid #E2EBF0; padding-top: 18px; font-size: 12px; color: #627D98; }
  .print-btn { display: inline-flex; align-items: gap: 8px; background: #006A60; color: #fff; font-weight: 700; padding: 10px 20px; border-radius: 10px; text-decoration: none; border: none; cursor: pointer; margin-bottom: 20px; font-size: 14px; }
  .print-btn:hover { background: #004D40; }
  @media print {
    body { background: #fff; padding: 0; }
    .invoice-box { border: none; box-shadow: none; padding: 0; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
  <div style="max-width:720px; margin:0 auto;" class="no-print">
    <button class="print-btn" onclick="window.print()">🖨️ Print / Save as PDF Receipt</button>
  </div>
  <div class="invoice-box">
    <div class="header">
      <div>
        <div class="logo">Fix<span>Mate</span></div>
        <div style="font-size:12px; color:#627D98; margin-top:4px;">GSTIN: 20AAACF1234F1Z5 · Dhanbad, Jharkhand</div>
        <div style="font-size:12px; color:#627D98;">support@fixmate.in · Helpline: +91 9999999999</div>
      </div>
      <div style="text-align:right;">
        <h2 style="font-size:20px; font-weight:800; color:#0F2537; margin-bottom:4px;">TAX INVOICE</h2>
        <div style="font-size:14px; font-weight:700; color:#006A60;">${inv.invoice_number}</div>
        <div style="font-size:12px; color:#627D98; margin:4px 0 8px;">Date: ${inv.date}</div>
        <span class="badge ${inv.paid ? 'paid' : 'unpaid'}">${inv.paid ? 'PAID' : 'PAYMENT PENDING'}</span>
      </div>
    </div>

    <div class="details-grid">
      <div class="details-col">
        <b>Billed To (Customer):</b>
        <div>${inv.customer.name}</div>
        <div>Phone: ${inv.customer.phone}</div>
        <div>Address: ${inv.customer.address}</div>
      </div>
      <div class="details-col">
        <b>Service & Technician Details:</b>
        <div>Service: ${inv.service.name} (${inv.service.category})</div>
        ${inv.technician ? `
          <div>Technician: ${inv.technician.name} ${inv.technician.verified ? '🛡️ (Verified Pro)' : ''}</div>
          <div>Contact: ${inv.technician.phone}</div>
        ` : '<div>Technician: FixMate Team</div>'}
        <div>Payment Mode: <span style="text-transform:capitalize;">${inv.payment_method}</span></div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Description</th>
          <th class="text-right">Qty</th>
          <th class="text-right">Rate</th>
          <th class="text-right">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${inv.items.map((it, idx) => `
          <tr>
            <td>${idx + 1}</td>
            <td>
              <b>${it.title}</b>
              ${it.note ? `<div style="font-size:11px; color:#1E824C;">${it.note}</div>` : ''}
            </td>
            <td class="text-right">${it.qty}</td>
            <td class="text-right">${it.rate < 0 ? '-' : ''}₹${Math.abs(it.rate)}</td>
            <td class="text-right"><b>${it.amount < 0 ? '-' : ''}₹${Math.abs(it.amount)}</b></td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="summary">
      <div class="summary-row">
        <span>Subtotal</span>
        <span>₹${inv.subtotal}</span>
      </div>
      ${inv.discount ? `
        <div class="summary-row" style="color:#1E824C; font-weight:700;">
          <span>Promo Discount</span>
          <span>-₹${inv.discount}</span>
        </div>
      ` : ''}
      <div class="summary-row" style="font-size:12px; color:#627D98;">
        <span>Includes GST 18% (CGST 9% + SGST 9%)</span>
        <span>₹${inv.gst.total_tax}</span>
      </div>
      <div class="summary-row total">
        <span>Final Payable</span>
        <span>₹${inv.total}</span>
      </div>
    </div>

    ${inv.warranty ? `
      <div class="warranty-box">
        <b>🛡️ 30-Day FixMate Guarantee Certificate</b>
        <p>${inv.warranty.terms}</p>
        <div style="font-size:12px; margin-top:6px; font-weight:700; color:#006A60;">Warranty Valid Till: ${inv.warranty.valid_until}</div>
      </div>
    ` : ''}

    <div class="footer">
      <div>This is a computer-generated tax invoice and requires no physical signature.</div>
      <div style="margin-top:4px;">Thank you for choosing FixMate Dhanbad! Safe · Reliable · Verified Home Services.</div>
    </div>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }));

  // ---------- Wallet ----------
  app.get('/api/wallet', auth(), h(async (req, res) => {
    const u = await db.queryOne('SELECT wallet FROM users WHERE id = $1', [req.user.id]);
    const txs = await db.query('SELECT label, amount, created_at FROM wallet_tx WHERE user_id = $1 ORDER BY id DESC LIMIT 20', [req.user.id]);
    ok(res, { balance: u.wallet, transactions: txs.rows });
  }));

  app.post('/api/wallet/topup', auth('customer'), h(async (req, res) => {
    if (!ALLOW_DEMO_TOPUP) bad(403, 'Demo topup disabled hai');
    const amt = Number(req.body.amount);
    if (!Number.isInteger(amt) || amt < 1 || amt > 5000) bad(400, 'Amount 1 se 5000 ke beech ho');
    await credit(req.user.id, 'Paise jode (demo)', amt);
    const u = await db.queryOne('SELECT wallet FROM users WHERE id = $1', [req.user.id]);
    ok(res, { balance: u.wallet });
  }));

  // ---------- Complaints & Support (Customer + Admin) ----------
  app.post('/api/complaints', auth('customer'), h(async (req, res) => {
    const { booking_id, category, description, refund_requested } = req.body || {};
    if (!category || !String(category).trim()) bad(400, 'Complaint category chunein');
    if (!description || String(description).trim().length < 5) bad(400, 'Problem ka vistaar se vivaran dein (kam se kam 5 akshar)');

    let validBookingId = null;
    if (booking_id) {
      const b = await load(booking_id);
      mine(b, req.user);
      validBookingId = b.id;
    }

    const ins = await db.query(
      `INSERT INTO complaints (booking_id, customer_id, category, description, refund_requested, status)
       VALUES ($1, $2, $3, $4, $5, 'open') RETURNING id`,
      [
        validBookingId,
        req.user.id,
        String(category).trim().slice(0, 50),
        String(description).trim().slice(0, 1000),
        refund_requested ? 1 : 0
      ]
    );

    ok(res, { ticket_id: ins.rows[0].id, message: 'Aapki shikayat darj kar li gayi hai. Hamari team jald sampark karegi.' }, 201);
  }));

  app.get('/api/complaints/my', auth('customer'), h(async (req, res) => {
    const result = await db.query(
      `SELECT c.*, s.name AS service_name, b.slot
       FROM complaints c
       LEFT JOIN bookings b ON b.id = c.booking_id
       LEFT JOIN services s ON s.id = b.service_id
       WHERE c.customer_id = $1
       ORDER BY c.id DESC`,
      [req.user.id]
    );
    ok(res, { complaints: result.rows });
  }));

  // ---------- Admin Dashboard & Platform Management (Role: Admin) ----------
  app.get('/api/admin/analytics', auth('admin'), h(async (req, res) => {
    const [
      customersRes,
      workersRes,
      verifiedWorkersRes,
      bookingsCountRes,
      statusCountsRes,
      revenueRes,
      complaintsCountRes,
      complaintsByStatusRes,
      topServicesRes
    ] = await Promise.all([
      db.queryOne("SELECT COUNT(*) AS c FROM users WHERE role = 'customer'"),
      db.queryOne("SELECT COUNT(*) AS c FROM users WHERE role = 'worker'"),
      db.queryOne("SELECT COUNT(*) AS c FROM users WHERE role = 'worker' AND id_verified = 1"),
      db.queryOne("SELECT COUNT(*) AS c FROM bookings"),
      db.query("SELECT status, COUNT(*) AS count FROM bookings GROUP BY status"),
      db.queryOne("SELECT COALESCE(SUM(total), 0) AS rev FROM bookings WHERE paid = 1"),
      db.queryOne("SELECT COUNT(*) AS c FROM complaints"),
      db.query("SELECT status, COUNT(*) AS count FROM complaints GROUP BY status"),
      db.query(
        `SELECT s.id, s.name, s.cat, COUNT(b.id) AS bookings_count, COALESCE(SUM(b.total), 0) AS total_revenue
         FROM services s
         LEFT JOIN bookings b ON b.service_id = s.id
         GROUP BY s.id, s.name, s.cat
         ORDER BY bookings_count DESC, total_revenue DESC
         LIMIT 6`
      )
    ]);

    const totalRevenue = Number(revenueRes ? revenueRes.rev : 0);
    const platformCommission = Math.round(totalRevenue * COMMISSION);

    const bookingStatusMap = {};
    (statusCountsRes.rows || []).forEach(r => {
      bookingStatusMap[r.status] = Number(r.count);
    });

    const complaintStatusMap = {};
    (complaintsByStatusRes.rows || []).forEach(r => {
      complaintStatusMap[r.status] = Number(r.count);
    });

    ok(res, {
      analytics: {
        total_customers: Number(customersRes ? customersRes.c : 0),
        total_workers: Number(workersRes ? workersRes.c : 0),
        verified_workers: Number(verifiedWorkersRes ? verifiedWorkersRes.c : 0),
        total_bookings: Number(bookingsCountRes ? bookingsCountRes.c : 0),
        total_revenue: totalRevenue,
        platform_commission: platformCommission,
        worker_payouts: Math.max(0, totalRevenue - platformCommission),
        bookings_by_status: bookingStatusMap,
        total_complaints: Number(complaintsCountRes ? complaintsCountRes.c : 0),
        complaints_by_status: complaintStatusMap,
        top_services: topServicesRes.rows
      }
    });
  }));

  app.get('/api/admin/users', auth('admin'), h(async (req, res) => {
    const { role, verified, q } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (role && ['customer', 'worker', 'admin'].includes(role)) {
      conditions.push(`role = $${idx++}`);
      params.push(role);
    }
    if (verified !== undefined && verified !== '') {
      conditions.push(`id_verified = $${idx++}`);
      params.push(Number(verified) ? 1 : 0);
    }
    if (q && String(q).trim()) {
      conditions.push(`(name ILIKE $${idx} OR phone LIKE $${idx})`);
      params.push(`%${String(q).trim()}%`);
      idx++;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await db.query(
      `SELECT id, name, phone, role, skill, wallet, online, id_verified, experience_years, service_areas
       FROM users
       ${whereClause}
       ORDER BY id DESC LIMIT 100`,
      params
    );
    ok(res, { users: result.rows });
  }));

  app.post('/api/admin/technicians/:id/verify', auth('admin'), h(async (req, res) => {
    const techId = Number(req.params.id);
    const verified = req.body.verified !== false ? 1 : 0;
    const worker = await db.queryOne("SELECT * FROM users WHERE id = $1 AND role = 'worker'", [techId]);
    if (!worker) bad(404, 'Technician nahi mila');

    await db.query('UPDATE users SET id_verified = $1 WHERE id = $2', [verified, techId]);
    const updated = await db.queryOne('SELECT * FROM users WHERE id = $1', [techId]);
    ok(res, {
      user: pub(updated),
      message: verified ? 'Technician ID verify kar di gayi (Badge active)' : 'Technician verification status hata diya gaya'
    });
  }));

  app.get('/api/admin/bookings', auth('admin'), h(async (req, res) => {
    const { status, limit } = req.query;
    const maxLimit = Math.min(Number(limit) || 100, 200);
    const querySql = `
      SELECT b.*, s.name AS service_name, s.cat, s.price AS base_price,
             c.name AS customer_name, c.phone AS customer_phone,
             w.name AS worker_name, w.phone AS worker_phone
      FROM bookings b
      JOIN services s ON s.id = b.service_id
      JOIN users c ON c.id = b.customer_id
      LEFT JOIN users w ON w.id = b.worker_id
      WHERE ($1::text IS NULL OR b.status = $1)
      ORDER BY b.id DESC
      LIMIT $2
    `;
    const result = await db.query(querySql, [status || null, maxLimit]);
    ok(res, { bookings: result.rows });
  }));

  app.post('/api/admin/bookings/:id/assign', auth('admin'), h(async (req, res) => {
    const bId = Number(req.params.id);
    const workerId = Number(req.body.worker_id);
    if (!workerId) bad(400, 'Technician select karein');

    const b = await db.queryOne('SELECT * FROM bookings WHERE id = $1', [bId]);
    if (!b) bad(404, 'Booking nahi mili');

    const worker = await db.queryOne("SELECT * FROM users WHERE id = $1 AND role = 'worker'", [workerId]);
    if (!worker) bad(404, 'Technician nahi mila');

    const newStatus = b.status === 'requested' ? 'assigned' : b.status;
    await db.transaction(async (tx) => {
      await tx.query('UPDATE bookings SET worker_id = $1, status = $2 WHERE id = $3', [workerId, newStatus, b.id]);
      await tx.query(
        'INSERT INTO booking_status_history (booking_id, old_status, new_status, changed_by_user_id, notes) VALUES ($1, $2, $3, $4, $5)',
        [b.id, b.status, newStatus, req.user.id, `Admin manual assignment: Technician ${worker.name} (ID: ${worker.id})`]
      );
    });

    const updated = await load(b.id);
    ok(res, { booking: view(updated, req.user), message: `Technician ${worker.name} assign ho gaya` });
  }));

  app.post('/api/admin/services', auth('admin'), h(async (req, res) => {
    const { cat, name, price, rating } = req.body || {};
    if (!cat || !CATEGORIES.includes(cat)) bad(400, 'Valid category chunein');
    if (!name || String(name).trim().length < 2) bad(400, 'Service ka naam likhein');
    const p = Number(price);
    if (!Number.isInteger(p) || p < 1 || p > 100000) bad(400, 'Valid service price likhein (₹1 se ₹100,000)');
    const r = rating != null ? Math.min(5, Math.max(1, Number(rating))) : 4.8;

    const ins = await db.query(
      `INSERT INTO services (cat, name, price, rating)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [cat, String(name).trim(), p, r]
    );
    const service = await db.queryOne('SELECT * FROM services WHERE id = $1', [ins.rows[0].id]);
    ok(res, { service, message: 'Nayi service catalog mein add ho gayi' }, 201);
  }));

  app.put('/api/admin/services/:id', auth('admin'), h(async (req, res) => {
    const sId = Number(req.params.id);
    const existing = await db.queryOne('SELECT * FROM services WHERE id = $1', [sId]);
    if (!existing) bad(404, 'Service nahi mili');

    const { cat, name, price, rating } = req.body || {};
    const updates = [];
    const values = [];
    let idx = 1;

    if (cat && CATEGORIES.includes(cat)) {
      updates.push(`cat = $${idx++}`);
      values.push(cat);
    }
    if (name && String(name).trim()) {
      updates.push(`name = $${idx++}`);
      values.push(String(name).trim());
    }
    if (price !== undefined) {
      const p = Number(price);
      if (!Number.isInteger(p) || p < 1 || p > 100000) bad(400, 'Price ₹1 se ₹100,000 ke beech ho');
      updates.push(`price = $${idx++}`);
      values.push(p);
    }
    if (rating !== undefined) {
      const r = Number(rating);
      if (Number.isFinite(r) && r >= 1 && r <= 5) {
        updates.push(`rating = $${idx++}`);
        values.push(r);
      }
    }

    if (updates.length > 0) {
      values.push(sId);
      await db.query(`UPDATE services SET ${updates.join(', ')} WHERE id = $${idx}`, values);
    }

    const updated = await db.queryOne('SELECT * FROM services WHERE id = $1', [sId]);
    ok(res, { service: updated, message: 'Service update ho gayi' });
  }));

  app.post('/api/admin/coupons', auth('admin'), h(async (req, res) => {
    const { code, title, discount_type, discount_value, min_order_amount, max_discount, usage_limit } = req.body || {};
    if (!code || String(code).trim().length < 3) bad(400, 'Coupon code kam se kam 3 akshar ka ho');
    if (!title || String(title).trim().length < 2) bad(400, 'Coupon title likhein');
    if (!['percentage', 'flat'].includes(discount_type)) bad(400, 'Discount type percentage ya flat ho');
    const val = Number(discount_value);
    if (!Number.isInteger(val) || val <= 0) bad(400, 'Discount value positive number ho');
    if (discount_type === 'percentage' && val > 90) bad(400, 'Percentage discount 90% se zyada nahi ho sakta');

    const cleanCode = String(code).trim().toUpperCase();
    const minAmt = Number(min_order_amount) || 0;
    const maxDisc = max_discount ? Number(max_discount) : null;
    const limit = Number(usage_limit) || 100;

    const ins = await db.query(
      `INSERT INTO coupons (code, title, discount_type, discount_value, min_order_amount, max_discount, usage_limit, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1) RETURNING id`,
      [cleanCode, String(title).trim(), discount_type, val, minAmt, maxDisc, limit]
    );
    const coupon = await db.queryOne('SELECT * FROM coupons WHERE id = $1', [ins.rows[0].id]);
    ok(res, { coupon, message: 'Coupon offer create ho gaya' }, 201);
  }));

  app.delete('/api/admin/coupons/:id', auth('admin'), h(async (req, res) => {
    const id = Number(req.params.id);
    const r = await db.query('UPDATE coupons SET is_active = 0 WHERE id = $1', [id]);
    if (r.rowCount === 0) bad(404, 'Coupon nahi mila');
    ok(res, { message: 'Coupon deactivate kar diya gaya' });
  }));

  app.get('/api/admin/complaints', auth('admin'), h(async (req, res) => {
    const { status } = req.query;
    const result = await db.query(
      `SELECT c.*, u.name AS customer_name, u.phone AS customer_phone,
              s.name AS service_name, b.total AS booking_total, b.paid AS booking_paid
       FROM complaints c
       JOIN users u ON u.id = c.customer_id
       LEFT JOIN bookings b ON b.id = c.booking_id
       LEFT JOIN services s ON s.id = b.service_id
       WHERE ($1::text IS NULL OR c.status = $1)
       ORDER BY c.id DESC`,
      [status || null]
    );
    ok(res, { complaints: result.rows });
  }));

  app.post('/api/admin/complaints/:id/resolve', auth('admin'), h(async (req, res) => {
    const cId = Number(req.params.id);
    const { status, resolution_notes, refund_amount } = req.body || {};
    const complaint = await db.queryOne('SELECT * FROM complaints WHERE id = $1', [cId]);
    if (!complaint) bad(404, 'Complaint ticket nahi mili');

    const nextStatus = status && ['in_investigation', 'resolved', 'closed'].includes(status) ? status : 'resolved';
    const notes = resolution_notes ? String(resolution_notes).trim().slice(0, 1000) : 'Resolved by FixMate Admin Support';
    const refund = Number(refund_amount) || 0;

    await db.transaction(async (tx) => {
      await tx.query(
        `UPDATE complaints
         SET status = $1, resolution_notes = $2, refund_amount = $3, resolved_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [nextStatus, notes, refund, cId]
      );

      if (refund > 0) {
        await credit(complaint.customer_id, `FixMate Refund (Ticket #${cId}): ${notes.slice(0, 40)}`, refund, tx);
      }
    });

    const updated = await db.queryOne('SELECT * FROM complaints WHERE id = $1', [cId]);
    ok(res, {
      complaint: updated,
      message: refund > 0
        ? `Complaint resolve ho gayi aur customer ke wallet mein ₹${refund} refund credit ho gaya`
        : `Complaint status update ho gaya: ${nextStatus}`
    });
  }));

  // ---------- AI Assistant (Voice + Chat) ----------
  app.use('/api/ai', createAiRouter({ db, authOptional }));

  app.use((req, res) => res.status(404).json({ success: false, message: 'Route nahi mila' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.code).json({ success: false, message: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ success: false, message: 'JSON galat hai' });
    console.error(err);
    res.status(500).json({ success: false, message: 'Server mein dikkat aayi' });
  });

  return app;
}

module.exports = { createApp };
