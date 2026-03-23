// src/AlertEngine.jsx
import { useEffect, useRef, useState, useCallback } from "react";
import { db, ref, onValue, push, set } from "./firebase";
import { format } from "date-fns";
import { toast } from "./utils/feedback";

const alertThresholds = {
  lowFeed: 20,      // unchanged (good)
  criticalFeed: 10, // unchanged
  lowWater: 20,
  criticalWater: 10,
  highAmmonia: 35,
  criticalAmmonia: 70,
  highTemp: 30,           // ← was 35; stress onset ~30°C (Aviagen/UGA)
  lowTemp: 22,            // ← was 18; protects young birds (needs 28+ early)
  criticalHighTemp: 35,   // ← tightened from 39; heat stress rapid above this
  criticalLowTemp: 18,    // ← was 15; hypothermia risk clear
  highHumidity: 75,       // ← was 80; prevents wet litter/ammonia (target <70–75%)
  lowHumidity: 45,        // ← was 40; avoids dust/dehydration (target >50%)
  rapidTempChange: 4,     // keep (engineering)
  rapidHumidityChange: 12,
  rapidChangeWindowMs: 2 * 60 * 1000,
  staleDataWarningMs: 45 * 1000,
};

const OFFLINE_AFTER_MS = 90 * 1000; // 90s offline threshold

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SCHEDULE_TRIGGER_WINDOW_MS = 70 * 1000;
const SCHEDULE_CONFIRM_WINDOW_MS = 4 * 60 * 1000;
const SCHEDULE_EVAL_TICK_MS = 15 * 1000;
const SCHEDULE_MIN_FEED_DROP = 1;

// =====================
// Reminders (unresolved)
// =====================
const REMINDER_CRITICAL_MS = 10 * 60 * 1000; // 10 minutes (anti-spam)
const REMINDER_WARNING_MS = 30 * 60 * 1000; // 30 minutes (anti-spam)
const REMINDER_TICK_MS = 60 * 1000; // check every 60 seconds
const REMINDER_STORAGE_KEY = "alertReminderState_v1";

// If true, only reminds when tab is not focused (less annoying while actively using app)
const REMIND_ONLY_WHEN_HIDDEN = true;
const FEED_CAPACITY_GRAMS = 2000;
const WATER_CAPACITY_ML = 4000;
const MIN_CONSUMPTION_DROP_PERCENT = 0.1;

function getDateTimePartsInZone(ts, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(new Date(ts));
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const dayKey = `${map.year}-${map.month}-${map.day}`;
  const hourKey = map.hour;
  return { dayKey, hourKey };
}

function ensureNotificationPermissionOnce() {
  try {
    if (!("Notification" in window)) return;
    const asked = localStorage.getItem("notifAsked");
    if (asked) return;

    localStorage.setItem("notifAsked", "1");

    setTimeout(() => {
      try {
        if (Notification.permission === "default") {
          Notification.requestPermission().catch(() => {
            /* noop */
          });
        }
      } catch {
        /* noop */
      }
    }, 500);
  } catch {
    /* noop */
  }
}

function fireBrowserNotification(title, body, options = {}) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  // Prefer service-worker notifications when available:
  // better support on mobile + works reliably with installed PWAs.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready
      .then((registration) => {
        if (registration?.showNotification) {
          return registration.showNotification(title, {
            body,
            tag: options.tag || "chickulungan-alert",
            renotify: Boolean(options.renotify),
          });
        }

        // Fallback to window notification.
        new Notification(title, { body });
      })
      .catch(() => {
        // Fallback if service worker isn't ready yet.
        try {
          new Notification(title, { body });
        } catch {
          /* noop */
        }
      });
    return;
  }

  try {
    new Notification(title, { body });
  } catch {
    /* noop */
  }
}

function formatElapsed(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (hours === 0 && seconds > 0) parts.push(`${seconds}s`);

  return parts.join(" ") || "0s";
}

