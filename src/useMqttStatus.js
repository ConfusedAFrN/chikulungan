import { useContext } from "react";
import { MqttContext } from "./mqttContext";

export function useMqttStatus() {
  const ctx = useContext(MqttContext);
  if (!ctx) throw new Error("useMqttStatus must be used inside <MqttProvider>");
  return ctx;
}
