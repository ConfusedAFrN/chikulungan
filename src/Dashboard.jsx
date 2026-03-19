// src/pages/Dashboard.jsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Paper,
  Typography,
  Button,
  TextField,
  Box,
  CircularProgress,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Collapse,
  Stack,
  Divider,
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
  ReferenceLine,
} from "recharts";
import { Gauge } from "@mui/x-charts/Gauge";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import ExpandLessRoundedIcon from "@mui/icons-material/ExpandLessRounded";
import RestartAltRoundedIcon from "@mui/icons-material/RestartAltRounded";
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
  // New filter states for live trends
  // ==========================
  const [timeWindowMin, setTimeWindowMin] = useState(15);
  const [trendResolutionSec, setTrendResolutionSec] = useState(10);
  const [tempDomain, setTempDomain] = useState([0, 50]);
  const [humDomain, setHumDomain] = useState([0, 100]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const thresholds = {
    tempLow: 18,
    tempHigh: 35,
    humidityLow: 45,
    humidityHigh: 75,
  };

  // ✅ Instant load: cache sensors
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

  // Updated helper: store full timestamp so time-window filtering works
  const addToHistory = useCallback((type, value, now) => {
    setHistory((prev) => {
      const last = prev[prev.length - 1] || {
        temp: sensorsRef.current.temp,
        humidity: sensorsRef.current.humidity,
        timestamp: now - 5000,
      };

      const newItem = {
        timestamp: now,
        temp: type === "temp" ? value : last.temp,
        humidity: type === "humidity" ? value : last.humidity,
      };

      let updated = [...prev, newItem];
      if (updated.length > 21600) updated = updated.slice(-21600);

      return updated;
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
          uptime: Number(Math.min(100, (activeMinutes / 1440) * 100).toFixed(1)),
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

  const makeBucketedHistory = useCallback((key) => {
    const cutoff = Date.now() - timeWindowMin * 60 * 1000;
    const filtered = history
      .filter((h) => h.timestamp >= cutoff)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (trendResolutionSec <= 1) {
      return filtered.map((h) => ({
        timestamp: h.timestamp,
        [key]: h[key],
      }));
    }

    const bucketMs = trendResolutionSec * 1000;
    const buckets = new Map();

    filtered.forEach((h) => {
      const bucketStart = Math.floor(h.timestamp / bucketMs) * bucketMs;
      if (!buckets.has(bucketStart)) {
        buckets.set(bucketStart, { sum: 0, count: 0 });
      }
      const bucket = buckets.get(bucketStart);
      bucket.sum += Number(h[key]) || 0;
      bucket.count += 1;
    });

    return Array.from(buckets.entries()).map(([timestamp, stats]) => ({
      timestamp,
      [key]: Number((stats.sum / Math.max(stats.count, 1)).toFixed(2)),
    }));
  }, [history, timeWindowMin, trendResolutionSec]);

  const tempHistory = useMemo(() => makeBucketedHistory("temp"), [makeBucketedHistory]);
  const humidityHistory = useMemo(() => makeBucketedHistory("humidity"), [makeBucketedHistory]);

  const tickFormatter = useCallback((ts) => {
    if (!Number.isFinite(ts)) return "";
    if (trendResolutionSec >= 3600) return format(new Date(ts), "MMM dd HH:mm");
    if (trendResolutionSec >= 60) return format(new Date(ts), "HH:mm");
    return format(new Date(ts), "HH:mm:ss");
  }, [trendResolutionSec]);

  const updateNumericDomain = useCallback((setter, index, rawValue, bounds) => {
    setter((prev) => {
      const next = [...prev];
      const parsedValue = Number(rawValue);
      const fallbackValue = prev[index];
      const boundedValue = Number.isFinite(parsedValue)
        ? Math.min(bounds.max, Math.max(bounds.min, parsedValue))
        : fallbackValue;

      next[index] = boundedValue;

      if (index === 0 && next[0] >= next[1]) {
        next[1] = Math.min(bounds.max, boundedValue + bounds.step);
      }

      if (index === 1 && next[1] <= next[0]) {
        next[0] = Math.max(bounds.min, boundedValue - bounds.step);
      }

      return next;
    });
  }, []);

  const resetTrendFilters = useCallback(() => {
    setTimeWindowMin(15);
    setTrendResolutionSec(10);
    setTempDomain([0, 50]);
    setHumDomain([0, 100]);
  }, []);

  const alertCandidates = useMemo(() => {
    const now = Date.now();
    const staleSeconds = lastUpdateMs ? Math.max(0, Math.floor((now - Number(lastUpdateMs)) / 1000)) : null;

    return [
      {
        key: "feed",
        label: sensors.feed < 10 ? "Feed Critically Low" : "Low Feed",
        active: sensors.feed < 20,
        severity: sensors.feed < 10 ? "critical" : "warning",
        detail: `Feed level at ${sensors.feed}%`,
      },
      {
        key: "water",
        label: sensors.water < 10 ? "Water Critically Low" : "Low Water",
        active: sensors.water < 20,
        severity: sensors.water < 10 ? "critical" : "warning",
        detail: `Water level at ${sensors.water}%`,
      },
      {
        key: "temp-high",
        label: sensors.temp >= 35 ? "Critical High Temperature" : "High Temperature",
        active: sensors.temp > 35,
        severity: sensors.temp >= 35 ? "critical" : "warning",
        detail: `Temperature at ${Number(sensors.temp).toFixed(1)}°C`,
      },
      {
        key: "temp-low",
        label: sensors.temp <= 22 ? "Critical Low Temperature" : "Low Temperature",
        active: sensors.temp < 22,
        severity: sensors.temp <= 22 ? "critical" : "warning",
        detail: `Temperature at ${Number(sensors.temp).toFixed(1)}°C`,
      },
      {
        key: "humidity-high",
        label: "High Humidity",
        active: sensors.humidity > 75,
        severity: "warning",
        detail: `Humidity at ${Number(sensors.humidity).toFixed(1)}%`,
      },
      {
        key: "humidity-low",
        label: "Low Humidity",
        active: sensors.humidity < 45,
        severity: "warning",
        detail: `Humidity at ${Number(sensors.humidity).toFixed(1)}%`,
      },
      {
        key: "stale",
        label: "Sensor Data Stale",
        active: staleSeconds != null && staleSeconds > 45 && staleSeconds <= 90,
        severity: "warning",
        detail: staleSeconds == null ? "No device timestamp yet" : `No fresh payload for ${staleSeconds}s`,
      },
      {
        key: "offline",
        label: "Device Offline",
        active: staleSeconds != null && staleSeconds > 90,
        severity: "critical",
        detail: staleSeconds == null ? "No device timestamp yet" : `No ESP32 update for ${staleSeconds}s`,
      },
    ];
  }, [sensors, lastUpdateMs]);

  const activeAlertCandidates = alertCandidates.filter((item) => item.active);

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

      <Paper sx={{ mt: 4, p: 3 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Alert Opportunities (Current Conditions)
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          These are alert types the current telemetry can produce. Active items are likely to fire in the Alert Center if they stay unresolved.
        </Typography>

        {activeAlertCandidates.length === 0 ? (
          <Typography color="success.main" fontWeight={600}>
            All monitored values are currently within normal range.
          </Typography>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.2 }}>
            {activeAlertCandidates.map((item) => (
              <Box
                key={item.key}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 2,
                  p: 1.25,
                  borderRadius: 1.5,
                  border: `1px solid ${theme.palette.divider}`,
                  backgroundColor:
                    item.severity === "critical"
                      ? theme.palette.error.light + "22"
                      : theme.palette.warning.light + "22",
                }}
              >
                <Box>
                  <Typography fontWeight={600}>{item.label}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {item.detail}
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  label={item.severity === "critical" ? "Critical" : "Warning"}
                  color={item.severity === "critical" ? "error" : "warning"}
                />
              </Box>
            ))}
          </Box>
        )}
      </Paper>

      <Paper sx={{ mt: 4, mb: 2, overflow: "hidden" }}>
        <Box
          sx={{
            px: { xs: 2, sm: 3 },
            py: 2,
            display: "flex",
            alignItems: { xs: "flex-start", sm: "center" },
            justifyContent: "space-between",
            gap: 2,
            flexWrap: "wrap",
          }}
        >
          <Box sx={{ flex: "1 1 320px", minWidth: 0 }}>
            <Typography variant="h6">Live Trends Filters</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Adjust time, resolution, and custom chart ranges without crowding the dashboard on smaller screens.
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 1.5 }}>
              <Chip size="small" label={`Window: ${timeWindowMin} min`} />
              <Chip size="small" label={`Resolution: ${trendResolutionSec >= 60 ? `${trendResolutionSec / 60} min` : `${trendResolutionSec}s`}`} />
              <Chip size="small" label={`Temp: ${tempDomain[0]}–${tempDomain[1]}°C`} />
              <Chip size="small" label={`Humidity: ${humDomain[0]}–${humDomain[1]}%`} />
            </Stack>
          </Box>

          <Stack direction="row" spacing={1} sx={{ width: { xs: "100%", sm: "auto" }, justifyContent: "flex-end" }}>
            <Button
              variant="text"
              color="inherit"
              size="small"
              startIcon={<RestartAltRoundedIcon />}
              onClick={resetTrendFilters}
            >
              Reset
            </Button>
            <Button
              variant={filtersOpen ? "contained" : "outlined"}
              endIcon={filtersOpen ? <ExpandLessRoundedIcon /> : <ExpandMoreRoundedIcon />}
              onClick={() => setFiltersOpen((prev) => !prev)}
            >
              {filtersOpen ? "Hide Filters" : "Show Filters"}
            </Button>
          </Stack>
        </Box>

        <Collapse in={filtersOpen} timeout="auto" unmountOnExit>
          <Divider />
          <Box
            sx={{
              px: { xs: 2, sm: 3 },
              py: { xs: 2, sm: 3 },
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                sm: "repeat(2, minmax(0, 1fr))",
                lg: "repeat(4, minmax(0, 1fr))",
              },
              gap: 2,
            }}
          >
            <FormControl size="small" fullWidth>
              <InputLabel>Time Window</InputLabel>
              <Select
                value={timeWindowMin}
                label="Time Window"
                onChange={(e) => setTimeWindowMin(Number(e.target.value))}
              >
                <MenuItem value={5}>Last 5 minutes</MenuItem>
                <MenuItem value={10}>Last 10 minutes</MenuItem>
                <MenuItem value={15}>Last 15 minutes</MenuItem>
                <MenuItem value={30}>Last 30 minutes</MenuItem>
                <MenuItem value={60}>Last 60 minutes</MenuItem>
                <MenuItem value={120}>Last 2 hours</MenuItem>
                <MenuItem value={360}>Last 6 hours</MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small" fullWidth>
              <InputLabel>Resolution</InputLabel>
              <Select
                value={trendResolutionSec}
                label="Resolution"
                onChange={(e) => setTrendResolutionSec(Number(e.target.value))}
              >
                <MenuItem value={1}>Every second (raw)</MenuItem>
                <MenuItem value={10}>10-second average</MenuItem>
                <MenuItem value={30}>30-second average</MenuItem>
                <MenuItem value={60}>1-minute average</MenuItem>
                <MenuItem value={300}>5-minute average</MenuItem>
                <MenuItem value={900}>15-minute average</MenuItem>
                <MenuItem value={3600}>1-hour average</MenuItem>
              </Select>
            </FormControl>

            <Box
              sx={{
                p: 2,
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: 2,
                display: "flex",
                flexDirection: "column",
                gap: 1.5,
              }}
            >
              <Typography variant="subtitle2">Temperature Range (°C)</Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1.5 }}>
                <TextField
                  size="small"
                  type="number"
                  label="Min"
                  value={tempDomain[0]}
                  onChange={(e) => updateNumericDomain(setTempDomain, 0, e.target.value, { min: -20, max: 80, step: 1 })}
                  inputProps={{ step: 1, min: -20, max: 80 }}
                />
                <TextField
                  size="small"
                  type="number"
                  label="Max"
                  value={tempDomain[1]}
                  onChange={(e) => updateNumericDomain(setTempDomain, 1, e.target.value, { min: -20, max: 80, step: 1 })}
                  inputProps={{ step: 1, min: -20, max: 80 }}
                />
              </Box>
              <Typography variant="caption" color="text.secondary">
                Fine-tune the temperature chart to match your preferred viewing range.
              </Typography>
            </Box>

            <Box
              sx={{
                p: 2,
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: 2,
                display: "flex",
                flexDirection: "column",
                gap: 1.5,
              }}
            >
              <Typography variant="subtitle2">Humidity Range (%)</Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 1.5 }}>
                <TextField
                  size="small"
                  type="number"
                  label="Min"
                  value={humDomain[0]}
                  onChange={(e) => updateNumericDomain(setHumDomain, 0, e.target.value, { min: 0, max: 100, step: 1 })}
                  inputProps={{ step: 1, min: 0, max: 100 }}
                />
                <TextField
                  size="small"
                  type="number"
                  label="Max"
                  value={humDomain[1]}
                  onChange={(e) => updateNumericDomain(setHumDomain, 1, e.target.value, { min: 0, max: 100, step: 1 })}
                  inputProps={{ step: 1, min: 0, max: 100 }}
                />
              </Box>
              <Typography variant="caption" color="text.secondary">
                Set a custom humidity band instead of switching between fixed presets.
              </Typography>
            </Box>
          </Box>
        </Collapse>
      </Paper>

      {/* Temperature Trend */}
      <Paper sx={{ mt: 2, p: 3 }}>
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
              <XAxis
                dataKey="timestamp"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={tickFormatter}
              />
              <YAxis domain={tempDomain} label={{ value: "Temp (°C)", angle: -90, position: "insideLeft" }} />
              <Tooltip
                labelFormatter={(value) => format(new Date(Number(value)), "MMM dd, HH:mm:ss")}
                formatter={(v) => `${Number(v).toFixed(1)}°C`}
                contentStyle={{
                  backgroundColor: theme.palette.background.paper,
                  color: theme.palette.text.primary,
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: theme.shape.borderRadius,
                }}
                labelStyle={{ color: theme.palette.text.primary, fontWeight: 600 }}
                itemStyle={{ color: theme.palette.text.primary }}
              />
              <ReferenceLine
                y={thresholds.tempLow}
                stroke="#0288d1"
                strokeDasharray="6 4"
                ifOverflow="extendDomain"
                label={{ value: `Too Low (${thresholds.tempLow}°C)`, position: "insideTopLeft", fill: "#0288d1", fontSize: 11 }}
              />
              <ReferenceLine
                y={thresholds.tempHigh}
                stroke="#d32f2f"
                strokeDasharray="6 4"
                ifOverflow="extendDomain"
                label={{ value: `Too High (${thresholds.tempHigh}°C)`, position: "insideBottomLeft", fill: "#d32f2f", fontSize: 11 }}
              />
              <Line
                type="monotone"
                dataKey="temp"
                stroke="#ffb400"
                strokeWidth={3}
                dot={false}
                isAnimationActive={false}
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
              <XAxis
                dataKey="timestamp"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={tickFormatter}
              />
              <YAxis domain={humDomain} label={{ value: "Humidity (%)", angle: -90, position: "insideLeft" }} />
              <Tooltip
                labelFormatter={(value) => format(new Date(Number(value)), "MMM dd, HH:mm:ss")}
                formatter={(v) => `${Number(v).toFixed(1)}%`}
                contentStyle={{
                  backgroundColor: theme.palette.background.paper,
                  color: theme.palette.text.primary,
                  border: `1px solid ${theme.palette.divider}`,
                  borderRadius: theme.shape.borderRadius,
                }}
                labelStyle={{ color: theme.palette.text.primary, fontWeight: 600 }}
                itemStyle={{ color: theme.palette.text.primary }}
              />
              <ReferenceLine
                y={thresholds.humidityLow}
                stroke="#0288d1"
                strokeDasharray="6 4"
                ifOverflow="extendDomain"
                label={{ value: `Too Low (${thresholds.humidityLow}%)`, position: "insideTopLeft", fill: "#0288d1", fontSize: 11 }}
              />
              <ReferenceLine
                y={thresholds.humidityHigh}
                stroke="#d32f2f"
                strokeDasharray="6 4"
                ifOverflow="extendDomain"
                label={{ value: `Too High (${thresholds.humidityHigh}%)`, position: "insideBottomLeft", fill: "#d32f2f", fontSize: 11 }}
              />
              <Line
                type="monotone"
                dataKey="humidity"
                stroke="#1976d2"
                strokeWidth={3}
                dot={false}
                isAnimationActive={false}
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
        value={log || "No logs yet"}
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
