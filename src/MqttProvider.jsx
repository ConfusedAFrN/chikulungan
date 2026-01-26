import React, { useEffect, useMemo, useRef, useState } from "react";
import client from "./mqtt";
import { MqttContext } from "./mqttContext";

// How long we consider ESP32 "online" after last status message
const ONLINE_TTL_MS = 90_000; // 90s

export function MqttProvider({ children }) {
  const [mqttConnected, setMqttConnected] = useState(client.connected);
  const [espStatus, setEspStatus] = useState("unknown"); // "online" | "offline" | "unknown"
  const [lastStatusAt, setLastStatusAt] = useState(0);

  // Keep a ref so our TTL updates don’t require re-adding listeners
  const lastStatusAtRef = useRef(0);

  // This state forces periodic re-render so TTL can expire even without new messages
  const [, forceTick] = useState(0);

  useEffect(() => {
    const onConnect = () => setMqttConnected(true);
    const onClose = () => setMqttConnected(false);
    const onOffline = () => setMqttConnected(false);
    const onError = () => setMqttConnected(false);

    client.on("connect", onConnect);
    client.on("close", onClose);
    client.on("offline", onOffline);
    client.on("error", onError);

    const onMsg = (e) => {
      const { topic, payload } = e.detail;

      if (topic === "chickulungan/status") {
        setEspStatus(payload); // expects "online" or "offline"
        const ts = Date.now();
        setLastStatusAt(ts);
        lastStatusAtRef.current = ts;
      }
    };

    window.addEventListener("mqtt-message", onMsg);

    // Tick every 1s so TTL-based online status can update even if no new messages come in
    const timer = setInterval(() => {
      // only tick if we have a status timestamp
      if (lastStatusAtRef.current) forceTick((x) => x + 1);
    }, 1000);

    return () => {
      clearInterval(timer);
      client.off("connect", onConnect);
      client.off("close", onClose);
      client.off("offline", onOffline);
      client.off("error", onError);
      window.removeEventListener("mqtt-message", onMsg);
    };
  }, []);

  const espOnlineByTTL =
    espStatus === "online" &&
    lastStatusAt > 0 &&
    Date.now() - lastStatusAt < ONLINE_TTL_MS;

  const value = useMemo(
    () => ({
      mqttConnected,
      espStatus,
      lastStatusAt,
      espOnlineByTTL,
      ONLINE_TTL_MS,
    }),
    [mqttConnected, espStatus, lastStatusAt, espOnlineByTTL]
  );

  return <MqttContext.Provider value={value}>{children}</MqttContext.Provider>;
}
