process.env.OTP_RATE_MAX = '1000';
process.env.JWT_SECRET = 'test-secret';
process.env.OTP_HMAC_KEY = 'test-otp-hmac-key-at-least-32-bytes';
process.env.CLIENT_ORIGIN = 'https://fixmate.example,https://localhost';
process.env.DEV_SHOW_OTP = '1';
process.env.ALLOW_DEMO_TOPUP = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const { createApp } = require('../src/app');
const { openDb, migrateSchema } = require('../src/db');

let server, base, testDb;
test.before(async () => {
  testDb = openDb(':memory:');
  server = createApp(testDb).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}`;
});
test.after(() => server.close());

test('additive security migration preserves legacy rows and is idempotent', () => {
  const legacy = new Database(':memory:');
  legacy.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, phone TEXT, name TEXT, role TEXT, skill TEXT, wallet INTEGER);
    CREATE TABLE otps (phone TEXT PRIMARY KEY, hash TEXT, salt TEXT, exp INTEGER, tries INTEGER, last_sent INTEGER);
    CREATE TABLE services (id INTEGER PRIMARY KEY, cat TEXT, name TEXT, price INTEGER, rating REAL);
    CREATE TABLE bookings (id INTEGER PRIMARY KEY, customer_id INTEGER, worker_id INTEGER, service_id INTEGER, slot TEXT, address TEXT, pay TEXT, status TEXT, start_code TEXT, parts INTEGER, total INTEGER, paid INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO users(id, phone, name, role, skill, wallet) VALUES (1, '9000000001', 'Existing', 'customer', NULL, 150);
    INSERT INTO services(id, cat, name, price, rating) VALUES (1, 'Electrician', 'Switch', 149, 4.8);
    INSERT INTO bookings(id, customer_id, service_id, slot, address, pay, status, start_code, parts, total, paid)
      VALUES (7, 1, 1, 'Aaj', 'Dhanbad', 'cash', 'requested', '1234', 0, 0, 0);
  `);

  migrateSchema(legacy);
  migrateSchema(legacy);

  assert.equal(legacy.prepare('SELECT name, wallet, online, token_version FROM users WHERE id=1').get().name, 'Existing');
  assert.equal(legacy.prepare('SELECT wallet, online, token_version FROM users WHERE id=1').get().token_version, 0);
  assert.deepEqual(legacy.prepare('SELECT id, address, pay, start_code_tries FROM bookings WHERE id=7').get(), {
    id: 7, address: 'Dhanbad', pay: 'cash', start_code_tries: 0,
  });
  assert.equal(legacy.prepare("UPDATE bookings SET pay='razorpay' WHERE id=7").run().changes, 1);
  assert.ok(legacy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='payment_orders'").get());
  assert.equal(legacy.prepare('SELECT id FROM services WHERE id=1').get().id, 1);
  assert.ok(legacy.pragma('table_info(bookings)').some((column) => column.name === 'start_code_tries'));
  assert.ok(legacy.pragma('table_info(otps)').some((column) => column.name === 'hash_version'));
  assert.equal(legacy.pragma('user_version', { simple: true }), 2);
  legacy.close();
});

