# Acoustic Pest Monitor

ESP32 + INMP441 -> HTTPS Vercel API -> Firebase Realtime Database (recording metadata + base64 WAV audio) -> React dashboard with Google sign-in and playback. No Firebase Storage and no Firestore are used. Classification is **Pending AI analysis** until a real trained model is integrated.

## Firebase setup
1. Create a Firebase project at https://console.firebase.google.com/.
2. Build -> Realtime Database -> Create Database. Choose a region and start in locked/production mode. Copy the database URL shown in the console.
3. Build -> Authentication -> Sign-in method -> enable **Google**. Configure the support email and save.
4. Authentication -> Settings -> Authorized domains: ensure `localhost` and your Vercel domain are listed.
5. Project settings -> General -> register a Web app and copy the config.
6. Project settings -> Service accounts -> generate a private service-account key. Keep it secret.
7. Realtime Database -> Rules: publish `firebase/database.rules.json`.

## Local setup
1. Copy `.env.example` to `.env.local`.
2. Fill the web config, `NEXT_PUBLIC_FIREBASE_DATABASE_URL`, service-account `client_email`, `private_key`, project ID, and a long random `DEVICE_UPLOAD_TOKEN`. The public and server database URL values should match.
3. Run `npm install`, then `npm run dev` and open http://localhost:3000.
4. Sign in with Google and test the dashboard.
5. In Vercel set every variable from `.env.local`, deploy, and copy the HTTPS deployment URL.

## ESP32
Open `firmware/AcousticPestMonitor.ino` in Arduino IDE, install ESP32 board support, fill Wi-Fi SSID/password, Vercel URL and same device token. Wire INMP441 VDD->3V3, GND->GND, SCK->GPIO26, WS->GPIO25, SD->GPIO33, L/R->GND. Firmware uploads 3-second, 16kHz, mono 16-bit PCM WAV files (~96KB).

## Storage design and limits
To avoid Firebase Storage, this prototype stores each WAV file as a base64 string under `audio/{id}` in Realtime Database and stores metadata separately under `recordings/{id}`. Base64 increases the file size by roughly one-third. This is suitable for a small demo, not a large or long-running audio archive. Monitor your Realtime Database usage and free-tier quotas; keep clips short and delete old audio. Audio nodes are not readable directly by dashboard clients; playback goes through an authenticated API route. Admin SDK credentials remain server-only. Do not commit `.env.local` or service-account keys.

Firmware currently uses `client.setInsecure()` for prototype compatibility: HTTPS is encrypted but server identity is not verified. Add CA certificate validation before production, plus rate limits and per-device credentials before public use.

## AI status
The current build stores and plays audio only. Realtime Database classification stays `Pending AI analysis`; no pest names are inferred from loudness. A trained classifier and labelled recordings are required to identify the 15 target pests.
