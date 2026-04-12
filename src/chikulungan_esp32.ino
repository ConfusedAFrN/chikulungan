#include <WiFi.h>
#include <FirebaseESP32.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <time.h>
#include <AccelStepper.h>
#include <HardwareSerial.h>

// ===== RTC + Flash cache (offline schedules) =====
#include <Preferences.h>
#include <ThreeWire.h>
#include <RtcDS1302.h>

// ========================
// WiFi
// ========================
const char* ssid = "Sleep na";
const char* password = "87654321";

// ========================
// Firebase
// ========================
#define FIREBASE_HOST "https://chikulungan-app-default-rtdb.asia-southeast1.firebasedatabase.app"
#define FIREBASE_AUTH "VIiZIdPvP43gjxHlofD39dSTlUqBF2lXdWrMEZH7"

// ========================
// MQTT
// ========================
const char* mqtt_server = "broker.emqx.io";

// ========================
// DHT (DHT22)
// ========================
#define DHT_PIN 4
#define DHT_TYPE DHT22

// ========================
// Ultrasonic (HC-SR04)
// ========================
static const int US_TRIG_PIN = 33;
static const int US_ECHO_PIN = 32;

// Bin-specific defaults for your narrow hopper (re-calibrate on actual feed levels)
static const float FEED_FULL_CM          = 4.5f;
static const float FEED_DETECT_START_CM  = 9.8f;
static const float FEED_DETECT_HYST_CM   = 0.45f;
static const float FEED_EMPTY_CM         = 10.0f;   // reference only

// Tight gate for small bin
static const float US_MIN_CM             = 1.4f;
static const float US_MAX_CM             = 11.5f;

// Sampling + filtering
static const int   US_SAMPLES            = 9;       // odd number
static const float US_VALID_SPREAD_CM    = 0.9f;    // reject if batch spread too high
static const float US_MAX_JUMP_CM        = 1.8f;    // movement guard per cycle
static const float US_SMOOTH_ALPHA       = 0.16f;

// Output stability
static const int   FEED_MAX_STEP_PCT     = 6;       // max % move per sensor cycle
static const int   FEED_EMPTY_CONFIRM_N  = 5;       // repeated empty proof
static const unsigned long US_HOLD_MS    = 30000UL; // hold last good value during noise

static bool usInDetectZone = false;
float lastGoodDistCm = -1.0f;
float smoothedDistCm = -1.0f;
int usConsecutiveFails = 0;
int usEmptyEvidence = 0;
unsigned long usLastGoodMs = 0;

// ========================
// Water level sensor (Analog)
// ========================
static const int WATER_AO_PIN = 34;

// Water calibration points (replace with your real values)
static const int RAW_DRY  = -2;
static const int RAW_25   = -1;
static const int RAW_50   = 0;
static const int RAW_75   = 1200;
static const int RAW_100  = 1400;

static float waterPctSmooth = -1.0f;
static const float WATER_ALPHA = 0.30f;

// ========================
// MQ135 ammonia sensor (Analog via voltage divider)
// ========================
static const int MQ135_AO_PIN = 35;
static const float MQ135_ADC_REF_V = 3.3f;
static const float MQ135_ALPHA = 0.20f;
static const float MQ135_BASELINE_FAST_ALPHA = 0.20f;
static const float MQ135_BASELINE_SLOW_ALPHA = 0.02f;
static const unsigned long MQ135_WARMUP_MS = 120000UL;
static const int MQ135_DELTA_LOW  = 15;
static const int MQ135_DELTA_HIGH = 180;

static float ammoniaPctSmooth = -1.0f;
int ammoniaRaw = 0;
float ammoniaVoltage = 0.0f;
int ammoniaLevel = 0;
float ammoniaBaselineRaw = -1.0f;
int ammoniaDeltaRaw = 0;
unsigned long mq135StartMs = 0;

// ========================
// Stepper (TMC2209 STEP/DIR)
// ========================
static const int PIN_STEP = 25;
static const int PIN_DIR  = 26;
static const int PIN_EN   = 27;

AccelStepper stepper(AccelStepper::DRIVER, PIN_STEP, PIN_DIR);

// ========================
// Feed control
// ========================
bool feeding = false;
unsigned long feedStartMs = 0;

const unsigned long FEED_DURATION_MS = 6000;
const float FEED_SPEED = 450.0f;

// ========================
// SIM900 SMS
// ========================
static const int SIM900_RX_PIN = 16;
static const int SIM900_TX_PIN = 17;
static const uint32_t SIM900_BAUD = 9600;
HardwareSerial sim900(2);

bool smsEnabled = false;
String smsPhone = "";
unsigned long lastSmsSettingsPollMs = 0;
const unsigned long SMS_SETTINGS_POLL_MS = 30000UL;
bool sim900Ready = false;
String lastProcessedTestTriggerId = "";

const int LOW_FEED_THRESHOLD = 20;
const int CRITICAL_WATER_THRESHOLD = 10;
const int CRITICAL_AMMONIA_THRESHOLD = 70;
const float CRITICAL_HIGH_TEMP_THRESHOLD_C = 35.0f;
const float CRITICAL_LOW_TEMP_THRESHOLD_C = 18.0f;
const unsigned long WIFI_OFFLINE_MIN_MS = 120000UL;
const unsigned long ALERT_COOLDOWN_MS = 30UL * 60UL * 1000UL;
unsigned long lastLowFeedAlertMs = 0;
unsigned long lastHighTempAlertMs = 0;
unsigned long lastLowTempAlertMs = 0;
unsigned long lastLowWaterAlertMs = 0;
unsigned long lastHighAmmoniaAlertMs = 0;
unsigned long lastWifiOfflineAlertMs = 0;
unsigned long wifiDisconnectedSinceMs = 0;
bool lowFeedAlertActive = false;
bool highTempAlertActive = false;
bool lowTempAlertActive = false;
bool lowWaterAlertActive = false;
bool highAmmoniaAlertActive = false;
bool wifiOfflineAlertActive = false;

// ========================
// Objects
// ========================
DHT dht(DHT_PIN, DHT_TYPE);
WiFiClient espClient;
PubSubClient client(espClient);
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

// ========================
// Live values
// ========================
float currentTemp = 0;
float currentHum = 0;
int feedLevel = 100;
int waterLevel = 0;

// ========================
// Aggregation (daily history)
// ========================
float tempSum = 0;
float tempMin = 100;
float tempMax = 0;
float humSum = 0;
int samples = 0;

int feedStart = 100;
int waterStart = 100;

// ========================
// Timing
// ========================
unsigned long lastSensor = 0;
unsigned long lastFirebase = 0;
const long sensorInterval = 5000;
const long firebaseInterval = 30000;

// ========================
// Day tracking
// ========================
int currentDay = -1;

// ========================
// Schedules
// ========================
unsigned long lastScheduleCheck = 0;
const unsigned long SCHEDULE_CHECK_MS = 250;

unsigned long lastScheduleFetch = 0;
const unsigned long SCHEDULE_FETCH_MS = 60000;

const int SCHEDULE_GRACE_MIN = 2;

String lastFiredScheduleKey = "";
int lastFiredY = -1, lastFiredM = -1, lastFiredD = -1;

volatile bool forceScheduleFetch = false;

// ========================
// RTC (DS1302)
// ========================
static const int RTC_CLK = 18;
static const int RTC_DAT = 19;
static const int RTC_RST = 23;

