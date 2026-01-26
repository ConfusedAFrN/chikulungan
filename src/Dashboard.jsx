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
import { db, ref, onValue, push, } from "./firebase";
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
  const [setLog] = useState("System ready...\n");
  const [online, setOnline] = useState(false);
  const [lastUpdateMs, setLastUpdateMs] = useState(null);

  const [ setLastMqttTime] = useState(0);
  const [history, setHistory] = useState([]);
  const [uptimeData, setUptimeData] = useState([]); // Now dynamic
  const [incidents, setIncidents] = useState(0);
  const theme = useTheme();  // Gets current theme (dark/light)
  const [isFeeding, setIsFeeding] = useState(false);




  // === MQTT Listener ===
  useEffect(() => {
  const handler = (e) => {
    const { topic, payload } = e.detail;
    const now = Date.now();

    if (topic === "chickulungan/sensor/temp") {
      const val = parseFloat(payload) || 0;
      setSensors((prev) => ({ ...prev, temp: val }));
      addToHistory("temp", val, now);
   ;
    }

    if (topic === "chickulungan/sensor/humidity") {
      const val = parseFloat(payload) || 0;
      setSensors((prev) => ({ ...prev, humidity: val }));
      addToHistory("humidity", val, now);
      
    }

    if (topic === "chickulungan/sensor/feed") {
      setSensors((prev) => ({ ...prev, feed: parseInt(payload) || 0 }));
   
    }

    if (topic === "chickulungan/sensor/water") {
      setSensors((prev) => ({ ...prev, water: parseInt(payload) || 0 }));
    }

    if (topic === "chickulungan/log") {
      setLog((prev) => prev + payload + "\n");
    }

    // ❌ REMOVE this line (we won't use MQTT status for online anymore)
    // if (topic === "chickulungan/status") setOnline(payload === "online");

    setLastMqttTime(now);
  };

  window.addEventListener("mqtt-message", handler);
  return () => window.removeEventListener("mqtt-message", handler);
}, []); // ✅ add this


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

  // === Firebase Fallback ===
  // === Firebase Sensors Listener (always on) ===
useEffect(() => {
  const sensorsRef = ref(db, "sensors");

  const unsub = onValue(sensorsRef, (snap) => {
    const data = snap.val();
    if (!data) return;

    setSensors((prev) => ({
      ...prev,
      temp: data.temperature ?? prev.temp ?? 0,
      humidity: data.humidity ?? prev.humidity ?? 0,
      feed: data.feedLevel ?? prev.feed ?? 0,
      water: data.waterLevel ?? prev.water ?? 0,
    }));

    // lastUpdate should be ms epoch (number). Handle string too.
    if (data.lastUpdate != null) {
      const v = Number(data.lastUpdate);
      if (!Number.isNaN(v)) setLastUpdateMs(v);
    }
  });

  return () => unsub();
}, []);

// === Online/Offline based on lastUpdate ===
useEffect(() => {
  const OFFLINE_AFTER_MS = 90 * 1000; // 90 seconds

  const tick = () => {
    if (!lastUpdateMs) {
      setOnline(false);
      return;
    }
    const age = Date.now() - Number(lastUpdateMs);
    setOnline(age <= OFFLINE_AFTER_MS);
  };

  tick(); // run immediately
  const timer = setInterval(tick, 5000);
  return () => clearInterval(timer);
}, [lastUpdateMs]);


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

  const navigate = useNavigate();

  const setSched = () => {
    navigate("/schedules");
  };

  //

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
          Last update: {lastUpdateMs ? format(lastUpdateMs, "HH:mm:ss") : "Never"}

        </Typography>
      </Box>

      
        <Grid container spacing={{ xs: 2, sm: 3, md: 4 }}>

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
