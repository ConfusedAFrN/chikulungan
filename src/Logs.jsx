// src/pages/Logs.jsx
import React, { useState, useEffect } from "react";
import {
  Paper,
  Typography,
  TextField,
  Button,
  Box,
  Chip,
  CircularProgress,
  Alert,
} from "@mui/material";
import { format } from "date-fns";
import { db, ref, onValue, push, serverTimestamp, set } from "./firebase";
import { useTheme } from "@mui/material/styles";

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
          .sort((a, b) => b.timestamp - a.timestamp)
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

  const exportLogs = () => {
    const filtered = logs
      .filter((log) => log.message.toLowerCase().includes(search.toLowerCase()))
      .map(
        (log) =>
          `${format(log.timestamp, "PP p")} [${log.source}] ${log.message}`
      )
      .join("\n");

    const blob = new Blob([filtered], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chickulungan_logs_${format(
      new Date(),
      "yyyy-MM-dd_HHmm"
    )}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredLogs = logs
    .filter((log) => log.message.toLowerCase().includes(search.toLowerCase()))
    .map(
      (log) =>
        `${format(log.timestamp, "MMM dd, yyyy │ hh:mm:ss a")}  ` +
        `${
          log.source === "esp32"
            ? "ESP32"
            : log.source === "web"
            ? "Web"
            : "System"
        }  ${log.message}`
    )
    .join("\n");

  return (
    <Box
  sx={{
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
  }}
>

      <Paper sx={{ p: 3, flex: 1, display: "flex", flexDirection: "column" }}>
        <Box //Header Box
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
            <Chip
              label={`${logs.length} entries`}
              size="small"
              color="primary"
            />
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
          label="Search logs..."
          variant="outlined"
          fullWidth
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{
            backgroundColor: theme.palette.mode === "dark" ? "#000" : "#f5f5f5", // Dark: black, Light: light gray
            color: theme.palette.mode === "dark" ? "#0f0" : "#000", // Dark: green, Light: black
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
          <Alert severity="info">
            No logs yet. System events will appear here.
          </Alert>
        ) : (
          <TextField
            multiline
            fullWidth
            value={filteredLogs || "No matching logs."}
            InputProps={{ readOnly: true }}
            sx={{
              backgroundColor:
                theme.palette.mode === "dark" ? "#000" : "#f5f5f5", // Dark: black, Light: light gray
              color: theme.palette.mode === "dark" ? "#0f0" : "#000", // Dark: green, Light: black
              fontFamily: "monospace",
              fontSize: "0.875rem",
              "& .MuiOutlinedInput-root": {
                color: theme.palette.mode === "dark" ? "#0f0" : "#000",
                overflowY: "auto", // Enable vertical scrolling
                height: "100%", // Full height
                "&::-webkit-scrollbar": {
                  // Custom scrollbar for aesthetics
                  width: "8px",
                },
                "&::-webkit-scrollbar-track": {
                  background: theme.palette.mode === "dark" ? "#333" : "#ddd",
                },
                "&::-webkit-scrollbar-thumb": {
                  background: theme.palette.mode === "dark" ? "#666" : "#aaa",
                  borderRadius: "4px",
                },
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

//overflow: 'auto !important',
// height: '100% !important',