test('CORS allows the Android origin and rejects unknown origins', async () => {
  const allowed = await fetch(base + '/api/services', { headers: { Origin: 'https://localhost' } });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://localhost');
  assert.equal(allowed.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(allowed.headers.get('x-frame-options'), 'DENY');
  assert.equal(allowed.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');

  const rejected = await fetch(base + '/api/services', { headers: { Origin: 'https://unknown.example' } });
  assert.equal(rejected.headers.get('access-control-allow-origin'), null);
});

test('production refuses wildcard CORS and development-only flags', () => {
  const script = [
    "const {createApp}=require('./src/app'); const {openDb}=require('./src/db');",
    "try{createApp(openDb(':memory:'));process.stdout.write('started')}catch(error){process.stdout.write(error.message)}",
  ].join(' ');
  const baseEnv = {
    ...process.env,
    NODE_ENV: 'production',
    JWT_SECRET: 'production-test-secret-with-more-than-32-chars',
    OTP_HMAC_KEY: 'production-otp-hmac-key-with-over-32-chars',
    DEV_SHOW_OTP: '0',
    ALLOW_DEMO_TOPUP: '0',
  };
  const run = (env) => spawnSync(process.execPath, ['-e', script], {
    cwd: require('node:path').join(__dirname, '..'), env, encoding: 'utf8',
  });
  const wildcard = run({ ...baseEnv, CLIENT_ORIGIN: '*' });
  assert.equal(wildcard.status, 0, wildcard.stderr);
  assert.equal(wildcard.stdout, 'CLIENT_ORIGIN must list explicit production origins');

  const demoOtp = run({ ...baseEnv, CLIENT_ORIGIN: 'https://fixmate.example', DEV_SHOW_OTP: '1' });
  assert.equal(demoOtp.status, 0, demoOtp.stderr);
  assert.equal(demoOtp.stdout, 'Development-only flags are not allowed in production');
});

test('OTP per-IP limiter blocks requests across different phone numbers', () => {
  const script = [
    "process.env.NODE_ENV='development'; process.env.JWT_SECRET='test-secret'; process.env.OTP_HMAC_KEY='test-otp-hmac-key-at-least-32-bytes';",
    "process.env.OTP_RATE_MAX='1'; process.env.API_RATE_MAX='100'; process.env.DEV_SHOW_OTP='1'; process.env.ALLOW_DEMO_TOPUP='1';",
    "const {createApp}=require('./src/app'); const {openDb}=require('./src/db');",
    "const server=createApp(openDb(':memory:')).listen(0,async()=>{try{const base='http://127.0.0.1:'+server.address().port;const send=async(phone)=>{const response=await fetch(base+'/api/auth/otp/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone})});return response.status;};process.stdout.write(JSON.stringify([await send('9000000071'),await send('9000000072')]));}finally{server.close();}});",
  ].join(' ');
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: require('node:path').join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'development', OTP_RATE_MAX: '1000' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [200, 429]);
});

const call = async (method, path, body, token) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: res.status, ...(await res.json()) };
};
const login = async (phone, extra) => {
  const s = await call('POST', '/api/auth/otp/send', { phone });
  const v = await call('POST', '/api/auth/otp/verify', { phone, otp: s.devOtp, ...extra });
  assert.equal(v.status, 200, v.message);
  return v.token;
};

test('OTP validation, wrong OTP lockout, auth required', async () => {
  assert.equal((await call('POST', '/api/auth/otp/send', { phone: '12345' })).status, 400);
  const s = await call('POST', '/api/auth/otp/send', { phone: '9000000001' });
  assert.match(s.devOtp, /^\d{6}$/);
  const stored = testDb.prepare('SELECT hash, salt, hash_version FROM otps WHERE phone=?').get('9000000001');
  assert.equal(stored.hash_version, 1);
  assert.equal(stored.hash, crypto.createHmac('sha256', process.env.OTP_HMAC_KEY).update(`otp:9000000001:${s.devOtp}`).digest('hex'));
  const wrong = s.devOtp === '111111' ? '222222' : '111111';
  for (let i = 0; i < 3; i++) assert.equal((await call('POST', '/api/auth/otp/verify', { phone: '9000000001', otp: wrong })).status, 400);
  assert.equal((await call('POST', '/api/auth/otp/verify', { phone: '9000000001', otp: s.devOtp })).status, 429);
  assert.equal((await call('GET', '/api/wallet')).status, 401);
  assert.equal((await call('POST', '/api/auth/otp/send', { phone: '9000000001' })).status, 429); // resend cooldown
});

test('new user needs name and role', async () => {
  const s = await call('POST', '/api/auth/otp/send', { phone: '9000000002' });
  const v = await call('POST', '/api/auth/otp/verify', { phone: '9000000002', otp: s.devOtp });
  assert.equal(v.status, 400);
  assert.equal(v.needsProfile, true);
  // same OTP still works once the profile is supplied
  const v2 = await call('POST', '/api/auth/otp/verify', { phone: '9000000002', otp: s.devOtp, name: 'Test', role: 'customer' });
  assert.equal(v2.status, 200);
  assert.equal(v2.isNew, true);
  // OTP is single use
  assert.equal((await call('POST', '/api/auth/otp/verify', { phone: '9000000002', otp: s.devOtp })).status, 400);
});

test('logout-all revokes the caller token immediately', async () => {
  const token = await login('9000000098', { name: 'Revoked', role: 'customer' });
  assert.equal((await call('GET', '/api/me', null, token)).status, 200);
  assert.equal((await call('POST', '/api/auth/logout-all', {}, token)).status, 200);
  assert.equal((await call('GET', '/api/me', null, token)).status, 401);
});