ThreeWire rtcWire(RTC_DAT, RTC_CLK, RTC_RST);
RtcDS1302<ThreeWire> Rtc(rtcWire);

// ========================
// Offline schedule cache
// ========================
Preferences prefs;
String cachedSchedules = "";

// ========================
// RTC daily resync
// ========================
unsigned long lastRtcResyncMs = 0;
const unsigned long RTC_RESYNC_INTERVAL_MS = 24UL * 60UL * 60UL * 1000UL;

// ========================
// RTC debug prints
// ========================
unsigned long lastRtcPrintMs = 0;
const unsigned long RTC_PRINT_INTERVAL_MS = 5000;

// ========================
// NON-BLOCKING MQTT reconnect
// ========================
unsigned long lastMqttAttemptMs = 0;
const unsigned long MQTT_RETRY_MS = 5000;

// --------------------------------------------------------
// SMS helpers (revamped from known-working SIM900 test flow)
// --------------------------------------------------------
bool isValidPHNumber(const String& number) {
  if (number.length() != 13) return false;
  if (!number.startsWith("+63")) return false;
  for (int i = 3; i < 13; i++) {
    if (!isDigit(number[i])) return false;
  }
  return true;
}

String sim900ReadResponse(unsigned long timeoutMs = 1500) {
  unsigned long start = millis();
  String response = "";
  while (millis() - start < timeoutMs) {
    while (sim900.available()) {
      response += (char)sim900.read();
    }
    if (client.connected()) client.loop();
    delay(5);
    yield();
  }
  return response;
}

void sim900FlushInput() {
  while (sim900.available()) sim900.read();
}

void cooperativeDelay(unsigned long waitMs) {
  unsigned long start = millis();
  while (millis() - start < waitMs) {
    if (client.connected()) client.loop();
    delay(10);
    yield();
  }
}

bool sim900SendAT(const String& cmd, const char* expect = "OK", unsigned long timeoutMs = 3000) {
  sim900FlushInput();
  sim900.println(cmd);

  unsigned long start = millis();
  String response = "";
  while (millis() - start < timeoutMs) {
    while (sim900.available()) {
      response += (char)sim900.read();
      if (response.indexOf(expect) != -1) {
        Serial.print("[SMS] AT <");
        Serial.print(cmd);
        Serial.println("> OK");
        return true;
      }
      if (response.indexOf("ERROR") != -1) {
        Serial.print("[SMS] AT <");
        Serial.print(cmd);
        Serial.print("> ERROR: ");
        Serial.println(response);
        return false;
      }
    }
    if (client.connected()) client.loop();
    delay(5);
    yield();
  }

  Serial.print("[SMS] AT <");
  Serial.print(cmd);
  Serial.print("> timeout. resp=");
  Serial.println(response);
  return false;
}

bool sim900SendATWithDelay(const String& cmd, unsigned long waitMs = 1500) {
  sim900FlushInput();
  sim900.println(cmd);
  cooperativeDelay(waitMs);

  String response = sim900ReadResponse(300);
  Serial.print("[SMS] -> ");
  Serial.println(cmd);
  Serial.print("[SMS] <- ");
  Serial.println(response);

  return (response.indexOf("OK") != -1) && (response.indexOf("ERROR") == -1);
}

String sim900RunCommand(const String& cmd, unsigned long waitMs = 1500) {
  sim900FlushInput();
  sim900.println(cmd);
  cooperativeDelay(waitMs);
  String response = sim900ReadResponse(500);
  Serial.print("[SMS] -> ");
  Serial.println(cmd);
  Serial.print("[SMS] <- ");
  Serial.println(response);
  return response;
}

bool sim900NetworkReady() {
  String reg = sim900RunCommand("AT+CREG?", 1200);
  bool registered = reg.indexOf("+CREG: 0,1") != -1 || reg.indexOf("+CREG: 0,5") != -1;
  if (!registered) {
    Serial.println("[SMS] network not registered yet (AT+CREG?)");
    return false;
  }

  String csq = sim900RunCommand("AT+CSQ", 800);
  // CSQ: 0,99 means unknown/invalid RSSI.
  if (csq.indexOf("+CSQ: 0,99") != -1) {
    Serial.println("[SMS] weak/unknown signal (AT+CSQ)");
    return false;
  }
  return true;
}

void sim900ReadOwnNumber() {
  sim900FlushInput();
  sim900.println("AT+CNUM");
  String response = sim900ReadResponse(2000);

  Serial.print("[SMS] CNUM response: ");
  Serial.println(response);

  if (response.indexOf("+CNUM:") != -1) {
    Serial.println("[SMS] SIM number available from modem.");
  } else {
    Serial.println("[SMS] SIM number not exposed by carrier/SIM (normal on some networks).");
  }
}

void sim900Init() {
  sim900.begin(SIM900_BAUD, SERIAL_8N1, SIM900_RX_PIN, SIM900_TX_PIN);
  cooperativeDelay(5000); // aligns with the proven standalone test sketch

  Serial.println("[SMS] === SIM900 startup ===");
  sim900FlushInput();

  // Keep startup flow close to the working standalone sketch.
  bool atOk = sim900SendATWithDelay("AT", 1200);
  if (!atOk) {
    // One retry using the token-based reader before giving up.
    atOk = sim900SendAT("AT", "OK", 4000);
  }

  bool textOk = sim900SendATWithDelay("AT+CMGF=1", 1200);
  if (!textOk) {
    textOk = sim900SendAT("AT+CMGF=1", "OK", 4000);
  }
  sim900SendATWithDelay("ATE0", 600);
  sim900SendATWithDelay("AT+CSCS=\"GSM\"", 1000);
  sim900SendATWithDelay("AT+CSMP=17,167,0,0", 1000);

  sim900ReadOwnNumber();

  // Do not hard-fail startup on CPIN/CREG checks because some modules/SIMs
  // respond slowly/noisily at boot. We validate on every actual send instead.
  sim900Ready = atOk && textOk;
  Serial.print("[SMS] ready=");
  Serial.println(sim900Ready ? "1" : "0");
}

bool sendSMS(const String& number, const String& message) {
  if (!sim900Ready) {
    Serial.println("[SMS] send skipped: SIM900 not ready");
    return false;
  }
  if (!isValidPHNumber(number)) {
    Serial.print("[SMS] send skipped: invalid number ");
    Serial.println(number);
    return false;
  }

  // Keep send flow close to the known-good test sketch.
  if (!sim900SendATWithDelay("AT", 1000)) return false;
  if (!sim900SendATWithDelay("AT+CMGF=1", 1000)) return false;
  sim900SendATWithDelay("AT+CSCS=\"GSM\"", 800);
  if (!sim900NetworkReady()) return false;

  sim900FlushInput();
  sim900.print("AT+CMGS=\"");
  sim900.print(number);
  sim900.println("\"");
  cooperativeDelay(1000);

  sim900.print(message);
  sim900.write((char)26); // Ctrl+Z
  cooperativeDelay(7000);

  String finalResp = sim900ReadResponse(10000);
  bool ok = (finalResp.indexOf("ERROR") == -1) &&
            (finalResp.indexOf("+CMGS:") != -1) &&
            (finalResp.indexOf("OK") != -1);
  Serial.print("[SMS] send result=");
  Serial.println(ok ? "OK" : "FAIL");
  Serial.println(finalResp);
  return ok;
}