function loadReminderState() {
  try {
    return JSON.parse(localStorage.getItem(REMINDER_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveReminderState(state) {
  try {
    localStorage.setItem(REMINDER_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* noop */
  }
}

function normalizeSeverity(sev) {
  return sev === "critical" ? "critical" : "warning";
}

function parseScheduleTimeToday(timeStr, nowMs = Date.now()) {
  if (!timeStr || typeof timeStr !== "string") return null;

  const m = timeStr.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;

  let hours = Number(m[1]);
  const minutes = Number(m[2]);
  const period = String(m[3]).toUpperCase();

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;

  const d = new Date(nowMs);
  d.setHours(hours, minutes, 0, 0);
  return d.getTime();
}

function summarizeUnresolved(alertsObj) {
  const list = Object.entries(alertsObj || {})
    .map(([id, a]) => ({ id, ...(a || {}) }))
    .filter((a) => a && !a.resolved);

  // priority: critical first, then newest
  list.sort((a, b) => {
    const as = normalizeSeverity(a.severity);
    const bs = normalizeSeverity(b.severity);
    if (as !== bs) return as === "critical" ? -1 : 1;
    return (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0);
  });

  const criticalCount = list.filter((a) => normalizeSeverity(a.severity) === "critical").length;
  const warningCount = list.length - criticalCount;

  return { list, total: list.length, criticalCount, warningCount };
}

export default function AlertEngine() {
  const hasRealDataRef = useRef(false);
  const farmTimeZoneRef = useRef(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const prevLevelsRef = useRef({ feed: null, water: null, timestamp: null });
  const lastWrittenHourRef = useRef("");

  const sensorsRef = useRef({ temp: 0, humidity: 0, feed: 0, water: 0, ammonia: 0 });
  const sensorTrendRef = useRef({
    temp: { value: null, timestamp: null },
    humidity: { value: null, timestamp: null },
  });
  const lastUpdateMsRef = useRef(null);

  const alertsSnapshotRef = useRef({});
  const schedulesSnapshotRef = useRef({});
  const scheduleFeedChecksRef = useRef({});
  const resolvingIdsRef = useRef(new Set());
  const [ready, setReady] = useState(false);

  // Debounce per alert type
  const lastAlertTimesRef = useRef({}); // { type: timestamp }

  // Reminder state: { [alertId]: lastNotifiedMs }
  const reminderStateRef = useRef(loadReminderState());

  // Keep a local snapshot of /alerts to detect duplicates + do reminders
  useEffect(() => {
    ensureNotificationPermissionOnce();

    const unsubAlerts = onValue(ref(db, "alerts"), (snap) => {
      alertsSnapshotRef.current = snap.val() || {};
      setReady(true);
    });

    return () => unsubAlerts();
  }, []);

  const shouldCreateAlert = useCallback((type, now, dedupeKey = type) => {
    // 1) Debounce: one per 60s per type
    const last = lastAlertTimesRef.current[type] || 0;
    if (now - last < 60000) return false;

    // 2) Prevent duplicates: same type unresolved within last 1 hour
    const existing = alertsSnapshotRef.current || {};
    const duplicate = Object.values(existing).some((a) => {
      if (!a) return false;
      const ts = Number(a.timestamp || 0);
      const key = String(a.dedupeKey || a.type || "");
      return key === dedupeKey && !a.resolved && now - ts < 3600000;
    });

    return !duplicate;
  }, []);

  const createAlert = useCallback(
    async ({ type, message, severity, dedupeKey = type, meta = null }) => {
      const now = Date.now();
      if (!shouldCreateAlert(type, now, dedupeKey)) return;

      const newRef = push(ref(db, "alerts"));
      const payload = {
        type,
        message,
        severity, // "warning" | "critical"
        timestamp: now,
        resolved: false,
        source: "web", // created by the web app engine
        dedupeKey,
      };

      if (meta && typeof meta === "object") payload.meta = meta;

      await set(newRef, payload);
      lastAlertTimesRef.current[type] = now;

      // Toast + browser notif (immediate)
      toast(`${type}: ${message}`, severity === "critical" ? "error" : "warning");
      fireBrowserNotification(`ChicKulungan Alert: ${type}`, message);
    },
    [shouldCreateAlert]
  );

  useEffect(() => {
    const unsubSchedules = onValue(ref(db, "schedules"), (snap) => {
      schedulesSnapshotRef.current = snap.val() || {};
    });

    return () => unsubSchedules();
  }, []);

  useEffect(() => {
    const unsubFarmTz = onValue(ref(db, "settings/farm/timeZone"), (snap) => {
      const tz = String(snap.val() || "").trim();
      if (!tz) return;
      farmTimeZoneRef.current = tz;
    });

    return () => unsubFarmTz();
  }, []);

  const persistHourlyAndConsumption = useCallback(async () => {
    const now = Date.now();
    const timeZone = farmTimeZoneRef.current || "UTC";
    const s = sensorsRef.current;
    const { dayKey, hourKey } = getDateTimePartsInZone(now, timeZone);

    const hourPath = `history/hourly/${dayKey}/${hourKey}`;
    const hourStampKey = `${dayKey}-${hourKey}`;

    if (lastWrittenHourRef.current !== hourStampKey) {
      lastWrittenHourRef.current = hourStampKey;
      await set(ref(db, hourPath), {
        timestamp: now,
        temp: Number(s.temp ?? 0),
        humidity: Number(s.humidity ?? 0),
        feedLevel: Number(s.feed ?? 0),
        waterLevel: Number(s.water ?? 0),
        timeZone,
      });
    }

    const prev = prevLevelsRef.current;
    const currentFeed = Number(s.feed ?? 0);
    const currentWater = Number(s.water ?? 0);

    if (prev.feed == null || prev.water == null) {
      prevLevelsRef.current = { feed: currentFeed, water: currentWater, timestamp: now };
      return;
    }

    const feedDropPercent = Number((prev.feed - currentFeed).toFixed(3));
    const waterDropPercent = Number((prev.water - currentWater).toFixed(3));

    if (feedDropPercent >= MIN_CONSUMPTION_DROP_PERCENT) {
      await push(ref(db, "history/consumptionEvents"), {
        timestamp: now,
        dayKey,
        hourKey,
        type: "feed",
        dropPercent: feedDropPercent,
        amount: Number(((feedDropPercent / 100) * FEED_CAPACITY_GRAMS).toFixed(2)),
        unit: "g",
        source: "natural_drop",
      });
    }

    if (waterDropPercent >= MIN_CONSUMPTION_DROP_PERCENT) {
      await push(ref(db, "history/consumptionEvents"), {
        timestamp: now,
        dayKey,
        hourKey,
        type: "water",
        dropPercent: waterDropPercent,
        amount: Number(((waterDropPercent / 100) * WATER_CAPACITY_ML).toFixed(2)),
        unit: "ml",
        source: "natural_drop",
      });
    }

    prevLevelsRef.current = { feed: currentFeed, water: currentWater, timestamp: now };
  }, []);

  const resolveAlertsByPredicate = useCallback(async (predicate) => {
    const entries = Object.entries(alertsSnapshotRef.current || {});

    const targets = entries.filter(([id, alert]) => {
      if (!alert || alert.resolved) return false;
      if (resolvingIdsRef.current.has(id)) return false;
      return predicate(alert);
    });

    if (!targets.length) return;

    await Promise.all(
      targets.map(async ([id, alert]) => {
        resolvingIdsRef.current.add(id);
        try {
          await set(ref(db, `alerts/${id}`), {
            ...alert,
            resolved: true,
            resolvedAt: Date.now(),
            resolvedBy: "auto",
          });
        } finally {
          resolvingIdsRef.current.delete(id);
        }
      })
    );
  }, []);

  const autoResolveStabilizedAlerts = useCallback(async () => {
    const s = sensorsRef.current;

    const isTempNormal =
      Number.isFinite(Number(s.temp)) &&
      Number(s.temp) >= alertThresholds.lowTemp &&
      Number(s.temp) <= alertThresholds.highTemp;
    const isHumidityNormal =
      Number.isFinite(Number(s.humidity)) &&
      Number(s.humidity) >= alertThresholds.lowHumidity &&
      Number(s.humidity) <= alertThresholds.highHumidity;
    const isFeedNormal = Number.isFinite(Number(s.feed)) && Number(s.feed) >= alertThresholds.lowFeed;
    const isWaterNormal = Number.isFinite(Number(s.water)) && Number(s.water) >= alertThresholds.lowWater; // <- UPDATED
    const isAmmoniaNormal =
      Number.isFinite(Number(s.ammonia)) && Number(s.ammonia) < alertThresholds.highAmmonia;

    await resolveAlertsByPredicate((a) => {
      const type = String(a.type || "").toLowerCase();

      if (type.includes("temperature")) return isTempNormal;
      if (type.includes("humidity")) return isHumidityNormal;
      if (type.includes("feed")) return isFeedNormal;
      if (type.includes("water")) return isWaterNormal;   // <- ADDED
      if (type.includes("ammonia")) return isAmmoniaNormal;

      return false;
    });
  }, [resolveAlertsByPredicate]);

  const autoResolveOfflineAlertsIfRecovered = useCallback(async () => {
    const lastUpdate = Number(lastUpdateMsRef.current || 0);
    if (!lastUpdate) return;

    const age = Date.now() - lastUpdate;
    if (age > OFFLINE_AFTER_MS) return;

    await resolveAlertsByPredicate((a) => String(a.type || "").toLowerCase() === "device offline");
  }, [resolveAlertsByPredicate]);

  const evaluateAlerts = useCallback(async () => {
    const lastUpdate = Number(lastUpdateMsRef.current || 0);
    if (!hasRealDataRef.current || !lastUpdate) return;

    // Don't generate low-feed/humidity/temp alerts if device is already "offline"
    const age = Date.now() - lastUpdate;
    if (age > OFFLINE_AFTER_MS) return;

    const s = sensorsRef.current;

    const feedValue = Number(s.feed);
    const waterValue = Number(s.water);
    const tempValue = Number(s.temp);
    const humidityValue = Number(s.humidity);
    const ammoniaValue = Number(s.ammonia);
    const isStale = age > alertThresholds.staleDataWarningMs;

    const candidates = [
      {
        condition: feedValue < alertThresholds.criticalFeed,
        type: "Feed Critically Low",
        message: `Feed level is critically low (${feedValue}%)`,
        severity: "critical",
      },
      {
        condition:
          feedValue < alertThresholds.lowFeed && feedValue >= alertThresholds.criticalFeed,
        type: "Low Feed",
        message: `Feed level is low (${feedValue}%)`,
        severity: "warning",
      },
      {
        condition: waterValue < alertThresholds.criticalWater,
        type: "Water Critically Low",
        message: `Water level is critically low (${waterValue}%)`,
        severity: "critical",
      },
      {
        condition:
          waterValue < alertThresholds.lowWater && waterValue >= alertThresholds.criticalWater,
        type: "Low Water",
        message: `Water level is low (${waterValue}%)`,
        severity: "warning",
      },
      {
        condition: tempValue >= alertThresholds.criticalHighTemp,
        type: "Critical High Temperature",
        message: `Temperature is critically high (${tempValue} degC)`,
        severity: "critical",
      },
      {
        condition:
          tempValue > alertThresholds.highTemp && tempValue < alertThresholds.criticalHighTemp,
        type: "High Temperature",
        message: `Temperature too high (${tempValue} degC)`,
        severity: "warning",
      },
      {
        condition: tempValue <= alertThresholds.criticalLowTemp,
        type: "Critical Low Temperature",
        message: `Temperature is critically low (${tempValue} degC)`,
        severity: "critical",
      },
      {
        condition: tempValue < alertThresholds.lowTemp && tempValue > alertThresholds.criticalLowTemp,
        type: "Low Temperature",
        message: `Temperature too low (${tempValue} degC)`,
        severity: "warning",
      },
      {
        condition: humidityValue > alertThresholds.highHumidity,
        type: "High Humidity",
        message: `Humidity too high (${humidityValue}%)`,
        severity: "warning",
      },
      {
        condition: humidityValue < alertThresholds.lowHumidity,
        type: "Low Humidity",
        message: `Humidity too low (${humidityValue}%)`,
        severity: "warning",
      },
      {
        condition: ammoniaValue >= alertThresholds.criticalAmmonia,
        type: "Critical High Ammonia",
        message: `Ammonia is critically high (${ammoniaValue}%)`,
        severity: "critical",
      },
      {
        condition:
          ammoniaValue >= alertThresholds.highAmmonia &&
          ammoniaValue < alertThresholds.criticalAmmonia,
        type: "High Ammonia",
        message: `Ammonia is elevated (${ammoniaValue}%)`,
        severity: "warning",
      },
      {
        condition: isStale,
        type: "Sensor Data Stale",
        message: `No fresh sensor payload for ${formatElapsed(age)}.`,
        severity: "warning",
      },
    ];

    for (const a of candidates) {
      if (a.condition) await createAlert(a);
    }
  }, [createAlert]);

  const evaluateRapidChanges = useCallback(async () => {
    const now = Number(lastUpdateMsRef.current || Date.now());
    const trend = sensorTrendRef.current;
    const current = sensorsRef.current;

    const checks = [
      {
        key: "temp",
        type: "Rapid Temperature Change",
        units: " degC",
        threshold: alertThresholds.rapidTempChange,
        severity: "warning",
      },
      {
        key: "humidity",
        type: "Rapid Humidity Change",
        units: "%",
        threshold: alertThresholds.rapidHumidityChange,
        severity: "warning",
      },
    ];

    for (const check of checks) {
      const previous = trend[check.key];
      const currentValue = Number(current[check.key]);
      if (!Number.isFinite(currentValue)) continue;

      if (previous?.timestamp && now - previous.timestamp <= alertThresholds.rapidChangeWindowMs) {
        const delta = Math.abs(currentValue - Number(previous.value));
        if (delta >= check.threshold) {
          await createAlert({
            type: check.type,
            message: `${check.key === "temp" ? "Temperature" : "Humidity"} shifted by ${delta.toFixed(
              1
            )}${check.units} in under ${Math.round(
              alertThresholds.rapidChangeWindowMs / 60000
            )} minutes.`,
            severity: check.severity,
          });
        }
      }

      trend[check.key] = { value: currentValue, timestamp: now };
    }
  }, [createAlert]);

  const evaluateOffline = useCallback(async () => {
    const lastUpdate = Number(lastUpdateMsRef.current || 0);
    if (!lastUpdate) return;

    const age = Date.now() - lastUpdate;
    if (age > OFFLINE_AFTER_MS) {
      await createAlert({
        type: "Device Offline",
        message: `No ESP32 update for ${formatElapsed(age)}`,
        severity: "critical",
      });
    }
  }, [createAlert]);

  const evaluateScheduledFeedChecks = useCallback(async () => {
    const schedulesObj = schedulesSnapshotRef.current || {};
    const now = Date.now();
    const dayName = DAYS[new Date(now).getDay()];
    const feedNow = Number(sensorsRef.current.feed);

    for (const [id, schedule] of Object.entries(schedulesObj)) {
      if (!schedule?.enabled) continue;

      const days = Array.isArray(schedule.days) ? schedule.days : [];
      if (!days.includes(dayName)) continue;

      const scheduledTs = parseScheduleTimeToday(schedule.time, now);
      if (!scheduledTs) continue;

      const occurrenceKey = `${id}:${format(new Date(now), "yyyy-MM-dd")}:${schedule.time}`;
      const existing = scheduleFeedChecksRef.current[occurrenceKey];

      const withinTriggerWindow = now >= scheduledTs && now - scheduledTs <= SCHEDULE_TRIGGER_WINDOW_MS;
      if (withinTriggerWindow && !existing) {
        scheduleFeedChecksRef.current[occurrenceKey] = {
          createdAt: now,
          scheduledTs,
          deadline: scheduledTs + SCHEDULE_CONFIRM_WINDOW_MS,
          baselineFeed: feedNow,
          scheduleId: id,
          scheduleTime: schedule.time,
        };

        await createAlert({
          type: "Scheduled Feeding Triggered",
          message: `Schedule ${schedule.time} was reached. Waiting for feed drop confirmation.`,
          severity: "warning",
          dedupeKey: `scheduled-trigger:${occurrenceKey}`,
          meta: { scheduleId: id, scheduleTime: schedule.time, scheduledTs },
        });
      }
    }

    const pending = { ...(scheduleFeedChecksRef.current || {}) };
    for (const [occurrenceKey, state] of Object.entries(pending)) {
      const baseline = Number(state.baselineFeed);
      const drop = Number((baseline - feedNow).toFixed(2));

      const lastUpdate = Number(lastUpdateMsRef.current || 0);
      const offlineAge = lastUpdate ? now - lastUpdate : Infinity;

      if (drop >= SCHEDULE_MIN_FEED_DROP) {
        await createAlert({
          type: "Scheduled Feeding Confirmed",
          message: `Feed dropped by ${drop}% after schedule ${state.scheduleTime}. Dispense verified.`,
          severity: "warning",
          dedupeKey: `scheduled-confirm:${occurrenceKey}`,
          meta: {
            scheduleId: state.scheduleId,
            scheduleTime: state.scheduleTime,
            drop,
            baseline,
            currentFeed: feedNow,
          },
        });
        delete scheduleFeedChecksRef.current[occurrenceKey];
        continue;
      }

      if (offlineAge > OFFLINE_AFTER_MS && now >= state.scheduledTs && now <= state.deadline + 60 * 1000) {
        await createAlert({
          type: "Feeding Process Disrupted",
          message: `Device went offline while verifying scheduled feed (${state.scheduleTime}).`,
          severity: "critical",
          dedupeKey: `scheduled-disrupted-offline:${occurrenceKey}`,
          meta: { scheduleId: state.scheduleId, scheduleTime: state.scheduleTime, offlineAge },
        });
        delete scheduleFeedChecksRef.current[occurrenceKey];
        continue;
      }

      if (now > state.deadline) {
        await createAlert({
          type: "Feeding Process Disrupted",
          message: `No feed drop detected within ${Math.round(
            SCHEDULE_CONFIRM_WINDOW_MS / 60000
          )} minutes after schedule ${state.scheduleTime}.`,
          severity: "critical",
          dedupeKey: `scheduled-disrupted-timeout:${occurrenceKey}`,
          meta: {
            scheduleId: state.scheduleId,
            scheduleTime: state.scheduleTime,
            baseline,
            currentFeed: feedNow,
            expectedDrop: SCHEDULE_MIN_FEED_DROP,
          },
        });
        delete scheduleFeedChecksRef.current[occurrenceKey];
      }
    }
  }, [createAlert]);

  // [ok] NEW: Remind unresolved alerts on a schedule until resolved
  const remindUnresolvedAlerts = useCallback(() => {
    if (!ready) return;

    if (REMIND_ONLY_WHEN_HIDDEN && document.visibilityState === "visible") return;

    const alertsObj = alertsSnapshotRef.current || {};
    const { list, total } = summarizeUnresolved(alertsObj);
    if (total === 0) return;

    const now = Date.now();
    let remindedAny = false;

    // Remind only 1 alert per tick to reduce notification pressure on browsers.
    const toConsider = list.slice(0, 1);

    for (const a of toConsider) {
      const sev = normalizeSeverity(a.severity);
      const interval = sev === "critical" ? REMINDER_CRITICAL_MS : REMINDER_WARNING_MS;

      const lastNotified = Number(reminderStateRef.current[a.id] || 0);
      if (now - lastNotified < interval) continue;

      reminderStateRef.current[a.id] = now;
      remindedAny = true;

      const title =
        sev === "critical"
          ? "ChicKulungan: Critical Alert Reminder"
          : "ChicKulungan: Alert Reminder";

      const body = `${a.type || "Alert"} - ${a.message || ""}`.slice(0, 160);

      toast(
        `REMINDER (${sev.toUpperCase()}): ${a.type}: ${a.message}`,
        sev === "critical" ? "error" : "warning"
      );
      fireBrowserNotification(title, body, {
        tag: sev === "critical" ? "chickulungan-alert-critical" : "chickulungan-alert-warning",
        renotify: sev === "critical",
      });
    }

    // Persist reminder timestamps only when we actually notified.
    if (remindedAny) saveReminderState(reminderStateRef.current);

    // Cleanup reminder state for resolved/removed alerts
    const cleaned = {};
    for (const [id, ts] of Object.entries(reminderStateRef.current || {})) {
      const alert = alertsObj[id];
      if (alert && !alert.resolved) cleaned[id] = ts;
    }
    reminderStateRef.current = cleaned;
    saveReminderState(cleaned);
  }, [ready]);

  // [ok] Firebase sensors listener (works even if MQTT is dead)
  useEffect(() => {
    if (!ready) return;

    const unsub = onValue(ref(db, "sensors"), (snap) => {
      const data = snap.val();
      if (!data) return;

      sensorsRef.current.temp = Number(data.temperature ?? sensorsRef.current.temp ?? 0);
      sensorsRef.current.humidity = Number(data.humidity ?? sensorsRef.current.humidity ?? 0);
      sensorsRef.current.feed = Number(data.feedLevel ?? sensorsRef.current.feed ?? 0);
      sensorsRef.current.water = Number(data.waterLevel ?? sensorsRef.current.water ?? 0);
      sensorsRef.current.ammonia = Number(data.ammoniaLevel ?? sensorsRef.current.ammonia ?? 0);

      if (data.lastUpdate != null) {
        const v = Number(data.lastUpdate);
        if (!Number.isNaN(v)) lastUpdateMsRef.current = v;
        hasRealDataRef.current = true; // only after ESP32 writes lastUpdate
      }

      evaluateAlerts();
      evaluateRapidChanges();
      evaluateOffline();
      evaluateScheduledFeedChecks();
      autoResolveStabilizedAlerts();
      autoResolveOfflineAlertsIfRecovered();
      persistHourlyAndConsumption().catch(() => {
        /* noop */
      });
    });

    return () => unsub();
  }, [
    ready,
    evaluateAlerts,
    evaluateOffline,
    evaluateRapidChanges,
    evaluateScheduledFeedChecks,
    autoResolveStabilizedAlerts,
    autoResolveOfflineAlertsIfRecovered,
    persistHourlyAndConsumption,
  ]);

  // [ok] MQTT listener (fast updates)
  useEffect(() => {
    if (!ready) return;

    const handler = (e) => {
      const { topic, payload } = e.detail || {};
      if (!topic) return;

      if (topic === "chickulungan/sensor/temp") {
        sensorsRef.current.temp = parseFloat(payload) || 0;
        evaluateAlerts();
        evaluateRapidChanges();
        autoResolveStabilizedAlerts();
        persistHourlyAndConsumption().catch(() => {
          /* noop */
        });
      } else if (topic === "chickulungan/sensor/humidity") {
        sensorsRef.current.humidity = parseFloat(payload) || 0;
        evaluateAlerts();
        evaluateRapidChanges();
        autoResolveStabilizedAlerts();
        persistHourlyAndConsumption().catch(() => {
          /* noop */
        });
      } else if (topic === "chickulungan/sensor/feed") {
        sensorsRef.current.feed = parseInt(payload, 10) || 0;
        evaluateAlerts();
        evaluateScheduledFeedChecks();
        autoResolveStabilizedAlerts();
        persistHourlyAndConsumption().catch(() => {
          /* noop */
        });
      } else if (topic === "chickulungan/sensor/water") {
        sensorsRef.current.water = parseInt(payload, 10) || 0;
        evaluateAlerts();                    // <- NOW triggers Low Water check
        autoResolveStabilizedAlerts();
        persistHourlyAndConsumption().catch(() => {
          /* noop */
        });
      } else if (topic === "chickulungan/sensor/ammonia") {
        sensorsRef.current.ammonia = parseInt(payload, 10) || 0;
        evaluateAlerts();
        autoResolveStabilizedAlerts();
        persistHourlyAndConsumption().catch(() => {
          /* noop */
        });
      } else if (topic === "chickulungan/status") {
        // optional: online/offline by MQTT LWT can be added later
      }
    };

    window.addEventListener("mqtt-message", handler);
    return () => window.removeEventListener("mqtt-message", handler);
  }, [ready, evaluateAlerts, evaluateRapidChanges, evaluateScheduledFeedChecks, autoResolveStabilizedAlerts, persistHourlyAndConsumption]);

  // Periodic offline check even if nothing changes
  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => {
      evaluateOffline();
      evaluateScheduledFeedChecks();
      autoResolveOfflineAlertsIfRecovered();
    }, 5000);
    return () => clearInterval(t);
  }, [ready, evaluateOffline, evaluateScheduledFeedChecks, autoResolveOfflineAlertsIfRecovered]);

  // Scheduled feed verification tick
  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => {
      evaluateScheduledFeedChecks();
    }, SCHEDULE_EVAL_TICK_MS);
    return () => clearInterval(t);
  }, [ready, evaluateScheduledFeedChecks]);

  // [ok] Periodic reminder tick
  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => {
      remindUnresolvedAlerts();
    }, REMINDER_TICK_MS);
    return () => clearInterval(t);
  }, [ready, remindUnresolvedAlerts]);

  return null;
}
