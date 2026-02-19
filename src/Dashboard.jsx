import React, { useState, useEffect, useRef, useMemo, useCallback, } from "react";
import {
  Paper,
  Typography,
  Button,
  TextField,
  Box,
  Grid,
  CircularProgress,
} from "@mui/material";
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  ResponsiveContainer,
} from "recharts";
import { Gauge } from "@mui/x-charts/Gauge";
import { useTheme } from "@mui/material/styles";
import { publishFeed } from "./mqtt";
import { db, ref, onValue, push } from "./firebase";
import { query, limitToLast } from "firebase/database";
import { format, differenceInMinutes } from "date-fns";
import { useNavigate } from "react-router-dom";
import { toast, setGlobalLoading } from "./utils/feedback";

export default function Dashboard() {
  const [sensors, setSensors] = useState({
    temp: 0,
    humidity: 0,
    feed: 0,
    water: 0,
  });

  const [online, setOnline] = useState(false);
  const [lastUpdateMs, setLastUpdateMs] = useState(null);

  const [history, setHistory] = useState([]);
  const [uptimeData, setUptimeData] = useState([]);
  const [incidents, setIncidents] = useState(0);

  const theme = useTheme();
  const [isFeeding, setIsFeeding] = useState(false);

  const navigate = useNavigate();

  // ==========================
  // ✅ Instant load: cache sensors
  // ==========================
  useEffect(() => {
    try {
      const cached = JSON.parse(localStorage.getItem("lastSensors") || "{}");
      if (cached && typeof cached === "object") {
        setSensors((prev) => ({ ...prev, ...cached }));
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("lastSensors", JSON.stringify(sensors));
    } catch {
      // ignore
    }
  }, [sensors]);

  // Keep latest sensors for history (avoids stale closure)
  const sensorsRef = useRef(sensors);
  useEffect(() => {
    sensorsRef.current = sensors;
  }, [sensors]);

  // Helper to add to live chart (same logic, just safer)
  const addToHistory = useCallback((type, value, now) => {
    const time = new Date(now).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    setHistory((prev) => {
      const existingIdx = prev.findIndex((p) => p.time === time);
      const updated = [...prev];

      if (existingIdx >= 0) {
        updated[existingIdx] = { ...updated[existingIdx], [type]: value };
      } else {
        const last = prev[prev.length - 1] || {
          temp: sensorsRef.current.temp,
          humidity: sensorsRef.current.humidity,
        };

        updated.push({
          time,
          temp: type === "temp" ? value : last.temp,
          humidity: type === "humidity" ? value : last.humidity,
        });
      }

      return updated.slice(-10);
    });
  }, []);

  // =====================
  // ✅ MQTT Listener (batched)
  // =====================
  const pendingRef = useRef({});
  const rafRef = useRef(null);

  useEffect(() => {
    const flush = () => {
      rafRef.current = null;
      const p = pendingRef.current;
      pendingRef.current = {};

      // One render for all sensor updates
      setSensors((prev) => ({ ...prev, ...p }));

      const now = Date.now();
      if (p.temp != null) addToHistory("temp", p.temp, now);
      if (p.humidity != null) addToHistory("humidity", p.humidity, now);
    };

    const handler = (e) => {
      const { topic, payload } = e.detail || {};

      if (topic === "chickulungan/sensor/temp") {
        pendingRef.current.temp = parseFloat(payload) || 0;
      } else if (topic === "chickulungan/sensor/humidity") {
        pendingRef.current.humidity = parseFloat(payload) || 0;
      } else if (topic === "chickulungan/sensor/feed") {
        pendingRef.current.feed = parseInt(payload, 10) || 0;
      } else if (topic === "chickulungan/sensor/water") {
        pendingRef.current.water = parseInt(payload, 10) || 0;
      }

      // NOTE: If you want to display MQTT logs, render them somewhere.
      // We intentionally do NOT keep a logText state here to avoid ESLint "unused" errors.

      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(flush);
      }
    };

    window.addEventListener("mqtt-message", handler);
    return () => window.removeEventListener("mqtt-message", handler);
  }, [addToHistory]);

  // ==========================
  // ✅ Firebase Sensors Listener
  // ==========================
  useEffect(() => {
    const sensorsRefDb = ref(db, "sensors");

    const unsub = onValue(sensorsRefDb, (snap) => {
      const data = snap.val();
      if (!data) return;

      setSensors((prev) => ({
        ...prev,
        temp: data.temperature ?? prev.temp ?? 0,
        humidity: data.humidity ?? prev.humidity ?? 0,
        feed: data.feedLevel ?? prev.feed ?? 0,
        water: data.waterLevel ?? prev.water ?? 0,
      }));

      if (data.lastUpdate != null) {
        const v = Number(data.lastUpdate);
        if (!Number.isNaN(v)) setLastUpdateMs(v);
      }
    });

    return () => unsub();
  }, []);

  // =================================
  // ✅ Online/Offline based on lastUpdate
  // =================================
  useEffect(() => {
    const OFFLINE_AFTER_MS = 90 * 1000;

    const tick = () => {
      if (!lastUpdateMs) {
        setOnline(false);
        return;
      }
      const age = Date.now() - Number(lastUpdateMs);
      setOnline(age <= OFFLINE_AFTER_MS);
    };

    tick();
    const timer = setInterval(tick, 5000);
    return () => clearInterval(timer);
  }, [lastUpdateMs]);

  // ==========================
  // ✅ Incidents count
  // ==========================
  useEffect(() => {
    const alertsRef = ref(db, "alerts");
    const unsub = onValue(alertsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const unresolvedCount = Object.values(data).filter((a) => !a?.resolved).length;
        setIncidents(unresolvedCount);
      } else {
        setIncidents(0);
      }
    });

    return () => unsub();
  }, []);

  // ==========================
  // ✅ Uptime calc (limit logs pulled)
  // ==========================
  useEffect(() => {
    const logsRef = query(ref(db, "logs"), limitToLast(2000));
    const unsub = onValue(logsRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        setUptimeData([]);
        return;
      }

      const logArray = Object.values(data)
        .map((log) => ({ ...log, timestamp: Number(log.timestamp) || 0 }))
        .filter((l) => l.timestamp > 0)
        .sort((a, b) => a.timestamp - b.timestamp);

      if (logArray.length < 2) {
        setUptimeData([]);
        return;
      }

      const dailyUptime = {};
      logArray.forEach((log, idx) => {
        const day = format(new Date(log.timestamp), "MMM dd");
        if (!dailyUptime[day]) dailyUptime[day] = { activeMinutes: 0 };

        if (idx > 0) {
          const prevTs = logArray[idx - 1].timestamp;
          const gap = differenceInMinutes(new Date(log.timestamp), new Date(prevTs));
          if (gap >= 0 && gap <= 10) {
            dailyUptime[day].activeMinutes += gap;
          }
        }
      });

      const uptimeDataFormatted = Object.entries(dailyUptime)
        .map(([day, { activeMinutes }]) => ({
          day,
          uptime: Number(Math.min(100, (activeMinutes / 1440) * 100).toFixed(1)), // ✅ number, not string
        }))
        .slice(-7);

      setUptimeData(uptimeDataFormatted);
    });

    return () => unsub();
  }, []);

  // ==========================
  // Controls
  // ==========================
  const feedNow = () => {
    if (isFeeding) return;
    setIsFeeding(true);

    setGlobalLoading(true);
    publishFeed();

    push(ref(db, "logs"), {
      message: "Feed command sent from Dashboard",
      source: "web",
      timestamp: Date.now(),
    });

    toast("Feed command sent!", "success");

    setTimeout(() => {
      setGlobalLoading(false);
      setIsFeeding(false);
    }, 1000);
  };

  const setSched = () => {
    navigate("/schedules");
  };

  // ✅ Memoize chart filters (avoids filtering on every render)
  const tempHistory = useMemo(() => history.filter((h) => h.temp != null), [history]);
  const humidityHistory = useMemo(() => history.filter((h) => h.humidity != null), [history]);

  return (
    <Box sx={{ px: { xs: 1.5, sm: 3 }, py: { xs: 2, sm: 3 } }}>
      {/* Online Status Indicator */}
      <Box sx={{ mb: 3, display: "flex", alignItems: "center", gap: 2 }}>
        <Box
          sx={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            backgroundColor: online ? "#4caf50" : "#f44336",
            boxShadow: online ? "0 0 10px #4caf50" : "0 0 10px #f44336",
            animation: online ? "pulse 2s infinite" : "none",
          }}
        />
        <Typography variant="h6" fontWeight={600}>
          {online ? "System Online" : "Disconnected"}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Last update:{" "}
          {lastUpdateMs ? format(new Date(Number(lastUpdateMs)), "HH:mm:ss") : "Never"}
        </Typography>
      </Box>

      <Box
  sx={{
    width: "100%",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: { xs: 2, sm: 3, md: 4 },
    alignItems: "stretch",
  }}
