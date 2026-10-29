# Acoustic Pest Monitor — HTML/CSS/JavaScript

This version uses plain HTML, CSS and browser JavaScript for the dashboard. It uses Firebase Google Authentication and Firebase Realtime Database only. It does **not** use Cloud Firestore or Firebase Storage. WAV bytes are stored as Base64 in Realtime Database, so keep clips short and monitor free-tier quotas.

## 1. Firebase setup
1. Create a Firebase project and register a Web app.
2. Build → Authentication → Sign-in method → enable Google.
3. Build → Realtime Database → Create database. Copy its exact URL.
4. Authentication → Settings → Authorized domains: add `localhost` and your Vercel domain.
5. Realtime Database → Rules: publish the contents of `firebase-rtdb-rules.json`.
6. Project settings → Service accounts: generate a private key for server-side API use. Never commit it.

## 2. Configure dashboard
Edit `app.js`, replace all `YOUR_...` placeholders in `firebaseConfig` with your Firebase Web App values. `databaseURL` must be the exact Realtime Database URL from the console.

## 3. Run locally
Use Node.js 18+:
```bash
npm install
npx vercel dev
```
Open the local URL shown by Vercel. The API needs the server environment variables in `.env` or your Vercel local environment. For just UI preview, a static server can serve `index.html`, but device uploads require the Vercel API.

## 4. Deploy
Import this folder/repository into Vercel. Add all variables from `.env.example` under Project → Settings → Environment Variables. Redeploy. Do not place server-side values in `app.js`.

## 5. Device upload endpoint
ESP32 sends raw WAV bytes to `POST https://YOUR-VERCEL-DOMAIN/api/device-upload` with headers:
- `Content-Type: audio/wav`
- `X-Device-Token: same value as DEVICE_UPLOAD_TOKEN`
- `X-Device-Id: ESP32-INMP441` (optional)

The API stores metadata under `/recordings/{id}` and Base64 audio under `/audio/{id}/base64`. This design uses no Firebase Storage. It currently accepts WAV files up to 500 KB. The firmware must send raw WAV bytes, not JSON.

## Security notes
- Realtime Database client rules allow authenticated reads only; all client writes are denied. Server Admin SDK bypasses rules.
- API device token is a prototype shared secret. Rotate it if exposed. For production, use certificate validation and stronger device authentication.
- Dashboard currently allows any Google-authenticated account to read records. Restrict by an explicit allowlist or custom claims before production.
- Google sign-in uses a popup; serve over HTTPS in production.
- This prototype does not perform pest AI classification. Classification remains “Pending AI analysis.”
