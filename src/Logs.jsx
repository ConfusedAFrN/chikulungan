// src/pages/Logs.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  Paper,
  Typography,
  TextField,
  Button,
  Box,
  Chip,
  CircularProgress,
  Alert,
  InputAdornment,
  IconButton,
} from "@mui/material";
import ClearIcon from "@mui/icons-material/Clear";
import { format } from "date-fns";
import { db, ref, onValue, push, serverTimestamp, set } from "./firebase";
import { useTheme } from "@mui/material/styles";

function normalize(s = "") {
  return s
    .toString()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9\s:./_-]/g, " ") // remove noisy punctuation
    .replace(/\s+/g, " ")
    .trim();
}

function getTimestampMs(ts) {
  // RTDB serverTimestamp resolves to a number (ms) when read,
  // but guard anyway because logs can be malformed or missing timestamp.
  if (typeof ts === "number") return ts;
  if (typeof ts === "string") {
    const n = Number(ts);
    return Number.isFinite(n) ? n : 0;
  }
  if (ts && typeof ts === "object") {
    // Some libs return { seconds, nanoseconds } (more common in Firestore),
    // or other shapes. Handle best-effort:
    if (typeof ts.seconds === "number") return ts.seconds * 1000;
    if (typeof ts._seconds === "number") return ts._seconds * 1000;
  }
  return 0;
}

function sourceLabel(src) {
  if (src === "esp32") return "ESP32";
  if (src === "web") return "Web";
  return "System";
}

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const theme = useTheme();

  // Real-time listener from Firebase
  useEffect(() => {
    const logsRef = ref(db, "logs");
    const unsub = onValue(logsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const logArray = Object.entries(data)
          .map(([id, log]) => ({ id, ...log }))
          .map((l) => ({
            ...l,
            // precompute tsMs for stable sort + formatting
            tsMs: getTimestampMs(l.timestamp),
          }))
          .sort((a, b) => (b.tsMs || 0) - (a.tsMs || 0))
          .slice(0, 500); // Limit to last 500 entries
        setLogs(logArray);
      } else {
        setLogs([]);
      }
      setLoading(false);
    });

    return () => unsub();
  }, []);

  // Add log from web (example: for testing)
  const addTestLog = () => {
    push(ref(db, "logs"), {
      message: "Test log from web interface",
      source: "web",
      timestamp: serverTimestamp(),
    });
  };

  const clearLogs = () => {
    if (window.confirm("Delete ALL logs permanently?")) {
      set(ref(db, "logs"), null);
    }
  };

  const tokens = useMemo(() => {
    const q = normalize(search);
    return q ? q.split(" ").filter(Boolean) : [];
  }, [search]);

  // Filtered lines for display + export (same source of truth)
  const filteredLines = useMemo(() => {
    if (!logs.length) return [];

    return logs
      .filter((log) => {
        const msg = log.message ?? "";
        const src = log.source ?? "";
        const tsMs = log.tsMs ?? getTimestampMs(log.timestamp);

        // Build searchable "haystack": message + source + date string
        const dateStr = tsMs ? format(new Date(tsMs), "MMM dd, yyyy hh:mm:ss a") : "";
        const haystack = normalize(`${msg} ${src} ${dateStr}`);

        if (tokens.length === 0) return true;
        // all tokens must match somewhere
        return tokens.every((t) => haystack.includes(t));
      })
      .map((log) => {
        const tsMs = log.tsMs ?? getTimestampMs(log.timestamp);
        const timeLabel = tsMs
          ? format(new Date(tsMs), "MMM dd, yyyy │ hh:mm:ss a")
          : "Unknown time";

        return (
          `${timeLabel}  ` +
          `${sourceLabel(log.source)}  ` +
          `${log.message ?? ""}`
        );
      });
  }, [logs, tokens]);

  const exportLogs = () => {
    const text = filteredLines.length ? filteredLines.join("\n") : "No matching logs.";
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chickulungan_logs_${format(new Date(), "yyyy-MM-dd_HHmm")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <Paper
        sx={{
          p: 3,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        <Box
          sx={{
            display: "flex",
            flexDirection: { xs: "column", sm: "row" },
            alignItems: { xs: "flex-start", sm: "center" },
            justifyContent: "space-between",
            gap: { xs: 2, sm: 0 },
            mb: 2,
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              flexWrap: "wrap",
            }}
          >
            <Typography variant="h5" fontWeight="bold">
              System Logs
            </Typography>
            <Chip label={`${logs.length} entries`} size="small" color="primary" />
            {search.trim() && (
              <Chip
                label={`${filteredLines.length} match`}
                size="small"
                color={filteredLines.length ? "success" : "warning"}
                variant="outlined"
              />
            )}
          </Box>

          <Box
            sx={{
              display: "flex",
              gap: 1,
              flexWrap: "wrap",
              width: { xs: "100%", sm: "auto" },
            }}
          >
            <Button
              variant="outlined"
              size="small"
              onClick={addTestLog}
              sx={{ flex: { xs: "1 1 100%", sm: "unset" } }}
            >
              Test Log
            </Button>

            <Button
              variant="outlined"
              color="warning"
              size="small"
              onClick={clearLogs}
              sx={{ flex: { xs: "1 1 100%", sm: "unset" } }}
            >
              Clear All
            </Button>

            <Button
              variant="contained"
              color="success"
              size="small"
              onClick={exportLogs}
              sx={{ flex: { xs: "1 1 100%", sm: "unset" } }}
            >
              Export ↓
            </Button>
          </Box>
        </Box>

        <TextField
          label="Search logs (e.g. 'feed error', 'esp32 07:10 pm')"
          variant="outlined"
          fullWidth
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{
            endAdornment: search ? (
              <InputAdornment position="end">
                <IconButton
                  aria-label="Clear search"
                  edge="end"
                  onClick={() => setSearch("")}
                  size="small"
                >
                  <ClearIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : null,
          }}
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

        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", my: 8 }}>
            <CircularProgress />
          </Box>
        ) : logs.length === 0 ? (
          <Alert severity="info">No logs yet. System events will appear here.</Alert>
        ) : (
          <TextField
            multiline
            fullWidth
            value={filteredLines.length ? filteredLines.join("\n") : "No matching logs."}
            InputProps={{ readOnly: true }}
            sx={{
              mt: 2,
              flex: 1,
              minHeight: 0,
              backgroundColor: theme.palette.mode === "dark" ? "#000" : "#f5f5f5",
              color: theme.palette.mode === "dark" ? "#0f0" : "#000",
              fontFamily: "monospace",
              fontSize: "0.875rem",
              "& .MuiOutlinedInput-root": {
                color: theme.palette.mode === "dark" ? "#0f0" : "#000",
                height: "100%",
                alignItems: "flex-start",
                overflowY: "auto",
              },
              "& .MuiOutlinedInput-notchedOutline": {
                borderColor: theme.palette.divider,
              },
            }}
          />
        )}
      </Paper>
    </Box>
  );
}
