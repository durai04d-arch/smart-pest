
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// =================================================
// 1. WIFI CONFIGURATION
// =================================================
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// =================================================
// 2. FIREBASE CONFIGURATION
// =================================================
const char* FIREBASE_API_KEY = "YOUR_FIREBASE_WEB_API_KEY";
const char* FIREBASE_EMAIL = "YOUR_DEVICE_ACCOUNT_EMAIL";
const char* FIREBASE_PASSWORD = "YOUR_DEVICE_ACCOUNT_PASSWORD";

const char* DATABASE_URL =
  "https://smartattendance-7923-default-rtdb.asia-southeast1.firebasedatabase.app";

// =================================================
// 3. MFRC522 RFID PINS
// =================================================
#define RFID_SS    5
#define RFID_RST   4
#define RFID_SCK   18
#define RFID_MISO  19
#define RFID_MOSI  23

MFRC522 rfid(RFID_SS, RFID_RST);

// =================================================
// 4. LED AND BUZZER PINS
// =================================================
#define GREEN_LED 25
#define RED_LED   26
#define BUZZER    27

// =================================================
// 5. OLED CONFIGURATION
// =================================================
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
#define OLED_ADDRESS 0x3C

Adafruit_SSD1306 display(
  SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET
);

// =================================================
// 6. FIREBASE AUTH STATE
// =================================================
String idToken = "";
unsigned long tokenExpiry = 0;

// Duplicate-scan protection
String lastUID = "";
unsigned long lastScanTime = 0;
const unsigned long DUPLICATE_DELAY = 3000;

// =================================================
// 7. OLED MESSAGE
// =================================================
void showMessage(String line1, String line2 = "") {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);

  display.setCursor(0, 12);
  display.println(line1);

  display.setCursor(0, 30);
  display.println(line2);

  display.display();
}

// =================================================
// 8. BUZZER AND LED SIGNALS
// =================================================
void beep(int frequency, int durationMs) {
  tone(BUZZER, frequency, durationMs);
  delay(durationMs + 30);
  noTone(BUZZER);
}

void approvedSignal() {
  digitalWrite(RED_LED, LOW);
  digitalWrite(GREEN_LED, HIGH);

  beep(2000, 120);

  delay(700);
  digitalWrite(GREEN_LED, LOW);
}

void rejectedSignal() {
  digitalWrite(GREEN_LED, LOW);
  digitalWrite(RED_LED, HIGH);

  beep(700, 180);
  beep(700, 180);

  delay(300);
  digitalWrite(RED_LED, LOW);
}

// =================================================
// 9. WIFI CONNECTION
// =================================================
bool connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }

  Serial.println("Connecting to Wi-Fi...");
  showMessage("Connecting WiFi");

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();

  while (WiFi.status() != WL_CONNECTED &&
         millis() - start < 20000) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("Wi-Fi connected");
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());
    return true;
  }

  Serial.println("Wi-Fi connection failed");
  showMessage("WiFi Failed", "Check credentials");
  return false;
}

