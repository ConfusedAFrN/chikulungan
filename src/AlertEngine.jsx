// src/AlertEngine.jsx
import { useEffect, useRef, useState, useCallback } from "react";
import { db, ref, onValue, push, set } from "./firebase";
import { toast } from "./utils/feedback";

const alertThresholds = {
  lowFeed: 20,
  highTemp: 35,
  lowTemp: 18,
  highHumidity: 80,
  lowHumidity: 40,
};

const OFFLINE_AFTER_MS = 90 * 1000; // 90s offline threshold

// =====================
// Reminders (unresolved)
// =====================
const REMINDER_CRITICAL_MS = 10 * 60 * 1000; // 10 minutes (anti-spam)
const REMINDER_WARNING_MS = 30 * 60 * 1000; // 30 minutes (anti-spam)
const REMINDER_TICK_MS = 60 * 1000; // check every 60 seconds
const REMINDER_STORAGE_KEY = "alertReminderState_v1";

// If true, only reminds when tab is not focused (less annoying while actively using app)
const REMIND_ONLY_WHEN_HIDDEN = true;

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

  const sensorsRef = useRef({ temp: 0, humidity: 0, feed: 0, water: 0 });
  const lastUpdateMsRef = useRef(null);

  const alertsSnapshotRef = useRef({});
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

  const shouldCreateAlert = useCallback((type, now) => {
    // 1) Debounce: one per 60s per type
    const last = lastAlertTimesRef.current[type] || 0;
    if (now - last < 60000) return false;

    // 2) Prevent duplicates: same type unresolved within last 1 hour
    const existing = alertsSnapshotRef.current || {};
    const duplicate = Object.values(existing).some((a) => {
      if (!a) return false;
      const ts = Number(a.timestamp || 0);
      return a.type === type && !a.resolved && now - ts < 3600000;
    });

    return !duplicate;
  }, []);

  const createAlert = useCallback(
    async ({ type, message, severity }) => {
      const now = Date.now();
      if (!shouldCreateAlert(type, now)) return;

      const newRef = push(ref(db, "alerts"));
      const payload = {
        type,
        message,
        severity, // "warning" | "critical"
        timestamp: now,
        resolved: false,
        source: "web", // created by the web app engine
      };

      await set(newRef, payload);
      lastAlertTimesRef.current[type] = now;

      // Toast + browser notif (immediate)
      toast(`${type}: ${message}`, severity === "critical" ? "error" : "warning");
      fireBrowserNotification(`ChicKulungan Alert: ${type}`, message);
    },
    [shouldCreateAlert]
  );

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
    // No explicit water thresholds yet in this file; use a safe baseline for recovery.
    const isWaterNormal = Number.isFinite(Number(s.water)) && Number(s.water) > 0;

    await resolveAlertsByPredicate((a) => {
      const type = String(a.type || "").toLowerCase();

      if (type.includes("temperature")) return isTempNormal;
      if (type.includes("humidity")) return isHumidityNormal;
      if (type.includes("feed")) return isFeedNormal;
      if (type.includes("water")) return isWaterNormal;

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

    const candidates = [
      {
        condition: Number(s.feed) < alertThresholds.lowFeed,
        type: "Low Feed",
        message: `Feed level is low (${s.feed}%)`,
        severity: "critical",
      },
      {
        condition: Number(s.temp) > alertThresholds.highTemp,
        type: "High Temperature",
        message: `Temperature too high (${s.temp}°C)`,
        severity: "critical",
      },
      {
        condition: Number(s.temp) < alertThresholds.lowTemp,
        type: "Low Temperature",
        message: `Temperature too low (${s.temp}°C)`,
        severity: "warning",
      },
      {
        condition: Number(s.humidity) > alertThresholds.highHumidity,
        type: "High Humidity",
        message: `Humidity too high (${s.humidity}%)`,
        severity: "warning",
      },
      {
        condition: Number(s.humidity) < alertThresholds.lowHumidity,
        type: "Low Humidity",
        message: `Humidity too low (${s.humidity}%)`,
        severity: "warning",
      },
    ];

    for (const a of candidates) {
      if (a.condition) await createAlert(a);
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

  // ✅ NEW: Remind unresolved alerts on a schedule until resolved
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

      const body = `${a.type || "Alert"} — ${a.message || ""}`.slice(0, 160);

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

  // ✅ Firebase sensors listener (works even if MQTT is dead)
  useEffect(() => {
    if (!ready) return;

    const unsub = onValue(ref(db, "sensors"), (snap) => {
      const data = snap.val();
      if (!data) return;

      sensorsRef.current.temp = Number(data.temperature ?? sensorsRef.current.temp ?? 0);
      sensorsRef.current.humidity = Number(data.humidity ?? sensorsRef.current.humidity ?? 0);
      sensorsRef.current.feed = Number(data.feedLevel ?? sensorsRef.current.feed ?? 0);
      sensorsRef.current.water = Number(data.waterLevel ?? sensorsRef.current.water ?? 0);

      if (data.lastUpdate != null) {
        const v = Number(data.lastUpdate);
        if (!Number.isNaN(v)) lastUpdateMsRef.current = v;
        hasRealDataRef.current = true; // only after ESP32 writes lastUpdate
      }

      evaluateAlerts();
      evaluateOffline();
      autoResolveStabilizedAlerts();
      autoResolveOfflineAlertsIfRecovered();
    });

    return () => unsub();
  }, [
    ready,
    evaluateAlerts,
    evaluateOffline,
    autoResolveStabilizedAlerts,
    autoResolveOfflineAlertsIfRecovered,
  ]);

  // ✅ MQTT listener (fast updates)
  useEffect(() => {
    if (!ready) return;

    const handler = (e) => {
      const { topic, payload } = e.detail || {};
      if (!topic) return;

      if (topic === "chickulungan/sensor/temp") {
        sensorsRef.current.temp = parseFloat(payload) || 0;
        evaluateAlerts();
        autoResolveStabilizedAlerts();
      } else if (topic === "chickulungan/sensor/humidity") {
        sensorsRef.current.humidity = parseFloat(payload) || 0;
        evaluateAlerts();
        autoResolveStabilizedAlerts();
      } else if (topic === "chickulungan/sensor/feed") {
        sensorsRef.current.feed = parseInt(payload, 10) || 0;
        evaluateAlerts();
        autoResolveStabilizedAlerts();
      } else if (topic === "chickulungan/sensor/water") {
        sensorsRef.current.water = parseInt(payload, 10) || 0;
        autoResolveStabilizedAlerts();
      } else if (topic === "chickulungan/status") {
        // optional: online/offline by MQTT LWT can be added later
      }
    };

    window.addEventListener("mqtt-message", handler);
    return () => window.removeEventListener("mqtt-message", handler);
  }, [ready, evaluateAlerts, autoResolveStabilizedAlerts]);

  // Periodic offline check even if nothing changes
  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => {
      evaluateOffline();
      autoResolveOfflineAlertsIfRecovered();
    }, 5000);
    return () => clearInterval(t);
  }, [ready, evaluateOffline, autoResolveOfflineAlertsIfRecovered]);

  // ✅ Periodic reminder tick
  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => {
      remindUnresolvedAlerts();
    }, REMINDER_TICK_MS);
    return () => clearInterval(t);
  }, [ready, remindUnresolvedAlerts]);

  return null;
}