test('worker availability is saved and enforced when accepting jobs', async () => {
  const cust = await login('9666666661', { name: 'Mina', role: 'customer' });
  const work = await login('9666666662', { name: 'Aman', role: 'worker', skill: 'Electrician' });
  const svc = (await call('GET', '/api/services?cat=Electrician')).services[0];
  const booking = (await call('POST', '/api/bookings', { serviceId: svc.id, slot: 'Aaj', address: 'Dhanbad', pay: 'cash' }, cust)).booking;

  assert.equal((await call('POST', '/api/me/online', { online: false }, work)).online, false);
  assert.equal((await call('POST', `/api/bookings/${booking.id}/accept`, {}, work)).status, 409);
  assert.equal((await call('POST', '/api/me/online', { online: true }, work)).online, true);
  assert.equal((await call('POST', `/api/bookings/${booking.id}/accept`, {}, work)).booking.status, 'assigned');
});

test('concurrent workers cannot both accept the same booking', async () => {
  const customer = await login('9000000081', { name: 'Owner', role: 'customer' });
  const workerOne = await login('9000000082', { name: 'Worker One', role: 'worker', skill: 'Electrician' });
  const workerTwo = await login('9000000083', { name: 'Worker Two', role: 'worker', skill: 'Electrician' });
  const service = (await call('GET', '/api/services?cat=Electrician')).services[0];
  const booking = (await call('POST', '/api/bookings', { serviceId: service.id, slot: 'Aaj', address: 'Dhanbad', pay: 'cash' }, customer)).booking;

  const results = await Promise.all([
    call('POST', `/api/bookings/${booking.id}/accept`, {}, workerOne),
    call('POST', `/api/bookings/${booking.id}/accept`, {}, workerTwo),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal(testDb.prepare('SELECT COUNT(*) AS count FROM bookings WHERE id=? AND status=\'assigned\' AND worker_id IS NOT NULL').get(booking.id).count, 1);
});

test('start code locks after five wrong attempts', async () => {
  const cust = await login('9000000096', { name: 'Mina', role: 'customer' });
  const work = await login('9000000097', { name: 'Aman', role: 'worker', skill: 'Electrician' });
  const service = (await call('GET', '/api/services?cat=Electrician')).services[0];
  const booking = (await call('POST', '/api/bookings', { serviceId: service.id, slot: 'Aaj', address: 'Dhanbad', pay: 'cash' }, cust)).booking;
  await call('POST', `/api/bookings/${booking.id}/accept`, {}, work);
  await call('POST', `/api/bookings/${booking.id}/on-the-way`, {}, work);

  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await call('POST', `/api/bookings/${booking.id}/start`, { code: '0000' }, work)).status, 400);
  }
  assert.equal((await call('POST', `/api/bookings/${booking.id}/start`, { code: booking.start_code }, work)).status, 429);
});

test('production OTP requests are blocked until an SMS provider is configured', () => {
  const script = [
    "const { createApp } = require('./src/app');",
    "const { openDb } = require('./src/db');",
    "const server = createApp(openDb(':memory:')).listen(0, async () => {",
    "const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/auth/otp/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '9000000001' }) });",
    'process.stdout.write(String(response.status)); server.close(); });',
  ].join(' ');
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: require('node:path').join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: 'production-test-secret-with-more-than-32-chars', OTP_HMAC_KEY: 'production-otp-hmac-key-with-over-32-chars', DEV_SHOW_OTP: '0', ALLOW_DEMO_TOPUP: '0' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '503');
});

