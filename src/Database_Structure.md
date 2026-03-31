# ChicKulungan Firebase Realtime Database Structure (Updated)

> This document reflects the database paths currently used by the web application, including the new SMS feature.

## 1) Tree View (Manuscript-Friendly Visualization)

```text
/
├─ sensors
│  ├─ temperature: Number
│  ├─ humidity: Number
│  ├─ feedLevel: Number
│  ├─ waterLevel: Number
│  ├─ ammoniaLevel: Number
│  ├─ ammoniaRaw: Number
│  ├─ ammoniaBaselineRaw: Number
│  ├─ ammoniaDeltaRaw: Number
│  ├─ ammoniaVoltage: Number
│  └─ lastUpdate: Number (Unix ms)
│
├─ schedules
│  └─ {scheduleId}
│     ├─ days: Array<String>
│     ├─ time: String (e.g., "06:30 AM")
│     ├─ enabled: Boolean
│     ├─ createdAt: Number (Unix ms)
│     └─ group: String ("starter" | "grower" | "maintenance" | "custom")
│
├─ logs
│  └─ {logId}
│     ├─ message: String
│     ├─ source: String ("esp32" | "web" | "system")
│     └─ timestamp: Number (Unix ms) | Firebase server timestamp value
│
├─ alerts
│  └─ {alertId}
│     ├─ type: String
│     ├─ message: String
│     ├─ severity: String ("warning" | "critical")
│     ├─ timestamp: Number (Unix ms)
│     ├─ resolved: Boolean
│     ├─ source: String (typically "web")
│     ├─ dedupeKey: String
│     ├─ meta: Object (optional)
│     ├─ resolvedAt: Number (Unix ms, optional)
│     └─ resolvedBy: String (optional, e.g., "auto")
│
├─ history
│  ├─ hourly
│  │  └─ {YYYY-MM-DD}
│  │     └─ {HH}
│  │        ├─ timestamp: Number (Unix ms)
│  │        ├─ temp: Number
│  │        ├─ humidity: Number
│  │        ├─ feedLevel: Number
│  │        ├─ waterLevel: Number
│  │        └─ timeZone: String
│  └─ consumptionEvents
│     └─ {eventId}
│        ├─ timestamp: Number (Unix ms)
│        ├─ dayKey: String (YYYY-MM-DD)
│        ├─ hourKey: String (HH)
│        ├─ type: String ("feed" | "water")
│        ├─ dropPercent: Number
│        ├─ amount: Number
│        ├─ unit: String ("g" | "ml")
│        └─ source: String (e.g., "natural_drop")
│
├─ settings
│  └─ farm
│     └─ timeZone: String (IANA timezone, e.g., "Asia/Manila")
│
└─ smsSettings
   ├─ phone: String (E.164 PH format, e.g., "+639123456789")
   ├─ enabled: Boolean
   ├─ lastUpdated: Number (Unix ms)
   └─ testTrigger
      ├─ command: String ("TEST_SMS")
      └─ timestamp: Number (Unix ms)
```

---

## 2) Table View (for Thesis Manuscript)

