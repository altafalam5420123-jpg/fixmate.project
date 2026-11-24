// MSG91 Real-time SMS OTP Service
// Integrates SendOTP and Verify OTP API v5

const MSG91_BASE_URL = 'https://control.msg91.com/api/v5/otp';

/**
 * Check if MSG91 credentials are configured in environment variables
 */
function isMsg91Configured() {
  const authKey = process.env.MSG91_AUTH_KEY;
  const templateId = process.env.MSG91_TEMPLATE_ID;
  return Boolean(authKey && authKey.trim() && templateId && templateId.trim());
}

/**
 * Get configured OTP expiry duration in minutes (default 5, clamped between 1 and 60)
 */
function getOtpExpiryMinutes() {
  const raw = Number(process.env.OTP_EXPIRY_MINUTES);
  if (Number.isFinite(raw) && raw >= 1 && raw <= 60) {
    return Math.floor(raw);
  }
  return 5;
}

/**
 * Format Indian 10-digit mobile number to MSG91 international format (e.g. 919876543210)
 */
function formatMobile(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) {
    return '91' + digits;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits;
  }
  throw new Error('Sahi 10 digit Indian mobile number daalo');
}

/**
 * Send real 6-digit OTP SMS via MSG91 API v5
 * @param {string} phone 10-digit mobile number
 * @param {object} [extraParams] Optional custom template params
 * @returns {Promise<{success: boolean, message: string, requestId?: string}>}
 */
async function sendOtp(phone, extraParams = {}) {
  const authKey = (process.env.MSG91_AUTH_KEY || '').trim();
  const templateId = (process.env.MSG91_TEMPLATE_ID || '').trim();

  if (!authKey || !templateId) {
    const err = new Error('MSG91_AUTH_KEY ya MSG91_TEMPLATE_ID configure nahi hai');
    err.status = 503;
    throw err;
  }

  const mobile = formatMobile(phone);
  const expiry = getOtpExpiryMinutes();

  const url = new URL(MSG91_BASE_URL);
  url.searchParams.set('template_id', templateId);
  url.searchParams.set('mobile', mobile);
  url.searchParams.set('otp_expiry', String(expiry));
  url.searchParams.set('otp_length', '6');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  let response;
  try {
    response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        authkey: authKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(extraParams),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const networkErr = new Error('MSG91 SMS provider se connection nahi hua');
    networkErr.status = 502;
    networkErr.cause = err;
    throw networkErr;
  } finally {
    clearTimeout(timer);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  // MSG91 v5 returns { type: 'success', message: '...' } on successful OTP dispatch
  if (!response.ok || !data || data.type !== 'success') {
    const msg = data && data.message ? String(data.message) : `MSG91 error (${response.status})`;
    const sendErr = new Error(`SMS provider OTP nahi bhej saka: ${msg}`);
    sendErr.status = 502;
    sendErr.details = data;
    throw sendErr;
  }

  return {
    success: true,
    message: typeof data.message === 'string' ? data.message : 'OTP sent successfully',
    requestId: data.message,
    expiryMinutes: expiry,
  };
}

/**
 * Verify 6-digit OTP code via MSG91 API v5
 * @param {string} phone 10-digit mobile number
 * @param {string} otp 6-digit numeric OTP
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function verifyOtp(phone, otp) {
  const authKey = (process.env.MSG91_AUTH_KEY || '').trim();

  if (!authKey) {
    const err = new Error('MSG91_AUTH_KEY configure nahi hai');
    err.status = 503;
    throw err;
  }

  const mobile = formatMobile(phone);
  const code = String(otp || '').trim();
  if (!/^\d{6}$/.test(code)) {
    return { success: false, message: '6-digit numeric OTP daalo' };
  }

  const url = new URL(`${MSG91_BASE_URL}/verify`);
  url.searchParams.set('mobile', mobile);
  url.searchParams.set('otp', code);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  let response;
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        authkey: authKey,
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const networkErr = new Error('MSG91 verification service se connection nahi hua');
    networkErr.status = 502;
    networkErr.cause = err;
    throw networkErr;
  } finally {
    clearTimeout(timer);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  // Strict check: MSG91 returns HTTP 200 even for wrong/expired OTP with type: 'error'.
  // We NEVER treat non-'success' type as valid!
  if (!response.ok || !data || data.type !== 'success') {
    const rawMsg = data && data.message ? String(data.message) : 'OTP verification failed';
    return {
      success: false,
      message: rawMsg,
      details: data,
    };
  }

  return {
    success: true,
    message: String(data.message || 'OTP verified successfully'),
  };
}

/**
 * Resend OTP via MSG91 retry endpoint
 * @param {string} phone 10-digit mobile number
 * @param {'text'|'voice'} [retryType='text']
 */
async function retryOtp(phone, retryType = 'text') {
  const authKey = (process.env.MSG91_AUTH_KEY || '').trim();
  if (!authKey) {
    const err = new Error('MSG91_AUTH_KEY configure nahi hai');
    err.status = 503;
    throw err;
  }

  const mobile = formatMobile(phone);
  const url = new URL(`${MSG91_BASE_URL}/retry`);
  url.searchParams.set('mobile', mobile);
  url.searchParams.set('retrytype', retryType);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  let response;
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        authkey: authKey,
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const networkErr = new Error('MSG91 retry service se connection nahi hua');
    networkErr.status = 502;
    throw networkErr;
  } finally {
    clearTimeout(timer);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok || !data || data.type !== 'success') {
    const msg = data && data.message ? String(data.message) : 'OTP dobara nahi bhej sake';
    const retryErr = new Error(`SMS provider retry fail hua: ${msg}`);
    retryErr.status = 502;
    throw retryErr;
  }

  return {
    success: true,
    message: String(data.message || 'OTP resent successfully'),
  };
}

module.exports = {
  isMsg91Configured,
  getOtpExpiryMinutes,
  formatMobile,
  sendOtp,
  verifyOtp,
  retryOtp,
};