void processSmsSerialCommand() {
  if (!Serial.available()) return;

  String command = Serial.readStringUntil('\n');
  command.trim();
  if (!command.startsWith("send ")) return;

  String args = command.substring(5);
  int split = args.indexOf(' ');
  if (split == -1) {
    Serial.println("[SMS] format error. use: send +63xxxxxxxxxx your message");
    return;
  }

  String number = args.substring(0, split);
  String message = args.substring(split + 1);
  bool ok = sendSMS(number, message);
  Serial.print("[SMS] manual send -> ");
  Serial.println(ok ? "SUCCESS" : "FAILED");
}

void fetchSmsSettingsFromFirebase() {
  if (WiFi.status() != WL_CONNECTED) return;

  bool enabledVal = false;
  if (Firebase.getBool(fbdo, "/smsSettings/enabled")) {
    enabledVal = fbdo.to<bool>();
  } else if (Firebase.getString(fbdo, "/smsSettings/enabled")) {
    String s = fbdo.to<String>();
    s.trim();
    s.toLowerCase();
    enabledVal = (s == "true" || s == "1");
  }

  String phoneVal = "";
  if (Firebase.getString(fbdo, "/smsSettings/phone")) {
    phoneVal = fbdo.to<String>();
    phoneVal.trim();
  }

  smsEnabled = enabledVal && isValidPHNumber(phoneVal);
  smsPhone = phoneVal;

  Serial.print("[SMS] settings: enabled=");
  Serial.print(enabledVal ? "1" : "0");
  Serial.print(" usable=");
  Serial.print(smsEnabled ? "1" : "0");
  Serial.print(" phone=");
  Serial.println(smsPhone);

  if (!smsEnabled) return;

  String command = "";
  String timestamp = "";
  if (Firebase.getString(fbdo, "/smsSettings/testTrigger/command")) {
    command = fbdo.to<String>();
    command.trim();
  }
  if (Firebase.getString(fbdo, "/smsSettings/testTrigger/timestamp")) {
    timestamp = fbdo.to<String>();
    timestamp.trim();
  }

  String triggerId = command + "|" + timestamp;
  if (command == "TEST_SMS" && timestamp.length() > 0 && triggerId != lastProcessedTestTriggerId) {
    lastProcessedTestTriggerId = triggerId;
    String msg = "[Chikulungan] TEST SMS " + timestamp + ": SIM900 link is working.";
    bool ok = sendSMS(smsPhone, msg);
    Serial.print("[SMS] TEST_SMS trigger -> ");
    Serial.println(ok ? "SUCCESS" : "FAILED");

    Firebase.setString(fbdo, "/smsSettings/testTrigger/lastProcessedId", triggerId);
    Firebase.setString(fbdo, "/smsSettings/testTrigger/lastStatus", ok ? "SUCCESS" : "FAILED");
    Firebase.setString(fbdo, "/smsSettings/testTrigger/lastResponseAt", String((unsigned long)time(nullptr)));
  }
}

void evaluateCriticalSmsAlerts() {
  if (!sim900Ready || !smsEnabled || !isValidPHNumber(smsPhone)) return;

  unsigned long now = millis();
  bool lowFeedNow = (feedLevel <= LOW_FEED_THRESHOLD);
  bool highTempNow = (currentTemp >= CRITICAL_HIGH_TEMP_THRESHOLD_C);
  bool lowTempNow = (currentTemp <= CRITICAL_LOW_TEMP_THRESHOLD_C);
  bool lowWaterNow = (waterLevel <= CRITICAL_WATER_THRESHOLD);
  bool highAmmoniaNow = (ammoniaLevel >= CRITICAL_AMMONIA_THRESHOLD);

  // Trigger on state transition to critical, then throttle repeats by cooldown.
  if (lowFeedNow) {
    bool shouldSend = !lowFeedAlertActive || (now - lastLowFeedAlertMs >= ALERT_COOLDOWN_MS);
    if (shouldSend) {
      String msg = "[Chikulungan] CRITICAL: Feed level is low (" + String(feedLevel) + "%).";
      if (sendSMS(smsPhone, msg)) {
        lastLowFeedAlertMs = now;
        lowFeedAlertActive = true;
      }
    }
  } else {
    lowFeedAlertActive = false;
  }

  if (highTempNow) {
    bool shouldSend = !highTempAlertActive || (now - lastHighTempAlertMs >= ALERT_COOLDOWN_MS);
    if (shouldSend) {
      String msg = "[Chikulungan] CRITICAL: High temperature (" + String(currentTemp, 1) + "C).";
      if (sendSMS(smsPhone, msg)) {
        lastHighTempAlertMs = now;
        highTempAlertActive = true;
      }
    }
  } else {
    highTempAlertActive = false;
  }

  if (lowTempNow) {
    bool shouldSend = !lowTempAlertActive || (now - lastLowTempAlertMs >= ALERT_COOLDOWN_MS);
    if (shouldSend) {
      String msg = "[Chikulungan] CRITICAL: Low temperature (" + String(currentTemp, 1) + "C).";
      if (sendSMS(smsPhone, msg)) {
        lastLowTempAlertMs = now;
        lowTempAlertActive = true;
      }
    }
  } else {
    lowTempAlertActive = false;
  }

  if (lowWaterNow) {
    bool shouldSend = !lowWaterAlertActive || (now - lastLowWaterAlertMs >= ALERT_COOLDOWN_MS);
    if (shouldSend) {
      String msg = "[Chikulungan] CRITICAL: Water level is low (" + String(waterLevel) + "%).";
      if (sendSMS(smsPhone, msg)) {
        lastLowWaterAlertMs = now;
        lowWaterAlertActive = true;
      }
    }
  } else {
    lowWaterAlertActive = false;
  }

  if (highAmmoniaNow) {
    bool shouldSend = !highAmmoniaAlertActive || (now - lastHighAmmoniaAlertMs >= ALERT_COOLDOWN_MS);
    if (shouldSend) {
      String msg = "[Chikulungan] CRITICAL: Ammonia is high (" + String(ammoniaLevel) + "%).";
      if (sendSMS(smsPhone, msg)) {
        lastHighAmmoniaAlertMs = now;
        highAmmoniaAlertActive = true;
      }
    }
  } else {
    highAmmoniaAlertActive = false;
  }

  if (WiFi.status() != WL_CONNECTED) {
    if (wifiDisconnectedSinceMs == 0) {
      wifiDisconnectedSinceMs = now;
    }

    bool offlineCritical = (now - wifiDisconnectedSinceMs >= WIFI_OFFLINE_MIN_MS);
    if (offlineCritical) {
      bool shouldSend = !wifiOfflineAlertActive || (now - lastWifiOfflineAlertMs >= ALERT_COOLDOWN_MS);
      if (shouldSend && sendSMS(smsPhone, "[Chikulungan] CRITICAL: Device WiFi is offline.")) {
        lastWifiOfflineAlertMs = now;
        wifiOfflineAlertActive = true;
      }
    }
  } else {
    wifiDisconnectedSinceMs = 0;
    wifiOfflineAlertActive = false;
  }
}

