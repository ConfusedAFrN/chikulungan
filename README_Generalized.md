# ChicKulungan System Capabilities

This document explains what ChicKulungan can do in production, with detailed coverage of software behavior, hardware components, and how each Arduino/ESP32-side module is used in the full system.

---

## 1) End-to-End Capability Scope

ChicKulungan is not only a dashboard; it is an integrated monitoring-and-control system made up of:

- **ESP32 firmware** for sensing, timing, and actuator control
- **MQTT messaging** for near-real-time telemetry and control signals
- **Firebase Realtime Database** for persistent app state and history
- **Web dashboard** for operator workflows
- **GSM/SMS pathway** for critical event escalation

---

## 2) Real-Time Sensing & Telemetry

### Environmental telemetry
The system can acquire and publish:
- Temperature
- Humidity
- Feed level
- Water level
- Ammonia-related values (raw, baseline, delta, voltage, normalized level)

### Streaming behavior
- Sensor data is pushed through MQTT topics (`chickulungan/sensor/...`).
- The dashboard updates in near real time.
- Firebase snapshots provide persistent data continuity.

### Operational impact
- Enables immediate awareness of environmental shifts.
- Supports quick detection of low-feed, low-water, and air-quality concerns.

---

## 3) Command & Actuation Capabilities

### Manual feed operations
Operators can trigger:
- Feed start command
- Emergency feed stop command

### Scheduled feeding support
- System supports schedule-triggered feed control.
- Schedule refresh command can be requested via control topic.

### Actuation hardware behavior
- ESP32 issues STEP/DIR/EN signals to the TMC2209 driver.
- TMC2209 controls the stepper motor used for dispensing feed.

### Operational impact
- Combines automation with manual override for safer operation.

---

## 4) Alerting, Incident State, and Escalation

### Alert lifecycle
The platform supports:
- Warning/critical incident recording
- Unresolved/resolved status tracking
- Alert deduplication and metadata support in data model

### Critical SMS pathway
SMS settings flow includes:
- Single recipient number configuration
- Enable/disable flag
- Number validation (`+63` + 10 digits)
- Test trigger command path (`smsSettings/testTrigger`)

### Operational impact
- Critical events can still reach operators outside the web UI.

---

## 5) Logs, History, and Decision Support

### Logs capability
- Stores operational/system events for audits and debugging.

### Historical capability
- Supports time-based history views and trend interpretation.
- Enables consumption-related event analysis over time.

### Operational impact
- Improves post-incident analysis and long-term optimization.

---

## 6) Connectivity and Device Health Interpretation

### MQTT connection awareness
- Dashboard tracks broker connectivity state.

### ESP online/offline health
- Uses status topic + TTL logic for stale-data handling.
- Prevents false "online" assumptions when updates stop.

### Offline resilience foundations
- RTC + schedule cache concepts support continuity during partial outages.

---

## 7) Arduino/ESP32 Hardware Components and Their Roles

| Hardware Component | System Role | Why It Matters |
|---|---|---|
| **ESP32 Dev Board** | Central controller for sensing, compute, network I/O, and control publishing | Core processing + Wi-Fi platform |
| **DHT22** | Air temperature/humidity input | Primary environmental comfort indicator |
| **HC-SR04 Ultrasonic** | Feed-bin distance measurement | Converts distance trend into feed-level estimation |
| **Water Level Analog Sensor** | Water reserve level signal | Tracks hydration resource status |
| **MQ-135 Gas Sensor** | Analog gas signal for ammonia-related monitoring | Early indicator for poor air-quality conditions |
| **TMC2209 Driver** | Stepper motor driver (STEP/DIR/EN) | Reliable motor control and feeder motion |
| **Stepper Motor** | Mechanical feed dispenser | Turns control commands into physical feed output |
| **SIM900 GSM Module** | SMS command execution and message sending | Out-of-band alert channel during critical events |
| **DS1302 RTC Module** | Timekeeping for schedules and periodic tasks | Supports schedule reliability and time continuity |
| **Power Supply Unit** | Delivers operating voltage/current for modules/motor path | Stable electrical foundation for safe operation |
| **Breadboard/Wiring/Resistors** | Interconnection and signal routing/conditioning | Makes complete prototype integration possible |

---

## 8) Firmware Pin-Level Capability Map

The firmware currently maps major functions to the following GPIOs:

| Function | GPIO |
|---|---:|
| DHT22 data | 4 |
| HC-SR04 TRIG | 33 |
| HC-SR04 ECHO | 32 |
| Water analog out | 34 |
| MQ-135 analog out | 35 |
| Stepper STEP | 25 |
| Stepper DIR | 26 |
| Stepper EN | 27 |
| SIM900 RX | 16 |
| SIM900 TX | 17 |
| DS1302 CLK | 18 |
| DS1302 DAT | 19 |
| DS1302 RST | 23 |

These mappings define the concrete hardware interface contract used by the firmware.

---

## 9) Data Backbone Capabilities (Firebase RTDB)

The system reads/writes operational nodes including:

- `sensors`
- `schedules`
- `logs`
- `alerts`
- `history/hourly`
- `history/consumptionEvents`
- `settings/farm`
- `smsSettings`

Detailed schema is documented in `src/Database_Structure.md`.

---

## 10) Progressive Web App Capability

The frontend is configured as a PWA, enabling:
- Installable app-like behavior
- Service-worker-backed update lifecycle
- Better field usability versus a plain tab-only workflow

---

## 11) Operator-Facing Capability Summary

In practical farm operations, ChicKulungan delivers:

1. **Observe** real-time environmental and resource conditions.
2. **Act** through manual feed controls and schedule management.
3. **Respond** to incidents with in-app alerts and SMS escalation.
4. **Review** logs and history for root-cause analysis.
5. **Sustain** operations through connectivity/state health awareness.
