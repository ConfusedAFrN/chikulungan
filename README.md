# ChicKulungan

ChicKulungan is a smart poultry-house monitoring dashboard that combines real-time telemetry, operational controls, alerts, logs, historical views, and SMS notifications in one web application.

---

## Table of Contents

- [Overview](#overview)
- [Core Features](#core-features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Arduino/ESP32 Components](#arduinoesp32-components)
- [Pinout and Wiring](#pinout-and-wiring)
- [Getting Started](#getting-started)
- [Available Scripts](#available-scripts)
- [Configuration](#configuration)
- [Firebase Data Model](#firebase-data-model)
- [MQTT Topics](#mqtt-topics)
- [PWA Notes](#pwa-notes)
- [Usage Guide](#usage-guide)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Roadmap](#roadmap)

---

## Overview

ChicKulungan is designed for poultry operators and developers who need a reliable interface to monitor environmental conditions, manage schedules, and react quickly to incidents.

The app focuses on:

- **Visibility** – real-time and historical condition tracking
- **Control** – schedule and command workflows for daily operations
- **Safety** – critical alerting with SMS support
- **Traceability** – logs and history for diagnostics and auditing

---

## Core Features

### 1) Real-Time Monitoring

- Live dashboard for temperature, humidity, feed level, water level, and ammonia-related indicators
- MQTT-driven message updates for low-latency UI feedback
- Firebase-backed state synchronization for persistent operational data

### 2) Operations & Control

- Manual feed control commands
- Emergency stop feed command
- Schedule refresh trigger via MQTT control topic

### 3) Scheduling

- Manage feeding schedules with enable/disable controls
- Support for grouped schedule routines

### 4) Alerting & Notifications

- Warning and critical alert flows
- Unresolved incident visibility
- SMS configuration for critical alerts
- Test SMS trigger workflow from the UI

### 5) Logs & History

- Event log review for operational traceability
- Historical records for trend analysis and reporting

### 6) Device/Connectivity Health

- MQTT connection awareness
- Device status handling with TTL-based staleness checks

### 7) User Experience

- Multi-page navigation (Dashboard, Schedules, Alerts, Logs, History, SMS Settings)
- Responsive layout and theme-aware UI components

---

## Tech Stack

| Layer | Tools |
|---|---|
| Frontend | React 19, Vite |
| UI | Material UI (`@mui/material`, icons, charts, data grid, date pickers) |
| Realtime Messaging | MQTT (`mqtt`) |
| Backend/Data | Firebase Realtime Database |
| Routing | `react-router-dom` |
| Charts/Visualization | Recharts, MUI X Charts |
| PWA | `vite-plugin-pwa` |
| Firmware | ESP32 + Arduino ecosystem |
| Linting | ESLint |

---

## Architecture

```text
ESP32 Sensors/Controller
        │
        ├── MQTT topics (sensor/status/log)
        ▼
ChicKulungan Web App (React + Vite)
        │
        ├── Live UI updates from MQTT events
        ├── Read/write operations to Firebase RTDB
        └── Control command publishing (feed/stop/refresh)
        ▼
Firebase Realtime Database
        └── sensors, schedules, alerts, logs, history, smsSettings
```

---

## Project Structure

```text
.
├─ src/
│  ├─ App.jsx
│  ├─ Dashboard.jsx
│  ├─ Schedules.jsx
│  ├─ Alerts.jsx
│  ├─ Logs.jsx
│  ├─ History.jsx
│  ├─ SMSSettings.jsx
│  ├─ mqtt.js
│  ├─ MqttProvider.jsx
│  ├─ firebase.js
│  ├─ Database_Structure.md
│  └─ chikulungan_esp32.ino
├─ public/
├─ vite.config.js
└─ package.json
```

---

## Arduino/ESP32 Components

The hardware side of ChicKulungan is built around an ESP32 controller and supporting sensor/actuator modules.

| Component | Purpose in the System |
|---|---|
| **ESP32 Dev Board** | Main controller; reads sensors, drives actuators, connects to Wi-Fi/MQTT/Firebase. |
| **DHT22** | Measures air temperature and humidity for environmental monitoring. |
| **HC-SR04 Ultrasonic Sensor** | Estimates feed-bin level from distance to feed surface. |
| **Analog Water Level Sensor** | Measures water level percentage in the water container. |
| **MQ-135 Gas Sensor** | Tracks ammonia-related air-quality signal (raw/voltage/normalized level). |
| **TMC2209 Stepper Driver** | Drives feeder motor with STEP/DIR/EN control from ESP32. |
| **Stepper Motor (NEMA-type)** | Mechanically dispenses feed during manual or scheduled runs. |
| **SIM900 GSM Module** | Sends critical SMS alerts and handles test-SMS flow. |
| **DS1302 RTC Module** | Provides hardware timekeeping for schedule reliability and offline fallback timing. |
| **DC Power Supply** | Powers motor/driver and supports overall hardware distribution. |
| **Breadboard + Resistors/Wiring** | Signal routing, level conditioning, and module interconnection. |

---

## Pinout and Wiring

### Pin mapping used in firmware (`src/chikulungan_esp32.ino`)

| Function | Pin |
|---|---:|
| DHT22 data | GPIO 4 |
| HC-SR04 TRIG | GPIO 33 |
| HC-SR04 ECHO | GPIO 32 |
| Water sensor analog out | GPIO 34 |
| MQ-135 analog out | GPIO 35 |
| Stepper STEP (TMC2209) | GPIO 25 |
| Stepper DIR (TMC2209) | GPIO 26 |
| Stepper EN (TMC2209) | GPIO 27 |
| SIM900 RX (ESP32 receives) | GPIO 16 |
| SIM900 TX (ESP32 transmits) | GPIO 17 |
| DS1302 CLK | GPIO 18 |
| DS1302 DAT | GPIO 19 |
| DS1302 RST | GPIO 23 |

### Pinout image

```md
![ChicKulungan hardware pinout](./public/Chikulungan%20Pinout.png)
```

- [Open pinout image](./public/Chikulungan%20Pinout.png)

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Install dependencies

```bash
npm install
```

### Run development server

```bash
npm run dev
```

### Build and preview production bundle

```bash
npm run build
npm run preview
```

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start local development server |
| `npm run build` | Build production bundle |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run ESLint checks |

---

## Configuration

### Current implementation

- Firebase is initialized in `src/firebase.js`.
- MQTT broker endpoint is configured in `src/mqtt.js`.

### Recommended production approach

Move runtime configuration into environment variables.

Example `.env` template:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_DATABASE_URL=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_MEASUREMENT_ID=...

VITE_MQTT_URL=wss://broker.emqx.io:8084/mqtt
```

---

## Firebase Data Model

Main RTDB nodes used by the app:

- `sensors`
- `schedules`
- `alerts`
- `logs`
- `history/hourly`
- `history/consumptionEvents`
- `settings/farm`
- `smsSettings`

Detailed structure reference:

- `src/Database_Structure.md`

---

## MQTT Topics

### Subscriptions

- `chickulungan/sensor/#`
- `chickulungan/log`
- `chickulungan/status`

### Control publishes

- `chickulungan/control/feed`
- `chickulungan/control/stopFeed`
- `chickulungan/control/refreshSchedules`

---

## PWA Notes

The project is configured with `vite-plugin-pwa` and supports installable app behavior.

Current manifest setup includes:

- Name: `ChicKulungan Dashboard`
- Start URL: `/?homescreen=1`
- Icons: `pwa-192x192.png`, `pwa-512x512.png`

---

## Usage Guide

1. **Dashboard:** monitor live telemetry and incident indicators
2. **Schedules:** create/update feeding routines
3. **Alerts:** inspect and manage warning/critical records
4. **Logs:** review operational timeline and event details
5. **History:** analyze trends across time
6. **SMS Settings:** configure critical-alert number and test SMS trigger

---

## Troubleshooting

### MQTT updates are not appearing

- Confirm the broker endpoint is reachable from your network
- Verify topic names exactly match expected `chickulungan/...` routes
- Check browser console for MQTT connection errors

### Device appears offline unexpectedly

- Confirm periodic status publishing from device
- Check status topic payload and timing
- Review TTL/offline thresholds in provider logic

### SMS test command not working

- Enable SMS in settings
- Use valid PH format number (`+63` + 10 digits)
- Confirm downstream consumer handles `/smsSettings/testTrigger`

### Inconsistent live vs stored values

- Validate MQTT payload types/formats
- Validate Firebase schema/path alignment with expected node names

---

## Contributing

1. Keep pull requests focused and scoped
2. Update docs when behavior changes
3. Run local checks before submitting
4. Include clear context in PR descriptions

---

## Roadmap

- [ ] Add `.env.example` and migrate hardcoded config to env loading
- [ ] Add final pinout image path once the image file name is finalized
- [ ] Add visual architecture diagram in `/docs`
- [ ] Document deployment workflow and target environments
- [ ] Expand test strategy section (unit/integration/e2e)
- [ ] Publish explicit MQTT/Firebase contract docs for firmware integration