>
  {/* Temperature */}
  <Paper
    sx={{
      p: 3,
      textAlign: "center",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      minWidth: 0,
    }}
  >
    <Typography variant="subtitle1" color="text.secondary" gutterBottom>
      Temperature
    </Typography>
    <Gauge
      value={sensors.temp}
      startAngle={-110}
      endAngle={110}
      height={180}
      sx={{ mb: 2 }}
      valueFormatter={(v) => `${Number(v).toFixed(1)}°C`}
    />
    <Typography
      variant="h4"
      fontWeight={700}
      color={sensors.temp > 35 ? "error" : "success"}
    >
      {Number(sensors.temp).toFixed(1)}°C
    </Typography>
  </Paper>

  {/* Humidity */}
  <Paper
    sx={{
      p: 3,
      textAlign: "center",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      minWidth: 0,
    }}
  >
    <Typography variant="subtitle1" color="text.secondary" gutterBottom>
      Humidity
    </Typography>
    <Gauge
      value={sensors.humidity}
      startAngle={-110}
      endAngle={110}
      height={180}
      sx={{ mb: 2 }}
    />
    <Typography
      variant="h4"
      fontWeight={700}
      color={sensors.humidity > 80 ? "warning" : "primary"}
    >
      {Number(sensors.humidity).toFixed(1)}%
    </Typography>
  </Paper>

  {/* Feed Level */}
  <Paper
    sx={{
      p: 3,
      textAlign: "center",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      minWidth: 0,
    }}
  >
    <Typography variant="subtitle1" color="text.secondary" gutterBottom>
      Feed Level
    </Typography>
    <Box sx={{ position: "relative", height: 180, mb: 2 }}>
      <CircularProgress
        variant="determinate"
        value={sensors.feed}
        size={160}
        thickness={8}
        sx={{ color: sensors.feed < 20 ? "#f44336" : "#ffb400" }}
      />
      <Box
        sx={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          textAlign: "center",
        }}
      >
        <Typography variant="h3" fontWeight={700}>
          {sensors.feed}%
        </Typography>
      </Box>
    </Box>
    <Typography variant="h5" color={sensors.feed < 20 ? "error" : "inherit"}>
      {sensors.feed < 20 ? "LOW!" : "Adequate"}
    </Typography>
  </Paper>

  {/* Water Level */}
  <Paper
    sx={{
      p: 3,
      textAlign: "center",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      justifyContent: "center",
      minWidth: 0,
    }}
  >
    <Typography variant="subtitle1" color="text.secondary" gutterBottom>
      Water Level
    </Typography>
    <Box sx={{ position: "relative", height: 180, mb: 2 }}>
      <CircularProgress
        variant="determinate"
        value={sensors.water}
        size={160}
        thickness={8}
        sx={{ color: sensors.water < 20 ? "#f44336" : "#1976d2" }}
      />
      <Box
        sx={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          textAlign: "center",
        }}
      >
        <Typography variant="h3" fontWeight={700}>
          {sensors.water}%
        </Typography>
      </Box>
    </Box>
    <Typography variant="h5" color={sensors.water < 20 ? "error" : "inherit"}>
      {sensors.water < 20 ? "LOW!" : "Adequate"}
    </Typography>
  </Paper>
