const BRAND = 'FixMate', CITY = 'Dhanbad';

// Initial default categories and services (extended dynamically from Neon PostgreSQL)
let CATS = [
  'Electrician', 'Plumber', 'AC Repair', 'TV Repair', 'Washing Machine', 'Refrigerator',
  'RO & Water Purifier', 'Microwave', 'Carpenter', 'Home Cleaning', 'Pest Control',
  'Painting', 'Appliance Installation', 'General Home Maintenance', 'Mechanic', 'Home Tutor'
];

let SV = [
  { id: 1, c: 'Electrician', e: 'zap', n: 'Switch aur socket repair', p: 149, r: 4.8, k: '12.4k' },
  { id: 2, c: 'Electrician', e: 'zap', n: 'Fan install ya repair', p: 199, r: 4.8, k: '9.1k' },
  { id: 3, c: 'Electrician', e: 'plug', n: 'Inverter aur wiring check', p: 249, r: 4.7, k: '5.6k' },
  { id: 4, c: 'Plumber', e: 'droplet', n: 'Tap aur leakage repair', p: 149, r: 4.8, k: '10.2k' },
  { id: 5, c: 'Plumber', e: 'droplet', n: 'Bathroom fitting', p: 299, r: 4.7, k: '4.3k' },
  { id: 6, c: 'Plumber', e: 'droplet', n: 'Water tank cleaning', p: 499, r: 4.8, k: '3.9k' },
  { id: 7, c: 'AC Repair', e: 'snow', n: 'Split AC service', p: 499, r: 4.9, k: '14.8k' },
  { id: 8, c: 'AC Repair', e: 'snow', n: 'AC gas refill', p: 1499, r: 4.7, k: '6.2k' },
  { id: 9, c: 'TV Repair', e: 'tv', n: 'TV diagnosis', p: 199, r: 4.7, k: '4.8k' },
  { id: 10, c: 'TV Repair', e: 'tv', n: 'TV wall mount', p: 349, r: 4.8, k: '3.1k' },
  { id: 11, c: 'Mechanic', e: 'bike', n: 'Bike service (pickup aur drop)', p: 399, r: 4.8, k: '7.5k' },
  { id: 12, c: 'Mechanic', e: 'car', n: 'Car check-up', p: 599, r: 4.6, k: '2.7k' },
  { id: 13, c: 'Home Tutor', e: 'book', n: 'Class 6 se 10 Maths aur Science', p: 1500, r: 4.9, k: '5.2k' },
  { id: 14, c: 'Home Tutor', e: 'grad', n: 'English aur coding basics', p: 1200, r: 4.8, k: '2.4k' }
];

function getCatIcon(cat) {
  const map = {
    'Electrician': 'zap', 'Plumber': 'droplet', 'AC Repair': 'snow', 'TV Repair': 'tv',
    'Washing Machine': 'disc', 'Refrigerator': 'box', 'RO & Water Purifier': 'filter',
    'Microwave': 'tv', 'Carpenter': 'tool', 'Home Cleaning': 'sparkles',
    'Pest Control': 'shield', 'Painting': 'brush', 'Appliance Installation': 'plug',
    'General Home Maintenance': 'home', 'Mechanic': 'bike', 'Home Tutor': 'grad'
  };
  return map[cat] || 'tool';
}

const P = {
  zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"/>',
  droplet: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  snow: '<path d="M2 12h20M12 2v20M20 16l-4-4 4-4M4 8l4 4-4 4M16 4l-4 4-4-4M8 20l4-4 4 4"/>',
  tv: '<rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/>',
  bike: '<circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>',
  car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  grad: '<path d="M22 10 12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  list: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4M12 16h4M8 11h.01M8 16h.01"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  theme: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.7 8.97a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  star: '<polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3 12 2"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  dot: '<circle cx="12" cy="12" r="4"/>',
  spark: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  wind: '<path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2"/>',
  disc: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/>',
  box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  tool: '<path d="m14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  brush: '<path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'
};

function ic(n, sz = 20, f) {
  return `<svg class="ico" width="${sz}" height="${sz}" viewBox="0 0 24 24" fill="${f ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || P.dot}</svg>`;
}

const BASE = '<path d="M8 60L60 84L112 60L60 38Z" fill="#E9E4DA"/><path d="M8 60L60 84V90L8 66Z" fill="#CFC8BB"/><path d="M112 60L60 84V90L112 66Z" fill="#DDD6CA"/>';
const ART = [
  '<rect x="38" y="20" width="44" height="38" rx="5" fill="#F8F8F6" stroke="#CFCFC8"/><rect x="46" y="27" width="10" height="16" rx="2" fill="#2F9E7A"/><rect x="64" y="27" width="10" height="16" rx="2" fill="#E8E8E2" stroke="#BDBDB5"/><circle cx="60" cy="50" r="4" fill="#3B4A57"/>',
  '<rect x="58" y="14" width="4" height="34" fill="#2B3A42"/><ellipse cx="60" cy="50" rx="9" ry="4" fill="#2B3A42"/><path d="M60 48L98 38L100 43L62 52Z" fill="#B98A5E"/><path d="M60 48L22 38L20 43L58 52Z" fill="#B98A5E"/><path d="M58 50L45 66L51 68L63 53Z" fill="#C79A6E"/>',
  '<rect x="34" y="28" width="52" height="32" rx="4" fill="#3C5A6B"/><rect x="40" y="34" width="22" height="9" rx="2" fill="#9ADBC4"/><circle cx="72" cy="39" r="4" fill="#F2B84B"/><rect x="40" y="48" width="40" height="4" rx="2" fill="#2A4250"/>',
  '<path d="M44 60V32a14 14 0 0 1 28 0V38" fill="none" stroke="#9AA7B0" stroke-width="7" stroke-linecap="round"/><rect x="67" y="36" width="10" height="8" rx="2" fill="#7E8C96"/><path d="M72 48q-5 7 0 10q5-3 0-10z" fill="#5BB4E5"/>',
  '<path d="M60 60V28" stroke="#9AA7B0" stroke-width="5"/><path d="M38 28a22 12 0 0 1 44 0Z" fill="#B7C3CB"/><path d="M46 34v8M54 34v14M62 34v8M70 34v14" stroke="#5BB4E5" stroke-width="2.5" stroke-linecap="round"/>',
  '<rect x="40" y="26" width="40" height="34" rx="6" fill="#4F8FBF"/><rect x="40" y="26" width="40" height="9" rx="4" fill="#3E78A5"/><path d="M46 46q7-5 14 0t14 0" fill="none" stroke="#BFE3F7" stroke-width="3"/>',
  '<rect x="26" y="22" width="68" height="22" rx="6" fill="#F4F6F6" stroke="#D2D8D8"/><rect x="32" y="35" width="56" height="4" rx="2" fill="#C9D3D3"/><circle cx="84" cy="29" r="2.2" fill="#2F9E7A"/><path d="M40 50q3 4 0 8M60 50q3 4 0 8M80 50q3 4 0 8" fill="none" stroke="#7CC4E8" stroke-width="2.5" stroke-linecap="round"/>',
  '<rect x="48" y="26" width="24" height="34" rx="8" fill="#E26D5A"/><rect x="55" y="20" width="10" height="8" rx="2" fill="#6B7A85"/><rect x="48" y="38" width="24" height="8" fill="#F6F0E8"/><path d="M72 24q10-2 14 8" fill="none" stroke="#6B7A85" stroke-width="3" stroke-linecap="round"/>',
  '<rect x="28" y="22" width="64" height="36" rx="4" fill="#2B3A42"/><rect x="32" y="26" width="56" height="28" rx="2" fill="#6EC1D9"/><path d="M32 46l16-12l14 10l10-7l16 12v5H32z" fill="#3E9B6B"/>',
  '<rect x="26" y="20" width="68" height="34" rx="3" fill="#2B3A42"/><rect x="30" y="24" width="60" height="26" rx="2" fill="#7FB8D6"/><path d="M52 54L48 62M68 54L72 62" stroke="#8D98A0" stroke-width="4" stroke-linecap="round"/><rect x="44" y="60" width="32" height="3" rx="1.5" fill="#8D98A0"/>',
  '<circle cx="38" cy="52" r="11" fill="none" stroke="#2B3A42" stroke-width="4"/><circle cx="84" cy="52" r="11" fill="none" stroke="#2B3A42" stroke-width="4"/><path d="M38 52L52 38H70L84 52M52 38L60 52H76" fill="none" stroke="#E26D5A" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/><rect x="52" y="32" width="18" height="6" rx="3" fill="#2B3A42"/><path d="M72 38L78 30H84" fill="none" stroke="#2B3A42" stroke-width="3" stroke-linecap="round"/>',
  '<path d="M24 52V44q0-4 5-5l10-2l8-10h24l10 10l10 2q4 1 4 5V52Z" fill="#4F8FBF"/><path d="M48 28H70l8 9H42Z" fill="#CFE8F5"/><circle cx="42" cy="54" r="7" fill="#2B3A42"/><circle cx="82" cy="54" r="7" fill="#2B3A42"/><circle cx="42" cy="54" r="2.5" fill="#B9C3CA"/><circle cx="82" cy="54" r="2.5" fill="#B9C3CA"/>',
  '<rect x="34" y="46" width="52" height="11" rx="2" fill="#2F9E7A"/><rect x="38" y="35" width="46" height="11" rx="2" fill="#F2B84B"/><rect x="36" y="24" width="48" height="11" rx="2" fill="#4F8FBF"/><path d="M42 29.5h20M46 40.5h16M40 51.5h22" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".8"/>',
  '<rect x="34" y="24" width="52" height="32" rx="3" fill="#2B3A42"/><rect x="38" y="28" width="44" height="24" rx="1.5" fill="#9ADBC4"/><path d="M48 36l-4 4l4 4M72 36l4 4l-4 4M64 34l-8 12" fill="none" stroke="#2B3A42" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M28 58H92l-5 4H33Z" fill="#B8C2C8"/>'
];