// =================================================
// 10. FIREBASE EMAIL/PASSWORD LOGIN
// =================================================
bool firebaseLogin() {
  if (!connectWiFi()) {
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure(); // Prototype only. Validate TLS in production.

  HTTPClient https;

  String url =
    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key="
    + String(FIREBASE_API_KEY);

  if (!https.begin(client, url)) {
    Serial.println("Cannot connect to Firebase Authentication");
    return false;
  }

  https.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> request;
  request["email"] = FIREBASE_EMAIL;
  request["password"] = FIREBASE_PASSWORD;
  request["returnSecureToken"] = true;

  String body;
  serializeJson(request, body);

  int httpCode = https.POST(body);
  String response = https.getString();

  https.end();

  if (httpCode != 200) {
    Serial.printf("Firebase login HTTP: %d\n", httpCode);
    Serial.println(response);
    return false;
  }

  StaticJsonDocument<2048> result;
  DeserializationError error = deserializeJson(result, response);

  if (error || !result["idToken"].is<const char*>()) {
    Serial.println("Could not read Firebase token");
    return false;
  }

  idToken = result["idToken"].as<String>();

  String expires = result["expiresIn"] | "3600";
  tokenExpiry = millis() + expires.toInt() * 1000UL;

  Serial.println("Firebase login successful");
  return true;
}

// =================================================
// 11. ENSURE TOKEN IS VALID
// =================================================
bool ensureFirebaseLogin() {
  if (idToken.length() > 0 &&
      (long)(tokenExpiry - millis()) > 60000) {
    return true;
  }

  idToken = "";
  return firebaseLogin();
}

// =================================================
// 12. SEND ONLY UID TO /scannedUIDs
// =================================================
bool sendUID(String uid) {
  if (!ensureFirebaseLogin()) {
    Serial.println("Cannot upload UID: login failed");
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure(); // Prototype only. Validate TLS in production.

  HTTPClient https;

  String url = String(DATABASE_URL) +
               "/scannedUIDs.json?auth=" + idToken;

  if (!https.begin(client, url)) {
    Serial.println("Database connection failed");
    return false;
  }

  https.addHeader("Content-Type", "application/json");

  // ONLY the RFID UID is sent in this record.
  StaticJsonDocument<128> document;
  document["uid"] = uid;

  String body;
  serializeJson(document, body);

  Serial.print("Uploading JSON: ");
  Serial.println(body);

  int httpCode = https.POST(body);
  String response = https.getString();

  https.end();

  Serial.printf("UID upload HTTP status: %d\n", httpCode);

  if (httpCode == 200) {
    Serial.println("UID uploaded successfully");
    return true;
  }

  Serial.println("UID upload failed:");
  Serial.println(response);
  return false;
}

// =================================================
// 13. CHECK CARD APPROVAL IN /cards/{UID}
// =================================================
// The website stores card information at /cards/{UID}.
// Example: /cards/04A12BC3
//
// Only status == "approved" is accepted.
// Missing or rejected records are denied.

bool isCardApproved(String uid) {
  if (!ensureFirebaseLogin()) {
    Serial.println("Cannot check approval: login failed");
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure(); // Prototype only. Validate TLS in production.

  HTTPClient https;

  String url = String(DATABASE_URL) +
               "/cards/" + uid + ".json?auth=" + idToken;

  if (!https.begin(client, url)) {
    Serial.println("Approval request could not start");
    return false;
  }

  int httpCode = https.GET();
  String response = https.getString();

  https.end();

  Serial.printf("Approval check HTTP status: %d\n", httpCode);
  Serial.print("Approval response: ");
  Serial.println(response);

  if (httpCode != 200) {
    Serial.println("Approval check failed; denying card");
    return false;
  }

  if (response == "null" || response.length() == 0) {
    Serial.println("Card is not registered");
    return false;
  }

  StaticJsonDocument<1024> document;
  DeserializationError error = deserializeJson(document, response);

  if (error) {
    Serial.println("Cannot parse card details");
    return false;
  }

  const char* status = document["status"] | "";

  return String(status) == "approved";
}

// =================================================
// 14. READ RFID UID
// =================================================
String readUID() {
  String uid = "";

  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) {
      uid += "0";
    }

    uid += String(rfid.uid.uidByte[i], HEX);
  }

  uid.toUpperCase();
  return uid;
}

// =================================================
// 15. RFID SCANNING
// =================================================
void scanRFID() {
  if (!rfid.PICC_IsNewCardPresent()) {
    return;
  }

  if (!rfid.PICC_ReadCardSerial()) {
    return;
  }

  String uid = readUID();

  Serial.println();
  Serial.println("========================");
  Serial.print("RFID UID: ");
  Serial.println(uid);

  unsigned long now = millis();

  if (uid == lastUID &&
      now - lastScanTime < DUPLICATE_DELAY) {
    Serial.println("Duplicate scan ignored");

    showMessage("Please wait", uid);

    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    return;
  }

  lastUID = uid;
  lastScanTime = now;

  showMessage("Card detected", uid);

  // Upload only the UID first.
  bool uploaded = sendUID(uid);

  if (!uploaded) {
    Serial.println("Upload failed; card not accepted");
    showMessage("Upload Failed", "Check WiFi/Firebase");
    rejectedSignal();

    rfid.PICC_HaltA();
    rfid.PCD_StopCrypto1();
    return;
  }

  // Then read the administrator's approval decision.
  showMessage("Checking card", uid);

  bool approved = isCardApproved(uid);

  if (approved) {
    Serial.println("RESULT: APPROVED");
    showMessage("ACCESS GRANTED", uid);
    approvedSignal();
  } else {
    Serial.println("RESULT: NOT APPROVED");
    showMessage("ACCESS DENIED", uid);
    rejectedSignal();
  }

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();

  Serial.println("========================");
}

// =================================================
// 16. SETUP
// =================================================
void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(GREEN_LED, OUTPUT);
  pinMode(RED_LED, OUTPUT);
  pinMode(BUZZER, OUTPUT);

  digitalWrite(GREEN_LED, LOW);
  digitalWrite(RED_LED, LOW);
  digitalWrite(BUZZER, LOW);

  // OLED I2C pins
  Wire.begin(21, 22);

  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS)) {
    Serial.println("OLED initialization failed");
    while (true) {
      delay(1000);
    }
  }

  showMessage("RFID Attendance", "Starting...");

  // RFID SPI pins
  SPI.begin(RFID_SCK, RFID_MISO, RFID_MOSI, RFID_SS);
  rfid.PCD_Init();
  delay(100);

  Serial.println("MFRC522 initialized");
  rfid.PCD_DumpVersionToSerial();

  showMessage("Connecting WiFi");
  connectWiFi();

  if (WiFi.status() == WL_CONNECTED) {
    showMessage("Firebase login");

    if (firebaseLogin()) {
      showMessage("Firebase Ready", "Scan RFID card");
    } else {
      showMessage("Firebase Error", "Check credentials");
    }
  }

  delay(1000);
  showMessage("Ready to Scan", "Tap your RFID card");
}

// =================================================
// 17. MAIN LOOP
// =================================================
void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  scanRFID();
  delay(30);
}
