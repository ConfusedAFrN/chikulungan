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
import { DataGrid } from "@mui/x-data-grid";
import { format } from "date-fns";
import { db, ref, onValue, push, serverTimestamp, set } from "./firebase";
import { useTheme } from "@mui/material/styles";

function normalize(s = "") {
  return s
    .toString()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s:./_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTimestampMs(ts) {
  if (typeof ts === "number" && Number.isFinite(ts) && ts > 0) return ts;
  if (typeof ts === "string") {
    const n = Number(ts);
    if (Number.isFinite(n) && n > 0) return n;
    const parsed = Date.parse(ts);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
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
  const [totalEntries, setTotalEntries] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const theme = useTheme();

  // Real-time listener from Firebase
  useEffect(() => {
    const logsRef = ref(db, "logs");
    const unsub = onValue(logsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const total = Object.keys(data).length;
        setTotalEntries(total);

        const logArray = Object.entries(data)
          .map(([id, log]) => ({ id, ...log }))
          .map((l) => ({
            ...l,
            tsMs: getTimestampMs(l.timestamp),
          }))
          .sort((a, b) => (b.tsMs || 0) - (a.tsMs || 0))
          .slice(0, 500);
        setLogs(logArray);
      } else {
        setLogs([]);
        setTotalEntries(0);
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

  // Filtered logs with pre-computed formatted time
  const filteredLogs = useMemo(() => {
    if (!logs.length) return [];

    return logs
      .filter((log) => {
        const msg = log.message ?? "";
        const src = log.source ?? "";
        const tsMs = log.tsMs ?? getTimestampMs(log.timestamp);
        const dateStr = tsMs ? format(new Date(tsMs), "MMM dd, yyyy hh:mm:ss a") : "";
        const haystack = normalize(`${msg} ${src} ${dateStr}`);

        if (tokens.length === 0) return true;
        return tokens.every((t) => haystack.includes(t));
      })
      .map((log) => {
        const ts = log.tsMs ?? getTimestampMs(log.timestamp);
        const formattedTime = ts
          ? format(new Date(ts), "MMM dd, yyyy hh:mm:ss a")
          : "Unknown";

        return {
          ...log,
          formattedTime,
          id: log.id || Date.now() + Math.random(),
        };
      });
  }, [logs, tokens]);

  const columns = [
    {
      field: "formattedTime",
      headerName: "Time",
      width: 190,
      sortable: true,
    },
    {
      field: "source",
      headerName: "Source",
      width: 130,
      renderCell: (params) => (
        <Chip
          label={sourceLabel(params.row?.source)}
          size="small"
          color={params.row?.source === "esp32" ? "primary" : "default"}
          variant="outlined"
        />
      ),
    },
    {
      field: "message",
      headerName: "Message",
      flex: 1,
      minWidth: 240,
      renderCell: (params) => (
        <Typography variant="body2" sx={{ whiteSpace: "normal", lineHeight: 1.4 }}>
          {params.row?.message ?? ""}
        </Typography>
      ),
    },
  ];

  const exportLogs = () => {
    if (!filteredLogs.length) {
      alert("No matching logs to export");
      return;
    }

    const headers = ["Time", "Source", "Message"];
    const lines = [
      headers.join(","),
      ...filteredLogs.map((log) => {
        const timeStr = log.formattedTime || "";
        return `"${timeStr}","${sourceLabel(log.source)}","${(log.message ?? "").replace(/"/g, '""')}"`;
      }),
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chickulungan_logs_${format(new Date(), "yyyy-MM-dd_HHmm")}.csv`;
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
          p: { xs: 2, sm: 3 },
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
            <Chip label={`${totalEntries} total entries`} size="small" color="primary" />
            {search.trim() && (
              <Chip
                label={`${filteredLogs.length} match`}
                size="small"
                color={filteredLogs.length ? "success" : "warning"}
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
              Export CSV
            </Button>
          </Box>
        </Box>

        <TextField
          label="Search logs (e.g. 'feed', 'esp32', 'low')"
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
          sx={{ mb: 2 }}
        />

        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", my: 8 }}>
            <CircularProgress />
          </Box>
        ) : logs.length === 0 ? (
          <Alert severity="info">No logs yet. System events will appear here.</Alert>
        ) : (
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <DataGrid
              rows={filteredLogs}
              columns={columns}
              pageSize={20}
              rowsPerPageOptions={[10, 20, 50]}
              disableSelectionOnClick
              autoHeight={false}
              density="compact"
              sx={{
                border: "none",
                bgcolor: theme.palette.background.paper,
                color: theme.palette.text.primary,
                "& .MuiDataGrid-columnHeaders": {
                  bgcolor:
                    theme.palette.mode === "dark"
                      ? "rgba(255,255,255,0.06)"
                      : "rgba(0,0,0,0.04)",
                  borderBottom: `1px solid ${theme.palette.divider}`,
                },
                "& .MuiDataGrid-cell": {
                  borderBottom: `1px solid ${theme.palette.divider}`,
                  py: 1,
                },
                "& .MuiDataGrid-footerContainer": {
                  borderTop: `1px solid ${theme.palette.divider}`,
                },
                "& .MuiDataGrid-row:hover": {
                  backgroundColor: "rgba(25, 118, 210, 0.08)",
                },
              }}
            />
          </Box>
        )}
      </Paper>
    </Box>
  );
}