test('production OTP sends the entered number through Twilio without exposing the code', () => {
  const script = [
    "process.env.NODE_ENV='production';",
    "process.env.JWT_SECRET='production-test-secret-with-more-than-32-chars';",
    "process.env.OTP_HMAC_KEY='production-otp-hmac-key-with-over-32-chars';",
    "process.env.DEV_SHOW_OTP='0'; process.env.ALLOW_DEMO_TOPUP='0';",
    "process.env.TWILIO_ACCOUNT_SID='AC12345678901234567890123456789012';",
    "process.env.TWILIO_AUTH_TOKEN='test-auth-token';",
    "process.env.TWILIO_PHONE_NUMBER='+15005550006';",
    'const realFetch=global.fetch; let sentTo="",sentCode="";',
    'global.fetch=async(url,options)=>{if(String(url).startsWith("https://api.twilio.com/")){const sms=new URLSearchParams(options.body);sentTo=sms.get("To");sentCode=sms.get("Body").match(/OTP: (\\d{6})/)[1];return {ok:true,status:201};}return realFetch(url,options);};',
    "const {createApp}=require('./src/app'); const {openDb}=require('./src/db');",
    "const server=createApp(openDb(':memory:')).listen(0,async()=>{try{const base='http://127.0.0.1:'+server.address().port;const response=await realFetch(base+'/api/auth/otp/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:'9000000001'})});const data=await response.json();const verify=await realFetch(base+'/api/auth/otp/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:'9000000001',otp:sentCode,name:'Test User',role:'customer'})});const verified=await verify.json();process.stdout.write(JSON.stringify({status:response.status,success:data.success,hasDevOtp:Object.hasOwn(data,'devOtp'),sentTo,verifyStatus:verify.status,hasToken:Boolean(verified.token)}));}finally{server.close();}});",
  ].join(' ');
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: require('node:path').join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: 'production-test-secret-with-more-than-32-chars', OTP_HMAC_KEY: 'production-otp-hmac-key-with-over-32-chars', DEV_SHOW_OTP: '0', ALLOW_DEMO_TOPUP: '0' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    status: 200,
    success: true,
    hasDevOtp: false,
    sentTo: '+919000000001',
    verifyStatus: 200,
    hasToken: true,
  });
});

test('production OTP reports SMS provider failures and removes unsent OTPs', () => {
  const script = [
    "process.env.NODE_ENV='production';",
    "process.env.JWT_SECRET='production-test-secret-with-more-than-32-chars';",
    "process.env.OTP_HMAC_KEY='production-otp-hmac-key-with-over-32-chars';",
    "process.env.DEV_SHOW_OTP='0'; process.env.ALLOW_DEMO_TOPUP='0';",
    "process.env.TWILIO_ACCOUNT_SID='AC12345678901234567890123456789012';",
    "process.env.TWILIO_AUTH_TOKEN='test-auth-token';",
    "process.env.TWILIO_PHONE_NUMBER='+15005550006';",
    'const realFetch=global.fetch;',
    'global.fetch=async(url,options)=>{if(String(url).startsWith("https://api.twilio.com/")){if(new URLSearchParams(options.body).get("To").endsWith("0003"))throw new Error("simulated network failure");return {ok:false,status:401};}return realFetch(url,options);};',
    "const {createApp}=require('./src/app'); const {openDb}=require('./src/db');",
    "const server=createApp(openDb(':memory:')).listen(0,async()=>{try{const base='http://127.0.0.1:'+server.address().port;const send=async(phone)=>{const response=await realFetch(base+'/api/auth/otp/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone})});return {response,body:await response.json()};};const rejected=await send('9000000002');const rejectedVerify=await realFetch(base+'/api/auth/otp/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:'9000000002',otp:'123456'})});const network=await send('9000000003');const networkVerify=await realFetch(base+'/api/auth/otp/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone:'9000000003',otp:'123456'})});process.stdout.write(JSON.stringify({rejectedStatus:rejected.response.status,rejectedMessage:rejected.body.message,rejectedVerifyStatus:rejectedVerify.status,networkStatus:network.response.status,networkMessage:network.body.message,networkVerifyStatus:networkVerify.status}));}finally{server.close();}});",
  ].join(' ');
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: require('node:path').join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: 'production-test-secret-with-more-than-32-chars', OTP_HMAC_KEY: 'production-otp-hmac-key-with-over-32-chars', DEV_SHOW_OTP: '0', ALLOW_DEMO_TOPUP: '0' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    rejectedStatus: 502,
    rejectedMessage: 'SMS provider OTP nahi bhej saka. Provider settings check karo',
    rejectedVerifyStatus: 400,
    networkStatus: 502,
    networkMessage: 'SMS provider se connection nahi hua',
    networkVerifyStatus: 400,
  });
});