function art(i) {
  const item = SV[i] || SV[0];
  const artIdx = Math.abs(i) % ART.length;
  return `<svg viewBox="0 0 120 92" width="100%" height="100%" role="img" aria-label="${esc(item.n)}">${BASE}${ART[artIdx]}</svg>`;
}

const SL = ['Abhi (60 min mein)', 'Aaj 6 se 8 PM', 'Kal 10 se 12 AM', 'Kal 4 se 6 PM'];
const TS = ['Free demo: Kal 5 PM', 'Free demo: Parso 5 PM'];
const ST = ['Booking confirm', 'Worker assign hua', 'Worker raste mein hai', 'Quote taiyaar', 'Kaam chal raha hai', 'Kaam poora'];

let S = {
  scr: 'splash',
  obStep: 0,
  cat: 'Sab',
  q: '',
  sv: 0,
  slot: 0,
  pay: 'wallet',
  w: 0,
  tx: [],
  B: [],
  token: null,
  n: 0,
  ad: '',
  addresses: [],
  activeAddrId: null,
  coupons: [],
  appliedCoupon: null,
  emergency: false,
  bookingIssue: '',
  bookingPhoto: '',
  modal: null,
  rescheduleBookingId: null,
  rescheduleSlot: '',
  reviewBookingId: null,
  reviewRating: 5,
  reviewComment: '',
  user: null,
  lg: { step: 0, ph: '', otp: '', tries: 0, exp: 0, rs: 0 }
};

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const $ = (i) => document.getElementById(i);

function toast(m) {
  const t = $('toast');
  if (!t) return;
  t.textContent = m;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2400);
}

function theme() {
  const r = document.documentElement;
  const d = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme:dark)').matches;
  r.dataset.theme = d ? 'light' : 'dark';
}

function go(s) {
  S.scr = s;
  S.modal = null;
  render();
  scrollTo(0, 0);
}

/* ========================================================
   SCREEN 1: SPLASH SCREEN
   ======================================================== */
function splash() {
  return `<div class="splash-screen">
    <div class="splash-logo-container">
      <div class="splash-logo-glow"></div>
      <div class="splash-logo-badge">${ic('spark', 44)}</div>
    </div>
    <h1 class="splash-title">${BRAND}</h1>
    <div class="splash-tagline">Ghar ke kaam, verified workers se. Ek tap mein service.</div>
    <div class="splash-loader"><div class="splash-loader-bar"></div></div>
  </div>`;
}

/* ========================================================
   SCREEN 2: ONBOARDING SCREENS
   ======================================================== */
const OBS = [
  {
    pill: '⚡ 60-Minute Fast Service',
    title: 'Verified Service Experts',
    desc: 'Electrician, Plumber, AC Repair aur bohot kuch bas ek tap par. Sabhi technicians police-verified hain.',
    art: () => `<svg viewBox="0 0 120 92" width="160" height="120" role="img">${BASE}${ART[0]}</svg>`
  },
  {
    pill: '🛡️ 100% Safe & Transparent',
    title: 'Transparent Fixed Quotes',
    desc: 'Worker ke aane par 4-digit safety code se kaam shuru. Bina aapki manzoori ke koi extra charge nahi.',
    art: () => `<svg viewBox="0 0 120 92" width="160" height="120" role="img">${BASE}${ART[3]}</svg>`
  },
  {
    pill: '💳 30-Day Free Warranty',
    title: 'Complete Peace of Mind',
    desc: 'Har service par 30 din ki free warranty aur instant 5% cashback aapke FixMate wallet mein.',
    art: () => `<svg viewBox="0 0 120 92" width="160" height="120" role="img">${BASE}${ART[6]}</svg>`
  }
];

function onboarding() {
  const cur = OBS[S.obStep] || OBS[0];
  const isLast = S.obStep === OBS.length - 1;
  return `<div class="onboarding-wrap">
    <div class="onboarding-top">
      <div style="font-weight:800;font-size:22px;color:var(--pri);letter-spacing:-0.02em">${BRAND}</div>
      <button class="onboarding-skip-btn" onclick="finishOnboarding()">Skip</button>
    </div>
    <div class="onboarding-card">
      <div class="onboarding-art">${cur.art()}</div>
      <div class="onboarding-pill">${cur.pill}</div>
      <h2 class="onboarding-title">${cur.title}</h2>
      <p class="onboarding-desc">${cur.desc}</p>
    </div>
    <div class="onboarding-footer">
      <div class="onboarding-dots">
        ${OBS.map((_, i) => `<span class="onboarding-dot ${S.obStep === i ? 'active' : ''}"></span>`).join('')}
      </div>
      <button class="btn ${isLast ? 'acc' : ''}" style="width:100%;max-width:340px" onclick="nextOnboarding()">
        ${isLast ? 'Shuru Karein (Get Started) 🚀' : 'Aage Badhein →'}
      </button>
    </div>
  </div>`;
}

function nextOnboarding() {
  if (S.obStep < OBS.length - 1) {
    S.obStep++;
    render();
  } else {
    finishOnboarding();
  }
}

function finishOnboarding() {
  try { localStorage.setItem('fm_onboarded', '1'); } catch (e) {}
  S.scr = 'login';
  render();
}

/* ========================================================
   SCREEN 3: LOGIN / SIGNUP SCREEN
   ======================================================== */
const mk = (p) => p.slice(0, 2) + 'XXXXXX' + p.slice(-2);

function login() {
  const L = S.lg;
  if (L.step === 0) {
    return `<div class="hd hero">
      <div class="splash-icon">${ic('spark', 28)}</div>
      <div class="brand-badge">${ic('shield', 13)} 100% Trusted Service</div>
      <b style="font-size:32px;display:block;letter-spacing:-0.03em;margin-top:2px">${BRAND}</b>
      <div style="margin-top:6px;font-size:14px;opacity:0.9">Ghar ke kaam, verified workers se. Shuru karne ke liye login karein.</div>
    </div>
    <div style="padding:16px 4px 0">
      <h2>Mobile number</h2>
      <div class="row">
        <span class="badge" style="padding:13px 14px;font-size:14px">+91</span>
        <input id="ph" type="tel" inputmode="numeric" maxlength="10" placeholder="10 digit number" value="${esc(L.ph)}" style="margin:0">
      </div>
      <div class="mut" style="margin:10px 0 16px">Hum OTP bhejenge. Aapka number bilkul surakshit rahega.</div>
      <button class="btn acc" onclick="sendOtp()">OTP Bhejo</button>
      <div style="text-align:center;margin-top:16px">
        <button class="btn sm ghost" style="display:inline-flex;width:auto;padding:6px 14px;font-size:12px;opacity:0.85" onclick="setCustomServerUrl()">⚙️ Server: ${esc(getApiBase() || 'Localhost')}</button>
      </div>
    </div>`;
  }

  if (L.step === 1) {
    const cd = (L.cooldown || 0) > 0;
    return `<button class="back" onclick="S.lg.step=0;render()">← Number badlo</button>
    <h2 style="font-size:22px">OTP daalein</h2>
    <div class="mut">+91 ${mk(L.ph)} pe 6 digit OTP bheja gaya. 60 second mein expire hoga.</div>
    <div class="card" style="margin-top:14px;border-color:var(--sec)">${L.dev ? `Demo OTP: <b style="color:var(--sec);font-size:18px">${esc(L.dev)}</b>` : 'OTP SMS par bheja gaya hai.'}</div>
    <input id="otp" type="tel" inputmode="numeric" maxlength="6" placeholder="------" style="margin:8px 0 14px;text-align:center;font-size:28px;letter-spacing:10px;font-weight:800">
    <button class="btn acc" onclick="verOtp()">Verify Karein</button>
    <button id="resend-btn" class="btn ghost" style="margin-top:10px;${cd ? 'opacity:0.6;cursor:not-allowed' : ''}" ${cd ? 'disabled' : ''} onclick="sendOtp(1)">${cd ? `OTP dobara bhejo (${L.cooldown}s)` : 'OTP dobara bhejo'}</button>`;
  }

  return `<h2 style="font-size:22px;margin-top:24px">Number verify ho gaya</h2>
  <div class="mut" style="margin-bottom:14px">Bas ek step baaki hai profile poori karne ke liye.</div>
  <label for="nm" style="font-weight:700;font-size:14px">Aapka naam</label>
  <input id="nm" placeholder="Poora naam" style="margin-top:6px">
  <label for="sk" style="font-weight:700;font-size:14px">Worker ho to apna kaam chuno</label>
  <select id="sk" style="margin-top:6px">${CATS.map((c) => `<option>${c}</option>`).join('')}</select>
  <button class="btn acc" onclick="fin2('customer')">Customer ban kar shuru karo</button>
  <button class="btn ghost" style="margin-top:10px" onclick="fin2('worker')">Worker ban kar kaam lo</button>
  <div class="mut" style="margin-top:10px">Worker ki ID aur verification ke baad hi requests milengi.</div>`;
}

