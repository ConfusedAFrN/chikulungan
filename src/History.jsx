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

function formatHourLabel(hour) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return "-";

  const normalizedHour = hour % 12 || 12;
  const meridiem = hour >= 12 ? "PM" : "AM";
  return `${normalizedHour}:00 ${meridiem}`;
}

function formatDayKey(dayKey) {
  if (!dayKey) return "-";

  const [year, month, day] = dayKey.split("-").map(Number);
  if (!year || !month || !day) return dayKey;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

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
  const hour = Number(map.hour);

  return {
    dayKey: `${map.year}-${map.month}-${map.day}`,
    hour,
    hourKey: map.hour,
    hhmm: `${map.hour}:${map.minute}`,
    displayTime: formatHourLabel(hour),
  };
}

function getNumericValue(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildHourSeries(hourlyObj) {
  const list = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: formatHourLabel(hour),
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
      temp: getNumericValue(item?.temp),
      humidity: getNumericValue(item?.humidity),
      feedLevel: getNumericValue(item?.feedLevel),
      waterLevel: getNumericValue(item?.waterLevel),
    };
  });

  return list;
}

function findPeak(rows, key) {
  let peak = null;

  rows.forEach((row) => {
    const value = getNumericValue(row[key]);
    if (value == null) return;

    if (!peak || value > peak.value) {
      peak = { value, hour: row.hour, label: row.label };
    }
  });

  return peak;
}

function findAboveThresholdRanges(rows, key, threshold) {
  const ranges = [];
  let startHour = null;
  let lastHour = null;

  rows.forEach((row) => {
    const value = getNumericValue(row[key]);
    const above = value != null && value > threshold;

    if (above && startHour == null) {
      startHour = row.hour;
      lastHour = row.hour;
      return;
    }

    if (above) {
      lastHour = row.hour;
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
  return `${formatHourLabel(startHour)} - ${formatHourLabel(Math.min(endHour + 1, 23))}`;
}

function asDayKeyFromDate(date, timeZone) {
  const ts = date?.getTime?.();
  if (!Number.isFinite(ts)) return "";
  return getDateTimePartsInZone(ts, timeZone).dayKey;
}

function buildTopHourSummary(countMap, limit = 3, suffix = "times") {
  const entries = Array.from(countMap.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0]);

  return entries.slice(0, limit).map(([hour, count]) => `${formatHourLabel(hour)} (${count} ${suffix})`);
}

function buildWeeklyMetricInsight({ dayKeys, hourlyByDay, metricKey, threshold }) {
  const dailyPeakCounts = new Map();
  const thresholdHourCounts = new Map();
  const hourlyAverages = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    total: 0,
    count: 0,
  }));

  let highestSinglePeak = null;
  let activeDays = 0;

  dayKeys.forEach((dayKey) => {
    const rows = buildHourSeries(hourlyByDay[dayKey] || {});
    const hasMetric = rows.some((row) => getNumericValue(row[metricKey]) != null);
    if (!hasMetric) return;

    activeDays += 1;

    const dayPeak = findPeak(rows, metricKey);
    if (dayPeak) {
      dailyPeakCounts.set(dayPeak.hour, (dailyPeakCounts.get(dayPeak.hour) || 0) + 1);

      if (!highestSinglePeak || dayPeak.value > highestSinglePeak.value) {
        highestSinglePeak = {
          ...dayPeak,
          dayKey,
        };
      }
    }

    rows.forEach((row) => {
      const value = getNumericValue(row[metricKey]);
      if (value == null) return;

      hourlyAverages[row.hour].total += value;
      hourlyAverages[row.hour].count += 1;

      if (value > threshold) {
        thresholdHourCounts.set(row.hour, (thresholdHourCounts.get(row.hour) || 0) + 1);
      }
    });
  });

  const strongestAverageHour = hourlyAverages
    .filter((row) => row.count > 0)
    .map((row) => ({
      hour: row.hour,
      average: Number((row.total / row.count).toFixed(1)),
    }))
    .sort((a, b) => b.average - a.average || a.hour - b.hour)[0] || null;

  const mostCommonPeakHour = Array.from(dailyPeakCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0] || null;

  return {
    activeDays,
    mostCommonPeakLabel: mostCommonPeakHour ? formatHourLabel(mostCommonPeakHour[0]) : "-",
    mostCommonPeakCount: mostCommonPeakHour?.[1] || 0,
    strongestAverageHour,
    highestSinglePeak,
    recurringSpikeHours: buildTopHourSummary(thresholdHourCounts, 3),
  };
}