test('Razorpay order and verification are signed, captured, and idempotent', () => {
  const script = [
    "process.env.NODE_ENV='production'; process.env.JWT_SECRET='production-test-secret-with-more-than-32-chars';",
    "process.env.OTP_HMAC_KEY='production-otp-hmac-key-with-over-32-chars'; process.env.RAZORPAY_KEY_ID='rzp_test_key'; process.env.RAZORPAY_KEY_SECRET='razorpay-test-secret';",
    "process.env.CLIENT_ORIGIN='https://fixmate.example,https://localhost'; process.env.DEV_SHOW_OTP='0'; process.env.ALLOW_DEMO_TOPUP='0';",
    'const crypto=require("node:crypto"),jwt=require("jsonwebtoken"),realFetch=global.fetch; let orderCreates=0;',
    'global.fetch=async(url,options)=>{if(String(url)==="https://api.razorpay.com/v1/orders"){orderCreates++;const request=JSON.parse(options.body);return new Response(JSON.stringify({id:"order_test_123",amount:request.amount,currency:request.currency}),{status:200});}if(String(url)==="https://api.razorpay.com/v1/payments/pay_test_123")return new Response(JSON.stringify({id:"pay_test_123",order_id:"order_test_123",amount:29900,currency:"INR",status:"captured"}),{status:200});return realFetch(url,options);};',
    "const {createApp}=require('./src/app'),{openDb}=require('./src/db'); const db=openDb(':memory:');",
    "const customer=db.prepare('INSERT INTO users(phone,name,role,skill,wallet) VALUES (?,?,?,?,0)').run('9000000011','Customer','customer',null).lastInsertRowid;",
    "const worker=db.prepare('INSERT INTO users(phone,name,role,skill,wallet) VALUES (?,?,?,?,0)').run('9000000012','Worker','worker','Electrician').lastInsertRowid;",
    "const service=db.prepare('SELECT id FROM services WHERE cat=?').get('Electrician').id;",
    "const booking=db.prepare(\"INSERT INTO bookings(customer_id,worker_id,service_id,slot,address,pay,status,start_code,parts,total,paid) VALUES (?,?,?,'Aaj','Dhanbad','razorpay','completed','1234',150,299,0)\").run(customer,worker,service).lastInsertRowid;",
    "const token=jwt.sign({id:customer,tokenVersion:0},process.env.JWT_SECRET,{expiresIn:'7d'});",
    "const server=createApp(db).listen(0,async()=>{try{const base='http://127.0.0.1:'+server.address().port;const post=async(path,body)=>{const response=await realFetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};const order=await post('/api/bookings/'+booking+'/payment/order',{});const repeatedOrder=await post('/api/bookings/'+booking+'/payment/order',{});const forged=await post('/api/bookings/'+booking+'/payment/verify',{razorpay_order_id:'order_test_123',razorpay_payment_id:'pay_test_123',razorpay_signature:'0'.repeat(64)});const signature=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update('order_test_123|pay_test_123').digest('hex');const verified=await post('/api/bookings/'+booking+'/payment/verify',{razorpay_order_id:'order_test_123',razorpay_payment_id:'pay_test_123',razorpay_signature:signature});const replay=await post('/api/bookings/'+booking+'/payment/verify',{razorpay_order_id:'order_test_123',razorpay_payment_id:'pay_test_123',razorpay_signature:signature});process.stdout.write(JSON.stringify({orderStatus:order.status,amount:order.body.order.amount,reusedOrder:repeatedOrder.body.order.id===order.body.order.id,forgedStatus:forged.status,verifiedStatus:verified.status,replayStatus:replay.status,bookingPaid:db.prepare('SELECT paid FROM bookings WHERE id=?').get(booking).paid,customerWallet:db.prepare('SELECT wallet FROM users WHERE id=?').get(customer).wallet,workerWallet:db.prepare('SELECT wallet FROM users WHERE id=?').get(worker).wallet,paymentCount:db.prepare('SELECT COUNT(*) AS count FROM payment_orders').get().count,orderCreates}));}finally{server.close();}});",
  ].join(' ');
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: require('node:path').join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: 'production-test-secret-with-more-than-32-chars', OTP_HMAC_KEY: 'production-otp-hmac-key-with-over-32-chars', RAZORPAY_KEY_ID: 'rzp_test_key', RAZORPAY_KEY_SECRET: 'razorpay-test-secret', CLIENT_ORIGIN: 'https://fixmate.example,https://localhost', DEV_SHOW_OTP: '0', ALLOW_DEMO_TOPUP: '0' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    orderStatus: 200,
    amount: 29900,
    reusedOrder: true,
    forgedStatus: 400,
    verifiedStatus: 200,
    replayStatus: 200,
    bookingPaid: 1,
    customerWallet: 14,
    workerWallet: 254,
    paymentCount: 1,
    orderCreates: 1,
  });
});