function startOtpCooldown() {
  const L = S.lg;
  L.cooldown = 20;
  if (L.timer) clearInterval(L.timer);
  L.timer = setInterval(() => {
    if (L.cooldown > 0) {
      L.cooldown--;
      const btn = $('resend-btn');
      if (btn) {
        if (L.cooldown > 0) {
          btn.textContent = `OTP dobara bhejo (${L.cooldown}s)`;
          btn.disabled = true;
          btn.style.opacity = '0.6';
          btn.style.cursor = 'not-allowed';
        } else {
          btn.textContent = 'OTP dobara bhejo';
          btn.disabled = false;
          btn.style.opacity = '1';
          btn.style.cursor = 'pointer';
          clearInterval(L.timer);
        }
      }
    } else {
      clearInterval(L.timer);
    }
  }, 1000);
}

function sendOtp(re) {
  const L = S.lg;
  let ph = L.ph;
  if (!re) {
    ph = $('ph').value.replace(/\D/g, '');
    if (!/^[6-9]\d{9}$/.test(ph)) {
      toast('Sahi 10 digit mobile number daalo');
      return;
    }
  }
  act(async () => {
    const d = await api('POST', '/auth/otp/send', { phone: ph });
    L.ph = ph;
    L.dev = d.devOtp || '';
    L.step = 1;
    render();
    startOtpCooldown();
    if (re) toast(d.message || 'Naya OTP bhej diya');
  });
}

function verOtp() {
  const L = S.lg, v = $('otp').value.trim();
  L.v = v;
  if (!/^\d{6}$/.test(v)) {
    toast('6 digit ka OTP daalein');
    return;
  }
  act(async () => {
    try {
      await signedIn(await api('POST', '/auth/otp/verify', { phone: L.ph, otp: v }));
    } catch (e) {
      if (e.data && e.data.needsProfile) {
        L.step = 2;
        render();
      } else {
        throw e;
      }
    }
  });
}

function fin2(role) {
  const n = $('nm').value.trim();
  if (n.length < 2) {
    toast('Apna naam likho');
    return;
  }
  act(async () => signedIn(await api('POST', '/auth/otp/verify', { phone: S.lg.ph, otp: S.lg.v, name: n, role, skill: role === 'worker' ? $('sk').value : undefined })));
}

async function signedIn(d) {
  S.token = d.token;
  S.user = d.user;
  try { localStorage.setItem('fm_auth', JSON.stringify({ t: d.token, u: d.user })); } catch (e) {}
  S.scr = d.user.role === 'worker' ? 'wk' : 'home';
  await refresh();
  render();
  scrollTo(0, 0);
  toast('Welcome, ' + d.user.name);
}

function out() {
  if (S.lg.timer) clearInterval(S.lg.timer);
  S.user = null;
  S.token = null;
  S.B = [];
  S.lg = { step: 0, ph: '', cooldown: 0 };
  try { localStorage.removeItem('fm_auth'); } catch (e) {}
  S.scr = 'login';
  render();
  toast('Logout ho gaya');
}

/* ========================================================
   SCREEN 4: HOME SCREEN (Customer Experience)
   ======================================================== */
function fl() {
  return SV.map((x, i) => [x, i]).filter(([x]) => {
    const matchCat = S.cat === 'Sab' || x.c === S.cat;
    const matchQ = !S.q || x.n.toLowerCase().includes(S.q.toLowerCase()) || x.c.toLowerCase().includes(S.q.toLowerCase());
    if (S.emergency) {
      const emergencyCats = ['Electrician', 'Plumber', 'AC Repair'];
      return emergencyCats.includes(x.c) && matchQ;
    }
    return matchCat && matchQ;
  });
}

function grid(L) {
  if (!L.length) {
    return `<div class="card mut" style="grid-column: 1 / -1;text-align:center;padding:24px">
      ${ic('tool', 32)}
      <div style="margin-top:8px">Ye service abhi nahi mili. Dusra naam try karo ya category chun lo.</div>
    </div>`;
  }
  return L.map(([x, i]) => `
    <button class="sc" onclick="pick(${i})">
      <div class="im">
        ${art(i)}
        <span class="rt">${ic('star', 11, 1)} ${x.r || 4.8} (${x.k || '5k+'})</span>
      </div>
      <b>${esc(x.n)}</b>
      <span class="mut" style="font-size:12px">${esc(x.c)}</span>
      <span class="pr">${x.c === 'Home Tutor' ? 'Free demo class' : inr(x.p) + ' se <s>' + inr(Math.round(x.p * 1.3 / 10) * 10) + '</s>'}</span>
    </button>
  `).join('');
}

function sr() {
  const gr = $('gr');
  if (gr) gr.innerHTML = grid(fl());
}

function home() {
  const activeBooking = S.B.find((b) => !b.paid && b.status !== 'cancelled');

  return `<div class="hd">
    <div class="row">
      <b style="font-size:26px;letter-spacing:-0.03em">${BRAND}</b>
      <div class="ics">
        <button class="ic" onclick="go('pf')" aria-label="Profile">${ic('user', 18)}</button>
        <button class="ic" onclick="theme()" aria-label="Theme badlo">${ic('theme', 18)}</button>
      </div>
    </div>
    <div class="loc" style="cursor:pointer" onclick="openAddressModal()">
      ${ic('pin', 14)} <span>${esc(S.ad || CITY + ', Jharkhand')}</span> ▾
    </div>
    <input id="q" placeholder="Kaunsi service chahiye? (e.g. AC, Tap, Fan)" value="${esc(S.q)}" oninput="S.q=this.value;sr()">
  </div>

  ${activeBooking ? `
    <div class="active-booking-banner" onclick="go('bk')">
      <div>
        <div style="font-size:11px;font-weight:800;color:var(--teal);text-transform:uppercase;letter-spacing:0.5px">Active Booking</div>
        <b style="font-size:14px;color:var(--ink)">${esc(activeBooking.service)}</b>
        <div class="mut" style="font-size:12px">${esc(activeBooking.label)} • Code: <b style="color:var(--sec)">${esc(activeBooking.start_code)}</b></div>
      </div>
      <button class="btn sm" style="width:auto;padding:6px 14px;font-size:12px">Track →</button>
    </div>
  ` : ''}

  <!-- Emergency 60-min Booking Mode -->
  <div class="emergency-strip" onclick="toggleEmergency()">
    <div>
      <b>${ic('alert', 16)} ${S.emergency ? '🚨 Emergency Mode Active' : '⚡ 60-Min Emergency Service'}</b>
      <span>${S.emergency ? 'Tap karein normal view par lautne ke liye' : 'Bijli, paani ya AC breakdown? Urgent worker dispatch'}</span>
    </div>
    <span class="badge" style="background:#FFFFFF;color:#DC2626;font-weight:800">${S.emergency ? 'Normal Mode' : 'Priority ⚡'}</span>
  </div>

  <!-- Coupons & Offers Carousel -->
  ${S.coupons.length ? `
    <div class="coupons-strip">
      ${S.coupons.map((c) => `
        <div class="coupon-pill" onclick="copyCoupon('${esc(c.code)}')">
          ${ic('tag', 15)}
          <div>
            <b>${esc(c.code)}</b>
            <span style="font-size:11px;color:var(--ink);opacity:0.85;margin-left:4px">${esc(c.title)}</span>
          </div>
        </div>
      `).join('')}
    </div>
  ` : ''}

  <div class="trust">${ic('shield', 16)} Verified worker, OTP se kaam shuru, pehle quote, 30 din warranty</div>

  <!-- AI Voice & Chat Assistant Banner -->
  <div class="ai-home-banner" onclick="window.FixMateAI&&window.FixMateAI.open('voice')">
    <div class="ai-banner-left">
      <div class="ai-banner-badge">✨ AI Voice & Chat Assistant</div>
      <div class="ai-banner-title">Talk to FixMate AI</div>
      <div class="ai-banner-sub">Bol kar ya likh kar koi bhi service book karein</div>
    </div>
    <div class="ai-banner-mic-btn">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="22"/>
      </svg>
    </div>
  </div>

  <!-- Smart Problem Diagnosis -->
  <div class="card">
    <b>${ic('spark', 16)} Problem batao</b>
    <div class="mut">Apni dikkat likho, sahi service aur andaza mil jayega.</div>
    <div class="row" style="margin-top:8px">
      <input id="pb" placeholder="Jaise: AC thanda nahi kar raha, paani leak" style="margin:0">
      <button class="btn sm" onclick="diag()">Dhundo</button>
    </div>
    <div id="dg"></div>
  </div>

  <!-- All 16 Dynamic Categories -->
  <div class="chips">
    ${['Sab', ...CATS].map((c) => `
      <button class="chip ${S.cat === c ? 'on' : ''}" onclick="S.cat='${c}';render()">${c}</button>
    `).join('')}
  </div>

  <!-- Services Grid -->
  <div id="gr" class="grid">${grid(fl())}</div>`;
}

