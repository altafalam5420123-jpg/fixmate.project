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
const { smartFindService, isOpenAIRealtimeConfigured, isGeminiConfigured } = require('./aiService');
const { isMsg91Configured, getOtpExpiryMinutes, sendOtp: sendMsg91Otp, verifyOtp: verifyMsg91Otp } = require('./msg91Service');

const COMMISSION = 0.15; // platform cut from worker earnings
const VISIT_FEE = 99; // charged if customer rejects the quote
const EMERGENCY_FEE = 99; // transparent priority surcharge for live emergency bookings
const CASHBACK = 0.05;
const OTP_RESEND = 20_000, OTP_MAX_TRIES = 3;
const getOtpTtlMs = () => getOtpExpiryMinutes() * 60_000;
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
  app.use(express.json({
    limit: '3mb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  }));
  const allowedOrigins = (process.env.CLIENT_ORIGIN || '*').split(',').map((origin) => origin.trim()).filter(Boolean);
  if (PROD && (!allowedOrigins.length || allowedOrigins.includes('*'))) bad(500, 'CLIENT_ORIGIN must list explicit production origins');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self)');
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Razorpay-Signature');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.static(path.join(__dirname, '../../client'))); // serves the frontend at /
  const h = (fn) => (req, res, next) => { try { Promise.resolve(fn(req, res, next)).catch(next); } catch (e) { next(e); } };
  const ok = (res, data = {}, code = 200) => res.status(code).json({ success: true, ...data });
  app.use('/api', rateLimit({ windowMs: 15 * 60_000, max: Number(process.env.API_RATE_MAX) || 300, standardHeaders: true, legacyHeaders: false }));

  // ---------- System Health & Credential Readiness (Phase 9) ----------
  app.get('/api/health', h(async (req, res) => {
    let dbOk = false;
    try {
      await db.queryOne('SELECT 1 AS ok');
      dbOk = true;
    } catch {}
    const twilioReady = Boolean(
      process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER &&
      !/xxxx|replace/i.test(process.env.TWILIO_ACCOUNT_SID)
    );
    const razorpayReady = Boolean(
      process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET &&
      !/replace/i.test(process.env.RAZORPAY_KEY_ID)
    );
    const razorpayWebhookReady = Boolean(
      process.env.RAZORPAY_WEBHOOK_SECRET && !/replace/i.test(process.env.RAZORPAY_WEBHOOK_SECRET)
    );
    res.status(dbOk ? 200 : 503).json({
      success: dbOk,
      status: dbOk ? 'ok' : 'degraded',
      database: dbOk ? 'connected' : 'disconnected',
      environment: PROD ? 'production' : 'development',
      integrations: {
        openai_realtime: isOpenAIRealtimeConfigured() ? 'ready' : 'BLOCKED',
        gemini_chat: isGeminiConfigured() ? 'ready' : 'BLOCKED',
        msg91_sms_otp: isMsg91Configured() ? 'ready' : 'BLOCKED',
        twilio_sms_otp: twilioReady ? 'ready' : 'BLOCKED',
        razorpay_checkout: razorpayReady ? 'ready' : 'BLOCKED',
        razorpay_webhook: razorpayWebhookReady ? 'ready' : 'BLOCKED',
        leaflet_osm_tracking: 'ready'
      }
    });
  }));

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
    const msg91Ready = isMsg91Configured();
    const twilioReady = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
    if (!showDevOtp && !msg91Ready && !twilioReady)
      bad(503, 'OTP SMS provider configure nahi hai; MSG91_AUTH_KEY aur MSG91_TEMPLATE_ID set karo ya local demo ke liye DEV_SHOW_OTP=1 set karo');
    const prev = await db.queryOne('SELECT last_sent FROM otps WHERE phone = $1', [phone]);
    if (prev && Date.now() - Number(prev.last_sent) < OTP_RESEND) bad(429, 'Thoda ruko, phir dobara OTP mangao');
    await consumeOtpSendBudget(phone);
    const ttl = getOtpTtlMs();
    const salt = crypto.randomBytes(8).toString('hex');

    if (msg91Ready && !showDevOtp) {
      try {
        await sendMsg91Otp(phone);
      } catch (error) {
        await db.query('DELETE FROM otps WHERE phone = $1', [phone]);
        throw error;
      }
      await db.query(`
        INSERT INTO otps (phone, hash, salt, exp, tries, last_sent, hash_version)
        VALUES ($1, $2, $3, $4, 0, $5, 1)
        ON CONFLICT (phone) DO UPDATE SET
          hash = EXCLUDED.hash, salt = EXCLUDED.salt, exp = EXCLUDED.exp, tries = 0, last_sent = EXCLUDED.last_sent, hash_version = 1
      `, [phone, 'MSG91_PENDING', salt, Date.now() + ttl, Date.now()]);
      ok(res, { message: 'OTP bhej diya' });
      return;
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    await db.query(`
      INSERT INTO otps (phone, hash, salt, exp, tries, last_sent, hash_version)
      VALUES ($1, $2, $3, $4, 0, $5, 1)
      ON CONFLICT (phone) DO UPDATE SET
        hash = EXCLUDED.hash, salt = EXCLUDED.salt, exp = EXCLUDED.exp, tries = 0, last_sent = EXCLUDED.last_sent, hash_version = 1
    `, [phone, otpHmac(otpHmacKey, phone, otp), salt, Date.now() + ttl, Date.now()]);

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

    if (row.hash === 'MSG91_VERIFIED_PENDING_PROFILE') {
      // Previously verified by MSG91, now submitting name and role for registration
    } else if (row.hash === 'MSG91_PENDING') {
      const verifyRes = await verifyMsg91Otp(normalizedPhone, code);
      if (!verifyRes.success) {
        await recordWrongOtp(normalizedPhone, row);
        bad(400, verifyRes.message || 'Galat OTP');
      }
    } else {
      const digest = row.hash_version === 1 ? otpHmac(otpHmacKey, normalizedPhone, code) : sha(row.salt, code);
      if (!same(row.hash, digest)) {
        await recordWrongOtp(normalizedPhone, row);
        bad(400, 'Galat OTP');
      }
    }

    let user = await db.queryOne('SELECT * FROM users WHERE phone = $1', [row.phone]), isNew = false;
    if (!user) {
      if (String(name || '').trim().length < 2 || !['customer', 'worker', 'admin', 'operations'].includes(role)) {
        if (row.hash === 'MSG91_PENDING') {
          await db.query('UPDATE otps SET hash = $1 WHERE phone = $2', ['MSG91_VERIFIED_PENDING_PROFILE', row.phone]);
        }
        return res.status(400).json({ success: false, needsProfile: true, message: 'Naam aur role chuno' });
      }
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

  // ---------- Smart Service Finder (Section 4) ----------
  app.post('/api/services/smart-find', h(async (req, res) => {
    const query = (req.body && req.body.query) || '';
    const result = await smartFindService({ query, db });
    if (!result.success) return bad(400, result.error);
    ok(res, result);
  }));

  app.get('/api/services/smart-find', h(async (req, res) => {
    const query = req.query.q || req.query.query || '';
    const result = await smartFindService({ query, db });
    if (!result.success) return bad(400, result.error);
    ok(res, result);
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
  const ACTIVE_TRACKING_STATUSES = ['assigned', 'on_the_way', 'inspecting', 'quoted', 'in_progress'];

  const calcDistanceAndEta = (lat1, lng1, lat2, lng2) => {
    if (lat1 == null || lng1 == null || lat2 == null || lng2 == null) {
      return { distance_km: null, eta_minutes: null };
    }
    const toRad = (deg) => (deg * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(Number(lat2) - Number(lat1));
    const dLng = toRad(Number(lng2) - Number(lng1));
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(Number(lat1))) * Math.cos(toRad(Number(lat2))) * Math.sin(dLng / 2) ** 2;
    const distanceKm = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const urbanKm = distanceKm * 1.35;
    const eta = distanceKm <= 0.15 ? 1 : Math.max(2, Math.round((urbanKm / 22) * 60));
    return { distance_km: Number(distanceKm.toFixed(2)), eta_minutes: eta };
  };

  const notifyUser = async ({ userId, bookingId = null, title, body, type = 'booking_status', dedupeKey = null }) => {
    if (!userId || !body) return;
    try {
      await db.query(
        `INSERT INTO notifications (user_id, booking_id, title, body, type, dedupe_key)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (user_id, dedupe_key) DO NOTHING`,
        [userId, bookingId, String(title || 'FixMate Update').slice(0, 140), String(body).slice(0, 500), type, dedupeKey]
      );
    } catch {
      // non-fatal notification failsafe
    }
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
    const {
      start_code, customer_phone, worker_phone,
      worker_lat, worker_lng, eta_minutes, tracking_active, location_updated_at,
      ...rest
    } = b;
    const address = u.role === 'worker' && b.status === 'requested'
      ? 'Address accept karne ke baad milega'
      : b.address;
    const contactPhone = u.role === 'customer'
      ? (b.worker_id && !['requested', 'cancelled'].includes(b.status) ? worker_phone : null)
      : (b.worker_id === u.id && !['requested', 'cancelled'].includes(b.status) ? customer_phone : null);

    // Strictly expose technician live coordinates ONLY during an active tracking job
    const canSeeLocation = ACTIVE_TRACKING_STATUSES.includes(b.status) &&
      Boolean(tracking_active) &&
      worker_lat != null && worker_lng != null;

    const trackingFields = canSeeLocation
      ? {
          tracking_active: true,
          worker_lat: Number(worker_lat),
          worker_lng: Number(worker_lng),
          eta_minutes: eta_minutes != null ? Number(eta_minutes) : null,
          location_updated_at
        }
      : {
          tracking_active: false,
          worker_lat: null,
          worker_lng: null,
          eta_minutes: null,
          location_updated_at: null
        };

    return {
      ...rest,
      ...trackingFields,
      address,
      contact_phone: contactPhone,
      label: LABEL[b.status] || b.status,
      ...(u.id === b.customer_id ? { start_code } : {})
    };
  };

  const load = async (id) => (await db.queryOne(`${SELECT} WHERE b.id = $1`, [+id])) || bad(404, 'Booking nahi mili');
  const mine = (b, u) => { if (u.role === 'customer' ? b.customer_id !== u.id : b.worker_id !== u.id) bad(403, 'Ye booking tumhari nahi hai'); };

  const NOTIF_TEXT = {
    assigned: ['Technician Assigned', 'Verified technician ne aapka job accept kar liya hai.'],
    on_the_way: ['Technician On The Way', 'Aapka technician aapke ghar ke liye nikal chuka hai. Live map par track karein!'],
    inspecting: ['Technician Arrived', 'Technician pahuch chuka hai aur inspection shuru ho gayi hai.'],
    quoted: ['Inspection Quote Ready', 'Technician ne repair estimate bhej diya hai. Kripya approve karein.'],
    in_progress: ['Work In Progress', 'Aapke quote ke anusaar kaam shuru ho gaya hai.'],
    completed: ['Service Completed', 'Kaam poora ho gaya hai! Apna digital invoice aur 30-day warranty dekhein.'],
    cancelled: ['Booking Cancelled', 'Aapki booking cancel kar di gayi hai.']
  };

  const move = async (b, from, to, setFields = {}, actorId = null) => {
    const mergedFields = { ...setFields };
    // Immediately wipe & stop technician GPS coordinates whenever booking leaves active tracking phase
    if (['completed', 'closed', 'cancelled'].includes(to)) {
      mergedFields.worker_lat = null;
      mergedFields.worker_lng = null;
      mergedFields.tracking_active = 0;
      mergedFields.eta_minutes = null;
    }

    const fields = ['status = $1'];
    const values = [to];
    let idx = 2;
    for (const [key, val] of Object.entries(mergedFields)) {
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

    if (NOTIF_TEXT[to]) {
      const [nTitle, nBody] = NOTIF_TEXT[to];
      await notifyUser({
        userId: b.customer_id,
        bookingId: b.id,
        title: `${nTitle} (#${b.id})`,
        body: nBody,
        type: 'booking_status',
        dedupeKey: `booking_${b.id}_${to}`
      });
    }
  };

  app.post('/api/bookings', auth('customer'), h(async (req, res) => {
    const {
      serviceId, slot, address, pay, issue_desc, photo_url,
      coupon_code, discount_amount, is_emergency, customer_lat, customer_lng,
      pincode, family_member_name, amc_subscription_id
    } = req.body;
    const s = (await db.queryOne('SELECT id, cat, name, price FROM services WHERE id = $1', [+serviceId])) || bad(400, 'Service nahi mili');
    if (!String(slot || '').trim() || !String(address || '').trim()) bad(400, 'Slot aur address zaruri hain');
    if (!['wallet', 'cash', 'razorpay'].includes(pay)) bad(400, 'Payment wallet, cash ya online hona chahiye');

    // Optional Pincode Serviceability check (Section 21)
    if (pincode && String(pincode).trim()) {
      const cleanPin = String(pincode).trim();
      const area = await db.queryOne('SELECT * FROM service_areas WHERE pincode = $1 AND is_active = 1', [cleanPin]);
      if (!area) bad(400, `Pincode ${cleanPin} abhi FixMate service zone mein nahi hai`);
    }

    // Real Emergency Availability Check (Section 11: Never promise instant service unless technician is online)
    const emergency = is_emergency ? 1 : 0;
    let emergencyFee = 0;
    if (emergency) {
      const onlineRow = await db.queryOne(
        "SELECT COUNT(*) AS c FROM users WHERE role = 'worker' AND online = 1 AND skill = $1",
        [s.cat]
      );
      if (Number(onlineRow?.c || 0) === 0) {
        bad(409, `Abhi ${s.cat} mein koi online emergency technician available nahi hai. Kripya normal scheduled slot chunein.`);
      }
      emergencyFee = EMERGENCY_FEE;
    }

    const code = String(crypto.randomInt(1000, 10000));

    // Optional Active AMC Subscription Check & Visit Redemption (Section 13)
    let validDiscount = 0;
    let validCouponCode = null;
    let validAmcSubId = null;

    if (amc_subscription_id) {
      const sub = await db.queryOne(
        `SELECT sub.*, p.category FROM amc_subscriptions sub
         JOIN amc_plans p ON p.id = sub.plan_id
         WHERE sub.id = $1 AND sub.user_id = $2 AND sub.status = 'active'`,
        [Number(amc_subscription_id), req.user.id]
      );
      if (!sub) bad(404, 'Active AMC subscription nahi mili');
      if (sub.visits_used >= sub.visits_total) bad(409, 'Is AMC plan ki sabhi free visits use ho chuki hain');
      if (new Date(sub.end_date).getTime() < Date.now()) bad(409, 'Ye AMC subscription expire ho chuki hai');
      validAmcSubId = sub.id;
      validDiscount = s.price;
      validCouponCode = `AMC-#${sub.id}`;
    } else if (coupon_code) {
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
    const famName = family_member_name ? String(family_member_name).trim().slice(0, 100) : null;

    let cLat = null;
    let cLng = null;
    if (customer_lat != null && customer_lng != null) {
      const pLat = Number(customer_lat);
      const pLng = Number(customer_lng);
      if (Number.isFinite(pLat) && pLat >= -90 && pLat <= 90 && Number.isFinite(pLng) && pLng >= -180 && pLng <= 180) {
        cLat = pLat;
        cLng = pLng;
      }
    } else {
      try {
        const defAddr = await db.queryOne('SELECT lat, lng FROM addresses WHERE user_id = $1 AND lat IS NOT NULL AND lng IS NOT NULL ORDER BY is_default DESC, id DESC LIMIT 1', [req.user.id]);
        if (defAddr) {
          cLat = Number(defAddr.lat);
          cLng = Number(defAddr.lng);
        }
      } catch {}
    }

    const id = await db.transaction(async (tx) => {
      if (validAmcSubId) {
        const upd = await tx.query(
          `UPDATE amc_subscriptions SET visits_used = visits_used + 1 WHERE id = $1 AND visits_used < visits_total`,
          [validAmcSubId]
        );
        if (upd.rowCount !== 1) bad(409, 'AMC visit limit poori ho chuki hai');
      }
      const ins = await tx.query(
        `INSERT INTO bookings (customer_id, service_id, slot, address, pay, start_code, issue_desc, photo_url, coupon_code, discount_amount, is_emergency, customer_lat, customer_lng, emergency_fee, family_member_name, amc_subscription_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
        [req.user.id, s.id, String(slot).slice(0, 60), String(address).slice(0, 200), pay, code, desc, photo, validCouponCode, validDiscount, emergency, cLat, cLng, emergencyFee, famName, validAmcSubId]
      );
      return ins.rows[0].id;
    });

    await notifyUser({
      userId: req.user.id,
      bookingId: id,
      title: `Booking Confirmed (#${id})`,
      body: `Aapki service booking confirm ho gayi hai. Safety Code: ${code}.`,
      type: 'booking_status',
      dedupeKey: `booking_${id}_requested`
    });
    ok(res, { booking: view(await load(id), req.user) }, 201);
  }));

  app.get('/api/bookings', auth(), h(async (req, res) => {
    const u = req.user;
    const result = u.role === 'customer'
      ? await db.query(`${SELECT} WHERE b.customer_id = $1 ORDER BY b.id DESC`, [u.id])
      : await db.query(`${SELECT} WHERE b.worker_id = $1 OR (b.status = 'requested' AND s.cat = $2) ORDER BY b.id DESC`, [u.id, u.skill]);
    ok(res, { bookings: result.rows.map((b) => view(b, u)) });
  }));

  // Service History & Warranty Eligibility (Section 10 — placed BEFORE /api/bookings/:id)
  app.get('/api/bookings/warranty-history', auth('customer'), h(async (req, res) => {
    const rows = await db.query(
      `${SELECT} WHERE b.customer_id = $1 AND b.status IN ('completed', 'closed') ORDER BY b.id DESC LIMIT 50`,
      [req.user.id]
    );
    const items = rows.rows.map((b) => {
      const days = b.status === 'closed' ? 0 : (Number(b.warranty_days) || 30);
      const baseTime = new Date(b.completed_at || b.created_at || Date.now()).getTime();
      const expiryMs = baseTime + days * 24 * 60 * 60 * 1000;
      return {
        booking_id: b.id,
        service: b.service,
        category: b.cat,
        booked_at: b.created_at,
        completed_at: b.completed_at || b.created_at,
        technician_name: b.worker_name || 'Verified Partner',
        technician_verified: Boolean(b.worker_verified),
        parts_desc: b.parts_desc || null,
        parts_cost: Number(b.parts || 0),
        total_paid: Number(b.total || b.price || 0),
        paid: Boolean(b.paid),
        warranty_days: days,
        parts_warranty_days: b.parts > 0 ? 90 : 0,
        warranty_valid_until: days > 0 ? new Date(expiryMs).toISOString() : null,
        warranty_active: days > 0 && Date.now() <= expiryMs,
        warranty_terms: days > 0
          ? `${days}-day service rework warranty${b.parts > 0 ? ' + 90-day genuine spare parts coverage' : ''}`
          : 'No service warranty (inspection quote rejected)'
      };
    });
    ok(res, { history: items });
  }));

  // 1-Click Repeat Booking Preview with Live Price & Availability Recheck (Section 12)
  app.get('/api/bookings/:id/repeat-preview', auth('customer'), h(async (req, res) => {
    const b = await load(req.params.id);
    mine(b, req.user);
    const svc = await db.queryOne('SELECT * FROM services WHERE id = $1', [b.service_id]);
    if (!svc) bad(404, 'Ye service ab catalog mein uplabdh nahi hai');
    const techRow = await db.queryOne("SELECT COUNT(*) AS c FROM users WHERE role = 'worker' AND online = 1 AND skill = $1", [svc.cat]);
    const onlineCount = Number(techRow?.c || 0);
    let priceChanged = false;
    if (b.status === 'completed' || (Number(b.total) > 0 && b.status !== 'closed')) {
      const origBase = Math.max(0, Number(b.total) - Number(b.parts || 0) - Number(b.emergency_fee || 0) + Number(b.discount_amount || 0));
      priceChanged = origBase > 0 && origBase !== Number(svc.price);
    }
    ok(res, {
      service: svc,
      previous_booking: {
        id: b.id,
        address: b.address,
        slot: b.slot,
        pay: b.pay,
        issue_desc: b.issue_desc,
        family_member_name: b.family_member_name || null
      },
      price_changed: priceChanged,
      availability: {
        available: onlineCount > 0,
        online_technicians: onlineCount
      }
    });
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
    const emergencyFee = Number(b.emergency_fee || 0);
    const subtotal = b.price + parts + emergencyFee;
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

  // ---------- Live Technician Tracking & Notifications (Phase 7) ----------
  // Permission-based technician location update strictly scoped to active booking
  app.post('/api/bookings/:id/location', auth('worker'), h(async (req, res) => {
    const b = await load(req.params.id);
    mine(b, req.user);

    if (req.body && req.body.stop === true) {
      await db.query(
        'UPDATE bookings SET tracking_active = 0, worker_lat = NULL, worker_lng = NULL, eta_minutes = NULL WHERE id = $1',
        [b.id]
      );
      return ok(res, {
        tracking_active: false,
        worker_location: null,
        message: 'Live location sharing band kar di gayi'
      });
    }

    if (!ACTIVE_TRACKING_STATUSES.includes(b.status)) {
      bad(409, 'Live tracking sirf active job ke dauran hi chalu ho sakti hai');
    }

    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      bad(400, 'Valid latitude aur longitude coordinates zaroori hain');
    }

    let calc = { distance_km: null, eta_minutes: null };
    if (b.customer_lat != null && b.customer_lng != null) {
      calc = calcDistanceAndEta(lat, lng, b.customer_lat, b.customer_lng);
    } else if (req.body?.eta_minutes != null && Number.isFinite(Number(req.body.eta_minutes))) {
      calc.eta_minutes = Math.max(1, Math.min(180, Math.round(Number(req.body.eta_minutes))));
    }

    const nowIso = new Date().toISOString();
    await db.query(
      `UPDATE bookings
       SET worker_lat = $1, worker_lng = $2, tracking_active = 1, eta_minutes = $3, location_updated_at = $4
       WHERE id = $5`,
      [lat, lng, calc.eta_minutes, nowIso, b.id]
    );

    if (calc.eta_minutes != null && calc.eta_minutes <= 5) {
      await notifyUser({
        userId: b.customer_id,
        bookingId: b.id,
        title: `Technician Arriving Soon (#${b.id})`,
        body: `Aapka technician lagbhag ${calc.eta_minutes} minute mein ghar pahuchne wala hai.`,
        type: 'tracking_eta',
        dedupeKey: `booking_${b.id}_arriving_soon`
      });
    }

    ok(res, {
      tracking_active: true,
      worker_location: {
        lat,
        lng,
        eta_minutes: calc.eta_minutes,
        distance_km: calc.distance_km,
        updated_at: nowIso
      }
    });
  }));

  // Customer / Authorized Viewer: Read live technician tracking ONLY when active job
  app.get('/api/bookings/:id/tracking', auth(), h(async (req, res) => {
    const b = await load(req.params.id);
    const isAuthorized = req.user.role === 'admin' || b.customer_id === req.user.id || b.worker_id === req.user.id;
    if (!isAuthorized) {
      bad(403, 'Aapko is booking ki tracking dekhne ki anumati nahi hai');
    }

    let timeline = [];
    try {
      const hist = await db.query(
        'SELECT old_status, new_status, notes, created_at FROM booking_status_history WHERE booking_id = $1 ORDER BY id ASC',
        [b.id]
      );
      timeline = hist.rows;
    } catch {}

    const isJobActive = ACTIVE_TRACKING_STATUSES.includes(b.status);
    const hasCoords = isJobActive && Boolean(b.tracking_active) && b.worker_lat != null && b.worker_lng != null;

    let distInfo = { distance_km: null, eta_minutes: b.eta_minutes != null ? Number(b.eta_minutes) : null };
    if (hasCoords && b.customer_lat != null && b.customer_lng != null) {
      distInfo = calcDistanceAndEta(Number(b.worker_lat), Number(b.worker_lng), Number(b.customer_lat), Number(b.customer_lng));
    }

    ok(res, {
      booking_id: b.id,
      status: b.status,
      status_label: LABEL[b.status] || b.status,
      is_active_job: isJobActive,
      tracking_active: hasCoords,
      worker_location: hasCoords ? {
        lat: Number(b.worker_lat),
        lng: Number(b.worker_lng),
        eta_minutes: distInfo.eta_minutes,
        distance_km: distInfo.distance_km,
        updated_at: b.location_updated_at
      } : null,
      customer_location: b.customer_lat != null && b.customer_lng != null ? {
        lat: Number(b.customer_lat),
        lng: Number(b.customer_lng),
        address: b.address
      } : { lat: null, lng: null, address: b.address },
      technician: b.worker_id && isJobActive ? {
        name: b.worker_name,
        skill: b.worker_skill,
        verified: Boolean(b.worker_verified),
        contact_phone: b.worker_phone
      } : null,
      timeline
    });
  }));

  app.get('/api/notifications', auth(), h(async (req, res) => {
    try {
      const list = await db.query(
        'SELECT id, booking_id, title, body, type, is_read, created_at FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 30',
        [req.user.id]
      );
      const unread = await db.queryOne(
        'SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = $1 AND is_read = 0',
        [req.user.id]
      );
      ok(res, { notifications: list.rows, unread_count: Number(unread?.cnt || 0) });
    } catch {
      ok(res, { notifications: [], unread_count: 0 });
    }
  }));

  app.post('/api/notifications/read', auth(), h(async (req, res) => {
    try {
      const nId = req.body && req.body.notification_id ? Number(req.body.notification_id) : null;
      if (nId) {
        await db.query('UPDATE notifications SET is_read = 1 WHERE id = $1 AND user_id = $2', [nId, req.user.id]);
      } else {
        await db.query('UPDATE notifications SET is_read = 1 WHERE user_id = $1 AND is_read = 0', [req.user.id]);
      }
      ok(res, { message: 'Notifications read mark kar diye gaye' });
    } catch {
      ok(res, { message: 'Updated' });
    }
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

  async function settleBookingOnlinePayment({ booking: targetBooking, order: targetOrder, paymentId: pId, ignoreAlreadyPaid = false }) {
    await db.transaction(async (tx) => {
      const current = await tx.queryOne('SELECT status, provider_payment_id FROM payment_orders WHERE id = $1', [targetOrder.id]);
      if (current.status === 'paid' && (ignoreAlreadyPaid || current.provider_payment_id === pId)) return;
      if (current.status !== 'created') {
        if (ignoreAlreadyPaid) return;
        bad(409, 'Razorpay order active nahi hai');
      }
      const updBooking = await tx.query('UPDATE bookings SET paid = 1 WHERE id = $1 AND paid = 0', [targetBooking.id]);
      if (updBooking.rowCount !== 1) {
        if (ignoreAlreadyPaid) return;
        bad(409, 'Booking payment pehle hi ho chuki hai');
      }
      const updOrder = await tx.query(
        `UPDATE payment_orders SET status = 'paid', provider_payment_id = $1, updated_at = $2 WHERE id = $3 AND status = 'created'`,
        [pId, Date.now(), targetOrder.id]
      );
      if (updOrder.rowCount !== 1) {
        if (ignoreAlreadyPaid) return;
        bad(409, 'Payment already processed');
      }
      await credit(targetBooking.customer_id, 'Cashback 5%', Math.floor(targetBooking.total * CASHBACK), tx);
      if (targetBooking.worker_id) {
        if (targetBooking.pay === 'wallet' || targetBooking.pay === 'razorpay') {
          await credit(targetBooking.worker_id, `Kamai: ${targetBooking.service}`, Math.floor(targetBooking.total * (1 - COMMISSION)), tx);
        } else if (targetBooking.pay === 'cash') {
          const w = await tx.queryOne('SELECT wallet FROM users WHERE id = $1', [targetBooking.worker_id]);
          const comm = Math.floor(targetBooking.total * COMMISSION);
          const deduct = Math.min(w ? w.wallet : 0, comm);
          if (deduct > 0) {
            await credit(targetBooking.worker_id, `Platform fee (15% Cash): ${targetBooking.service}`, -deduct, tx);
          }
        }
      }
    });
  }

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

    await settleBookingOnlinePayment({ booking: b, order, paymentId });

    ok(res, { booking: view(await load(b.id), req.user), message: 'Online payment verify ho gaya' });
  }));

  // ---------- Razorpay Webhook Signature Verification (Section 9) ----------
  app.post('/api/webhooks/razorpay', h(async (req, res) => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret || /replace/i.test(webhookSecret)) {
      bad(503, 'RAZORPAY_WEBHOOK_SECRET server par configure nahi hai');
    }
    const sig = String(req.get('x-razorpay-signature') || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sig) || !req.rawBody) {
      bad(400, 'Razorpay webhook signature invalid ya missing hai');
    }
    const expected = crypto.createHmac('sha256', webhookSecret).update(req.rawBody).digest('hex');
    if (!same(expected, sig)) {
      bad(400, 'Razorpay webhook signature verify nahi hua');
    }

    const event = req.body && req.body.event;
    const entity = req.body?.payload?.payment?.entity;
    if (!entity || !entity.order_id) {
      return ok(res, { received: true, ignored: true });
    }

    const order = await db.queryOne('SELECT * FROM payment_orders WHERE provider_order_id = $1', [entity.order_id]);
    if (!order) {
      return ok(res, { received: true, ignored: true });
    }

    if (event === 'payment.captured' && entity.status === 'captured') {
      const b = await db.queryOne(`${SELECT} WHERE b.id = $1`, [order.booking_id]);
      if (b && Number(entity.amount) === Number(order.amount_paise)) {
        await settleBookingOnlinePayment({ booking: b, order, paymentId: entity.id, ignoreAlreadyPaid: true });
      }
    } else if (event === 'payment.failed') {
      await db.query(
        `UPDATE payment_orders SET status = 'failed', updated_at = $1 WHERE id = $2 AND status IN ('creating', 'created')`,
        [Date.now(), order.id]
      );
    }

    ok(res, { received: true, event });
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
        const emgFee = Number(b.emergency_fee || 0);
        items.push({
          title: 'Priority Emergency Dispatch (Within 60 mins)',
          qty: 1,
          rate: emgFee,
          amount: emgFee,
          note: emgFee > 0 ? 'Express Emergency Surcharge' : 'Priority Dispatch'
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

    const subtotal = isClosed ? VISIT_FEE : (b.price + (b.parts || 0) + (b.emergency_fee || 0));
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

    if (role && ['customer', 'worker', 'admin', 'operations'].includes(role)) {
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

  app.get('/api/admin/bookings', auth('admin', 'operations'), h(async (req, res) => {
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
    const sanitized = result.rows.map((b) => {
      if (ACTIVE_TRACKING_STATUSES.includes(b.status) && b.tracking_active) return b;
      return { ...b, worker_lat: null, worker_lng: null, eta_minutes: null, tracking_active: 0 };
    });
    ok(res, { bookings: sanitized });
  }));

  app.post('/api/admin/bookings/:id/assign', auth('admin', 'operations'), h(async (req, res) => {
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

    await notifyUser({
      userId: b.customer_id,
      bookingId: b.id,
      title: `Technician Assigned (#${b.id})`,
      body: `${worker.name} aapki booking ke liye assign kiye gaye hain.`,
      type: 'booking_status',
      dedupeKey: `booking_${b.id}_admin_assigned_${worker.id}`
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

  app.get('/api/admin/complaints', auth('admin', 'operations'), h(async (req, res) => {
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

  app.post('/api/admin/complaints/:id/resolve', auth('admin', 'operations'), h(async (req, res) => {
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

  // ---------- 13-Section Admin Dashboard Endpoints ----------
  app.get('/api/admin/customers', auth('admin'), h(async (req, res) => {
    const { q } = req.query;
    let sql = `
      SELECT u.id, u.name, u.phone, u.wallet,
        COUNT(b.id) AS bookings_count,
        COALESCE(SUM(CASE WHEN b.paid = 1 THEN b.total ELSE 0 END), 0) AS total_spent
      FROM users u
      LEFT JOIN bookings b ON b.customer_id = u.id
      WHERE u.role = 'customer'
    `;
    const params = [];
    if (q && String(q).trim()) {
      sql += ` AND (u.name LIKE $1 OR u.phone LIKE $1)`;
      params.push(`%${String(q).trim()}%`);
    }
    sql += ` GROUP BY u.id, u.name, u.phone, u.wallet ORDER BY u.id DESC LIMIT 100`;
    const result = await db.query(sql, params);
    ok(res, { customers: result.rows });
  }));

  app.get('/api/admin/providers', auth('admin'), h(async (req, res) => {
    const { skill, verified, online, q } = req.query;
    let sql = `
      SELECT u.id, u.name, u.phone, u.skill, u.wallet, u.online, u.id_verified,
        u.experience_years, u.service_areas,
        COUNT(b.id) AS jobs_count,
        COALESCE(ROUND(AVG(r.stars), 1), 4.8) AS avg_rating
      FROM users u
      LEFT JOIN bookings b ON b.worker_id = u.id AND b.status = 'completed'
      LEFT JOIN reviews r ON r.booking_id = b.id
      WHERE u.role = 'worker'
    `;
    const conditions = [];
    const params = [];
    let idx = 1;
    if (skill) { conditions.push(`u.skill = $${idx++}`); params.push(skill); }
    if (verified !== undefined && verified !== '') { conditions.push(`u.id_verified = $${idx++}`); params.push(Number(verified) ? 1 : 0); }
    if (online !== undefined && online !== '') { conditions.push(`u.online = $${idx++}`); params.push(Number(online) ? 1 : 0); }
    if (q && String(q).trim()) { conditions.push(`(u.name LIKE $${idx} OR u.phone LIKE $${idx})`); params.push(`%${String(q).trim()}%`); idx++; }
    if (conditions.length) sql += ' AND ' + conditions.join(' AND ');
    sql += ` GROUP BY u.id, u.name, u.phone, u.skill, u.wallet, u.online, u.id_verified, u.experience_years, u.service_areas ORDER BY u.id DESC LIMIT 100`;
    const result = await db.query(sql, params);
    ok(res, { providers: result.rows });
  }));

  app.get('/api/admin/payments', auth('admin'), h(async (req, res) => {
    const ordersRes = await db.query(`
      SELECT p.id, p.booking_id, p.provider_order_id, p.provider_payment_id,
        p.amount_paise, p.currency, p.status, p.created_at,
        b.customer_id, u.name AS customer_name, u.phone AS customer_phone,
        b.worker_id, w.name AS worker_name, s.name AS service_name
      FROM payment_orders p
      LEFT JOIN bookings b ON b.id = p.booking_id
      LEFT JOIN users u ON u.id = b.customer_id
      LEFT JOIN users w ON w.id = b.worker_id
      LEFT JOIN services s ON s.id = b.service_id
      ORDER BY p.id DESC LIMIT 100
    `);
    ok(res, { payments: ordersRes.rows });
  }));

  let platformCommissionPct = 15;
  app.get('/api/admin/commission', auth('admin'), h(async (req, res) => {
    const rev = await db.queryOne("SELECT COALESCE(SUM(total), 0) AS rev FROM bookings WHERE paid = 1");
    const totalRev = Number(rev ? rev.rev : 0);
    const platformEarnings = Math.round(totalRev * (platformCommissionPct / 100));
    ok(res, {
      commission_percentage: platformCommissionPct,
      total_gmv: totalRev,
      total_commission_earned: platformEarnings,
      provider_net_payout: totalRev - platformEarnings
    });
  }));

  app.post('/api/admin/commission', auth('admin'), h(async (req, res) => {
    const pct = Number(req.body.percentage);
    if (isNaN(pct) || pct < 0 || pct > 50) bad(400, 'Commission 0% se 50% ke beech honi chahiye');
    platformCommissionPct = pct;
    ok(res, { message: `Platform commission rate update ho kar ${pct}% ho gaya`, commission_percentage: pct });
  }));

  app.get('/api/admin/reviews', auth('admin'), h(async (req, res) => {
    const result = await db.query(`
      SELECT r.id, r.booking_id, r.user_id AS customer_id, r.stars, r.feedback, r.created_at,
        u.name AS customer_name, u.phone AS customer_phone,
        b.service_id, s.name AS service_name, s.cat AS service_category,
        b.worker_id, w.name AS worker_name
      FROM reviews r
      LEFT JOIN users u ON u.id = r.user_id
      LEFT JOIN bookings b ON b.id = r.booking_id
      LEFT JOIN services s ON s.id = b.service_id
      LEFT JOIN users w ON w.id = b.worker_id
      ORDER BY r.id DESC LIMIT 100
    `);
    ok(res, { reviews: result.rows });
  }));

  app.get('/api/admin/notifications', auth('admin'), h(async (req, res) => {
    const result = await db.query(`
      SELECT n.id, n.user_id, n.title, n.body, n.read, n.created_at,
        u.name AS user_name, u.role AS user_role, u.phone AS user_phone
      FROM notifications n
      LEFT JOIN users u ON u.id = n.user_id
      ORDER BY n.id DESC LIMIT 100
    `);
    ok(res, { notifications: result.rows });
  }));

  app.post('/api/admin/notifications/broadcast', auth('admin'), h(async (req, res) => {
    const { target_role = 'all', title, body } = req.body || {};
    if (!title || !body) bad(400, 'Title aur message dono zaroori hain');
    let userQuery = "SELECT id FROM users";
    const params = [];
    if (target_role && target_role !== 'all') {
      userQuery += " WHERE role = $1";
      params.push(target_role);
    }
    const targetUsers = await db.query(userQuery, params);
    for (const u of targetUsers.rows) {
      await db.query(
        "INSERT INTO notifications (user_id, title, body, read) VALUES ($1, $2, $3, 0)",
        [u.id, title, body]
      );
    }
    ok(res, { message: `${targetUsers.rows.length} users ko notification send kiya gaya`, count: targetUsers.rows.length });
  }));

  app.get('/api/admin/reports', auth('admin'), h(async (req, res) => {
    const stats = await db.query(`
      SELECT status, COUNT(*) AS total_count, COALESCE(SUM(total), 0) AS total_value
      FROM bookings
      GROUP BY status
    `);
    const catStats = await db.query(`
      SELECT s.cat, COUNT(b.id) AS bookings_count, COALESCE(SUM(b.total), 0) AS total_revenue
      FROM services s
      LEFT JOIN bookings b ON b.service_id = s.id
      GROUP BY s.cat
      ORDER BY bookings_count DESC
    `);
    ok(res, {
      booking_breakdown: stats.rows,
      category_performance: catStats.rows,
      generated_at: new Date().toISOString()
    });
  }));

  let platformSettings = {
    city: 'Dhanbad',
    support_phone: '1800-FIX-MATE',
    emergency_surge_fee: 99,
    commission_pct: 15,
    maintenance_mode: false,
    auto_assign_enabled: true
  };

  app.get('/api/admin/settings', auth('admin'), h(async (req, res) => {
    ok(res, { settings: platformSettings });
  }));

  app.post('/api/admin/settings', auth('admin'), h(async (req, res) => {
    platformSettings = { ...platformSettings, ...(req.body || {}) };
    ok(res, { settings: platformSettings, message: 'Settings successfully update ho gaye' });
  }));

  // ---------- Operations Support Staff Endpoints ----------
  app.get('/api/operations/overview', auth('admin', 'operations'), h(async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const [bookingsTotal, pendingReq, inProg, completedToday, openComplaints, onlineWorkers] = await Promise.all([
      db.queryOne("SELECT count(*)::int AS count FROM bookings"),
      db.queryOne("SELECT count(*)::int AS count FROM bookings WHERE status = 'requested'"),
      db.queryOne("SELECT count(*)::int AS count FROM bookings WHERE status IN ('assigned', 'on_the_way', 'inspecting', 'quoted', 'in_progress')"),
      db.queryOne("SELECT count(*)::int AS count FROM bookings WHERE status = 'completed' AND substring(created_at::text, 1, 10) = $1", [today]),
      db.queryOne("SELECT count(*)::int AS count FROM complaints WHERE status = 'open'"),
      db.queryOne("SELECT count(*)::int AS count FROM users WHERE role = 'worker' AND online = 1")
    ]);

    ok(res, {
      stats: {
        total_bookings: bookingsTotal ? bookingsTotal.count : 0,
        pending_requests: pendingReq ? pendingReq.count : 0,
        in_progress_jobs: inProg ? inProg.count : 0,
        completed_today: completedToday ? completedToday.count : 0,
        open_complaints: openComplaints ? openComplaints.count : 0,
        online_providers: onlineWorkers ? onlineWorkers.count : 0
      }
    });
  }));

  app.get('/api/operations/providers', auth('admin', 'operations'), h(async (req, res) => {
    const { skill, online } = req.query;
    const conds = ["role = 'worker'"];
    const params = [];
    if (skill) {
      params.push(skill);
      conds.push(`skill = $${params.length}`);
    }
    if (online !== undefined && online !== '') {
      params.push(Number(online) ? 1 : 0);
      conds.push(`online = $${params.length}`);
    }
    const workers = await db.query(
      `SELECT id, name, phone, skill, online, id_verified, experience_years, service_areas
       FROM users
       WHERE ${conds.join(' AND ')}
       ORDER BY online DESC, id ASC`,
      params
    );
    ok(res, { providers: workers.rows });
  }));

  app.post('/api/operations/bookings/:id/cancel', auth('admin', 'operations'), h(async (req, res) => {
    const bId = Number(req.params.id);
    const reason = req.body && req.body.reason ? String(req.body.reason).trim().slice(0, 500) : 'Operations Support Cancellation';
    const b = await db.queryOne('SELECT * FROM bookings WHERE id = $1', [bId]);
    if (!b) bad(404, 'Booking nahi mili');
    if (['completed', 'closed', 'cancelled'].includes(b.status)) {
      bad(400, `Booking status ${b.status} hai, isse cancel nahi kiya ja sakta`);
    }

    await db.transaction(async (tx) => {
      await tx.query("UPDATE bookings SET status = 'cancelled' WHERE id = $1", [b.id]);
      await tx.query(
        'INSERT INTO booking_status_history (booking_id, old_status, new_status, changed_by_user_id, notes) VALUES ($1, $2, $3, $4, $5)',
        [b.id, b.status, 'cancelled', req.user.id, `Operations cancellation: ${reason}`]
      );
      if (b.paid && b.total > 0) {
        await credit(b.customer_id, `FixMate Cancellation Refund (Booking #${b.id})`, b.total, tx);
      }
    });

    await notifyUser({
      userId: b.customer_id,
      bookingId: b.id,
      title: `Booking Cancelled (#${b.id})`,
      body: `Aapki booking support team dwara cancel kar di gayi hai: ${reason}`,
      type: 'booking_status',
      dedupeKey: `booking_${b.id}_ops_cancelled`
    });

    const updated = await load(b.id);
    ok(res, { booking: view(updated, req.user), message: 'Booking cancel kar di gayi' });
  }));

  // ---------- Phase 8: Emergency Availability, AMC Plans, Family Accounts, Reminders & Service Areas ----------
  app.get('/api/services/emergency-availability', h(async (req, res) => {
    let cat = req.query.cat ? String(req.query.cat).trim() : null;
    if (!cat && req.query.serviceId) {
      const s = await db.queryOne('SELECT cat FROM services WHERE id = $1', [Number(req.query.serviceId)]);
      if (s) cat = s.cat;
    }
    const row = cat
      ? await db.queryOne("SELECT COUNT(*) AS c FROM users WHERE role = 'worker' AND online = 1 AND skill = $1", [cat])
      : await db.queryOne("SELECT COUNT(*) AS c FROM users WHERE role = 'worker' AND online = 1");
    const onlineCount = Number(row?.c || 0);
    ok(res, {
      category: cat || 'All',
      available: onlineCount > 0,
      online_technicians: onlineCount,
      emergency_fee: EMERGENCY_FEE,
      message: onlineCount > 0
        ? `${onlineCount} verified technician(s) abhi online hain (₹${EMERGENCY_FEE} express priority fee)`
        : `Abhi ${cat || 'is category'} mein koi live emergency technician online nahi hai`
    });
  }));

  app.get('/api/amc/plans', h(async (req, res) => {
    try {
      const plans = await db.query('SELECT * FROM amc_plans WHERE is_active = 1 ORDER BY price ASC');
      ok(res, { plans: plans.rows });
    } catch {
      ok(res, { plans: [] });
    }
  }));

  app.post('/api/admin/amc-plans', auth('admin'), h(async (req, res) => {
    const { name, category, validity_months, price, visits_included, inclusions, exclusions, description } = req.body || {};
    if (!name || String(name).trim().length < 3) bad(400, 'Plan ka naam kam se kam 3 akshar ho');
    if (!category || !CATEGORIES.includes(category)) bad(400, 'Valid category chunein');
    const p = Number(price);
    const months = Number(validity_months) || 12;
    const visits = Number(visits_included) || 2;
    if (!Number.isInteger(p) || p <= 0) bad(400, 'Valid positive price daalein');

    const ins = await db.query(
      `INSERT INTO amc_plans (name, category, description, validity_months, price, visits_included, inclusions, exclusions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        String(name).trim().slice(0, 140),
        category,
        description ? String(description).trim().slice(0, 500) : null,
        months,
        p,
        visits,
        String(inclusions || 'Preventive servicing and priority dispatch').slice(0, 1000),
        String(exclusions || 'Major hardware parts replacement').slice(0, 1000)
      ]
    );
    const plan = await db.queryOne('SELECT * FROM amc_plans WHERE id = $1', [ins.rows[0].id]);
    ok(res, { plan, message: 'AMC Plan create ho gaya' }, 201);
  }));

  app.post('/api/amc/subscribe', auth('customer'), h(async (req, res) => {
    const { plan_id, payment_method = 'wallet', auto_renew = 0 } = req.body || {};
    const plan = await db.queryOne('SELECT * FROM amc_plans WHERE id = $1 AND is_active = 1', [Number(plan_id)]);
    if (!plan) bad(404, 'AMC plan nahi mila');
    if (!['wallet', 'cash', 'razorpay'].includes(payment_method)) bad(400, 'Valid payment method chunein');

    const start = new Date();
    const end = new Date(start);
    end.setMonth(end.getMonth() + Number(plan.validity_months || 12));

    const subId = await db.transaction(async (tx) => {
      if (payment_method === 'wallet') {
        const u = await tx.queryOne('SELECT wallet FROM users WHERE id = $1', [req.user.id]);
        if (!u || u.wallet < plan.price) bad(402, 'Wallet mein paise kam hain');
        await credit(req.user.id, `AMC Plan: ${plan.name}`, -plan.price, tx);
      }
      const ins = await tx.query(
        `INSERT INTO amc_subscriptions (user_id, plan_id, status, visits_used, visits_total, start_date, end_date, price_paid, payment_method, auto_renew)
         VALUES ($1, $2, 'active', 0, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [req.user.id, plan.id, plan.visits_included, start.toISOString(), end.toISOString(), plan.price, payment_method, auto_renew ? 1 : 0]
      );
      return ins.rows[0].id;
    });

    await notifyUser({
      userId: req.user.id,
      title: `AMC Activated: ${plan.name}`,
      body: `${plan.visits_included} free service visits valid until ${end.toLocaleDateString('en-IN')}.`,
      type: 'amc',
      dedupeKey: `amc_sub_${subId}`
    });

    const sub = await db.queryOne(
      `SELECT s.*, p.name AS plan_name, p.category, p.validity_months, p.inclusions, p.exclusions
       FROM amc_subscriptions s JOIN amc_plans p ON p.id = s.plan_id WHERE s.id = $1`,
      [subId]
    );
    ok(res, { subscription: sub, message: `AMC Plan "${plan.name}" active ho gaya!` }, 201);
  }));

  app.get('/api/amc/my', auth('customer'), h(async (req, res) => {
    const rows = await db.query(
      `SELECT s.*, p.name AS plan_name, p.category, p.validity_months, p.price AS current_price, p.inclusions, p.exclusions
       FROM amc_subscriptions s JOIN amc_plans p ON p.id = s.plan_id
       WHERE s.user_id = $1 ORDER BY s.id DESC`,
      [req.user.id]
    );
    const list = rows.rows.map((s) => {
      const daysLeft = Math.max(0, Math.ceil((new Date(s.end_date).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
      return {
        ...s,
        visits_remaining: Math.max(0, Number(s.visits_total) - Number(s.visits_used)),
        days_left: daysLeft,
        needs_renewal: daysLeft <= 30 || Number(s.visits_used) >= Number(s.visits_total)
      };
    });
    ok(res, { subscriptions: list });
  }));

  app.post('/api/amc/:id/renew', auth('customer'), h(async (req, res) => {
    const sub = await db.queryOne(
      `SELECT s.*, p.name AS plan_name, p.price, p.validity_months, p.visits_included
       FROM amc_subscriptions s JOIN amc_plans p ON p.id = s.plan_id
       WHERE s.id = $1 AND s.user_id = $2`,
      [Number(req.params.id), req.user.id]
    );
    if (!sub) bad(404, 'AMC subscription nahi mili');
    const payMethod = (req.body && req.body.payment_method) || 'wallet';
    const baseStart = new Date(Math.max(Date.now(), new Date(sub.end_date).getTime()));
    const newEnd = new Date(baseStart);
    newEnd.setMonth(newEnd.getMonth() + Number(sub.validity_months || 12));

    await db.transaction(async (tx) => {
      if (payMethod === 'wallet') {
        const u = await tx.queryOne('SELECT wallet FROM users WHERE id = $1', [req.user.id]);
        if (!u || u.wallet < sub.price) bad(402, 'Wallet mein paise kam hain');
        await credit(req.user.id, `AMC Renewal: ${sub.plan_name}`, -sub.price, tx);
      }
      await tx.query(
        `UPDATE amc_subscriptions
         SET status = 'active', visits_used = 0, visits_total = $1, end_date = $2
         WHERE id = $3`,
        [sub.visits_included, newEnd.toISOString(), sub.id]
      );
    });

    const updated = await db.queryOne(
      `SELECT s.*, p.name AS plan_name, p.category, p.inclusions, p.exclusions
       FROM amc_subscriptions s JOIN amc_plans p ON p.id = s.plan_id WHERE s.id = $1`,
      [sub.id]
    );
    ok(res, { subscription: updated, message: `AMC Plan "${sub.plan_name}" renew ho gaya!` });
  }));

  // ---------- Family Accounts (Section 14) ----------
  app.get('/api/family', auth('customer'), h(async (req, res) => {
    const rows = await db.query('SELECT * FROM family_members WHERE owner_user_id = $1 ORDER BY id DESC', [req.user.id]);
    ok(res, { members: rows.rows });
  }));

  app.post('/api/family', auth('customer'), h(async (req, res) => {
    const { member_name, member_phone, relation = 'Family', can_book = 1 } = req.body || {};
    if (!member_name || String(member_name).trim().length < 2) bad(400, 'Member ka naam likhein');
    if (!PHONE.test(String(member_phone || '').trim())) bad(400, 'Valid 10-digit mobile number daalein');

    const ins = await db.query(
      `INSERT INTO family_members (owner_user_id, member_name, member_phone, relation, can_book)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [req.user.id, String(member_name).trim().slice(0, 80), String(member_phone).trim(), String(relation).trim().slice(0, 40), can_book ? 1 : 0]
    );
    const member = await db.queryOne('SELECT * FROM family_members WHERE id = $1', [ins.rows[0].id]);
    ok(res, { member, message: 'Family member add ho gaya' }, 201);
  }));

  app.delete('/api/family/:id', auth('customer'), h(async (req, res) => {
    const r = await db.query('DELETE FROM family_members WHERE id = $1 AND owner_user_id = $2', [Number(req.params.id), req.user.id]);
    if (r.rowCount === 0) bad(404, 'Member nahi mila');
    ok(res, { message: 'Family member hata diya gaya' });
  }));

  // ---------- Service Maintenance Reminders (Section 18) ----------
  app.get('/api/reminders', auth('customer'), h(async (req, res) => {
    const rows = await db.query('SELECT * FROM service_reminders WHERE user_id = $1 ORDER BY next_due_date ASC', [req.user.id]);
    ok(res, { reminders: rows.rows });
  }));

  app.post('/api/reminders', auth('customer'), h(async (req, res) => {
    const { category, title, interval_months = 6 } = req.body || {};
    if (!category || !CATEGORIES.includes(category)) bad(400, 'Valid category chunein');
    if (!title || String(title).trim().length < 3) bad(400, 'Reminder title likhein');
    const months = Math.max(1, Math.min(24, Number(interval_months) || 6));
    const due = new Date();
    due.setMonth(due.getMonth() + months);

    const ins = await db.query(
      `INSERT INTO service_reminders (user_id, category, title, interval_months, next_due_date, enabled)
       VALUES ($1, $2, $3, $4, $5, 1) RETURNING id`,
      [req.user.id, category, String(title).trim().slice(0, 140), months, due.toISOString()]
    );
    const reminder = await db.queryOne('SELECT * FROM service_reminders WHERE id = $1', [ins.rows[0].id]);
    ok(res, { reminder, message: 'Service reminder set ho gaya' }, 201);
  }));

  app.put('/api/reminders/:id/toggle', auth('customer'), h(async (req, res) => {
    const r = await db.queryOne('SELECT * FROM service_reminders WHERE id = $1 AND user_id = $2', [Number(req.params.id), req.user.id]);
    if (!r) bad(404, 'Reminder nahi mila');
    const nextVal = r.enabled ? 0 : 1;
    await db.query('UPDATE service_reminders SET enabled = $1 WHERE id = $2', [nextVal, r.id]);
    ok(res, { enabled: Boolean(nextVal), message: nextVal ? 'Reminder chalu kiya gaya' : 'Reminder band kiya gaya' });
  }));

  app.delete('/api/reminders/:id', auth('customer'), h(async (req, res) => {
    const r = await db.query('DELETE FROM service_reminders WHERE id = $1 AND user_id = $2', [Number(req.params.id), req.user.id]);
    if (r.rowCount === 0) bad(404, 'Reminder nahi mila');
    ok(res, { message: 'Reminder delete kar diya gaya' });
  }));

  // ---------- Location & Pincode Service Areas (Section 21) ----------
  app.get('/api/service-areas', h(async (req, res) => {
    const rows = await db.query('SELECT * FROM service_areas WHERE is_active = 1 ORDER BY pincode ASC');
    ok(res, { areas: rows.rows });
  }));

  app.get('/api/service-areas/check', h(async (req, res) => {
    const pin = String(req.query.pincode || '').trim();
    if (!/^\d{6}$/.test(pin)) bad(400, '6-digit valid pincode daalein');
    const area = await db.queryOne('SELECT * FROM service_areas WHERE pincode = $1 AND is_active = 1', [pin]);
    ok(res, {
      pincode: pin,
      serviceable: Boolean(area),
      area: area || null,
      message: area ? `Service available in ${area.area_name}, ${area.city}` : `Pincode ${pin} abhi service coverage mein nahi hai`
    });
  }));

  app.post('/api/admin/service-areas', auth('admin'), h(async (req, res) => {
    const { pincode, city = 'Dhanbad', area_name, is_active = 1 } = req.body || {};
    const pin = String(pincode || '').trim();
    if (!/^\d{6}$/.test(pin)) bad(400, '6-digit valid pincode daalein');
    if (!area_name || String(area_name).trim().length < 2) bad(400, 'Area ka naam likhein');

    await db.query(
      `INSERT INTO service_areas (pincode, city, area_name, is_active)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (pincode) DO UPDATE SET city = EXCLUDED.city, area_name = EXCLUDED.area_name, is_active = EXCLUDED.is_active`,
      [pin, String(city).trim().slice(0, 80), String(area_name).trim().slice(0, 140), is_active ? 1 : 0]
    );
    const area = await db.queryOne('SELECT * FROM service_areas WHERE pincode = $1', [pin]);
    ok(res, { area, message: `Pincode ${pin} updated` }, 201);
  }));

  // ---------- AI Assistant (Voice + Chat) ----------
  app.use('/api/ai', createAiRouter({ db, auth, authOptional }));

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