| Node/Path | Key Example | Data Type | Sample Value / Format |
|---|---|---|---|
| `/sensors` | *(single object)* | Object | — |
| `├ temperature` | `temperature` | Number | `32.5` |
| `├ humidity` | `humidity` | Number | `68` |
| `├ feedLevel` | `feedLevel` | Number | `45` |
| `├ waterLevel` | `waterLevel` | Number | `72` |
| `├ ammoniaLevel` | `ammoniaLevel` | Number | `37` |
| `├ ammoniaRaw` | `ammoniaRaw` | Number | `512` |
| `├ ammoniaBaselineRaw` | `ammoniaBaselineRaw` | Number | `490` |
| `├ ammoniaDeltaRaw` | `ammoniaDeltaRaw` | Number | `22` |
| `├ ammoniaVoltage` | `ammoniaVoltage` | Number | `1.874` |
| `└ lastUpdate` | `lastUpdate` | Number | `1738700000000` |
| `/schedules` | `-N123abc...` | Object | *(auto-generated key)* |
| `├ days` | `days` | Array<String> | `["Monday","Wednesday","Friday"]` |
| `├ time` | `time` | String | `"06:30 AM"` |
| `├ enabled` | `enabled` | Boolean | `true` |
| `├ createdAt` | `createdAt` | Number | `1738700000000` |
| `└ group` | `group` | String | `"custom"` |
| `/logs` | `-N456def...` | Object | *(auto-generated key)* |
| `├ message` | `message` | String | `"Feeding activated - Schedule: 06:30 AM"` |
| `├ source` | `source` | String | `"esp32"` or `"web"` |
| `└ timestamp` | `timestamp` | Number / Server Timestamp | `1738791234567` |
| `/alerts` | `-N789ghi...` | Object | *(auto-generated key)* |
| `├ type` | `type` | String | `"Low Feed"` |
| `├ message` | `message` | String | `"Feed level is low (12%)"` |
| `├ severity` | `severity` | String | `"critical"` or `"warning"` |
| `├ timestamp` | `timestamp` | Number | `1738795000000` |
| `├ resolved` | `resolved` | Boolean | `false` |
| `├ source` | `source` | String | `"web"` |
| `├ dedupeKey` | `dedupeKey` | String | `"low-feed"` |
| `├ meta` | `meta` | Object *(optional)* | `{ "threshold": 20 }` |
| `├ resolvedAt` | `resolvedAt` | Number *(optional)* | `1738798600000` |
| `└ resolvedBy` | `resolvedBy` | String *(optional)* | `"auto"` |
| `/history/hourly` | `2026-03-30/14` | Object | grouped by day + hour |
| `├ timestamp` | `timestamp` | Number | `1738796400000` |
| `├ temp` | `temp` | Number | `31.4` |
| `├ humidity` | `humidity` | Number | `71` |
| `├ feedLevel` | `feedLevel` | Number | `54` |
| `├ waterLevel` | `waterLevel` | Number | `62` |
| `└ timeZone` | `timeZone` | String | `"Asia/Manila"` |
| `/history/consumptionEvents` | `-Nabc123...` | Object | *(auto-generated key)* |
| `├ timestamp` | `timestamp` | Number | `1738796450000` |
| `├ dayKey` | `dayKey` | String | `"2026-03-30"` |
| `├ hourKey` | `hourKey` | String | `"14"` |
| `├ type` | `type` | String | `"feed"` or `"water"` |
| `├ dropPercent` | `dropPercent` | Number | `2.35` |
| `├ amount` | `amount` | Number | `7.76` |
| `├ unit` | `unit` | String | `"g"` or `"ml"` |
| `└ source` | `source` | String | `"natural_drop"` |
| `/settings/farm` | `timeZone` | String | `"Asia/Manila"` |
| `/smsSettings` | *(single object)* | Object | — |
| `├ phone` | `phone` | String | `"+639123456789"` |
| `├ enabled` | `enabled` | Boolean | `true` |
| `├ lastUpdated` | `lastUpdated` | Number | `1738800000000` |
| `└ testTrigger` | `testTrigger` | Object | — |
| `  ├ command` | `command` | String | `"TEST_SMS"` |
| `  └ timestamp` | `timestamp` | Number | `1738800005000` |

---

## 3) Notes for manuscript consistency

1. The old manuscript path names `temp`, `feed`, and `water` under `/sensors` should be updated to `temperature`, `feedLevel`, and `waterLevel`.
2. Alerts now include deduplication and auto-resolution metadata (`dedupeKey`, `resolvedAt`, `resolvedBy`).
3. SMS configuration is stored in `/smsSettings` and test commands in `/smsSettings/testTrigger`.
4. Historical analytics now include `/history/hourly` and `/history/consumptionEvents`.