function toggleEmergency() {
  S.emergency = !S.emergency;
  if (S.emergency) S.cat = 'Sab';
  render();
  toast(S.emergency ? 'Emergency mode on: Urgent services dikhaye ja rahe hain' : 'Normal mode active');
}

function copyCoupon(code) {
  try { navigator.clipboard.writeText(code); } catch (e) {}
  toast('Coupon code ' + code + ' copy ho gaya!');
}

/* ========================================================
   SCREEN 5: BOOKING FLOW (Enhanced Customer Booking)
   ======================================================== */
function pick(i) {
  S.sv = i;
  S.slot = 0;
  S.bookingIssue = '';
  S.bookingPhoto = '';
  S.appliedCoupon = null;
  S.scr = 'book';
  render();
  scrollTo(0, 0);
}

function onPhotoSelected(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    toast('Photo 2MB se chhoti honi chahiye');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    S.bookingPhoto = e.target.result;
    render();
    toast('Photo jodi gayi!');
  };
  reader.readAsDataURL(file);
}

function removePhoto() {
  S.bookingPhoto = '';
  render();
}

async function applyCouponCode() {
  const code = ($('cpn-input')?.value || '').trim();
  if (!code) {
    toast('Coupon code daalein');
    return;
  }
  const x = SV[S.sv] || SV[0];
  try {
    const res = await api('POST', '/coupons/apply', { code, amount: x.p });
    S.appliedCoupon = res;
    render();
    toast(`Coupon applied! ${inr(res.discount_amount)} discount mila.`);
  } catch (e) {
    toast(e.message);
  }
}

function removeAppliedCoupon() {
  S.appliedCoupon = null;
  render();
  toast('Coupon hata diya gaya');
}

function book() {
  const x = SV[S.sv] || SV[0];
  const isTutor = x.c === 'Home Tutor';
  const sl = isTutor ? TS : SL;
  const discount = S.appliedCoupon ? S.appliedCoupon.discount_amount : 0;
  const estimatedTotal = Math.max(0, x.p - discount);

  return `<button class="back" onclick="go('home')">← Wapas Home Pe</button>

  <div class="card row" style="justify-content:flex-start;margin-top:10px">
    <div class="im sm" style="width:70px;height:70px;flex-shrink:0">${art(S.sv)}</div>
    <div>
      <b style="font-size:16px">${esc(x.n)}</b>
      <div class="mut">${esc(x.c)} • ${ic('star', 12, 1)} ${x.r || 4.8}</div>
      <div style="font-weight:800;color:var(--teal);margin-top:2px">${isTutor ? 'Free Demo Class' : inr(x.p)}</div>
    </div>
  </div>

  ${S.emergency ? `
    <div class="badge" style="background:#FEE2E2;color:#DC2626;padding:10px 14px;font-size:13px;margin:12px 0;display:block">
      🚨 <b>Emergency Priority Booking</b>: Technician 60 minute mein aapke address par dispatch hoga.
    </div>
  ` : ''}

  <h2>Problem ka vivaran (Optional)</h2>
  <textarea id="bk-desc" placeholder="Apni dikkat likhein (jaise: switch se aag nikal rahi hai, awaaz aa rahi hai)" rows="2" style="width:100%;padding:12px 14px;border-radius:14px;border:1.5px solid var(--bd);background:var(--card);color:var(--ink);font:inherit;margin-bottom:12px" oninput="S.bookingIssue=this.value">${esc(S.bookingIssue)}</textarea>

  <!-- Photo / Video Attachment -->
  <div class="photo-upload-wrap">
    ${S.bookingPhoto ? `
      <img src="${S.bookingPhoto}" class="photo-preview-thumb" alt="Issue photo">
      <button class="btn sm ghost" style="width:auto;padding:4px 12px;font-size:12px;color:var(--bad)" onclick="removePhoto()">❌ Photo Hatayein</button>
    ` : `
      <label for="bk-file" style="cursor:pointer;display:block">
        <div style="font-size:24px;margin-bottom:4px">${ic('camera', 28)}</div>
        <b>Dikkat ki photo jodein (Optional)</b>
        <div class="mut" style="font-size:12px">Technician ko pehle samajhne mein asani hogi</div>
      </label>
      <input type="file" id="bk-file" accept="image/*" style="display:none" onchange="onPhotoSelected(event)">
    `}
  </div>

  <h2>Date & Time Slot</h2>
  <div class="chips">
    ${sl.map((s, i) => `
      <button class="chip ${S.slot === i ? 'on' : ''}" onclick="S.slot=${i};render()">${s}</button>
    `).join('')}
  </div>

  <h2>Address</h2>
  ${S.addresses.length ? `
    <div class="chips" style="margin-bottom:8px">
      ${S.addresses.map((a) => {
        const full = a.address_line + (a.landmark ? ', ' + a.landmark : '') + ', ' + a.city;
        const isSel = S.ad === full;
        return `<button class="chip ${isSel ? 'on' : ''}" onclick="S.ad='${esc(full)}';render()">
          ${a.label === 'Home' ? '🏠' : a.label === 'Work' ? '🏢' : '📍'} ${esc(a.label)}
        </button>`;
      }).join('')}
      <button class="chip" onclick="openAddAddressModal()">+ Naya Address</button>
    </div>
  ` : ''}
  <input id="ad" placeholder="Ghar / Flat no, gali, landmark, Dhanbad" value="${esc(S.ad)}" oninput="S.ad=this.value">

  <!-- Offers & Coupons -->
  <h2>Offers & Coupons</h2>
  ${S.appliedCoupon ? `
    <div class="card row" style="border-color:var(--ok);background:rgba(30,130,76,0.06)">
      <div>
        <b style="color:var(--ok)">🎉 ${esc(S.appliedCoupon.code)} Applied!</b>
        <div class="mut" style="font-size:12px">${esc(S.appliedCoupon.title)} (-${inr(S.appliedCoupon.discount_amount)})</div>
      </div>
      <button class="btn sm ghost" style="width:auto;padding:4px 10px;font-size:12px" onclick="removeAppliedCoupon()">Hatao</button>
    </div>
  ` : `
    <div class="row" style="margin-bottom:14px">
      <input id="cpn-input" placeholder="Coupon Code (e.g. WELCOME50)" style="margin:0;text-transform:uppercase">
      <button class="btn sm" style="width:auto;padding:12px 18px" onclick="applyCouponCode()">Apply</button>
    </div>
  `}

  <!-- Transparent Pricing Breakdown -->
  <h2>Transparent Price Estimate</h2>
  <div class="price-breakdown">
    <div class="price-line">
      <span>Inspection / Visiting Fee</span>
      <span>₹99 <small class="mut">(Bill mein adjust)</small></span>
    </div>
    <div class="price-line">
      <span>Service Base Labor</span>
      <span>${isTutor ? 'Free Demo' : inr(x.p)}</span>
    </div>
    ${discount > 0 ? `
      <div class="price-line" style="color:var(--ok);font-weight:700">
        <span>Coupon Discount (${esc(S.appliedCoupon.code)})</span>
        <span>-${inr(discount)}</span>
      </div>
    ` : ''}
    <div class="price-line total">
      <span>Estimated Total (Pay after service)</span>
      <span>${isTutor ? 'Free Demo' : inr(estimatedTotal)}</span>
    </div>
  </div>

  <div class="card mut" style="font-size:12.5px;line-height:1.4">
    🛡️ <b>FixMate Safety & Pricing Guarantee:</b><br>
    Visit fee ₹99 kaam banne par final quote mein jud jati hai. Worker aane ke baad exact quote dega. Bina aapki manzoori ke koi kaam nahi hoga. 30 din ki free warranty.
  </div>

  <h2>Payment (Kaam poora hone ke baad)</h2>
  <div class="chips">
    <button class="chip ${S.pay === 'wallet' ? 'on' : ''}" onclick="S.pay='wallet';render()">FixMate Wallet (Balance: ${inr(S.w)})</button>
    <button class="chip ${S.pay === 'cash' ? 'on' : ''}" onclick="S.pay='cash';render()">Cash on Completion</button>
    <button class="chip ${S.pay === 'razorpay' ? 'on' : ''}" onclick="S.pay='razorpay';render()">Online UPI / Card</button>
  </div>

  <button class="btn acc" style="margin-top:16px" onclick="doBook()">
    ${isTutor ? 'Free Demo Book Karein' : `Book Confirm Karein (${inr(estimatedTotal)})`}
  </button>`;
}

