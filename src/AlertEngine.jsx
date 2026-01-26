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


function fireBrowserNotification(title, body) {
  try {
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    new Notification(title, { body });
  } catch {
    /* noop */
  }
}


export default function AlertEngine() {

  const hasRealDataRef = useRef(false);


  const sensorsRef = useRef({ temp: 0, humidity: 0, feed: 0, water: 0 });
  const lastUpdateMsRef = useRef(null);

  const alertsSnapshotRef = useRef({});
  const [ready, setReady] = useState(false);

  // Debounce per alert type
  const lastAlertTimesRef = useRef({}); // { type: timestamp }

  // Keep a local snapshot of /alerts to detect duplicates
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
        severity,
        timestamp: now,
        resolved: false,
      };

      await set(newRef, payload);
      lastAlertTimesRef.current[type] = now;

      // Toast + browser notif
      toast(`${type}: ${message}`, severity === "critical" ? "error" : "warning");
      fireBrowserNotification(`ChicKulungan Alert: ${type}`, message);
    },
    [shouldCreateAlert]
  );

  const evaluateAlerts = useCallback(async () => {
    const lastUpdate = Number(lastUpdateMsRef.current || 0);
  if (!hasRealDataRef.current || !lastUpdate) return;

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
        message: `No ESP32 update for ${(age / 1000).toFixed(0)}s`,
        severity: "critical",
      });
    }
  }, [createAlert]);

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
        // Mark as "real data" only when ESP32 has actually written lastUpdate
hasRealDataRef.current = true;

      }

      // Evaluate based on Firebase updates too
      evaluateAlerts();
      evaluateOffline();
    });

    return () => unsub();
  }, [ready, evaluateAlerts, evaluateOffline]);

  // ✅ MQTT listener (fast updates)
  useEffect(() => {
    if (!ready) return;

    const handler = (e) => {
      const { topic, payload } = e.detail || {};
      if (!topic) return;

      if (topic === "chickulungan/sensor/temp") {
        sensorsRef.current.temp = parseFloat(payload) || 0;
        evaluateAlerts();
      } else if (topic === "chickulungan/sensor/humidity") {
        sensorsRef.current.humidity = parseFloat(payload) || 0;
        evaluateAlerts();
      } else if (topic === "chickulungan/sensor/feed") {
        sensorsRef.current.feed = parseInt(payload, 10) || 0;
        evaluateAlerts();
      } else if (topic === "chickulungan/sensor/water") {
        sensorsRef.current.water = parseInt(payload, 10) || 0;
      } else if (topic === "chickulungan/status") {
        // optional: you can also handle online/offline here later
      }
    };

    window.addEventListener("mqtt-message", handler);
    return () => window.removeEventListener("mqtt-message", handler);
  }, [ready, evaluateAlerts]);

  // Periodic offline check even if nothing changes
  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => {
      evaluateOffline();
    }, 5000);
    return () => clearInterval(t);
  }, [ready, evaluateOffline]);

  return null;
}