// --------------------------------------------------------
// Firebase log helper
// --------------------------------------------------------
void logToFirebase(const String& message, const String& source) {
  FirebaseJson json;
  json.set("message", message);
  json.set("source", source);

  unsigned long ts = (unsigned long)time(nullptr);
  if (ts > 100000UL) json.set("timestamp", (long long)ts * 1000LL);
  else json.set("timestamp", (long long)millis());

  Firebase.pushJSON(fbdo, "/logs", json);
}

// --------------------------------------------------------
// Time helpers
// --------------------------------------------------------
String dayNameFromWday(int wday) {
  switch (wday) {
    case 0: return "Sunday";
    case 1: return "Monday";
    case 2: return "Tuesday";
    case 3: return "Wednesday";
    case 4: return "Thursday";
    case 5: return "Friday";
    case 6: return "Saturday";
    default: return "";
  }
}

int dayBitFromName(String day) {
  day.trim();
  if (day == "Sunday") return 0;
  if (day == "Monday") return 1;
  if (day == "Tuesday") return 2;
  if (day == "Wednesday") return 3;
  if (day == "Thursday") return 4;
  if (day == "Friday") return 5;
  if (day == "Saturday") return 6;
  return -1;
}

String formatTime12h(int hour24, int minute) {
  String period = (hour24 >= 12) ? "PM" : "AM";
  int hour12 = hour24 % 12;
  if (hour12 == 0) hour12 = 12;

  char buf[6];
  sprintf(buf, "%02d:%02d", hour12, minute);
  return String(buf) + " " + period;
}

bool parseTime12h(String t, int &hour24, int &min) {
  t.trim();

  int sp = t.lastIndexOf(' ');
  if (sp < 0) return false;

  String hm = t.substring(0, sp);
  String ap = t.substring(sp + 1);
  hm.trim();
  ap.trim();
  ap.toUpperCase();

  int colon = hm.indexOf(':');
  if (colon < 0) return false;

  int h = hm.substring(0, colon).toInt();
  int m = hm.substring(colon + 1).toInt();

  if (ap != "AM" && ap != "PM") return false;
  if (h < 1 || h > 12) return false;
  if (m < 0 || m > 59) return false;

  if (h == 12) h = 0;
  hour24 = h + (ap == "PM" ? 12 : 0);
  min = m;
  return true;
}

// --------------------------------------------------------
// RTC helpers
// --------------------------------------------------------
void rtcBegin() {
  Rtc.Begin();
  if (!Rtc.GetIsRunning()) Rtc.SetIsRunning(true);
  Serial.println("RTC initialized");
}

bool rtcHasValidTime() {
  RtcDateTime now = Rtc.GetDateTime();
  return now.Year() >= 2024;
}

bool systemTimeLooksValid() {
  time_t now = time(nullptr);
  return now > 1700000000;
}

void rtcSyncFromSystemTimeIfValid() {
  if (!systemTimeLooksValid()) return;
  time_t now = time(nullptr);
  RtcDateTime rtcTime((uint32_t)now);
  Rtc.SetDateTime(rtcTime);
  Serial.println("RTC synced from NTP/system time");
}

void rtcResyncDailyIfOnline() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (!systemTimeLooksValid()) return;

  unsigned long nowMs = millis();
  if (lastRtcResyncMs != 0 && (nowMs - lastRtcResyncMs) < RTC_RESYNC_INTERVAL_MS) return;

  rtcSyncFromSystemTimeIfValid();
  lastRtcResyncMs = nowMs;
  Serial.println("RTC daily resync done");
}

bool getNowFields(int &year, int &month, int &day, int &wday, int &hour, int &minute, int &second) {
  struct tm timeinfo;
  if (getLocalTime(&timeinfo) && systemTimeLooksValid()) {
    year = timeinfo.tm_year + 1900;
    month = timeinfo.tm_mon + 1;
    day = timeinfo.tm_mday;
    wday = timeinfo.tm_wday;
    hour = timeinfo.tm_hour;
    minute = timeinfo.tm_min;
    second = timeinfo.tm_sec;
    return true;
  }

  RtcDateTime now = Rtc.GetDateTime();
  if (now.Year() < 2024) return false;

  year = (int)now.Year();
  month = (int)now.Month();
  day = (int)now.Day();
  wday = (int)now.DayOfWeek();
  hour = (int)now.Hour();
  minute = (int)now.Minute();
  second = (int)now.Second();
  return true;
}

void printRtcAndSystemTimeDebug() {
  unsigned long nowMs = millis();
  if (nowMs - lastRtcPrintMs < RTC_PRINT_INTERVAL_MS) return;
  lastRtcPrintMs = nowMs;

  RtcDateTime rtcNow = Rtc.GetDateTime();
  Serial.printf("[RTC] %04u-%02u-%02u %02u:%02u:%02u  DOW=%u  Valid=%s\n",
                rtcNow.Year(), rtcNow.Month(), rtcNow.Day(),
                rtcNow.Hour(), rtcNow.Minute(), rtcNow.Second(),
                rtcNow.DayOfWeek(),
                (rtcNow.Year() >= 2024 ? "YES" : "NO"));

  struct tm t;
  if (getLocalTime(&t) && systemTimeLooksValid()) {
    Serial.printf("[SYS] %04d-%02d-%02d %02d:%02d:%02d  DOW=%d  (NTP OK)\n",
                  t.tm_year + 1900, t.tm_mon + 1, t.tm_mday,
                  t.tm_hour, t.tm_min, t.tm_sec,
                  t.tm_wday);
  } else {
    Serial.println("[SYS] (NTP not ready / offline)");
  }
}

// --------------------------------------------------------
// Ultrasonic helpers (bin-specific hardening)
// --------------------------------------------------------
static inline long usTimeoutFromMaxCm(float maxCm) {
  // Round-trip ~58.3 us/cm at ~25C + margin
  return (long)(maxCm * 58.3f + 2200.0f);
}