function doBook() {
  if (!S.ad.trim()) {
    toast('Address likhna zaruri hai');
    return;
  }
  const x = SV[S.sv] || SV[0];
  const slotText = (x.c === 'Home Tutor' ? TS : SL)[S.slot];
  const issueDesc = ($('bk-desc')?.value || S.bookingIssue || '').trim();
  const couponCode = S.appliedCoupon ? S.appliedCoupon.code : null;
  const discountAmount = S.appliedCoupon ? S.appliedCoupon.discount_amount : 0;

  act(async () => {
    const res = await api('POST', '/bookings', {
      serviceId: x.id || S.sv + 1,
      slot: slotText,
      address: S.ad.trim(),
      pay: S.pay,
      issue_desc: issueDesc,
      photo_url: S.bookingPhoto || null,
      coupon_code: couponCode,
      discount_amount: discountAmount,
      is_emergency: S.emergency ? 1 : 0
    });
    await refresh();
    S.scr = 'bk';
    render();
    toast(`Booking confirm! 4-digit code: ${res.booking.start_code}`);
  });
}

/* ========================================================
   SCREEN 6: BOOKINGS TAB & LIVE STATUS TRACKING
   ======================================================== */
const ORD = ['requested', 'assigned', 'on_the_way', 'inspecting', 'quoted', 'in_progress', 'completed'];
const SL2 = ['Booking confirm', 'Worker assign hua', 'Worker raste mein hai', 'Worker jaanch kar raha hai', 'Quote taiyaar', 'Kaam chal raha hai', 'Kaam poora'];

function bkc(b) {
  const i = b.status === 'closed' || b.status === 'cancelled' ? 6 : ORD.indexOf(b.status);
  const x = SV.find((s) => s.id === b.service_id) || SV[0];
  const cx = b.status === 'closed';
  const fin = i === 6;
  const isCan = b.status === 'cancelled';

  return `<div class="card" style="margin-bottom:14px">
    <div class="row">
      <b>${ic(x.e || 'tool', 18)} ${esc(b.service)}</b>
      ${isCan ? '<span class="badge" style="background:#FEE2E2;color:#DC2626">Cancel hui</span>' : b.paid ? '<span class="badge ok">Paid & Closed</span>' : `<span class="badge">${esc(b.label)}</span>`}
    </div>
    <div class="mut" style="font-size:13px;margin-top:2px">${esc(b.slot)} • ${esc(b.address)}</div>

    ${b.issue_desc ? `<div class="card" style="background:var(--soft);border:none;padding:8px 12px;margin:8px 0;font-size:12.5px"><b>Dikkat:</b> ${esc(b.issue_desc)}</div>` : ''}

    ${b.is_emergency ? `<div class="badge" style="background:#FEE2E2;color:#DC2626;display:inline-block;margin-top:4px">🚨 Emergency Priority Booking</div>` : ''}

    ${isCan ? `
      <div class="mut" style="margin-top:8px">Ye booking cancel ho chuki hai. Aap chahein to dobara book kar sakte hain.</div>
    ` : `
      <div class="tl">${SL2.map((t, k) => `<div class="${k <= i ? 'd' : ''}"><span>${ic(k <= i ? 'check' : 'dot', 14)}</span>${t}</div>`).join('')}</div>
    `}

    ${i >= 1 && !isCan ? `
      <div class="row" style="justify-content:flex-start;margin-top:10px">
        <span class="av">${ic('user', 22)}</span>
        <div>
          <b>${esc(b.worker_name || 'Verified Technician')}</b>
          <div class="mut" style="font-size:12px">ID & Police Verified Expert</div>
        </div>
      </div>
    ` : ''}

    ${b.contact_phone && !isCan ? `
      <a href="tel:${esc(b.contact_phone)}" class="btn sm" style="text-decoration:none;margin-top:10px;background:var(--sec);color:#fff">
        ${ic('phone', 16)} Worker ko call karo (${esc(b.contact_phone)})
      </a>
    ` : ''}

    <!-- Prominent Safety Code for Worker Arrival -->
    ${i >= 0 && i <= 2 && !isCan ? `
      <div class="card" style="background:rgba(0,106,96,0.06);border-color:var(--teal);margin-top:10px;text-align:center">
        <div class="mut" style="font-size:12px">Worker aane par ye 4-digit safety code batayein:</div>
        <div class="otp" style="font-size:32px;font-weight:800;letter-spacing:8px;color:var(--teal);margin:4px 0">${esc(b.start_code)}</div>
        <div class="mut" style="font-size:11px">Code verify hone ke baad hi worker ka kaam shuru hoga.</div>
      </div>
    ` : ''}

    <!-- Reschedule / Cancel actions for pending bookings -->
    ${['requested', 'assigned'].includes(b.status) ? `
      <div class="row" style="margin-top:10px">
        <button class="btn sm ghost" onclick="openRescheduleModal(${b.id})">${ic('clock', 14)} Reschedule Slot</button>
        <button class="btn sm ghost" style="color:var(--bad);border-color:rgba(239,68,68,0.3)" onclick="cancelBook(${b.id})">${ic('x', 14)} Cancel</button>
      </div>
    ` : ''}

    <!-- Quote details -->
    ${b.status === 'quoted' ? `
      <div class="card" style="border-color:var(--pri);margin:10px 0 0">
        <b>Inspection Quote</b>
        <div class="row mut"><span>Service charge</span><span>${inr(b.price)}</span></div>
        ${b.parts ? `<div class="row mut"><span>Genuine spare parts</span><span>${inr(b.parts)}</span></div>` : ''}
        <div class="row" style="border-top:1px dashed var(--bd);padding-top:6px;margin-top:6px">
          <b>Total Payable</b><b>${inr(b.total)}</b>
        </div>
        <div class="row" style="margin-top:10px">
          <button class="btn sm" onclick="post(${b.id},'approve',null,'Quote manzoor kiya')">Manzoor hai</button>
          <button class="btn sm ghost" onclick="post(${b.id},'reject',null,'Sirf visit fee lagegi')">Nahi chahiye</button>
        </div>
      </div>
    ` : ''}

    <!-- Payment action -->
    ${fin && !b.paid && !isCan ? (
      b.pay === 'razorpay'
        ? `<button class="btn acc" style="margin-top:10px" onclick="onlinePay(${b.id})">${inr(b.total)} Online Pay Karo</button>`
        : `<button class="btn acc" style="margin-top:10px" onclick="post(${b.id},'pay',null,'Payment ho gaya')">${inr(b.total)} Pay Karo (${b.pay === 'wallet' ? 'Wallet' : 'Cash'})</button>`
    ) : ''}

    <!-- Review & Rating for completed service -->
    ${fin && b.paid && !isCan ? `
      <div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--bd)">
        ${b.customer_rating ? `
          <div class="card" style="background:var(--soft);border:none;padding:10px 12px">
            <div class="row">
              <b>${ic('star', 14, 1)} Aapka Review: ${b.customer_rating}/5</b>
              <span class="badge ok">Reviewed</span>
            </div>
            ${b.customer_comment ? `<div class="mut" style="font-size:12px;margin-top:4px">"${esc(b.customer_comment)}"</div>` : ''}
          </div>
        ` : `
          <button class="btn sm acc" style="width:100%" onclick="openReviewModal(${b.id})">
            ⭐ Rating & Review Dein
          </button>
        `}
        <div class="mut" style="margin-top:6px;font-size:12px">
          ${cx ? 'Sirf visit fee li gayi.' : '✅ 30 din ki warranty active hai.'}
        </div>
      </div>
    ` : ''}
  </div>`;
}

function bk() {
  return `<h2 style="font-size:22px;margin-top:20px">Bookings</h2>
  ${S.B.length ? S.B.map(bkc).join('') : `
    <div class="card mut" style="text-align:center;padding:28px">
      ${ic('list', 36)}
      <div style="margin-top:8px;font-size:15px">Abhi koi booking nahi hai.</div>
      <button class="btn acc" style="margin-top:14px;max-width:220px" onclick="go('home')">Service Chuno</button>
    </div>
  `}`;
}

/* ========================================================
   SCREEN 7: MONEY & WALLET SCREEN
   ======================================================== */
function mo() {
  return `<h2 style="font-size:22px;margin-top:20px">FixMate Money</h2>
  <div class="hd" style="border-radius:22px;margin:0 0 14px">
    <div>Wallet balance</div>
    <b style="font-size:34px">${inr(S.w)}</b>
    <div style="font-size:12px;opacity:0.9;margin-top:4px">Har booking par 5% instant cashback</div>
  </div>
  <div class="row" style="margin-bottom:8px">
    <button class="btn ghost" onclick="topup(100)">+ ₹100</button>
    <button class="btn ghost" onclick="topup(500)">+ ₹500</button>
  </div>
  <div class="mut" style="margin-bottom:12px">Demo topup. Asli payment Razorpay se integrated hai.</div>
  ${S.tx.map((t) => `
    <div class="card row">
      <span>${esc(t[0])}</span>
      <b style="color:${t[1] < 0 ? 'var(--bad)' : 'var(--ok)'}">${t[1] < 0 ? '-' : '+'}${inr(Math.abs(t[1]))}</b>
    </div>
  `).join('')}`;
}

