// FixMate Client Configuration
// Priority: localStorage 'fm_api_base' -> window.API_BASE_URL -> Auto-detect Render/Localhost/Native
(function () {
  const PROD_API_URL = 'https://fixmate-server-hx4n.onrender.com';

  let saved = null;
  try {
    saved = localStorage.getItem('fm_api_base');
  } catch (e) {}

  // If saved contains an old local development IP or :3000, clear it so native/production users connect to Render
  if (saved && (saved.includes(':3000') || saved.includes('192.168.') || saved.includes('10.') || saved.includes('localhost') || saved.includes('127.0.0.1'))) {
    try { localStorage.removeItem('fm_api_base'); } catch (e) {}
    saved = null;
  }

  const isBrowser = typeof window !== 'undefined' && typeof location !== 'undefined';

  // Detect if running on localhost / local development server
  const isLocalHost = isBrowser && (
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1' ||
    location.hostname === '' ||
    location.hostname.startsWith('192.168.') ||
    location.hostname.startsWith('10.') ||
    location.hostname.startsWith('172.')
  );

  const isNative = (typeof window !== 'undefined' && window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) ||
                   (isBrowser && (location.protocol === 'file:' || location.origin === 'https://localhost'));

  // In production (Render web or Native mobile app), use deployed Render URL.
  // In local browser development (localhost/127.0.0.1), use empty string (relative) or local origin.
  let defaultBackend = PROD_API_URL;
  if (isBrowser && isLocalHost && !isNative) {
    defaultBackend = location.origin || 'http://localhost:3000';
  } else if (isBrowser && !isNative && location.origin && location.origin.startsWith('http')) {
    defaultBackend = location.origin;
  }

  window.API_BASE_URL = saved || window.API_BASE_URL || defaultBackend;
  window.FIXMATE_API_BASE = window.API_BASE_URL;
})();