test('full booking flow: customer + worker + payment + commission', async () => {
  const cust = await login('9111111111', { name: 'Altaf', role: 'customer' });
  const work = await login('9222222222', { name: 'Ravi', role: 'worker', skill: 'Electrician' });
  const other = await login('9333333333', { name: 'Imran', role: 'worker', skill: 'Plumber' });

  const svc = (await call('GET', '/api/services?cat=Electrician')).services[0];
  assert.equal(svc.price, 149);
  assert.equal((await call('POST', '/api/bookings', { serviceId: svc.id, slot: 'Aaj', address: 'Bank More', pay: 'wallet' }, work)).status, 403);
  const b = (await call('POST', '/api/bookings', { serviceId: svc.id, slot: 'Aaj 6 se 8 PM', address: 'Bank More, Dhanbad', pay: 'wallet' }, cust)).booking;
  assert.equal(b.status, 'requested');

  assert.equal((await call('GET', '/api/bookings', null, other)).bookings.length, 0); // plumber can't see electrician job
  const workerList = (await call('GET', '/api/bookings', null, work)).bookings;
  assert.equal(workerList[0].address, 'Address accept karne ke baad milega');
  assert.equal((await call('GET', `/api/bookings/${b.id}`, null, work)).booking.address, 'Address accept karne ke baad milega');
  assert.equal((await call('GET', `/api/bookings/${b.id}`, null, cust)).booking.address, 'Bank More, Dhanbad');
  assert.equal((await call('POST', `/api/bookings/${b.id}/accept`, {}, other)).status, 403);
  assert.equal((await call('POST', `/api/bookings/${b.id}/accept`, {}, cust)).status, 403);
  assert.equal((await call('GET', '/api/bookings', null, work)).bookings.length, 1);
  assert.equal((await call('POST', `/api/bookings/${b.id}/accept`, {}, work)).booking.status, 'assigned');
  assert.equal((await call('POST', `/api/bookings/${b.id}/start`, { code: b.start_code }, work)).status, 409); // wrong order
  await call('POST', `/api/bookings/${b.id}/on-the-way`, {}, work);
  assert.equal((await call('POST', `/api/bookings/${b.id}/start`, { code: '0000' }, work)).status, 400);
  const seen = (await call('GET', `/api/bookings/${b.id}`, null, work)).booking;
  assert.equal(seen.start_code, undefined); // worker never sees the code
  assert.equal((await call('POST', `/api/bookings/${b.id}/start`, { code: b.start_code }, work)).booking.status, 'inspecting');
  const q = (await call('POST', `/api/bookings/${b.id}/quote`, { parts: 150 }, work)).booking;
  assert.equal(q.total, 299);
  assert.equal((await call('POST', `/api/bookings/${b.id}/approve`, {}, work)).status, 403);
  const approvals = await Promise.all([
    call('POST', `/api/bookings/${b.id}/approve`, {}, cust),
    call('POST', `/api/bookings/${b.id}/approve`, {}, cust),
  ]);
  assert.deepEqual(approvals.map((approval) => approval.status).sort(), [200, 409]);
  await call('POST', `/api/bookings/${b.id}/complete`, {}, work);

  assert.equal((await call('POST', `/api/bookings/${b.id}/pay`, {}, cust)).status, 402); // 150 welcome < 299
  await call('POST', '/api/wallet/topup', { amount: 500 }, cust);
  const concurrentPayments = await Promise.all([
    call('POST', `/api/bookings/${b.id}/pay`, {}, cust),
    call('POST', `/api/bookings/${b.id}/pay`, {}, cust),
  ]);
  assert.deepEqual(concurrentPayments.map((payment) => payment.status).sort(), [200, 409]);

  const customerWallet = await call('GET', '/api/wallet', null, cust);
  const workerWallet = await call('GET', '/api/wallet', null, work);
  assert.equal(customerWallet.balance, 150 + 500 - 299 + 14); // 5% cashback = 14
  assert.equal(workerWallet.balance, 254); // 85% of 299
  assert.equal(customerWallet.balance, customerWallet.transactions.reduce((sum, transaction) => sum + transaction.amount, 0));
  assert.equal(workerWallet.balance, workerWallet.transactions.reduce((sum, transaction) => sum + transaction.amount, 0));
});