/* ========================================================
   SCREEN 8: CUSTOMER PROFILE & ADDRESS MANAGEMENT
   ======================================================== */
function pf() {
  const u = S.user || { name: 'Customer', phone: '9876543210', id: 1 };
  return `<button class="back" onclick="go('home')">← Wapas Home</button>
  <h2 style="font-size:22px">Aapka Profile</h2>

  <div class="card row" style="justify-content:flex-start">
    <div class="av">${esc(u.name[0].toUpperCase())}</div>
    <div>
      <b>${esc(u.name)}</b>
      <div class="mut">+91 ${esc(u.phone)} • ${esc(u.role)}</div>
    </div>
  </div>

  <div class="row" style="margin-top:20px">
    <h2 style="margin:0">Saved Addresses</h2>
    <button class="btn sm" style="width:auto;padding:6px 14px;font-size:12px" onclick="openAddAddressModal()">+ Add New</button>
  </div>

  ${S.addresses.length ? S.addresses.map((a) => {
    const full = a.address_line + (a.landmark ? ', ' + a.landmark : '') + ', ' + a.city;
    return `<div class="addr-item ${S.ad === full ? 'selected' : ''}">
      <div>
        <div style="font-weight:700;font-size:14px">${a.label === 'Home' ? '🏠' : a.label === 'Work' ? '🏢' : '📍'} ${esc(a.label)} ${a.is_default ? '<span class="badge ok" style="font-size:10px">Default</span>' : ''}</div>
        <div class="mut" style="font-size:13px;margin-top:2px">${esc(a.address_line)}</div>
        <div class="mut" style="font-size:11px">${esc(a.landmark || '')} ${esc(a.city)} - ${esc(a.pincode)}</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn sm ghost" style="width:auto;padding:4px 8px;font-size:11px" onclick="selectAddress(${JSON.stringify(a).replace(/"/g, '&quot;')})">Use</button>
        <button class="btn sm ghost" style="width:auto;padding:4px 8px;font-size:11px;color:var(--bad)" onclick="deleteAddress(${a.id})">${ic('trash', 14)}</button>
      </div>
    </div>`;
  }).join('') : '<div class="card mut">Koi saved address nahi hai. "+ Add New" par tap karein.</div>'}

  <!-- Available Offers & Coupons -->
  <h2 style="margin-top:20px">Available Offers</h2>
  ${S.coupons.length ? S.coupons.map((c) => `
    <div class="card row" style="margin-bottom:8px">
      <div>
        <b style="color:var(--sec)">${esc(c.code)}</b>
        <div class="mut" style="font-size:12px">${esc(c.title)}</div>
        <div class="mut" style="font-size:11px">Min order: ${inr(c.min_order_amount)} ${c.max_discount ? `• Max discount: ${inr(c.max_discount)}` : ''}</div>
      </div>
      <button class="btn sm ghost" style="width:auto;padding:4px 12px;font-size:12px" onclick="copyCoupon('${esc(c.code)}')">Copy</button>
    </div>
  `).join('') : '<div class="card mut">Abhi koi offer available nahi hai.</div>'}

  <h2>Refer & Earn</h2>
  <div class="card row">
    <div>
      <div>Aapka Referral Code:</div>
      <b style="font-size:18px;color:var(--teal)">FIX${String(u.id || 1).padStart(4, '0')}</b>
      <div class="mut" style="font-size:12px">Dost ko pehli booking par ₹50 cashback, aur aapko bhi ₹50.</div>
    </div>
    <button class="btn sm" style="width:auto;padding:8px 14px" onclick="copyCoupon('FIX${String(u.id || 1).padStart(4, '0')}')">Share</button>
  </div>

  <button class="btn acc" style="margin-top:20px" onclick="out()">Logout & Switch Account</button>`;
}

/* ========================================================
   SCREEN 9: WORKER APPLICATION SCREEN
   ======================================================== */
function setOnline(online) {
  act(async () => {
    const d = await api('POST', '/me/online', { online });
    S.user.online = d.online;
    render();
  });
}

function wk() {
  const u = S.user, on = u.online !== false;
  const open = S.B.filter((b) => b.status === 'requested');
  const mine = S.B.filter((b) => b.status !== 'requested' && b.status !== 'cancelled');

  return `<h2 style="font-size:22px;margin-top:20px">Technician Portal</h2>
  <div class="card row">
    <div>
      <b>${esc(u.name)}</b>
      <div class="mut">${esc(u.skill)} Expert</div>
    </div>
    <button class="btn sm ghost" onclick="out()">Logout</button>
  </div>
  <div class="card row">
    <span>Online (Naye job requests dekhein)</span>
    <button class="tg ${on ? 'on' : ''}" onclick="setOnline(${!on})" aria-label="Online toggle"></button>
  </div>
  <div class="hd" style="border-radius:22px;margin:0 0 12px">
    <div>Kamai (Wallet)</div>
    <b style="font-size:34px">${inr(S.w)}</b>
    <div style="font-size:13px">Har kaam pe 85% aapka, 15% platform ka</div>
  </div>
  <h2>Naye Requests</h2>
  ${on ? (open.length ? open.map(wcard).join('') : '<div class="card mut">Abhi koi naya request nahi mila.</div>') : '<div class="card mut">Aap offline hain. Jobs lene ke liye Online toggle karein.</div>'}
  <h2>Mere Active Jobs</h2>
  ${mine.length ? mine.map(wcard).join('') : '<div class="card mut">Abhi koi assigned kaam nahi hai.</div>'}`;
}

function wcard(b) {
  const a = b.status;
  const bt = (c, t) => `<button class="btn" style="margin-top:8px" onclick="${c}">${t}</button>`;

  return `<div class="card" style="margin-bottom:12px">
    <div class="row">
      <b>${esc(b.service)}</b>
      <span class="badge">${esc(b.label)}</span>
    </div>
    <div class="mut">${esc(b.slot)}, ${esc(b.address)}</div>
    ${b.issue_desc ? `<div class="card" style="background:var(--soft);border:none;padding:6px 10px;margin:6px 0;font-size:12px"><b>Customer Note:</b> ${esc(b.issue_desc)}</div>` : ''}
    ${b.contact_phone && a !== 'requested' ? `<a href="tel:${esc(b.contact_phone)}" class="btn sm" style="text-decoration:none;margin-top:10px;background:var(--sec);color:#fff">${ic('phone', 16)} Customer ko call karo (${esc(b.contact_phone)})</a>` : ''}
    ${a === 'requested' ? bt(`post(${b.id},'accept',null,'Job accept kiya')`, 'Accept Karo') : ''}
    ${a === 'assigned' ? bt(`post(${b.id},'on-the-way',null,'Customer ko bata diya')`, 'Main Nikal Gaya') : ''}
    ${a === 'on_the_way' ? `
      <input id="c${b.id}" type="tel" inputmode="numeric" maxlength="4" placeholder="Customer ka 4 digit start code" style="margin-top:8px">
      ${bt(`post(${b.id},'start',{code:$('c${b.id}').value.trim()},'Kaam shuru')`, 'Code Se Kaam Shuru Karo')}
    ` : ''}
    ${a === 'inspecting' ? `
      <input id="q${b.id}" type="number" min="0" placeholder="Parts ka kharcha (₹), 0 bhi chalega" style="margin-top:8px">
      <div class="mut" style="margin-bottom:8px">Service charge ${inr(b.price)} alag se judega.</div>
      ${bt(`post(${b.id},'quote',{parts:+$('q${b.id}').value||0},'Quote bhej diya')`, 'Quote Bhejo')}
    ` : ''}
    ${a === 'quoted' ? '<div class="mut" style="margin-top:8px">Customer ke manzoori ka intezaar hai...</div>' : ''}
    ${a === 'in_progress' ? bt(`post(${b.id},'complete',null,'Kaam poora')`, 'Kaam Poora Hua') : ''}
    ${a === 'completed' || a === 'closed' ? `<div class="mut" style="margin-top:8px">${b.paid ? 'Payment mil gayi, aapka hissa wallet mein jud gaya.' : 'Customer ke payment ka intezaar hai.'}</div>` : ''}
  </div>`;
}

/* ========================================================
   MODALS: ADDRESSES, RESCHEDULE, AND REVIEWS
   ======================================================== */
function openAddressModal() {
  S.modal = 'addresses';
  render();
}

function openAddAddressModal() {
  S.modal = 'addAddress';
  render();
}

function openRescheduleModal(id) {
  S.rescheduleBookingId = id;
  S.rescheduleSlot = SL[0];
  S.modal = 'reschedule';
  render();
}

function openReviewModal(id) {
  S.reviewBookingId = id;
  S.reviewRating = 5;
  S.reviewComment = '';
  S.modal = 'review';
  render();
}

function closeModal() {
  S.modal = null;
  render();
}

function selectAddress(addr) {
  const full = addr.address_line + (addr.landmark ? ', ' + addr.landmark : '') + ', ' + addr.city;
  S.ad = full;
  S.activeAddrId = addr.id;
  S.modal = null;
  render();
  toast('Address set: ' + addr.label);
}

function saveNewAddress() {
  const lbl = ($('new-addr-label')?.value || 'Home').trim();
  const line = ($('new-addr-line')?.value || '').trim();
  const lmark = ($('new-addr-lmark')?.value || '').trim();
  const cty = ($('new-addr-city')?.value || 'Dhanbad').trim();
  const pin = ($('new-addr-pin')?.value || '826001').trim();
  const isDef = $('new-addr-def')?.checked ? 1 : 0;

  if (!line) {
    toast('Address line likhna zaruri hai');
    return;
  }

  act(async () => {
    const res = await api('POST', '/addresses', {
      label: lbl,
      address_line: line,
      landmark: lmark,
      city: cty,
      pincode: pin,
      is_default: isDef
    });
    await refresh();
    selectAddress(res.address);
    toast('Address save ho gaya');
  });
}

function deleteAddress(id) {
  if (!confirm('Kya aap is address ko delete karna chahte hain?')) return;
  act(async () => {
    await api('DELETE', `/addresses/${id}`);
    await refresh();
    render();
    toast('Address delete kar diya');
  });
}

function submitReschedule() {
  const id = S.rescheduleBookingId;
  const slot = S.rescheduleSlot || SL[0];
  act(async () => {
    await api('POST', `/bookings/${id}/reschedule`, { slot });
    await refresh();
    closeModal();
    toast('Time slot reschedule ho gaya');
  });
}

function setReviewRating(r) {
  S.reviewRating = r;
  render();
}

function submitReview() {
  const id = S.reviewBookingId;
  const rating = S.reviewRating || 5;
  const comment = ($('review-comment')?.value || '').trim();

  act(async () => {
    await api('POST', '/reviews', {
      booking_id: id,
      rating,
      comment
    });
    await refresh();
    closeModal();
    toast('Shukriya! Review submit ho gaya ⭐');
  });
}

function renderModal() {
  if (!S.modal) return '';

  if (S.modal === 'addresses') {
    return `<div class="modal-overlay" onclick="closeModal()">
      <div class="modal-sheet" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>Delivery Address Chunein</h3>
          <button class="modal-close" onclick="closeModal()">×</button>
        </div>
        ${S.addresses.length ? S.addresses.map((a) => {
          const full = a.address_line + (a.landmark ? ', ' + a.landmark : '') + ', ' + a.city;
          const isSel = S.ad === full;
          return `<div class="addr-item ${isSel ? 'selected' : ''}" onclick="selectAddress(${JSON.stringify(a).replace(/"/g, '&quot;')})">
            <div>
              <b style="font-size:14px">${a.label === 'Home' ? '🏠' : a.label === 'Work' ? '🏢' : '📍'} ${esc(a.label)}</b>
              <div class="mut" style="font-size:13px">${esc(a.address_line)}</div>
              <div class="mut" style="font-size:11px">${esc(a.landmark || '')} ${esc(a.city)}</div>
            </div>
            ${isSel ? '<span class="badge ok">Selected</span>' : '<button class="btn sm ghost" style="width:auto;padding:4px 10px;font-size:11px">Chuno</button>'}
          </div>`;
        }).join('') : '<div class="card mut">Abhi koi address save nahi hai.</div>'}
        <button class="btn acc" style="margin-top:14px" onclick="openAddAddressModal()">+ Naya Address Jodein</button>
      </div>
    </div>`;
  }

  if (S.modal === 'addAddress') {
    return `<div class="modal-overlay" onclick="closeModal()">
      <div class="modal-sheet" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>Naya Address Jodein</h3>
          <button class="modal-close" onclick="closeModal()">×</button>
        </div>
        <label style="font-size:13px;font-weight:700">Type</label>
        <select id="new-addr-label" style="margin:6px 0 12px;padding:12px;border-radius:12px;border:1.5px solid var(--bd);width:100%;background:var(--card)">
          <option value="Home">🏠 Home</option>
          <option value="Work">🏢 Office / Work</option>
          <option value="Other">📍 Other</option>
        </select>
        <label style="font-size:13px;font-weight:700">Pata (House No, Building, Gali)</label>
        <input id="new-addr-line" placeholder="e.g. Flat 302, Green Valley Apartments" style="margin:6px 0 12px">
        <label style="font-size:13px;font-weight:700">Landmark</label>
        <input id="new-addr-lmark" placeholder="e.g. Near City Center Chowk" style="margin:6px 0 12px">
        <div class="row">
          <div style="flex:1">
            <label style="font-size:13px;font-weight:700">Shahar</label>
            <input id="new-addr-city" value="Dhanbad" style="margin:6px 0 12px">
          </div>
          <div style="flex:1">
            <label style="font-size:13px;font-weight:700">Pincode</label>
            <input id="new-addr-pin" value="826001" style="margin:6px 0 12px">
          </div>
        </div>
        <label class="row" style="justify-content:flex-start;gap:8px;margin-bottom:16px;cursor:pointer">
          <input type="checkbox" id="new-addr-def" checked style="width:auto;margin:0">
          <span style="font-size:13px">Default address banayein</span>
        </label>
        <button class="btn acc" onclick="saveNewAddress()">Save Karein</button>
      </div>
    </div>`;
  }

  if (S.modal === 'reschedule') {
    return `<div class="modal-overlay" onclick="closeModal()">
      <div class="modal-sheet" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>Time Slot Badlein (Reschedule)</h3>
          <button class="modal-close" onclick="closeModal()">×</button>
        </div>
        <div class="mut" style="font-size:13px;margin-bottom:14px">Apni suvidha ke anusaar naya time slot chunein:</div>
        <div class="chips" style="flex-direction:column;gap:8px;overflow:visible">
          ${SL.map((s) => `
            <button class="chip ${S.rescheduleSlot === s ? 'on' : ''}" style="width:100%;text-align:left;padding:12px 16px" onclick="S.rescheduleSlot='${esc(s)}';render()">
              ${esc(s)}
            </button>
          `).join('')}
        </div>
        <button class="btn acc" style="margin-top:16px" onclick="submitReschedule()">Reschedule Confirm Karein</button>
      </div>
    </div>`;
  }

  if (S.modal === 'review') {
    return `<div class="modal-overlay" onclick="closeModal()">
      <div class="modal-sheet" onclick="event.stopPropagation()">
        <div class="modal-header">
          <h3>Service Rating & Feedback</h3>
          <button class="modal-close" onclick="closeModal()">×</button>
        </div>
        <div class="mut" style="text-align:center;font-size:13px">Kaam kaisa laga? Star rating chunein:</div>
        <div class="star-rating-row">
          ${[1, 2, 3, 4, 5].map((r) => `
            <button class="star-btn ${S.reviewRating >= r ? 'active' : ''}" onclick="setReviewRating(${r})">★</button>
          `).join('')}
        </div>
        <div style="text-align:center;font-weight:800;color:var(--sec);margin-bottom:12px">${S.reviewRating}/5 Stars</div>
        <label style="font-size:13px;font-weight:700">Aapka Anubhav / Review</label>
        <textarea id="review-comment" placeholder="Worker ka kaam, time aur vyavhaar kaisa tha? (e.g. Bohot jaldi aur acche se solve kiya)" rows="3" style="width:100%;padding:12px;border-radius:14px;border:1.5px solid var(--bd);background:var(--card);color:var(--ink);font:inherit;margin:6px 0 16px"></textarea>
        <button class="btn acc" onclick="submitReview()">Review Submit Karein</button>
      </div>
    </div>`;
  }

  return '';
}