float readDistanceOnceCm() {
  digitalWrite(US_TRIG_PIN, LOW);
  delayMicroseconds(3);
  digitalWrite(US_TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(US_TRIG_PIN, LOW);

  long dur = pulseIn(US_ECHO_PIN, HIGH, usTimeoutFromMaxCm(US_MAX_CM));
  if (dur <= 0) return -1.0f;

  // Temperature compensation
  float tempC = currentTemp;
  if (tempC < -20.0f || tempC > 60.0f) tempC = 25.0f;

  float speed = 331.3f + 0.606f * tempC; // m/s
  float cm_per_us = (speed * 100.0f) / 1000000.0f;

  float cm = (dur * cm_per_us) / 2.0f;
  if (cm < US_MIN_CM || cm > US_MAX_CM) return -1.0f;
  return cm;
}

static void sortFloat(float *a, int n) {
  for (int i = 0; i < n - 1; i++) {
    for (int j = i + 1; j < n; j++) {
      if (a[j] < a[i]) {
        float t = a[i];
        a[i] = a[j];
        a[j] = t;
      }
    }
  }
}

float readDistanceMedianCm(int &ok, int &bad, float &spread) {
  float vals[US_SAMPLES];
  ok = 0;
  bad = 0;

  for (int i = 0; i < US_SAMPLES; i++) {
    float cm = readDistanceOnceCm();
    if (cm > 0) vals[ok++] = cm;
    else bad++;

    delay(25);
    yield();
  }

  if (ok < 5) {
    spread = 999.0f;
    return -1.0f;
  }

  sortFloat(vals, ok);
  spread = vals[ok - 1] - vals[0];
  if (spread > US_VALID_SPREAD_CM) return -1.0f;

  return vals[ok / 2];
}

float applyJumpGuard(float newCm) {
  if (newCm < 0) return -1.0f;
  if (smoothedDistCm < 0) return newCm;

  float diff = fabsf(newCm - smoothedDistCm);

  // Always accept tiny movement
  if (diff <= 0.7f) return newCm;

  // Medium movement: accept only while stream is stable
  if (diff <= US_MAX_JUMP_CM) {
    if (usConsecutiveFails == 0) return newCm;
    return -1.0f;
  }

  // Large jump in this short-range bin is likely a wall echo
  return -1.0f;
}

int distanceToFeedPercent(float cm) {
  if (cm < 0) return feedLevel;
  if (cm > US_MAX_CM) return 0;

  // Hysteresis around detect-start boundary
  if (!usInDetectZone) {
    if (cm <= (FEED_DETECT_START_CM - FEED_DETECT_HYST_CM)) usInDetectZone = true;
    else return 0;
  } else {
    if (cm >= (FEED_DETECT_START_CM + FEED_DETECT_HYST_CM)) {
      usInDetectZone = false;
      return 0;
    }
  }

  if (cm <= FEED_FULL_CM) return 100;
  if (cm >= FEED_DETECT_START_CM) return 0;

  float pct = 100.0f * (FEED_DETECT_START_CM - cm) / (FEED_DETECT_START_CM - FEED_FULL_CM);
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  return (int)(pct + 0.5f);
}

void updateFeedFromUltrasonic() {
  int ok = 0, bad = 0;
  float spread = 0;
  float med = readDistanceMedianCm(ok, bad, spread);
  float guarded = applyJumpGuard(med);

  Serial.printf("[US] med=%.2f guard=%.2f spread=%.2f ok=%d bad=%d smooth=%.2f\n",
                med, guarded, spread, ok, bad, smoothedDistCm);

  if (guarded < 0) {
    usConsecutiveFails++;

    // Hold last trusted value while noise is temporary
    if (lastGoodDistCm > 0 && (millis() - usLastGoodMs) < US_HOLD_MS) {
      Serial.printf("[US] noisy -> hold feed=%d%% fail=%d\n", feedLevel, usConsecutiveFails);
      return;
    }

    // Prolonged bad stream: gentle degrade, never cliff to zero
    feedLevel = max(0, feedLevel - 2);
    Serial.printf("[US] prolonged noise -> gentle degrade feed=%d%%\n", feedLevel);
    return;
  }

  usConsecutiveFails = 0;
  usLastGoodMs = millis();
  lastGoodDistCm = guarded;

  if (smoothedDistCm < 0) smoothedDistCm = guarded;
  else smoothedDistCm = (1.0f - US_SMOOTH_ALPHA) * smoothedDistCm + US_SMOOTH_ALPHA * guarded;

  int rawPct = distanceToFeedPercent(smoothedDistCm);

  // Empty must be confirmed repeatedly
  if (rawPct <= 1) usEmptyEvidence++;
  else usEmptyEvidence = 0;

  int targetPct = rawPct;
  if (usEmptyEvidence < FEED_EMPTY_CONFIRM_N && rawPct < 3) {
    targetPct = 3;
  }

  // Rate-limit display/output movement
  int delta = targetPct - feedLevel;
  if (delta > FEED_MAX_STEP_PCT) delta = FEED_MAX_STEP_PCT;
  if (delta < -FEED_MAX_STEP_PCT) delta = -FEED_MAX_STEP_PCT;
  feedLevel += delta;

  Serial.printf("[US] smooth=%.2f raw=%d%% target=%d%% final=%d%% emptyEv=%d\n",
                smoothedDistCm, rawPct, targetPct, feedLevel, usEmptyEvidence);
}

// --------------------------------------------------------
// Analog helpers
// --------------------------------------------------------
int readAnalogStable(int pin, int sampleCount = 30, int sampleDelayMs = 5) {
  long sum = 0;
  for (int i = 0; i < sampleCount; i++) {
    sum += analogRead(pin);
    delay(sampleDelayMs);
    yield();
  }
  return (int)(sum / sampleCount);
}

int clampInt(int v, int lo, int hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

int mapSegment(int x, int x0, int x1, int y0, int y1) {
  if (x1 == x0) return y0;
  float t = (x - x0) / (float)(x1 - x0);
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  return (int)(y0 + t * (y1 - y0) + 0.5f);
}

// --------------------------------------------------------
// Water level helpers
// --------------------------------------------------------
int waterRawToPercent(int raw) {
  if (raw <= RAW_DRY) return 0;
  if (raw >= RAW_100) return 100;

  if (raw < RAW_25)  return mapSegment(raw, RAW_DRY, RAW_25, 0, 25);
  if (raw < RAW_50)  return mapSegment(raw, RAW_25, RAW_50, 25, 50);
  if (raw < RAW_75)  return mapSegment(raw, RAW_50, RAW_75, 50, 75);
  return               mapSegment(raw, RAW_75, RAW_100, 75, 100);
}

int updateWaterLevelPercent() {
  int raw = readAnalogStable(WATER_AO_PIN);
  raw = clampInt(raw, 0, 4095);

  int pct = waterRawToPercent(raw);

  if (waterPctSmooth < 0) waterPctSmooth = pct;
  else waterPctSmooth = (1.0f - WATER_ALPHA) * waterPctSmooth + WATER_ALPHA * pct;

  int smoothPct = (int)(waterPctSmooth + 0.5f);

  Serial.printf("[WATER] raw=%d => pct=%d%% smooth=%d%% (DRY=%d 25=%d 50=%d 75=%d 100=%d)\n",
                raw, pct, smoothPct, RAW_DRY, RAW_25, RAW_50, RAW_75, RAW_100);

  return smoothPct;
}

// --------------------------------------------------------
// MQ135 ammonia helpers
// --------------------------------------------------------
float rawToVoltage(int raw) {
  return (raw * MQ135_ADC_REF_V) / 4095.0f;
}

void updateAmmoniaBaseline(int raw) {
  if (ammoniaBaselineRaw < 0) {
    ammoniaBaselineRaw = raw;
    return;
  }

  unsigned long warmupElapsed = millis() - mq135StartMs;
  float alpha = (warmupElapsed < MQ135_WARMUP_MS) ? MQ135_BASELINE_FAST_ALPHA : MQ135_BASELINE_SLOW_ALPHA;

  // Allow the baseline to fall quickly if the clean-air value is lower than before,
  // but rise more slowly once the warmup period is over so transient spikes stand out.
  if (raw < ammoniaBaselineRaw) {
    ammoniaBaselineRaw = (1.0f - alpha) * ammoniaBaselineRaw + alpha * raw;
  } else {
    float riseAlpha = (warmupElapsed < MQ135_WARMUP_MS) ? alpha : (alpha * 0.20f);
    ammoniaBaselineRaw = (1.0f - riseAlpha) * ammoniaBaselineRaw + riseAlpha * raw;
  }
}

int ammoniaDeltaToPercent(int deltaRaw) {
  if (deltaRaw <= MQ135_DELTA_LOW) return 0;
  if (deltaRaw >= MQ135_DELTA_HIGH) return 100;
  return mapSegment(deltaRaw, MQ135_DELTA_LOW, MQ135_DELTA_HIGH, 0, 100);
}

int updateAmmoniaLevelPercent() {
  ammoniaRaw = readAnalogStable(MQ135_AO_PIN, 40, 5);
  ammoniaRaw = clampInt(ammoniaRaw, 0, 4095);
  ammoniaVoltage = rawToVoltage(ammoniaRaw);
  updateAmmoniaBaseline(ammoniaRaw);

  ammoniaDeltaRaw = max(0, ammoniaRaw - (int)(ammoniaBaselineRaw + 0.5f));
  int pct = ammoniaDeltaToPercent(ammoniaDeltaRaw);

  if (ammoniaPctSmooth < 0) ammoniaPctSmooth = pct;
  else ammoniaPctSmooth = (1.0f - MQ135_ALPHA) * ammoniaPctSmooth + MQ135_ALPHA * pct;

  ammoniaLevel = (int)(ammoniaPctSmooth + 0.5f);

  const char* phase = ((millis() - mq135StartMs) < MQ135_WARMUP_MS) ? "warmup" : "active";
  Serial.printf("[MQ135] raw=%d base=%.1f delta=%d voltage=%.3fV ammonia=%d%% smooth=%d%% (%s)\n",
                ammoniaRaw, ammoniaBaselineRaw, ammoniaDeltaRaw, ammoniaVoltage, pct, ammoniaLevel, phase);

  return ammoniaLevel;
}

// --------------------------------------------------------
// Flash schedule cache
// --------------------------------------------------------
void loadSchedulesFromFlash() {
  prefs.begin("ck_sched", true);
  cachedSchedules = prefs.getString("sched", "");
  prefs.end();

  Serial.print("Loaded cached schedules length: ");
  Serial.println(cachedSchedules.length());
}

void saveSchedulesToFlash(const String& s) {
  prefs.begin("ck_sched", false);
  prefs.putString("sched", s);
  prefs.end();
  Serial.println("Saved schedules to flash");
}

int parseShallowKeys(const String& json, String ids[], int maxIds) {
  int count = 0;
  int i = 0;
  while (true) {
    int q1 = json.indexOf('"', i);
    if (q1 < 0) break;
    int q2 = json.indexOf('"', q1 + 1);
    if (q2 < 0) break;

    String key = json.substring(q1 + 1, q2);
    key.trim();

    if (key.length() > 0 && key.charAt(0) == '-') {
      bool exists = false;
      for (int k = 0; k < count; k++) {
        if (ids[k] == key) { exists = true; break; }
      }
      if (!exists) {
        if (count < maxIds) ids[count++] = key;
      }
    }

    i = q2 + 1;
    if (count >= maxIds) break;
  }
  return count;
}

void serviceMqttDuringLongOps() {
  if (client.connected()) client.loop();
  yield();
}

String buildScheduleCacheFromFirebase() {
  if (feeding) {
    Serial.println("[SCHED] fetch skipped: feeder active");
    return "";
  }

  bool ok = Firebase.getShallowData(fbdo, "/schedules");
  if (!ok) {
    Serial.println("Failed to fetch schedules (shallow)");
    return "";
  }

  String shallow = fbdo.to<String>();
  Serial.print("[SCHED] shallow = ");
  Serial.println(shallow);

  const int MAX_IDS = 50;
  String ids[MAX_IDS];
  int idCount = parseShallowKeys(shallow, ids, MAX_IDS);

  Serial.printf("[SCHED] schedule IDs found = %d\n", idCount);
  for (int i = 0; i < idCount; i++) {
    Serial.printf("  [ID] %s\n", ids[i].c_str());
  }

  if (idCount == 0) return "";

  String out = "";
  bool abortedForFeed = false;

  for (int i = 0; i < idCount; i++) {
    serviceMqttDuringLongOps();
    if (feeding) {
      abortedForFeed = true;
      break;
    }

    String id = ids[i];
    String base = "/schedules/" + id;

    bool enabled = true;
    if (Firebase.getBool(fbdo, base + "/enabled")) {
      enabled = fbdo.to<bool>();
    } else if (Firebase.getString(fbdo, base + "/enabled")) {
      String s = fbdo.to<String>();
      s.trim(); s.toLowerCase();
      enabled = (s == "true" || s == "1");
    } else {
      Serial.printf("[SCHED] id=%s missing enabled\n", id.c_str());
      continue;
    }

    if (!Firebase.getString(fbdo, base + "/time")) {
      Serial.printf("[SCHED] id=%s missing time\n", id.c_str());
      continue;
    }
    String t = fbdo.to<String>();
    t.trim();

    int mask = 0;
    for (int idx = 0; idx < 7; idx++) {
      serviceMqttDuringLongOps();
      if (feeding) {
        abortedForFeed = true;
        break;
      }

      String dayPath = base + "/days/" + String(idx);
      if (Firebase.getString(fbdo, dayPath)) {
        String dayVal = fbdo.to<String>();
        dayVal.trim();
        Serial.printf("  [DAY] id=%s days[%d]='%s'\n", id.c_str(), idx, dayVal.c_str());
        int bit = dayBitFromName(dayVal);
        if (bit >= 0) mask |= (1 << bit);
      }
    }

    if (abortedForFeed) break;

    Serial.printf("[SCHED] id=%s enabled=%d time='%s' mask=%d\n",
                  id.c_str(), enabled ? 1 : 0, t.c_str(), mask);

    if (mask == 0) {
      Serial.printf("[SCHED] id=%s skipped (mask=0) — days not detected\n", id.c_str());
      continue;
    }

    out += String(enabled ? 1 : 0) + "," + t + "," + String(mask) + ";";
  }

  if (abortedForFeed) {
    Serial.println("[SCHED] fetch aborted: feeder became active");
    return "";
  }

  Serial.printf("[SCHED] built cache length=%d\n", out.length());
  if (out.length() > 0) {
    Serial.print("[SCHED] cache preview: ");
    Serial.println(out);
  } else {
    Serial.println("[SCHED] built cache is EMPTY (no valid schedules parsed)");
  }

  return out;
}

// --------------------------------------------------------
// Feed run (Stepper reverse)
// --------------------------------------------------------
bool stopFeedRun(const String& reason) {
  if (!feeding) {
    Serial.println("Stop request ignored: feeder already idle");
    if (client.connected()) client.publish("chickulungan/log", "Stop request ignored (feeder idle)");
    return false;
  }

  feeding = false;
  stepper.setSpeed(0);
  digitalWrite(PIN_EN, HIGH);

  Serial.print("Feed stopped: ");
  Serial.println(reason);

  if (client.connected()) client.publish("chickulungan/log", ("Feed stopped: " + reason).c_str());
  if (WiFi.status() == WL_CONNECTED) logToFirebase("Feed stopped: " + reason, "esp32");
  return true;
}

bool startFeedRun(const String& reason) {
  if (feeding) {
    Serial.println("Feed request ignored: already feeding");
    if (client.connected()) client.publish("chickulungan/log", "Feed request ignored (already running)");
    return false;
  }

  feeding = true;
  feedStartMs = millis();

  digitalWrite(PIN_EN, LOW);
  stepper.setSpeed(-FEED_SPEED);

  Serial.print("Feed started: ");
  Serial.println(reason);

  if (client.connected()) client.publish("chickulungan/log", ("Feed started: " + reason).c_str());
  if (WiFi.status() == WL_CONNECTED) logToFirebase("Feed started: " + reason, "esp32");
  return true;
}

// --------------------------------------------------------
// Cached schedule check
// --------------------------------------------------------
void checkSchedulesFromCache() {
  unsigned long nowMs = millis();
  if (nowMs - lastScheduleCheck < SCHEDULE_CHECK_MS) return;
  lastScheduleCheck = nowMs;

  if (cachedSchedules.length() == 0) return;

  int year, month, day, wday, hour, minute, second;
  if (!getNowFields(year, month, day, wday, hour, minute, second)) return;

  int nowTotal = hour * 60 + minute;

  int start = 0;
  while (true) {
    int end = cachedSchedules.indexOf(';', start);
    if (end == -1) break;

    String item = cachedSchedules.substring(start, end);
    start = end + 1;

    int p1 = item.indexOf(',');
    int p2 = item.indexOf(',', p1 + 1);
    if (p1 == -1 || p2 == -1) continue;

    int enabled = item.substring(0, p1).toInt();
    String schedTime = item.substring(p1 + 1, p2);
    int mask = item.substring(p2 + 1).toInt();

    if (!enabled) continue;
    if ((mask & (1 << wday)) == 0) continue;

    int sh, sm;
    if (!parseTime12h(schedTime, sh, sm)) {
      Serial.printf("[MATCH] failed to parse schedTime='%s'\n", schedTime.c_str());
      continue;
    }

    int schedTotal = sh * 60 + sm;
    int diff = nowTotal - schedTotal;

    if (diff < 0 || diff > SCHEDULE_GRACE_MIN) continue;

    String firedKey = String(wday) + "|" + schedTime;
    bool sameDay = (year == lastFiredY && month == lastFiredM && day == lastFiredD);

    if (sameDay && firedKey == lastFiredScheduleKey) {
      continue;
    }

    String nowLabel = formatTime12h(hour, minute);
    Serial.printf("Schedule matched! DOW=%d now=%s sched=%s diff=%d sec=%d\n",
                  wday, nowLabel.c_str(), schedTime.c_str(), diff, second);

    if (startFeedRun("Scheduled (" + dayNameFromWday(wday) + " " + schedTime + ")")) {
      lastFiredScheduleKey = firedKey;
      lastFiredY = year;
      lastFiredM = month;
      lastFiredD = day;
      break;
    }
  }
}

// --------------------------------------------------------
// NON-BLOCKING MQTT ensure
// --------------------------------------------------------
void ensureMQTT() {
  if (client.connected()) return;

  unsigned long now = millis();
  if (now - lastMqttAttemptMs < MQTT_RETRY_MS) return;
  lastMqttAttemptMs = now;

  Serial.println("MQTT reconnect attempt...");

  if (client.connect("ChicKulungan-ESP32",
                     "chickulungan/status", 0, true, "offline")) {
    client.subscribe("chickulungan/control/feed");
    client.subscribe("chickulungan/control/stopFeed");
    client.subscribe("chickulungan/control/refreshSchedules");
    client.publish("chickulungan/status", "online", true);
    client.publish("chickulungan/log", "ESP32 online");
    Serial.println("MQTT connected");
  } else {
    Serial.print("MQTT connect failed, state=");
    Serial.println(client.state());
  }
}

// --------------------------------------------------------
// MQTT callback
// --------------------------------------------------------
void callback(char* topic, byte* payload, unsigned int len) {
  String msg = "";
  for (unsigned int i = 0; i < len; i++) msg += (char)payload[i];

  String tp = String(topic);

  if (tp == "chickulungan/control/feed" && msg == "1") {
    startFeedRun("MQTT command");
    return;
  }

  if ((tp == "chickulungan/control/feed" && msg == "0") ||
      (tp == "chickulungan/control/stopFeed" && msg == "1")) {
    stopFeedRun("Emergency stop command");
    return;
  }

  if (tp == "chickulungan/control/refreshSchedules") {
    forceScheduleFetch = true;
    Serial.println("Received refreshSchedules command");
    return;
  }
}

// --------------------------------------------------------
// Daily history
// --------------------------------------------------------
void initNewDay() {
  int year, month, day, wday, hour, minute, second;
  if (!getNowFields(year, month, day, wday, hour, minute, second)) {
    Serial.println("initNewDay: no valid time source");
    return;
  }

  currentDay = day;

  tempSum = 0;
  humSum = 0;
  tempMin = 100;
  tempMax = 0;
  samples = 0;

  feedStart = feedLevel;
  waterStart = waterLevel;

  Serial.println("New day initialized");
}

void flushDailyHistory() {
  if (samples == 0) return;

  int year, month, day, wday, hour, minute, second;
  if (!getNowFields(year, month, day, wday, hour, minute, second)) return;

  char dateKey[11];
  sprintf(dateKey, "%04d-%02d-%02d", year, month, day);

  float tempAvg = tempSum / samples;
  float humAvg = humSum / samples;

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi offline: skipped daily history flush");
    return;
  }

  String base = "/history/daily/" + String(dateKey);

  Firebase.setString(fbdo, base + "/date", dateKey);
  Firebase.setFloat(fbdo, base + "/tempAvg", tempAvg);
  Firebase.setFloat(fbdo, base + "/tempMin", tempMin);
  Firebase.setFloat(fbdo, base + "/tempMax", tempMax);
  Firebase.setFloat(fbdo, base + "/humAvg", humAvg);

  Firebase.setInt(fbdo, base + "/feedStart", feedStart);
  Firebase.setInt(fbdo, base + "/feedEnd", feedLevel);
  Firebase.setInt(fbdo, base + "/feedUsed", max(0, feedStart - feedLevel));

  Firebase.setInt(fbdo, base + "/waterStart", waterStart);
  Firebase.setInt(fbdo, base + "/waterEnd", waterLevel);
  Firebase.setInt(fbdo, base + "/waterUsed", max(0, waterStart - waterLevel));

  Firebase.setInt(fbdo, base + "/samples", samples);
  Firebase.setTimestamp(fbdo, base + "/lastFlush");

  Serial.println("Daily history flushed");
}

void checkDayChange() {
  int year, month, day, wday, hour, minute, second;
  if (!getNowFields(year, month, day, wday, hour, minute, second)) return;

  if (currentDay != day) {
    flushDailyHistory();
    initNewDay();
  }
}

// ========================
// SETUP
// ========================
void setup() {
  Serial.begin(115200);
  Serial.printf("[WATER CAL] DRY=%d 25=%d 50=%d 75=%d 100=%d\n", RAW_DRY, RAW_25, RAW_50, RAW_75, RAW_100);
  mq135StartMs = millis();
  Serial.printf("[MQ135 CAL] warmup=%lus deltaLow=%d deltaHigh=%d (auto-baseline enabled)\n",
                MQ135_WARMUP_MS / 1000UL, MQ135_DELTA_LOW, MQ135_DELTA_HIGH);

  dht.begin();

  analogReadResolution(12);
#if defined(ESP32)
  analogSetPinAttenuation(WATER_AO_PIN, ADC_11db);
  analogSetPinAttenuation(MQ135_AO_PIN, ADC_11db);
#endif
  pinMode(WATER_AO_PIN, INPUT);
  pinMode(MQ135_AO_PIN, INPUT);

  pinMode(PIN_EN, OUTPUT);
  digitalWrite(PIN_EN, HIGH);
  pinMode(PIN_DIR, OUTPUT);

  stepper.setMaxSpeed(2500);
  stepper.setSpeed(0);

  pinMode(US_TRIG_PIN, OUTPUT);
  pinMode(US_ECHO_PIN, INPUT_PULLDOWN);
  digitalWrite(US_TRIG_PIN, LOW);

  rtcBegin();
  loadSchedulesFromFlash();

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) delay(200);
  Serial.println("WiFi connected");

  configTime(8 * 3600, 0, "pool.ntp.org", "time.nist.gov");
  delay(2000);

  rtcSyncFromSystemTimeIfValid();
  if (!rtcHasValidTime()) Serial.println("WARNING: RTC time looks invalid (battery/module/wiring?)");

  config.host = FIREBASE_HOST;
  config.signer.tokens.legacy_token = FIREBASE_AUTH;
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);

  sim900Init();

  client.setServer(mqtt_server, 1883);
  client.setCallback(callback);

  String built = buildScheduleCacheFromFirebase();
  if (built.length() > 0) {
    cachedSchedules = built;
    saveSchedulesToFlash(cachedSchedules);
  } else {
    Serial.println("Using cached schedules (no new schedules fetched)");
  }

  fetchSmsSettingsFromFirebase();

  {
    float t0 = dht.readTemperature();
    float h0 = dht.readHumidity();
    if (!isnan(t0) && !isnan(h0)) {
      currentTemp = t0;
      currentHum  = h0;
      Serial.printf("[DHT] init T=%.1fC H=%.1f%%\n", currentTemp, currentHum);
    } else {
      Serial.println("[DHT] init read failed (will retry in loop)");
    }
  }

  updateFeedFromUltrasonic();
  waterLevel = updateWaterLevelPercent();
  ammoniaLevel = updateAmmoniaLevelPercent();

  initNewDay();
  Serial.println("Setup complete");
}

