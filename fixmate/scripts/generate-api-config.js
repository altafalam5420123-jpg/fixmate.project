const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');

const root = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(root, '.env') });

const value = String(process.env.API_BASE_URL || '').trim().replace(/\/+$/, '');
if (!value || /your-hosted-backend-url/i.test(value)) {
  console.error('Set API_BASE_URL to the deployed HTTPS backend URL in the project .env file.');
  process.exit(1);
}

let apiUrl;
try {
  apiUrl = new URL(value);
} catch {
  console.error('API_BASE_URL must be a valid absolute HTTPS URL.');
  process.exit(1);
}

if (apiUrl.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(apiUrl.hostname)
  || apiUrl.search || apiUrl.hash || apiUrl.username || apiUrl.password) {
  console.error('Android API_BASE_URL must use HTTPS and cannot point to localhost.');
  process.exit(1);
}

const output = `window.API_BASE_URL = ${JSON.stringify(apiUrl.origin + apiUrl.pathname.replace(/\/+$/, ''))};\n`;
fs.writeFileSync(path.join(root, 'client', 'config.js'), output);
console.log(`Configured Android API base: ${apiUrl.origin}`);