/* ========================================================
   DIAGNOSIS & SEARCH HELPER
   ======================================================== */
const KW = [
  [/gas|thanda|cooling/i, 7],
  [/\bac\b|air con/i, 6],
  [/tv|screen|display/i, 8],
  [/fan/i, 1],
  [/inverter|wiring/i, 2],
  [/switch|socket|light|bijli|current|short/i, 0],
  [/leak|tap|nal|pipe|paani/i, 3],
  [/tank/i, 5],
  [/bathroom|shower/i, 4],
  [/bike|car|gaadi|engine|brake|puncture/i, 10],
  [/padh|tuition|maths|science|class|english|coding/i, 12]
];

function diag() {
  const v = $('pb')?.value.trim();
  if (!v) {
    toast('Pehle dikkat likho');
    return;
  }
  const m = KW.find((k) => k[0].test(v));
  const dg = $('dg');
  if (!dg) return;
  if (m && SV[m[1]]) {
    const s = SV[m[1]];
    dg.innerHTML = `<div class="card" style="margin:10px 0 0;border-color:var(--sec)">
      <b>${ic(s.e, 18)} ${esc(s.n)}</b>
      <div class="mut">Andaza: ${inr(s.p)} se ${inr(s.p * 1.6)} (final quote worker dekh ke dega)</div>
      <button class="btn sm acc" style="margin-top:8px" onclick="pick(${m[1]})">Book karo</button>
    </div>`;
  } else {
    dg.innerHTML = '<div class="mut" style="margin-top:8px">Samajh nahi aaya. Neeche category mein se chun lo ya AI Assistant se pucho.</div>';
  }
}

