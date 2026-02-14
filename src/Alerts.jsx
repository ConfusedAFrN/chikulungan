// src/pages/Alerts.jsx
// To be added = Feed Interrupted Alert
import React, { useMemo, useState, useEffect } from "react";
import {
  Paper,
  Typography,
  Button,
  Box,
  Chip,
  Alert as MuiAlert,
  CircularProgress,
  Divider,
  Stack,
  useMediaQuery,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { DataGrid } from "@mui/x-data-grid";
import { format } from "date-fns";
import { db, ref, onValue, set } from "./firebase";

function toTsMs(raw) {
  // Accept: number (ms), ISO string, numeric string. Otherwise: 0.
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === "string") {
    const asNum = Number(raw);
    if (Number.isFinite(asNum) && asNum > 0) return asNum;
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

function severityToColor(sev) {
  // Data: sev is "critical" or "warning" (based on your existing logic)
  if (sev === "critical") return "error";
  return "warning";
}

function prettyTime(tsMs) {
  if (!Number.isFinite(tsMs) || tsMs <= 0) return "Unknown time";
  return format(new Date(tsMs), "MMM dd, yyyy hh:mm:ss a");
}

export default function Alerts() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notifSupported, setNotifSupported] = useState(false);
  const [notifPermission, setNotifPermission] = useState("default");

  useEffect(() => {
    const alertsRef = ref(db, "alerts");
    const unsub = onValue(alertsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const list = Object.entries(data)
          .map(([id, alert]) => {
            const tsMs = toTsMs(alert?.timestamp);
            return {
              id,
              ...alert,
              tsMs: tsMs || Date.now(), // fallback so sorting is stable
            };
          })
          .sort((a, b) => (b.tsMs || 0) - (a.tsMs || 0));
        setAlerts(list);
      } else {
        setAlerts([]);
      }
      setLoading(false);
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    const supported = typeof window !== "undefined" && "Notification" in window;
    setNotifSupported(supported);
    if (supported) {
      setNotifPermission(Notification.permission);
    }
  }, []);

  const requestNotificationPermission = async () => {
    if (!("Notification" in window)) return;
    const result = await Notification.requestPermission();
    setNotifPermission(result);
  };

  const activeCount = useMemo(
    () => alerts.filter((a) => !a.resolved).length,
    [alerts]
  );

  const resolveAlert = (id) => {
    const found = alerts.find((a) => a.id === id);
    if (!found) return;

    const alertRef = ref(db, `alerts/${id}`);
    set(alertRef, { ...found, resolved: true })
      .then(() => {
        setAlerts((prev) =>
          prev.map((a) => (a.id === id ? { ...a, resolved: true } : a))
        );
      })
      .catch((error) => {
        console.error("Error resolving alert:", error);
        window.alert("Failed to resolve alert – check console");
      });
  };

  const resolveAll = () => {
    const unresolved = alerts.filter((a) => !a.resolved);
    unresolved.forEach((a) => {
      const alertRef = ref(db, `alerts/${a.id}`);
      set(alertRef, { ...a, resolved: true })
        .then(() => {
          setAlerts((prev) =>
            prev.map((x) => (x.id === a.id ? { ...x, resolved: true } : x))
          );
        })
        .catch((error) => {
          console.error("Error resolving all alerts:", error);
        });
    });
  };

  const columns = useMemo(
    () => [
      {
        field: "tsMs",
        headerName: "Time",
        width: 220,
        valueGetter: (params) => params?.row?.tsMs ?? 0,
        renderCell: (params) => prettyTime(Number(params?.row?.tsMs)),
      },
      {
        field: "type",
        headerName: "Type",
        width: 150,
        renderCell: (params) => (
          <Chip
            label={params.value || "unknown"}
            size="small"
            color={severityToColor(params.row?.severity)}
            sx={{ fontWeight: "bold" }}
          />
        ),
      },
      { field: "message", headerName: "Message", flex: 1, minWidth: 240 },
      {
        field: "resolved",
        headerName: "Status",
        width: 120,
        renderCell: (params) =>
          params.value ? (
            <Chip label="Resolved" color="success" size="small" />
          ) : (
            <Chip label="Active" color="error" size="small" />
          ),
      },
      {
        field: "actions",
        headerName: "",
        width: 120,
        sortable: false,
        filterable: false,
        renderCell: (params) =>
          !params.row.resolved && (
            <Button
              size="small"
              variant="outlined"
              onClick={() => resolveAlert(params.row.id)}
            >
              Resolve
            </Button>
          ),
      },
    ],
    [alerts]
  );

  return (
    <Box
      sx={{
        p: { xs: 1.5, sm: 2 },
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 2,
        minHeight: 0,
      }}
    >
      <Paper
        sx={{
          p: { xs: 1.5, sm: 3 },
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      >
        {/* Header */}
        <Box
          sx={{
            display: "flex",
            flexDirection: { xs: "column", sm: "row" },
            gap: { xs: 1.5, sm: 0 },
            justifyContent: "space-between",
            alignItems: { xs: "flex-start", sm: "center" },
            mb: 2,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
            <Typography variant={isMobile ? "h6" : "h5"} fontWeight="bold">
              Alert Center
            </Typography>

            {activeCount > 0 && (
              <Chip label={`${activeCount} Active`} color="error" size="small" />
            )}
          </Box>

          <Button
            variant="contained"
            onClick={resolveAll}
            disabled={activeCount === 0}
            sx={{ width: { xs: "100%", sm: "auto" } }}
          >
            Resolve All
          </Button>
        </Box>

        {/* Body */}
        {notifSupported && notifPermission !== "granted" && (
          <MuiAlert
            severity={notifPermission === "denied" ? "warning" : "info"}
            sx={{ mb: 2 }}
            action={
              notifPermission === "default" ? (
                <Button color="inherit" size="small" onClick={requestNotificationPermission}>
                  Enable
                </Button>
              ) : null
            }
          >
            {notifPermission === "denied"
              ? "Browser notifications are blocked. Please allow them in your browser settings."
              : "Enable browser notifications to receive alert updates (mobile browsers require a tap)."}
          </MuiAlert>
        )}
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", my: 8 }}>
            <CircularProgress />
          </Box>
        ) : alerts.length === 0 ? (
          <MuiAlert severity="success">
            No alerts — system running smoothly!
          </MuiAlert>
        ) : isMobile ? (
          // ✅ Mobile: card list (readable, not cramped)
          <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", pr: 0.5 }}>
            <Stack spacing={1.25}>
              {alerts.map((a) => {
                const sevColor = severityToColor(a.severity);
                return (
                  <Paper
                    key={a.id}
                    variant="outlined"
                    sx={{
                      p: 1.25,
                      borderColor:
                        a.resolved
                          ? theme.palette.divider
                          : sevColor === "error"
                          ? theme.palette.error.main
                          : theme.palette.warning.main,
                    }}
                  >
                    <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1 }}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle2" noWrap>
                          {prettyTime(a.tsMs)}
                        </Typography>
                        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 0.5 }}>
                          <Chip
                            label={a.type || "unknown"}
                            size="small"
                            color={sevColor}
                            sx={{ fontWeight: "bold" }}
                          />
                          {a.resolved ? (
                            <Chip label="Resolved" size="small" color="success" />
                          ) : (
                            <Chip label="Active" size="small" color="error" />
                          )}
                        </Box>
                      </Box>

                      {!a.resolved && (
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => resolveAlert(a.id)}
                          sx={{ flexShrink: 0 }}
                        >
                          Resolve
                        </Button>
                      )}
                    </Box>

                    <Divider sx={{ my: 1 }} />

                    <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                      {a.message || "(no message)"}
                    </Typography>
                  </Paper>
                );
              })}
            </Stack>
          </Box>
        ) : (
          // ✅ Desktop/tablet: DataGrid, but themed (no hard-coded dark colors)
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <DataGrid
              rows={alerts}
              columns={columns}
              pageSize={10}
              rowsPerPageOptions={[10, 20]}
              disableSelectionOnClick
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
                },

                "& .MuiDataGrid-footerContainer": {
                  borderTop: `1px solid ${theme.palette.divider}`,
                },
              }}
            />
          </Box>
        )}
      </Paper>
    </Box>
  );
}
