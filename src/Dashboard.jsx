import React, { useState, useEffect } from "react";
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
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Gauge } from "@mui/x-charts/Gauge";
import { useTheme } from '@mui/material/styles';
import { publishFeed } from "./mqtt";
import { db, ref, onValue, push, set, get } from "./firebase";
import { format, differenceInMinutes } from "date-fns";
import { useNavigate } from "react-router-dom";
import { logEvent } from "./logger"; // If logger.js is used for events

import { toast, setGlobalLoading } from "./utils/feedback";

export default function Dashboard() {
  const [sensors, setSensors] = useState({
    temp: 0,
    humidity: 0,
    feed: 0,
    water: 0,
  });
  const [setLog] = useState("System ready...\n");
  const [online, setOnline] = useState(false);
  const [lastMqttTime, setLastMqttTime] = useState(0);
  const [history, setHistory] = useState([]);
  const [uptimeData, setUptimeData] = useState([]); // Now dynamic
  const [incidents, setIncidents] = useState(0);
  const [lastAlertTimes, setLastAlertTimes] = useState({}); // e.g., { 'Low Feed': timestamp }
  const theme = useTheme();  // Gets current theme (dark/light)

  const checkAndAlert = async () => {
    // Make async for await
    const now = Date.now();
    const alertTypes = [
      {
        condition: sensors.feed < alertThresholds.lowFeed,
        type: "Low Feed",
        message: `Feed level is low (${sensors.feed}%)`,
        severity: "critical",
      },
      {
        condition: sensors.temp > alertThresholds.highTemp,
        type: "High Temperature",
        message: `Temperature too high (${sensors.temp}°C)`,
        severity: "critical",
      },
      {
        condition: sensors.temp < alertThresholds.lowTemp,
        type: "Low Temperature",
        message: `Temperature too low (${sensors.temp}°C)`,
        severity: "warning",
      },
      {
        condition: sensors.humidity > alertThresholds.highHumidity,
        type: "High Humidity",
        message: `Humidity too high (${sensors.humidity}%)`,
        severity: "warning",
      },
      {
        condition: sensors.humidity < alertThresholds.lowHumidity,
        type: "Low Humidity",
        message: `Humidity too low (${sensors.humidity}%)`,
        severity: "warning",
      },
    ];

    for (const { condition, type, message, severity } of alertTypes) {
      if (!condition) continue;

      const lastTime = lastAlertTimes[type] || 0;
      if (now - lastTime < 60000) continue; // Debounce: Skip if <1min

      // Check for duplicate unresolved alert
      const alertsRef = ref(db, "alerts");
      const snapshot = await get(alertsRef);
      const existing = snapshot.val();
      const hasDuplicate =
        existing &&
        Object.values(existing).some(
          (alert) =>
            alert.type === type &&
            !alert.resolved &&
            now - Number(alert.timestamp) < 3600000 // Same type, unresolved, <1h
        );
      if (hasDuplicate) continue;

      // Push new alert
      const newAlertRef = push(ref(db, "alerts"));
      const newAlert = {
        type,
        message,
        severity,
        timestamp: now,
        resolved: false,
      };
      await set(newAlertRef, newAlert);

      // Update debounce and log
      setLastAlertTimes((prev) => ({ ...prev, [type]: now }));
      if (logEvent) logEvent(`Alert triggered: ${type} - ${message}`, "web"); // Optional if logger exists
      console.log(`Alert triggered: ${type}`);
    }
  };

  // === MQTT Listener ===
  useEffect(() => {
    const handler = (e) => {
      const { topic, payload } = e.detail;
      const now = Date.now();

      if (topic === "chickulungan/sensor/temp") {
        const val = parseFloat(payload) || 0;
        setSensors((prev) => ({ ...prev, temp: val }));
        addToHistory("temp", val, now);
        checkAndAlert();
      }
      if (topic === "chickulungan/sensor/humidity") {
        const val = parseFloat(payload) || 0;
        setSensors((prev) => ({ ...prev, humidity: val }));
        addToHistory("humidity", val, now);
        checkAndAlert();
      }
      if (topic === "chickulungan/sensor/feed") {
        setSensors((prev) => ({ ...prev, feed: parseInt(payload) || 0 }));
        checkAndAlert();
      }
      if (topic === "chickulungan/log") {
        setLog((prev) => prev + payload + "\n");
      }
      if (topic === "chickulungan/status") {
        setOnline(payload === "online");
      }
      if (topic === "chickulungan/sensor/water") {
        setSensors((prev) => ({ ...prev, water: parseInt(payload) || 0 }));
      }

      setLastMqttTime(now);
    };

    window.addEventListener("mqtt-message", handler);
    return () => window.removeEventListener("mqtt-message", handler);
  });

  // Helper to add to live chart (improved with labels)
  const addToHistory = (type, value, now) => {
    const time = new Date(now).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    setHistory((prev) => {
      const existingIdx = prev.findIndex((p) => p.time === time);
      let updated = [...prev];
      if (existingIdx >= 0) {
        updated[existingIdx] = { ...updated[existingIdx], [type]: value };
      } else {
        const last = prev[prev.length - 1] || {
          temp: sensors.temp,
          humidity: sensors.humidity,
        };
        updated.push({
          time,
          temp: type === "temp" ? value : last.temp,
          humidity: type === "humidity" ? value : last.humidity,
        });
      }
      return updated.slice(-10);
    });
  };

  const [alertThresholds] = useState({
    lowFeed: 20, // Feed < 20%
    highTemp: 35, // Temp > 35°C
    lowTemp: 18, // Temp < 18°C
    highHumidity: 80, // Humidity > 80%
    lowHumidity: 40, // Humidity < 40%
  });

  // === Firebase Fallback ===
  useEffect(() => {
    const interval = setInterval(() => {
      if (Date.now() - lastMqttTime > 15000) {
        const backupRef = ref(db, "sensors");
        onValue(
          backupRef,
          (snap) => {
            const data = snap.val();
            if (data) {
              setSensors({
                temp: data.temperature || 0,
                humidity: data.humidity || 0,
                feed: data.feedLevel || 0,
              });
              setOnline(false);
            }
          },
          { onlyOnce: true }
        );
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [lastMqttTime]);

  // === Load Real Uptime & Incidents from Firebase ===
  //wait
  useEffect(() => {
    const alertsRef = ref(db, "alerts");
    const unsub = onValue(alertsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const unresolvedCount = Object.values(data).filter(
          (alert) => !alert.resolved
        ).length;
        setIncidents(unresolvedCount);
      } else {
        setIncidents(0);
      }
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    const logsRef = ref(db, "logs");
    const unsub = onValue(logsRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      const logArray = Object.values(data)
        .map((log) => ({ ...log, timestamp: Number(log.timestamp) })) // Ensure number
        .sort((a, b) => a.timestamp - b.timestamp); // Ascending for gaps

      // Group by day and calculate uptime
      const dailyUptime = {};
      logArray.forEach((log, idx) => {
        const day = format(new Date(log.timestamp), "MMM dd"); // e.g., "Sep 23"
        if (!dailyUptime[day])
          dailyUptime[day] = { activeMinutes: 0, lastTs: log.timestamp };

        if (idx > 0) {
          const prevTs = logArray[idx - 1].timestamp;
          const gap = differenceInMinutes(
            new Date(log.timestamp),
            new Date(prevTs)
          );
          if (gap <= 10) {
            // Assume active if logs within 10min
            dailyUptime[day].activeMinutes += gap;
          }
        }
        dailyUptime[day].lastTs = log.timestamp;
      });

      // Normalize to % (assume 1440 min/day, cap at 100%)
      const uptimeDataFormatted = Object.entries(dailyUptime)
        .map(([day, { activeMinutes }]) => ({
          day,
          uptime: Math.min(100, (activeMinutes / 1440) * 100).toFixed(1),
        }))
        .slice(-7); // Last 7 days for graph

      setUptimeData(uptimeDataFormatted);
    });

    return () => unsub();
  }, []);

  // Isolate for now
  const feedNow = () => {
    publishFeed();
    push(ref(db, "logs"));
    toast("Feed activated successfully!", "success");
    setGlobalLoading(true);
  };

  const navigate = useNavigate();

  const setSched = () => {
    navigate("/schedules");
  };

  //

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
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
          {lastMqttTime ? format(lastMqttTime, "HH:mm:ss") : "Never"}
        </Typography>
      </Box>

      {/* Sensor Cards Grid */}
      <Box
        sx={{
          width: "100%",
          px: { xs: 2, sm: 3, md: 4 }, // Responsive horizontal padding
        }}
      >
        <Grid container spacing={5}>
          {/* Temperature */}
          <Grid item xs={12} sm={6} lg={3}>
            <Paper
              sx={{
                p: 3,
                textAlign: "center",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
              }}
            >
              <Typography
                variant="subtitle1"
                color="text.secondary"
                gutterBottom
              >
                Temperature
              </Typography>
              <Gauge
                value={sensors.temp}
                startAngle={-110}
                endAngle={110}
                height={180}
                sx={{ mb: 2 }}
                valueFormatter={(v) => `${v.toFixed(1)}°C`} // ← fixed: lowercase + function
              />
              <Typography
                variant="h4"
                fontWeight={700}
                color={sensors.temp > 35 ? "error" : "success"}
              >
                {sensors.temp.toFixed(1)}°C
              </Typography>
            </Paper>
          </Grid>

          {/* Humidity */}
          <Grid item xs={12} sm={6} lg={3}>
            <Paper
              sx={{
                p: 3,
                textAlign: "center",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
              }}
            >
              <Typography
                variant="subtitle1"
                color="text.secondary"
                gutterBottom
              >
                Humidity
              </Typography>
              <Gauge
                value={sensors.humidity}
                startAngle={-110}
                endAngle={110}
                height={180}
                sx={{ mb: 2 }}
                valueFormatter={(v) => `${v}%`}
              />
              <Typography
                variant="h4"
                fontWeight={700}
                color={sensors.humidity > 80 ? "warning" : "primary"}
              >
                {sensors.humidity.toFixed(1)}%
              </Typography>
            </Paper>
          </Grid>

          {/* Feed Level */}
          <Grid item xs={12} sm={12} lg={4}>
            <Paper
              sx={{
                p: 3,
                textAlign: "center",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
              }}
            >
              <Typography
                variant="subtitle1"
                color="text.secondary"
                gutterBottom
              >
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
              <Typography
                variant="h5"
                color={sensors.feed < 20 ? "error" : "inherit"}
              >
                {sensors.feed < 20 ? "LOW!" : "Adequate"}
              </Typography>
            </Paper>
          </Grid>
          {/* Water Level */}
          <Grid item xs={12} sm={6} lg={3}>
            <Paper
              sx={{
                p: 3,
                textAlign: "center",
                height: "100%",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
              }}
            >
              <Typography
                variant="subtitle1"
                color="text.secondary"
                gutterBottom
              >
                Water Level
              </Typography>
              <Box sx={{ position: "relative", height: 180, mb: 2 }}>
                <CircularProgress
                  variant="determinate"
                  value={sensors.water}
                  size={160}
                  thickness={8}
                  sx={{ color: sensors.water < 20 ? "#f44336" : "#1976d2" }} // Red low, blue normal
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
              <Typography
                variant="h5"
                color={sensors.water < 20 ? "error" : "inherit"}
              >
                {sensors.water < 20 ? "LOW!" : "Adequate"}
              </Typography>
            </Paper>
          </Grid>
        </Grid>
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
        <Button variant="contained" size="large" onClick={feedNow}>
          FEED NOW
        </Button>
        <Button variant="outlined" size="large" onClick={setSched}>
          SET SCHEDULE
        </Button>
      </Box>

      {/* Live Trends Chart */}
      {/* Temperature Trend */}
       <Paper sx={{ mt: 4, p: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Temperature Trend (Live)
        </Typography>
        {history.filter((h) => h.temp != null).length === 0 ? (
          <Typography color="textSecondary" sx={{ textAlign: "center", py: 4 }}>
            Waiting for data...
          </Typography>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={history.filter((h) => h.temp != null)}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis
                domain={[0, 50]}
                label={{
                  value: "Temp (°C)",
                  angle: -90,
                  position: "insideLeft",
                }}
              />
              <Tooltip formatter={(v) => `${v.toFixed(1)}°C`} />
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
        {history.filter((h) => h.humidity != null).length === 0 ? (
          <Typography color="textSecondary" sx={{ textAlign: "center", py: 4 }}>
            Waiting for data...
          </Typography>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={history.filter((h) => h.humidity != null)}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis
                domain={[0, 100]}
                label={{
                  value: "Humidity (%)",
                  angle: -90,
                  position: "insideLeft",
                }}
              />
              <Tooltip formatter={(v) => `${v.toFixed(1)}%`} />
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
    padding: '8px 12px',
    boxShadow: theme.shadows[4],
  }}
  itemStyle={{ color: theme.palette.text.primary }}  // For list items
  labelStyle={{ color: theme.palette.text.secondary }}  // For date labels
  //formatter={(v) => `${v.toFixed(1)}°C`}  // Adjust per chart
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

      {/* Terminal Log */}
      <Paper sx={{ mt: 4, p: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          Terminal Log
        </Typography>
        <LiveLog />
      </Paper>
    </Box>
  );

  // Helper component for log (shared)
  function LiveLog() {
    const [log, setLog] = useState("");

    useEffect(() => {
      const unsub = onValue(ref(db, "logs"), (snap) => {
        const data = snap.val();
        if (data) {
          const arr = Object.values(data)
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 30)
            .map((e) => `[${format(e.timestamp, "HH:mm:ss")}] ${e.message}`)
            .join("\n");
          setLog(arr);
        }
      });
      return () => unsub();
    }, []);

    return (
      <TextField
        multiline
        rows={6}
        fullWidth
        value={log || "No logs yet"}
        InputProps={{ readOnly: true }}
        sx={{
  backgroundColor: theme.palette.mode === 'dark' ? '#000' : '#f5f5f5',  // Dark: black, Light: light gray
  color: theme.palette.mode === 'dark' ? '#0f0' : '#000',  // Dark: green, Light: black
  fontFamily: 'monospace',
  fontSize: '0.875rem',
  '& .MuiOutlinedInput-root': {
    color: theme.palette.mode === 'dark' ? '#0f0' : '#000',
  },
  '& .MuiOutlinedInput-notchedOutline': {
    borderColor: theme.palette.divider,
  },
}}
      />
    );
  }
}