</Box>


      {/* Control Buttons */}
      <Box
        sx={{
          mt: 4,
          display: "flex",
          gap: 2,
          justifyContent: "center",
          flexWrap: "wrap",
        }}
      >
        <Button variant="contained" size="large" onClick={feedNow} disabled={isFeeding}>
          FEED NOW
        </Button>

        <Button variant="outlined" size="large" onClick={setSched}>
          SET SCHEDULE
        </Button>
      </Box>

      {/* Temperature Trend */}
      <Paper sx={{ mt: 4, p: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Temperature Trend (Live)
        </Typography>
        {tempHistory.length === 0 ? (
          <Typography color="textSecondary" sx={{ textAlign: "center", py: 4 }}>
            Waiting for data...
          </Typography>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={tempHistory}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis
                domain={[0, 50]}
                label={{ value: "Temp (°C)", angle: -90, position: "insideLeft" }}
              />
              <Tooltip formatter={(v) => `${Number(v).toFixed(1)}°C`} />
              <Line
                type="monotone"
                dataKey="temp"
                stroke="#ffb400"
                strokeWidth={3}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Paper>

      {/* Humidity Trend */}
      <Paper sx={{ mt: 4, p: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Humidity Trend (Live)
        </Typography>
        {humidityHistory.length === 0 ? (
          <Typography color="textSecondary" sx={{ textAlign: "center", py: 4 }}>
            Waiting for data...
          </Typography>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={humidityHistory}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis
                domain={[0, 100]}
                label={{ value: "Humidity (%)", angle: -90, position: "insideLeft" }}
              />
              <Tooltip formatter={(v) => `${Number(v).toFixed(1)}%`} />
              <Line
                type="monotone"
                dataKey="humidity"
                stroke="#1976d2"
                strokeWidth={3}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Paper>

      {/* Uptime & Incidents */}
      <Paper sx={{ mt: 4, p: 3 }}>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            mb: 2,
          }}
        >
          <Typography variant="h6">System Uptime (Last 7 Days)</Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            <Typography variant="h6" color="error">
              Incidents: {incidents}
            </Typography>
            {incidents > 0 && (
              <Box
                sx={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  backgroundColor: "#f44336",
                  animation: "pulse 1.5s infinite",
                }}
              />
            )}
          </Box>
        </Box>

        {uptimeData.length === 0 ? (
          <Typography color="textSecondary" sx={{ textAlign: "center", py: 4 }}>
            Collecting uptime data...
          </Typography>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={uptimeData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" />
              <YAxis domain={[0, 100]} />
              <Tooltip
                contentStyle={{
                  backgroundColor: theme.palette.background.paper,
                  color: theme.palette.text.primary,
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: theme.shape.borderRadius,
                  padding: "8px 12px",
                  boxShadow: theme.shadows[4],
                }}
                itemStyle={{ color: theme.palette.text.primary }}
                labelStyle={{ color: theme.palette.text.secondary }}
              />
              <Bar dataKey="uptime">
                {uptimeData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={
                      entry.uptime >= 98
                        ? "#4caf50"
                        : entry.uptime >= 90
                        ? "#ff9800"
                        : "#f44336"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Paper>
    </Box>
  );

  

  // Helper component for log (limited query = faster)
  function LiveLog() {
    const [log, setLog] = useState("");

    useEffect(() => {
      const logRef = query(ref(db, "logs"), limitToLast(60));
      const unsub = onValue(logRef, (snap) => {
        const data = snap.val();
        if (data) {
          const arr = Object.values(data)
            .map((e) => ({
              ts: Number(e.timestamp) || 0,
              msg: e.message || "",
            }))
            .filter((x) => x.ts > 0)
            .sort((a, b) => b.ts - a.ts)
            .slice(0, 30)
            .map((e) => `[${format(new Date(e.ts), "HH:mm:ss")}] ${e.msg}`)
            .join("\n");
          setLog(arr);
        } else {
          setLog("");
        }
      });

      return () => unsub();
    }, []);

    return (
      <TextField
        multiline
        rows={6}
        fullWidth
        value={log}
        InputProps={{ readOnly: true }}
        sx={{
          backgroundColor: theme.palette.mode === "dark" ? "#000" : "#f5f5f5",
          color: theme.palette.mode === "dark" ? "#0f0" : "#000",
          fontFamily: "monospace",
          fontSize: "0.875rem",
          "& .MuiOutlinedInput-root": {
            color: theme.palette.mode === "dark" ? "#0f0" : "#000",
          },
          "& .MuiOutlinedInput-notchedOutline": {
            borderColor: theme.palette.divider,
          },
        }}
      />
    );
  }
}
