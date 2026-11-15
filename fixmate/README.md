# FixMate Android App

The Android app wraps the existing client with Capacitor. The app ID is currently `in.fixmate.app`; choose a unique final ID before the first Play Store release.

## Configure the backend

Deploy the API from the `server` directory to a public HTTPS URL first. The Android app cannot call `localhost` on your computer. Copy `.env.example` to `.env` in this project root and set `API_BASE_URL` to the backend origin only, without `/api` at the end:

```dotenv
API_BASE_URL=https://api.your-domain.in
```

`npm run android:sync` reads this value and writes it to the ignored `client/config.js` file before copying the web app into Android. The app calls `POST /api/auth/otp/send` with `{ "phone": "9000000001" }`; verification remains `POST /api/auth/otp/verify`.

The server must also have production `JWT_SECRET`, `CLIENT_ORIGIN` including `https://localhost`, and Twilio `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE_NUMBER` configured. Without SMS credentials, OTP send returns `503`; Twilio rejection/network errors return `502`. Use persistent storage for SQLite (set `DB_PATH`) or a persistent database service. Wallet top-ups remain demo-only until a payment provider is integrated.

## Build on Windows

Install Android Studio with the Android SDK and a supported JDK, then from this directory run:

```powershell
npm install
Copy-Item .env.example .env
# Set API_BASE_URL in .env before syncing/building the Android app.
npm run icons:generate
npm run android:sync
npm run android:open
```

In Android Studio, build a signed Android App Bundle (`.aab`) and test it on a real device.

## Before Play Store submission

- Configure and test Twilio OTP delivery and payment processing.
- Use persistent production storage, backups, HTTPS, and production secrets.
- Add worker identity verification and support/reporting flows.
- Publish a privacy policy and complete Play Console Data safety, content rating, screenshots, and store listing.
- Create and protect the release signing key. Never commit it to the repository.
- Check current Play Console account and testing requirements before submission.