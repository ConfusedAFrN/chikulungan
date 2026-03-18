import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Chip,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import {
  Line,
  LineChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Bar,
  BarChart,
} from "recharts";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { db, onValue, ref } from "./firebase";
import { useTheme } from "@mui/material/styles";

const FEED_CAPACITY_GRAMS = 2000;
const WATER_CAPACITY_ML = 4000;
const TEMP_THRESHOLD = 35;
const HUMIDITY_THRESHOLD = 80;

function getDateTimePartsInZone(ts, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(new Date(ts));
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));

  return {
    dayKey: `${map.year}-${map.month}-${map.day}`,
    hour: Number(map.hour),
    hourKey: map.hour,
    hhmm: `${map.hour}:${map.minute}`,
  };
}

function buildHourSeries(hourlyObj) {
  const list = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    temp: null,
    humidity: null,
    feedLevel: null,
    waterLevel: null,
  }));

  Object.entries(hourlyObj || {}).forEach(([hourKey, item]) => {
    const hour = Number(hourKey);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return;

    list[hour] = {
      ...list[hour],
      temp: Number(item?.temp ?? 0),
      humidity: Number(item?.humidity ?? 0),
      feedLevel: Number(item?.feedLevel ?? 0),
      waterLevel: Number(item?.waterLevel ?? 0),
    };
  });

  return list;
}

function findPeak(rows, key) {
  let peak = null;

  rows.forEach((r) => {
    const value = Number(r[key]);
    if (!Number.isFinite(value)) return;
    if (!peak || value > peak.value) {
      peak = { value, hour: r.hour, label: r.label };
    }
  });

  return peak;
}

function findAboveThresholdRanges(rows, key, threshold) {
  const ranges = [];
  let startHour = null;
  let lastHour = null;

  rows.forEach((r) => {
    const value = Number(r[key]);
    const above = Number.isFinite(value) && value > threshold;

    if (above && startHour == null) {
      startHour = r.hour;
      lastHour = r.hour;
      return;
    }

    if (above) {
      lastHour = r.hour;
      return;
    }

    if (!above && startHour != null) {
      ranges.push({ startHour, endHour: lastHour });
      startHour = null;
      lastHour = null;
    }
  });

  if (startHour != null && lastHour != null) {
    ranges.push({ startHour, endHour: lastHour });
  }

  return ranges;
}

function formatHourRange(startHour, endHour) {
  const start = `${String(startHour).padStart(2, "0")}:00`;
  const end = `${String(Math.min(endHour + 1, 24)).padStart(2, "0")}:00`;
  return `${start} - ${end}`;
}

function asDayKeyFromDate(date, timeZone) {
  const ts = date?.getTime?.();
  if (!Number.isFinite(ts)) return "";
  return getDateTimePartsInZone(ts, timeZone).dayKey;
}