export default function History() {
  const theme = useTheme();
  const [tab, setTab] = useState(0);
  const [timeZone, setTimeZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [range, setRange] = useState("24h");

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
        .map(([id, event]) => ({
          id,
          timestamp: Number(event?.timestamp ?? 0),
          type: String(event?.type || ""),
          amount: Number(event?.amount ?? 0),
          unit: String(event?.unit || ""),
          dropPercent: Number(event?.dropPercent ?? 0),
          dayKey: String(event?.dayKey || ""),
          hourKey: String(event?.hourKey || ""),
        }))
        .filter((event) => event.timestamp > 0)
        .sort((a, b) => a.timestamp - b.timestamp);

      setConsumptionEvents(rows);
    });

    return () => unsubConsumption();
  }, []);

  const selectedDayKey = useMemo(
    () => asDayKeyFromDate(selectedDate, timeZone),
    [selectedDate, timeZone]
  );

  const selectedDateLabel = useMemo(() => formatDayKey(selectedDayKey), [selectedDayKey]);

  const hourlyRows = useMemo(() => {
    const dayObj = hourlyByDay[selectedDayKey] || {};
    return buildHourSeries(dayObj);
  }, [hourlyByDay, selectedDayKey]);

  const dailyConsumptionRows = useMemo(() => {
    const byDay = {};

    consumptionEvents.forEach((event) => {
      const dayKey = event.dayKey || getDateTimePartsInZone(event.timestamp, timeZone).dayKey;
      if (!byDay[dayKey]) {
        byDay[dayKey] = { dayKey, feedG: 0, waterMl: 0 };
      }

      if (event.type === "feed") byDay[dayKey].feedG += Number(event.amount || 0);
      if (event.type === "water") byDay[dayKey].waterMl += Number(event.amount || 0);
    });

    return Object.values(byDay)
      .sort((a, b) => a.dayKey.localeCompare(b.dayKey))
      .map((row) => ({
        ...row,
        feedG: Number(row.feedG.toFixed(2)),
        waterMl: Number(row.waterMl.toFixed(2)),
        displayDay: formatDayKey(row.dayKey),
      }));
  }, [consumptionEvents, timeZone]);

  const visibleDailyConsumption = useMemo(() => {
    if (!selectedDayKey) return [];
    if (range === "all") return dailyConsumptionRows;

    if (range === "24h") {
      return dailyConsumptionRows.filter((row) => row.dayKey === selectedDayKey);
    }

    const days = range === "7d" ? 7 : 30;
    return dailyConsumptionRows
      .filter((row) => row.dayKey <= selectedDayKey)
      .slice(-days);
  }, [dailyConsumptionRows, range, selectedDayKey]);

  const visibleRangeDayKeys = useMemo(
    () => new Set(visibleDailyConsumption.map((row) => row.dayKey)),
    [visibleDailyConsumption]
  );

  const selectedDayEvents = useMemo(() => {
    return consumptionEvents.filter((event) => {
      const dayKey = event.dayKey || getDateTimePartsInZone(event.timestamp, timeZone).dayKey;
      return dayKey === selectedDayKey;
    });
  }, [consumptionEvents, selectedDayKey, timeZone]);

  const selectedRangeEvents = useMemo(() => {
    if (range === "all") return consumptionEvents;

    return consumptionEvents.filter((event) => {
      const dayKey = event.dayKey || getDateTimePartsInZone(event.timestamp, timeZone).dayKey;
      return visibleRangeDayKeys.has(dayKey);
    });
  }, [consumptionEvents, range, timeZone, visibleRangeDayKeys]);

  const selectedDayConsumptionByHour = useMemo(() => {
    const rows = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      label: formatHourLabel(hour),
      feedG: 0,
      waterMl: 0,
    }));

    selectedDayEvents.forEach((event) => {
      const hour = Number.isFinite(Number(event.hourKey))
        ? Number(event.hourKey)
        : getDateTimePartsInZone(event.timestamp, timeZone).hour;

      if (!Number.isInteger(hour) || hour < 0 || hour > 23) return;
      if (event.type === "feed") rows[hour].feedG += Number(event.amount || 0);
      if (event.type === "water") rows[hour].waterMl += Number(event.amount || 0);
    });

    return rows.map((row) => ({
      ...row,
      feedG: Number(row.feedG.toFixed(2)),
      waterMl: Number(row.waterMl.toFixed(2)),
    }));
  }, [selectedDayEvents, timeZone]);

  const consumptionSummary = useMemo(() => {
    const totalFeedG = selectedDayConsumptionByHour.reduce((sum, row) => sum + Number(row.feedG || 0), 0);
    const totalWaterMl = selectedDayConsumptionByHour.reduce((sum, row) => sum + Number(row.waterMl || 0), 0);

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

  const availableDayKeys = useMemo(
    () => Object.keys(hourlyByDay).sort((a, b) => a.localeCompare(b)),
    [hourlyByDay]
  );

  const weeklyDayKeys = useMemo(() => {
    if (!selectedDayKey) return [];

    return availableDayKeys.filter((dayKey) => dayKey <= selectedDayKey).slice(-7);
  }, [availableDayKeys, selectedDayKey]);

  const temperatureWeeklyInsight = useMemo(
    () => buildWeeklyMetricInsight({
      dayKeys: weeklyDayKeys,
      hourlyByDay,
      metricKey: "temp",
      threshold: TEMP_THRESHOLD,
    }),
    [hourlyByDay, weeklyDayKeys]
  );

  const humidityWeeklyInsight = useMemo(
    () => buildWeeklyMetricInsight({
      dayKeys: weeklyDayKeys,
      hourlyByDay,
      metricKey: "humidity",
      threshold: HUMIDITY_THRESHOLD,
    }),
    [hourlyByDay, weeklyDayKeys]
  );

  const consumptionRangeInsight = useMemo(() => {
    const highestFeedDay = [...visibleDailyConsumption]
      .sort((a, b) => b.feedG - a.feedG || a.dayKey.localeCompare(b.dayKey))[0] || null;

    const highestWaterDay = [...visibleDailyConsumption]
      .sort((a, b) => b.waterMl - a.waterMl || a.dayKey.localeCompare(b.dayKey))[0] || null;

    const hourlyEventSummary = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      feedEvents: 0,
      waterEvents: 0,
      feedAmount: 0,
      waterAmount: 0,
    }));

    selectedRangeEvents.forEach((event) => {
      const hour = Number.isFinite(Number(event.hourKey))
        ? Number(event.hourKey)
        : getDateTimePartsInZone(event.timestamp, timeZone).hour;

      if (!Number.isInteger(hour) || hour < 0 || hour > 23) return;

      if (event.type === "feed") {
        hourlyEventSummary[hour].feedEvents += 1;
        hourlyEventSummary[hour].feedAmount += Number(event.amount || 0);
      }

      if (event.type === "water") {
        hourlyEventSummary[hour].waterEvents += 1;
        hourlyEventSummary[hour].waterAmount += Number(event.amount || 0);
      }
    });

    const busiestFeedHour = [...hourlyEventSummary]
      .sort((a, b) => b.feedAmount - a.feedAmount || b.feedEvents - a.feedEvents || a.hour - b.hour)[0] || null;

    const busiestWaterHour = [...hourlyEventSummary]
      .sort((a, b) => b.waterAmount - a.waterAmount || b.waterEvents - a.waterEvents || a.hour - b.hour)[0] || null;

    const daysInView = Math.max(visibleDailyConsumption.length, 1);
    const totalFeed = visibleDailyConsumption.reduce((sum, row) => sum + Number(row.feedG || 0), 0);
    const totalWater = visibleDailyConsumption.reduce((sum, row) => sum + Number(row.waterMl || 0), 0);

    return {
      highestFeedDay,
      highestWaterDay,
      busiestFeedHour,
      busiestWaterHour,
      avgDailyFeed: Number((totalFeed / daysInView).toFixed(2)),
      avgDailyWater: Number((totalWater / daysInView).toFixed(2)),
    };
  }, [selectedRangeEvents, timeZone, visibleDailyConsumption]);

  const consumptionIdeas = useMemo(
    () => [
      "Run-out forecast based on average daily use versus feed/water capacity.",
      "Anomaly detection when a day’s intake is much higher or lower than the recent weekly average.",
      "Cost tracking if you later attach a price per kilogram of feed or per liter of water.",
    ],
    []
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

  const hourAxisTicks = useMemo(
    () => Array.from({ length: 24 }, (_, hour) => hour),
    []
  );

  const todayDayKey = useMemo(() => asDayKeyFromDate(new Date(), timeZone), [timeZone]);

  const selectedDateIsToday = selectedDayKey === todayDayKey;

  const visibleEnvironmentRows = useMemo(() => {
    if (!selectedDateIsToday) return hourlyRows;

    return hourlyRows.filter(
      (row) => getNumericValue(row.temp) != null || getNumericValue(row.humidity) != null
    );
  }, [hourlyRows, selectedDateIsToday]);

  const environmentAxisTicks = useMemo(() => {
    if (!selectedDateIsToday) return hourAxisTicks;
    return visibleEnvironmentRows.map((row) => row.hour);
  }, [hourAxisTicks, selectedDateIsToday, visibleEnvironmentRows]);

  const environmentAxisDomain = useMemo(() => {
    if (!selectedDateIsToday || visibleEnvironmentRows.length === 0) return [0, 23];

    const hours = visibleEnvironmentRows.map((row) => row.hour);
    return [Math.min(...hours), Math.max(...hours)];
  }, [selectedDateIsToday, visibleEnvironmentRows]);

  const hasHourlyData = hourlyRows.some(
    (row) => getNumericValue(row.temp) != null || getNumericValue(row.humidity) != null
  );

  const totalsHeading = useMemo(() => {
    if (range === "24h") return `Consumption Totals (24H for ${selectedDateLabel})`;
    if (range === "7d") return `Consumption Totals (7D ending ${selectedDateLabel})`;
    if (range === "30d") return `Consumption Totals (30D ending ${selectedDateLabel})`;
    return "Consumption Totals (All Recorded Days)";
  }, [range, selectedDateLabel]);

  const weeklyWindowLabel = useMemo(() => {
    if (!weeklyDayKeys.length) return "No weekly data yet";
    return `${formatDayKey(weeklyDayKeys[0])} to ${formatDayKey(weeklyDayKeys[weeklyDayKeys.length - 1])}`;
  }, [weeklyDayKeys]);

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
            onChange={(dateValue) => dateValue && setSelectedDate(dateValue)}
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
          <Tabs value={tab} onChange={(_, value) => setTab(value)}>
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
                <Typography variant="body2" color="text.secondary">Consumption Totals ({selectedDateLabel})</Typography>
                <Typography variant="h6" fontWeight={700}>
                  Feed: {consumptionSummary.totalFeedG} g | Water: {consumptionSummary.totalWaterMl} ml
                </Typography>
              </Paper>

              <Paper sx={{ p: 2 }}>
                <Typography variant="body2" color="text.secondary">Average per Hour ({selectedDateLabel})</Typography>
                <Typography variant="h6" fontWeight={700}>
                  Feed: {consumptionSummary.avgFeedPerHour} g/hr | Water: {consumptionSummary.avgWaterPerHour} ml/hr
                </Typography>
              </Paper>

              <Paper sx={{ p: 2 }}>
                <Typography variant="body2" color="text.secondary">Peak Consumption Hour ({selectedDateLabel})</Typography>
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
                Consumption by Hour ({selectedDateLabel})
              </Typography>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={selectedDayConsumptionByHour} margin={{ top: 8, right: 8, left: 0, bottom: 28 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="hour"
                    type="number"
                    domain={[0, 23]}
                    ticks={hourAxisTicks}
                    tickFormatter={formatHourLabel}
                    interval={0}
                    angle={-35}
                    textAnchor="end"
                    height={60}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis yAxisId="feed" orientation="left" />
                  <YAxis yAxisId="water" orientation="right" />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={(value) => formatHourLabel(Number(value))} />
                  <Line yAxisId="feed" type="monotone" dataKey="feedG" stroke="#ffb400" name="Feed (g)" dot={false} isAnimationActive={false} />
                  <Line yAxisId="water" type="monotone" dataKey="waterMl" stroke="#1976d2" name="Water (ml)" dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </Paper>

            <Paper sx={{ p: 3, mb: 3 }}>
              <Typography variant="subtitle1" sx={{ mb: 2 }}>
                {totalsHeading}
              </Typography>
              {visibleDailyConsumption.length === 0 ? (
                <Alert severity="info">No consumption records yet for the selected date range. Records appear after sensor-level drops are detected.</Alert>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={visibleDailyConsumption}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="displayDay" minTickGap={18} />
                    <YAxis />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="feedG" fill="#ffb400" name="Feed (g)" />
                    <Bar dataKey="waterMl" fill="#1976d2" name="Water (ml)" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Paper>

            <Paper sx={{ p: 3 }}>
              <Typography variant="subtitle1" sx={{ mb: 2 }}>
                Consumption Insights & Ideas
              </Typography>

              <Box
                sx={{
                  display: "grid",
                  gap: 2,
                  gridTemplateColumns: {
                    xs: "1fr",
                    md: "repeat(3, minmax(0, 1fr))",
                  },
                  mb: 2,
                }}
              >
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">Highest Feed Day in View</Typography>
                  <Typography variant="h6" fontWeight={700}>
                    {consumptionRangeInsight.highestFeedDay
                      ? `${formatDayKey(consumptionRangeInsight.highestFeedDay.dayKey)} (${consumptionRangeInsight.highestFeedDay.feedG} g)`
                      : "-"}
                  </Typography>
                  <Typography variant="subtitle2" color="text.secondary">
                    Average daily feed in this range: {consumptionRangeInsight.avgDailyFeed} g
                  </Typography>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">Highest Water Day in View</Typography>
                  <Typography variant="h6" fontWeight={700}>
                    {consumptionRangeInsight.highestWaterDay
                      ? `${formatDayKey(consumptionRangeInsight.highestWaterDay.dayKey)} (${consumptionRangeInsight.highestWaterDay.waterMl} ml)`
                      : "-"}
                  </Typography>
                  <Typography variant="subtitle2" color="text.secondary">
                    Average daily water in this range: {consumptionRangeInsight.avgDailyWater} ml
                  </Typography>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">Most Active Refill Window</Typography>
                  <Typography variant="h6" fontWeight={700}>
                    Feed: {consumptionRangeInsight.busiestFeedHour ? formatHourLabel(consumptionRangeInsight.busiestFeedHour.hour) : "-"}
                  </Typography>
                  <Typography variant="subtitle2" color="text.secondary">
                    Water: {consumptionRangeInsight.busiestWaterHour ? formatHourLabel(consumptionRangeInsight.busiestWaterHour.hour) : "-"}
                  </Typography>
                </Paper>
              </Box>

              <Stack spacing={1}>
                {consumptionIdeas.map((idea) => (
                  <Alert key={idea} severity="info" variant="outlined">
                    {idea}
                  </Alert>
                ))}
              </Stack>
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
                  {tempPeak ? `${tempPeak.value} at ${tempPeak.label}` : "-"}
                </Typography>
                <Typography variant="subtitle2" color="text.secondary">
                  Above {TEMP_THRESHOLD}: {tempRanges.length ? tempRanges.map((rangeItem) => formatHourRange(rangeItem.startHour, rangeItem.endHour)).join(", ") : "No spikes"}
                </Typography>
              </Paper>

              <Paper sx={{ p: 2 }}>
                <Typography variant="body2" color="text.secondary">Humidity Peak</Typography>
                <Typography variant="h6" fontWeight={700}>
                  {humidityPeak ? `${humidityPeak.value}% at ${humidityPeak.label}` : "-"}
                </Typography>
                <Typography variant="subtitle2" color="text.secondary">
                  Above {HUMIDITY_THRESHOLD}%: {humidityRanges.length ? humidityRanges.map((rangeItem) => formatHourRange(rangeItem.startHour, rangeItem.endHour)).join(", ") : "No spikes"}
                </Typography>
              </Paper>
            </Box>

            <Paper sx={{ p: 3, mb: 3 }}>
              <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
                Weekly Peak Pattern Report
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Common peak and spike windows for up to 7 recorded days ending on {selectedDateLabel}. Window: {weeklyWindowLabel}.
              </Typography>

              <Box
                sx={{
                  display: "grid",
                  gap: 2,
                  gridTemplateColumns: {
                    xs: "1fr",
                    md: "repeat(2, minmax(0, 1fr))",
                  },
                }}
              >
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">Temperature Weekly Pattern</Typography>
                  <Typography variant="h6" fontWeight={700}>
                    Most common peak time: {temperatureWeeklyInsight.mostCommonPeakLabel}
                  </Typography>
                  <Typography variant="subtitle2" color="text.secondary">
                    Seen on {temperatureWeeklyInsight.mostCommonPeakCount} day(s) across {temperatureWeeklyInsight.activeDays} recorded day(s).
                  </Typography>
                  <Typography sx={{ mt: 1 }}>
                    Strongest average hour: {temperatureWeeklyInsight.strongestAverageHour
                      ? `${formatHourLabel(temperatureWeeklyInsight.strongestAverageHour.hour)} (${temperatureWeeklyInsight.strongestAverageHour.average})`
                      : "-"}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Recurring hot hours above {TEMP_THRESHOLD}: {temperatureWeeklyInsight.recurringSpikeHours.length ? temperatureWeeklyInsight.recurringSpikeHours.join(", ") : "No recurring spike window yet"}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Strongest single spike: {temperatureWeeklyInsight.highestSinglePeak
                      ? `${temperatureWeeklyInsight.highestSinglePeak.value} at ${temperatureWeeklyInsight.highestSinglePeak.label} on ${formatDayKey(temperatureWeeklyInsight.highestSinglePeak.dayKey)}`
                      : "-"}
                  </Typography>
                </Paper>

                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">Humidity Weekly Pattern</Typography>
                  <Typography variant="h6" fontWeight={700}>
                    Most common peak time: {humidityWeeklyInsight.mostCommonPeakLabel}
                  </Typography>
                  <Typography variant="subtitle2" color="text.secondary">
                    Seen on {humidityWeeklyInsight.mostCommonPeakCount} day(s) across {humidityWeeklyInsight.activeDays} recorded day(s).
                  </Typography>
                  <Typography sx={{ mt: 1 }}>
                    Strongest average hour: {humidityWeeklyInsight.strongestAverageHour
                      ? `${formatHourLabel(humidityWeeklyInsight.strongestAverageHour.hour)} (${humidityWeeklyInsight.strongestAverageHour.average}%)`
                      : "-"}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Recurring humid hours above {HUMIDITY_THRESHOLD}%: {humidityWeeklyInsight.recurringSpikeHours.length ? humidityWeeklyInsight.recurringSpikeHours.join(", ") : "No recurring spike window yet"}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Strongest single spike: {humidityWeeklyInsight.highestSinglePeak
                      ? `${humidityWeeklyInsight.highestSinglePeak.value}% at ${humidityWeeklyInsight.highestSinglePeak.label} on ${formatDayKey(humidityWeeklyInsight.highestSinglePeak.dayKey)}`
                      : "-"}
                  </Typography>
                </Paper>
              </Box>
            </Paper>

            <Paper sx={{ p: 3 }}>
              <Typography variant="subtitle1" sx={{ mb: 2 }}>
                {selectedDateIsToday
                  ? `Temperature & Humidity Recorded So Far (${selectedDateLabel})`
                  : `24-hour Temperature & Humidity (${selectedDateLabel})`}
              </Typography>
              {!hasHourlyData ? (
                <Alert severity="info">No hourly history yet. Hourly rows are created automatically from incoming sensors.</Alert>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={visibleEnvironmentRows} margin={{ top: 8, right: 8, left: 0, bottom: 28 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="hour"
                      type="number"
                      domain={environmentAxisDomain}
                      ticks={environmentAxisTicks}
                      tickFormatter={formatHourLabel}
                      interval={0}
                      angle={-35}
                      textAnchor="end"
                      height={60}
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis yAxisId="temp" orientation="left" domain={[0, 50]} />
                    <YAxis yAxisId="humidity" orientation="right" domain={[0, 100]} />
                    <Tooltip contentStyle={tooltipStyle} labelFormatter={(value) => formatHourLabel(Number(value))} />
                    <Line yAxisId="temp" type="monotone" dataKey="temp" stroke="#ff7043" name="Temperature" connectNulls={!selectedDateIsToday} isAnimationActive={false} />
                    <Line yAxisId="humidity" type="monotone" dataKey="humidity" stroke="#42a5f5" name="Humidity (%)" connectNulls={!selectedDateIsToday} isAnimationActive={false} />
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