test('rejecting a quote only charges the visit fee', async () => {
  const cust = await login('9444444444', { name: 'Riya', role: 'customer' });
  const work = await login('9555555555', { name: 'Deepak', role: 'worker', skill: 'AC Repair' });
  const svc = (await call('GET', '/api/services?q=AC gas')).services[0];
  const b = (await call('POST', '/api/bookings', { serviceId: svc.id, slot: 'Kal', address: 'Hirapur', pay: 'cash' }, cust)).booking;
  await call('POST', `/api/bookings/${b.id}/accept`, {}, work);
  await call('POST', `/api/bookings/${b.id}/on-the-way`, {}, work);
  await call('POST', `/api/bookings/${b.id}/start`, { code: b.start_code }, work);
  await call('POST', `/api/bookings/${b.id}/quote`, { parts: 500 }, work);
  const r = await call('POST', `/api/bookings/${b.id}/reject`, {}, cust);
  assert.equal(r.booking.status, 'closed');
  assert.equal(r.booking.total, 99);
});

test('legacy in-flight OTP remains verifiable during the migration window', async () => {
  const phone = '9000000099', otp = '123456', salt = 'legacy-test-salt';
  const hash = crypto.createHash('sha256').update(salt + otp).digest('hex');
  testDb.prepare('INSERT INTO otps(phone,hash,salt,exp,tries,last_sent,hash_version) VALUES (?,?,?,?,0,?,0)')
    .run(phone, hash, salt, Date.now() + 60_000, Date.now());

  const result = await call('POST', '/api/auth/otp/verify', { phone, otp, name: 'Legacy', role: 'customer' });
  assert.equal(result.status, 200, result.message);
});

test('per-phone OTP send and wrong-guess hourly budgets persist across OTP reissues', async () => {
  const sendPhone = '9888888881';
  for (let i = 0; i < 5; i++) {
    assert.equal((await call('POST', '/api/auth/otp/send', { phone: sendPhone })).status, 200);
    testDb.prepare('UPDATE otps SET last_sent=? WHERE phone=?').run(Date.now() - 21_000, sendPhone);
  }
  assert.equal((await call('POST', '/api/auth/otp/send', { phone: sendPhone })).status, 429);

  const guessPhone = '9888888882';
  let wrongGuesses = 0, locked = false;
  for (let issuance = 0; issuance < 4 && !locked; issuance++) {
    assert.equal((await call('POST', '/api/auth/otp/send', { phone: guessPhone })).status, 200);
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await call('POST', '/api/auth/otp/verify', { phone: guessPhone, otp: '000000' });
      wrongGuesses++;
      if (wrongGuesses <= 10) assert.equal(response.status, 400);
      else {
        assert.equal(response.status, 429);
        locked = true;
        break;
      }
    }
    if (!locked) testDb.prepare('UPDATE otps SET last_sent=? WHERE phone=?').run(Date.now() - 21_000, guessPhone);
  }
  assert.equal(wrongGuesses, 11);
});

test('production OTP daily budget caps SMS attempts', () => {
  const script = [
    "process.env.NODE_ENV='production'; process.env.JWT_SECRET='production-test-secret-with-more-than-32-chars';",
    "process.env.OTP_HMAC_KEY='production-otp-hmac-key-with-over-32-chars'; process.env.OTP_DAILY_MAX='1';",
    "process.env.TWILIO_ACCOUNT_SID='AC12345678901234567890123456789012'; process.env.TWILIO_AUTH_TOKEN='test-auth-token'; process.env.TWILIO_PHONE_NUMBER='+15005550006';",
    "process.env.DEV_SHOW_OTP='0'; process.env.ALLOW_DEMO_TOPUP='0';",
    'const realFetch=global.fetch; global.fetch=async(url,options)=>String(url).startsWith("https://api.twilio.com/")?{ok:true,status:201}:realFetch(url,options);',
    "const {createApp}=require('./src/app'); const {openDb}=require('./src/db');",
    "const server=createApp(openDb(':memory:')).listen(0,async()=>{try{const base='http://127.0.0.1:'+server.address().port;const send=async(phone)=>{const response=await realFetch(base+'/api/auth/otp/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone})});return response.status;};process.stdout.write(JSON.stringify([await send('9000000011'),await send('9000000012')]));}finally{server.close();}});",
  ].join(' ');
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: require('node:path').join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: 'production-test-secret-with-more-than-32-chars', OTP_HMAC_KEY: 'production-otp-hmac-key-with-over-32-chars', DEV_SHOW_OTP: '0', ALLOW_DEMO_TOPUP: '0' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [200, 429]);
});