/* ========================================================
   BACKEND API & DATA SYNC
   ======================================================== */
function getApiBase() {
  let b = '';
  try { b = localStorage.getItem('fm_api_base'); } catch (e) {}
  if (!b) b = window.API_BASE_URL || '';
  return String(b).trim().replace(/\/+$/, '');
}

function setCustomServerUrl() {
  const cur = getApiBase() || 'http://192.168.101.24:3000';
  const u = prompt('FixMate Backend Server URL daalein (e.g. http://192.168.101.24:3000):', cur);
  if (u !== null && u.trim()) {
    localStorage.setItem('fm_api_base', u.trim());
    window.API_BASE_URL = u.trim();
    toast('Server URL save ho gaya: ' + u.trim());
    setTimeout(() => location.reload(), 800);
  }
}

async function api(m, p, b) {
  const API = getApiBase();
  if (!API && (window.Capacitor?.isNativePlatform() || location.protocol === 'file:'))
    throw new Error('API_BASE_URL configure nahi hai. Hosted HTTPS ya Wi-Fi IP set karein.');
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
  let r;
  try {
    r = await fetch(API + '/api' + p, {
      method: m,
      headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
      body: b ? JSON.stringify(b) : undefined,
      signal: controller.signal
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Backend se response nahi mila. Thodi der baad try karo.');
    throw new Error('Backend se connection nahi hua. Check karein backend server chal raha hai aur phone same Wi-Fi pe hai.');
  } finally {
    clearTimeout(timeout);
  }
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && S.token) {
    if (S.scr !== 'splash') out();
    else { S.token = null; S.user = null; try { localStorage.removeItem('fm_auth'); } catch (err) {} }
    throw new Error('Dobara login karo');
  }
  if (!r.ok) {
    const e = new Error(d.message || (r.status === 503 ? 'Backend service abhi available nahi hai' : r.status >= 500 ? 'Backend error occurred' : `Request fail hui (${r.status})`));
    e.data = d;
    throw e;
  }
  return d;
}

async function act(fn) {
  try {
    await fn();
  } catch (e) {
    toast(e.message);
  }
}

async function refresh() {
  if (!S.user) return;
  try {
    const [w, b, addrRes, cpnRes] = await Promise.all([
      api('GET', '/wallet'),
      api('GET', '/bookings'),
      S.user.role === 'customer' ? api('GET', '/addresses').catch(() => ({ addresses: [] })) : Promise.resolve({ addresses: [] }),
      api('GET', '/coupons').catch(() => ({ coupons: [] }))
    ]);
    S.w = w.balance;
    S.tx = w.transactions.map((t) => [t.label, t.amount]);
    S.B = b.bookings;
    S.addresses = addrRes.addresses || [];
    S.coupons = cpnRes.coupons || [];

    // Auto-select default address if none chosen
    if (!S.ad && S.addresses.length) {
      const def = S.addresses.find((a) => a.is_default) || S.addresses[0];
      S.ad = def.address_line + (def.landmark ? ', ' + def.landmark : '') + ', ' + def.city;
      S.activeAddrId = def.id;
    }
  } catch (e) {
    // Failsafe quiet refresh
  }
}

function post(id, path, body, msg) {
  act(async () => {
    await api('POST', `/bookings/${id}/${path}`, body || {});
    await refresh();
    render();
    if (msg) toast(msg);
  });
}

function cancelBook(id) {
  if (!confirm('Kya aap is booking ko cancel karna chahte hain? Free cancellation policy lagu hai.')) return;
  post(id, 'cancel', null, 'Booking cancel kar di gayi');
}

function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Razorpay Checkout load nahi hua. Internet check karo.'));
    document.head.appendChild(script);
  });
}

function onlinePay(id) {
  act(async () => {
    const { order, keyId } = await api('POST', `/bookings/${id}/payment/order`, {});
    await loadRazorpay();
    const checkout = new window.Razorpay({
      key: keyId,
      amount: order.amount,
      currency: order.currency,
      name: BRAND,
      description: 'FixMate service payment',
      order_id: order.id,
      handler: async (response) => {
        try {
          await api('POST', `/bookings/${id}/payment/verify`, response);
          await refresh();
          render();
          toast('Online payment verify ho gaya!');
        } catch (e) {
          toast(e.message);
        }
      },
      modal: { ondismiss: () => toast('Payment cancel ho gaya') }
    });
    checkout.on('payment.failed', () => toast('Payment fail hui. Dobara try karo.'));
    checkout.open();
  });
}

function topup(a) {
  act(async () => {
    await api('POST', '/wallet/topup', { amount: a });
    await refresh();
    render();
    toast(inr(a) + ' wallet mein jud gaye');
  });
}

/* ========================================================
   RENDER DISPATCHER
   ======================================================== */
function render() {
  const a = $('app');
  document.querySelectorAll('.ni').forEach((e) => e.innerHTML = ic(e.dataset.i, 22));

  if (S.scr === 'splash') {
    a.innerHTML = splash();
  } else if (S.scr === 'onboarding') {
    a.innerHTML = onboarding();
  } else if (S.scr === 'login' || !S.user) {
    a.innerHTML = login();
  } else {
    a.innerHTML = ({ home, book, bk, mo, wk, pf }[S.scr] || home)() + renderModal();
  }

  $('n-home').classList.toggle('on', S.scr === 'home' || S.scr === 'book');
  $('n-bk').classList.toggle('on', S.scr === 'bk');
  $('n-mo').classList.toggle('on', S.scr === 'mo');
  if ($('n-pf')) $('n-pf').classList.toggle('on', S.scr === 'pf');
  const actCount = S.B.filter((b) => !b.paid && b.status !== 'cancelled').length;
  const o = document.querySelector('#n-bk .dot');
  if (o) o.remove();
  if (actCount) $('n-bk').insertAdjacentHTML('beforeend', `<span class="dot">${actCount}</span>`);

  const showNav = S.user && S.user.role === 'customer' && !['splash', 'onboarding', 'login'].includes(S.scr);
  document.querySelector('.nav').style.display = showNav ? '' : 'none';
}

let _lastHash = '';
function dataHash() {
  return JSON.stringify({
    s: S.scr,
    w: S.w,
    m: S.modal,
    o: S.user?.online,
    b: S.B.map((b) => [b.id, b.status, b.paid, b.total, b.contact_phone, b.customer_rating]),
    t: S.tx.length
  });
}

setInterval(() => {
  if (S.user && ['bk', 'wk', 'mo'].includes(S.scr) && !document.hidden && !S.modal && !(document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName))) {
    refresh().then(() => {
      const h = dataHash();
      if (h !== _lastHash) {
        _lastHash = h;
        render();
      }
    }).catch(() => {});
  }
}, 4000);

/* ========================================================
   APPLICATION BOOTSTRAP (Splash -> Onboarding -> Login -> Home)
   ======================================================== */
(async () => {
  S.scr = 'splash';
  render();

  const urlParams = new URLSearchParams(location.search);
  const forceReset = urlParams.has('reset') || location.hash === '#login';
  if (forceReset) {
    try { localStorage.removeItem('fm_auth'); localStorage.removeItem('fm_onboarded'); } catch (e) {}
  }

  // 1. Check local session
  let hasStoredSession = false;
  try {
    const a = JSON.parse(localStorage.getItem('fm_auth') || 'null');
    if (a && a.t) {
      S.token = a.t;
      S.user = a.u;
      hasStoredSession = true;
    }
  } catch (e) {}

  // 2. Verify session with backend /api/me
  if (hasStoredSession) {
    try {
      const me = await api('GET', '/me');
      S.user = me.user;
      S.w = me.wallet;
    } catch (e) {
      S.token = null;
      S.user = null;
      try { localStorage.removeItem('fm_auth'); } catch (err) {}
    }
  }

  // 3. Fetch categories & services catalog from backend
  try {
    const [catData, svcData] = await Promise.all([
      api('GET', '/categories').catch(() => null),
      api('GET', '/services').catch(() => null)
    ]);

    if (catData && catData.categories && catData.categories.length) {
      CATS = catData.categories.map((c) => c.name);
    }

    if (svcData && svcData.services && svcData.services.length) {
      SV = svcData.services.map((s) => ({
        id: s.id,
        c: s.cat,
        n: s.name,
        p: s.price,
        r: s.rating || 4.8,
        k: '5k+',
        e: getCatIcon(s.cat)
      }));
    }
  } catch (e) {}

  // 4. If session valid, fetch bookings, wallet, addresses, coupons
  if (S.user) {
    try { await refresh(); } catch (e) {}
  }

  // 5. Navigate after smooth Splash duration
  setTimeout(() => {
    if (S.user) {
      go(S.user.role === 'worker' ? 'wk' : 'home');
    } else {
      const onboarded = localStorage.getItem('fm_onboarded');
      if (!onboarded) {
        S.obStep = 0;
        go('onboarding');
      } else {
        go('login');
      }
    }
  }, 1800);
})();