export default function History() {
  const theme = useTheme();
  const [tab, setTab] = useState(0);
  const [timeZone, setTimeZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [range, setRange] = useState("24h"); // 24h | 7d | 30d | all

  const [hourlyByDay, setHourlyByDay] = useState({});
  const [consumptionEvents, setConsumptionEvents] = useState([]);

  useEffect(() => {
    const unsubTz = onValue(ref(db, "settings/farm/timeZone"), (snap) => {
      const tz = String(snap.val() || "").trim();
      if (tz) setTimeZone(tz);
    });

    return () => unsubTz();
  }, []);

  useEffect(() => {
    const unsubHourly = onValue(ref(db, "history/hourly"), (snap) => {
      setHourlyByDay(snap.val() || {});
    });

    return () => unsubHourly();
  }, []);

  useEffect(() => {
    const unsubConsumption = onValue(ref(db, "history/consumptionEvents"), (snap) => {
      const obj = snap.val() || {};
      const rows = Object.entries(obj)
        .map(([id, e]) => ({
          id,
          timestamp: Number(e?.timestamp ?? 0),
          type: String(e?.type || ""),
          amount: Number(e?.amount ?? 0),
          unit: String(e?.unit || ""),
          dropPercent: Number(e?.dropPercent ?? 0),
          dayKey: String(e?.dayKey || ""),
          hourKey: String(e?.hourKey || ""),
        }))
        .filter((e) => e.timestamp > 0)
        .sort((a, b) => a.timestamp - b.timestamp);

      setConsumptionEvents(rows);
    });

    return () => unsubConsumption();
  }, []);

  const selectedDayKey = useMemo(
    () => asDayKeyFromDate(selectedDate, timeZone),
    [selectedDate, timeZone]
  );

  const hourlyRows = useMemo(() => {
    const dayObj = hourlyByDay[selectedDayKey] || {};
    return buildHourSeries(dayObj);
  }, [hourlyByDay, selectedDayKey]);

  const dailyConsumptionRows = useMemo(() => {
    const byDay = {};

    consumptionEvents.forEach((e) => {
      const dayKey = e.dayKey || getDateTimePartsInZone(e.timestamp, timeZone).dayKey;
      if (!byDay[dayKey]) {
        byDay[dayKey] = { dayKey, feedG: 0, waterMl: 0 };
      }

      if (e.type === "feed") byDay[dayKey].feedG += Number(e.amount || 0);
      if (e.type === "water") byDay[dayKey].waterMl += Number(e.amount || 0);
    });

    return Object.values(byDay).sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  }, [consumptionEvents, timeZone]);

  const visibleDailyConsumption = useMemo(() => {
    if (range === "all") return dailyConsumptionRows;

    const days = range === "7d" ? 7 : range === "30d" ? 30 : 1;
    return dailyConsumptionRows.slice(-days);
  }, [dailyConsumptionRows, range]);

  const selectedDayEvents = useMemo(() => {
    return consumptionEvents.filter((e) => {
      const dayKey = e.dayKey || getDateTimePartsInZone(e.timestamp, timeZone).dayKey;
      return dayKey === selectedDayKey;
    });
  }, [consumptionEvents, selectedDayKey, timeZone]);

  const selectedDayConsumptionByHour = useMemo(() => {
    const rows = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      label: `${String(hour).padStart(2, "0")}:00`,
      feedG: 0,
      waterMl: 0,
    }));

    selectedDayEvents.forEach((e) => {
      const hour = Number.isFinite(Number(e.hourKey))
        ? Number(e.hourKey)
        : getDateTimePartsInZone(e.timestamp, timeZone).hour;

      if (!Number.isInteger(hour) || hour < 0 || hour > 23) return;
      if (e.type === "feed") rows[hour].feedG += Number(e.amount || 0);
      if (e.type === "water") rows[hour].waterMl += Number(e.amount || 0);
    });

    return rows.map((r) => ({
      ...r,
      feedG: Number(r.feedG.toFixed(2)),
      waterMl: Number(r.waterMl.toFixed(2)),
    }));
  }, [selectedDayEvents, timeZone]);

  const consumptionSummary = useMemo(() => {
    const totalFeedG = selectedDayConsumptionByHour.reduce((sum, r) => sum + Number(r.feedG || 0), 0);
    const totalWaterMl = selectedDayConsumptionByHour.reduce((sum, r) => sum + Number(r.waterMl || 0), 0);

    const feedPeak = selectedDayConsumptionByHour.reduce(
      (peak, row) => (row.feedG > (peak?.value ?? -1) ? { hour: row.label, value: row.feedG } : peak),
      null
    );

    const waterPeak = selectedDayConsumptionByHour.reduce(
      (peak, row) => (row.waterMl > (peak?.value ?? -1) ? { hour: row.label, value: row.waterMl } : peak),
      null
    );

    return {
      totalFeedG: Number(totalFeedG.toFixed(2)),
      totalWaterMl: Number(totalWaterMl.toFixed(2)),
      avgFeedPerHour: Number((totalFeedG / 24).toFixed(2)),
      avgWaterPerHour: Number((totalWaterMl / 24).toFixed(2)),
      feedPeak,
      waterPeak,
    };
  }, [selectedDayConsumptionByHour]);

  const tempPeak = useMemo(() => findPeak(hourlyRows, "temp"), [hourlyRows]);
  const humidityPeak = useMemo(() => findPeak(hourlyRows, "humidity"), [hourlyRows]);

  const tempRanges = useMemo(
    () => findAboveThresholdRanges(hourlyRows, "temp", TEMP_THRESHOLD),
    [hourlyRows]
  );

  const humidityRanges = useMemo(
    () => findAboveThresholdRanges(hourlyRows, "humidity", HUMIDITY_THRESHOLD),
    [hourlyRows]
  );

  const tooltipStyle = useMemo(
    () => ({
      backgroundColor: theme.palette.background.paper,
      color: theme.palette.text.primary,
      border: `1px solid ${theme.palette.divider}`,
      borderRadius: theme.shape.borderRadius,
      padding: "8px 12px",
      boxShadow: theme.shadows[4],
    }),
    [theme]
  );

  const hasHourlyData = hourlyRows.some(
    (r) => Number.isFinite(Number(r.temp)) || Number.isFinite(Number(r.humidity))
  );

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <Box sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h4" fontWeight={700} gutterBottom>
          Consumption & Environment History
        </Typography>

        <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
          Farm timezone: <b>{timeZone}</b>. Baselines used: <b>{FEED_CAPACITY_GRAMS}g</b> feed and <b>{WATER_CAPACITY_ML}ml</b> water.
        </Typography>

        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mb: 2, alignItems: "center" }}>
          <DatePicker
            label="Calendar Day"
            value={selectedDate}
            onChange={(d) => d && setSelectedDate(d)}
            slotProps={{ textField: { size: "small" } }}
          />

          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            <Chip label="24h" color={range === "24h" ? "primary" : "default"} onClick={() => setRange("24h")} />
            <Chip label="7d" color={range === "7d" ? "primary" : "default"} onClick={() => setRange("7d")} />
            <Chip label="30d" color={range === "30d" ? "primary" : "default"} onClick={() => setRange("30d")} />
            <Chip label="All" color={range === "all" ? "primary" : "default"} onClick={() => setRange("all")} />
          </Box>
        </Stack>

        <Paper sx={{ mb: 3 }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)}>
            <Tab label="Consumption" />
            <Tab label="Temperature & Humidity" />
          </Tabs>
        </Paper>

        {tab === 0 && (
          <Box>
            <Box
              sx={{
                mb: 2,
                display: "grid",
                gap: 2,
                gridTemplateColumns: {
                  xs: "1fr",
                  md: "repeat(3, minmax(0, 1fr))",
                },
              }}
            >
              <Paper sx={{ p: 2 }}>
                <Typography variant="body2" color="text.secondary">Total Consumed (Day)</Typography>
                <Typography variant="h6" fontWeight={700}>
                  Feed: {consumptionSummary.totalFeedG} g | Water: {consumptionSummary.totalWaterMl} ml
                </Typography>
              </Paper>

              <Paper sx={{ p: 2 }}>
                <Typography variant="body2" color="text.secondary">Average per Hour (Day)</Typography>
                <Typography variant="h6" fontWeight={700}>
                  Feed: {consumptionSummary.avgFeedPerHour} g/hr | Water: {consumptionSummary.avgWaterPerHour} ml/hr
                </Typography>
              </Paper>

              <Paper sx={{ p: 2 }}>
                <Typography variant="body2" color="text.secondary">Peak Consumption Hour (Day)</Typography>
                <Typography variant="h6" fontWeight={700}>
                  Feed: {consumptionSummary.feedPeak?.hour || "-"} ({consumptionSummary.feedPeak?.value ?? 0} g)
                </Typography>
                <Typography variant="subtitle2" color="text.secondary">
                  Water: {consumptionSummary.waterPeak?.hour || "-"} ({consumptionSummary.waterPeak?.value ?? 0} ml)
                </Typography>
              </Paper>
            </Box>

            <Paper sx={{ p: 3, mb: 3 }}>
              <Typography variant="subtitle1" sx={{ mb: 2 }}>
                Consumption by Hour ({selectedDayKey})
              </Typography>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={selectedDayConsumptionByHour}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis yAxisId="feed" orientation="left" />
                  <YAxis yAxisId="water" orientation="right" />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line yAxisId="feed" type="monotone" dataKey="feedG" stroke="#ffb400" name="Feed (g)" dot={false} />
                  <Line yAxisId="water" type="monotone" dataKey="waterMl" stroke="#1976d2" name="Water (ml)" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </Paper>

            <Paper sx={{ p: 3 }}>
              <Typography variant="subtitle1" sx={{ mb: 2 }}>
                Consumption Totals ({range.toUpperCase()})
              </Typography>
              {visibleDailyConsumption.length === 0 ? (
                <Alert severity="info">No consumption records yet. Records appear after sensor-level drops are detected.</Alert>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={visibleDailyConsumption}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="dayKey" />
                    <YAxis />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="feedG" fill="#ffb400" name="Feed (g)" />
                    <Bar dataKey="waterMl" fill="#1976d2" name="Water (ml)" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Paper>
          </Box>
        )}

        {tab === 1 && (
          <Box>
            <Box
              sx={{
                mb: 2,
                display: "grid",
                gap: 2,
                gridTemplateColumns: {
                  xs: "1fr",
                  md: "repeat(2, minmax(0, 1fr))",
                },
              }}
            >
              <Paper sx={{ p: 2 }}>
                <Typography variant="body2" color="text.secondary">Temperature Peak</Typography>
                <Typography variant="h6" fontWeight={700}>
                  {tempPeak ? `${tempPeak.value} degC at ${tempPeak.label}` : "-"}
                </Typography>
                <Typography variant="subtitle2" color="text.secondary">
                  Above {TEMP_THRESHOLD} degC: {tempRanges.length ? tempRanges.map((r) => formatHourRange(r.startHour, r.endHour)).join(", ") : "No spikes"}
                </Typography>
              </Paper>

              <Paper sx={{ p: 2 }}>
                <Typography variant="body2" color="text.secondary">Humidity Peak</Typography>
                <Typography variant="h6" fontWeight={700}>
                  {humidityPeak ? `${humidityPeak.value}% at ${humidityPeak.label}` : "-"}
                </Typography>
                <Typography variant="subtitle2" color="text.secondary">
                  Above {HUMIDITY_THRESHOLD}%: {humidityRanges.length ? humidityRanges.map((r) => formatHourRange(r.startHour, r.endHour)).join(", ") : "No spikes"}
                </Typography>
              </Paper>
            </Box>

            <Paper sx={{ p: 3 }}>
              <Typography variant="subtitle1" sx={{ mb: 2 }}>
                24-hour Temperature & Humidity ({selectedDayKey})
              </Typography>
              {!hasHourlyData ? (
                <Alert severity="info">No hourly history yet. Hourly rows are created automatically from incoming sensors.</Alert>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={hourlyRows}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis yAxisId="temp" orientation="left" domain={[0, 50]} />
                    <YAxis yAxisId="humidity" orientation="right" domain={[0, 100]} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Line yAxisId="temp" type="monotone" dataKey="temp" stroke="#ff7043" name="Temperature ( degC)" connectNulls />
                    <Line yAxisId="humidity" type="monotone" dataKey="humidity" stroke="#42a5f5" name="Humidity (%)" connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </Paper>
          </Box>
        )}
      </Box>
    </LocalizationProvider>
  );
}