// ========================
// LOOP
// ========================
void loop() {
  checkSchedulesFromCache();

  if (feeding) {
    stepper.runSpeed();
    if (millis() - feedStartMs >= FEED_DURATION_MS) {
      stopFeedRun("timeout");
    }
  }

  ensureMQTT();
  if (client.connected()) client.loop();

  unsigned long now = millis();
  processSmsSerialCommand();

  printRtcAndSystemTimeDebug();
  rtcResyncDailyIfOnline();

  if (now - lastSmsSettingsPollMs > SMS_SETTINGS_POLL_MS) {
    fetchSmsSettingsFromFirebase();
    lastSmsSettingsPollMs = now;
  }

  if (WiFi.status() == WL_CONNECTED) {
    bool doFetch = false;

    if (forceScheduleFetch) {
      doFetch = true;
      forceScheduleFetch = false;
      Serial.println("Forced schedule fetch requested");
    }

    if (!doFetch && (now - lastScheduleFetch > SCHEDULE_FETCH_MS)) {
      doFetch = true;
    }

    if (doFetch) {
      if (feeding) {
        Serial.println("[SCHED] fetch deferred: feeder active");
      } else {
        lastScheduleFetch = now;
        String built = buildScheduleCacheFromFirebase();

        if (built.length() > 0 && built != cachedSchedules) {
          cachedSchedules = built;
          saveSchedulesToFlash(cachedSchedules);
          Serial.println("Schedule cache updated");
        } else {
          Serial.println("Schedule cache unchanged or empty");
        }
      }
    }
  }

  if (now - lastSensor > sensorInterval) {
    float t = dht.readTemperature();
    float h = dht.readHumidity();
    bool dhtOk = (!isnan(t) && !isnan(h));

    if (dhtOk) {
      currentTemp = t;
      currentHum  = h;

      tempSum += t;
      humSum  += h;
      tempMin = min(tempMin, t);
      tempMax = max(tempMax, t);
      samples++;
    } else {
      Serial.println("[DHT] Read failed (NaN). Check wiring/power.");
    }

    if (!feeding) {
      updateFeedFromUltrasonic();
    } else {
      Serial.println("[US] skipped (feeding=TRUE)");
    }

    waterLevel = updateWaterLevelPercent();
    ammoniaLevel = updateAmmoniaLevelPercent();

    evaluateCriticalSmsAlerts();

    if (client.connected()) {
      if (dhtOk) {
        client.publish("chickulungan/sensor/temp", String(currentTemp, 1).c_str());
        client.publish("chickulungan/sensor/humidity", String(currentHum, 1).c_str());
      }
      client.publish("chickulungan/sensor/feed", String(feedLevel).c_str());
      client.publish("chickulungan/sensor/water", String(waterLevel).c_str());
      client.publish("chickulungan/sensor/ammonia", String(ammoniaLevel).c_str());
      client.publish("chickulungan/sensor/ammoniaRaw", String(ammoniaRaw).c_str());
      client.publish("chickulungan/sensor/ammoniaBaselineRaw", String(ammoniaBaselineRaw, 1).c_str());
      client.publish("chickulungan/sensor/ammoniaDeltaRaw", String(ammoniaDeltaRaw).c_str());
      client.publish("chickulungan/sensor/ammoniaVoltage", String(ammoniaVoltage, 3).c_str());
    }

    if (dhtOk) {
      Serial.printf("T: %.1f°C  H: %.1f%%  Feed: %d%%  Water: %d%%  Ammonia: %d%% (raw=%d, base=%.1f, delta=%d, %.3fV)\n",
                    currentTemp, currentHum, feedLevel, waterLevel, ammoniaLevel,
                    ammoniaRaw, ammoniaBaselineRaw, ammoniaDeltaRaw, ammoniaVoltage);
    } else {
      Serial.printf("T: (invalid)  H: (invalid)  Feed: %d%%  Water: %d%%  Ammonia: %d%% (raw=%d, base=%.1f, delta=%d, %.3fV)\n",
                    feedLevel, waterLevel, ammoniaLevel, ammoniaRaw, ammoniaBaselineRaw, ammoniaDeltaRaw, ammoniaVoltage);
    }

    lastSensor = now;
  }

  if (now - lastFirebase > firebaseInterval) {
    if (WiFi.status() == WL_CONNECTED) {
      Firebase.setFloat(fbdo, "/sensors/temperature", currentTemp);
      Firebase.setFloat(fbdo, "/sensors/humidity", currentHum);
      Firebase.setInt(fbdo, "/sensors/feedLevel", feedLevel);
      Firebase.setInt(fbdo, "/sensors/waterLevel", waterLevel);
      Firebase.setInt(fbdo, "/sensors/ammoniaLevel", ammoniaLevel);
      Firebase.setInt(fbdo, "/sensors/ammoniaRaw", ammoniaRaw);
      Firebase.setFloat(fbdo, "/sensors/ammoniaBaselineRaw", ammoniaBaselineRaw);
      Firebase.setInt(fbdo, "/sensors/ammoniaDeltaRaw", ammoniaDeltaRaw);
      Firebase.setFloat(fbdo, "/sensors/ammoniaVoltage", ammoniaVoltage);
      Firebase.setTimestamp(fbdo, "/sensors/lastUpdate");
      Serial.println("Data saved to Firebase");
    } else {
      Serial.println("WiFi offline: skipped Firebase save");
    }
    lastFirebase = now;
  }

  checkDayChange();
}
