// src/pages/Schedules.jsx
import React, { useState, useEffect, useMemo } from "react";
import {
  Paper,
  Typography,
  Button,
  Box,
  Chip,
  IconButton,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Alert,
  Tooltip,
  TextField,
  Switch,
  Stack,
} from "@mui/material";
import { Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon } from "@mui/icons-material";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import { TimePicker } from "@mui/x-date-pickers/TimePicker";
import { format } from "date-fns";
import { db, ref, onValue, push, remove, set } from "./firebase";
import { toast } from "./utils/feedback";
import { refreshSchedules } from "./mqtt";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function Schedules() {
  const [schedules, setSchedules] = useState({});
  const [selectedDays, setSelectedDays] = useState([]);
  const [time, setTime] = useState(null);
  const [editingId, setEditingId] = useState(null);

  // Load schedules
  useEffect(() => {
    const unsub = onValue(ref(db, "schedules"), (snap) => {
      const data = snap.val() || {};
      setSchedules(data);
    });
    return () => unsub();
  }, []);

  const activeCount = useMemo(
    () => Object.values(schedules).filter((s) => s?.enabled).length,
    [schedules]
  );

  const resetForm = () => {
    setSelectedDays([]);
    setTime(null);
    setEditingId(null);
  };

  const handleAddOrUpdate = () => {
    if (!time || selectedDays.length === 0) {
      toast("Please select time and days", "warning");
      return;
    }

    const formattedTime = format(time, "hh:mm a").toUpperCase();
    const payload = {
      days: selectedDays,
      time: formattedTime,
      enabled: true,
      createdAt: Date.now(),
    };

    if (editingId) {
      set(ref(db, `schedules/${editingId}`), payload).then(() => {
        toast("Schedule updated successfully!", "success");

        // Tell ESP32 to refresh schedules now
        refreshSchedules();

        push(ref(db, "logs"), {
          message: `Updated schedule: ${selectedDays.join(", ")} at ${formattedTime}`,
          source: "web",
          timestamp: Date.now(),
        });

        resetForm();
      });
    } else {
      push(ref(db, "schedules"), payload).then(() => {
        toast("Schedule added successfully!", "success");

        // Tell ESP32 to refresh schedules now
        refreshSchedules();

        push(ref(db, "logs"), {
          message: `Added schedule: ${selectedDays.join(", ")} at ${formattedTime}`,
          source: "web",
          timestamp: Date.now(),
        });

        resetForm();
      });
    }
  };

  const handleToggleEnabled = (id, currentEnabled) => {
    set(ref(db, `schedules/${id}/enabled`), !currentEnabled).then(() => {
      toast(`Schedule ${!currentEnabled ? "enabled" : "disabled"}`, "info");

      // Tell ESP32 to refresh schedules now
      refreshSchedules();

      push(ref(db, "logs"), {
        message: `Schedule ${!currentEnabled ? "enabled" : "disabled"}: ID ${id}`,
        source: "web",
        timestamp: Date.now(),
      });
    });
  };

  const handleDelete = (id) => {
    if (window.confirm("Delete this schedule permanently?")) {
      remove(ref(db, `schedules/${id}`)).then(() => {
        toast("Schedule deleted", "info");

        // Tell ESP32 to refresh schedules now
        refreshSchedules();

        push(ref(db, "logs"), {
          message: `Deleted schedule: ID ${id}`,
          source: "web",
          timestamp: Date.now(),
        });

        // If you deleted the one you were editing, reset the form
        if (editingId === id) resetForm();
      });
    }
  };

  const handleEdit = (id, sched) => {
    setEditingId(id);
    setSelectedDays(sched.days || []);

    // Convert "hh:mm AM/PM" to Date
    const [t, periodRaw] = (sched.time || "").split(" ");
    const period = (periodRaw || "").toUpperCase();
    const [hStr, mStr] = (t || "12:00").split(":");

    let hours = parseInt(hStr, 10);
    const minutes = parseInt(mStr, 10);

    if (period === "PM" && hours !== 12) hours += 12;
    if (period === "AM" && hours === 12) hours = 0;

    setTime(new Date(2000, 0, 1, hours, minutes));
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <Box sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h4" fontWeight={700} gutterBottom>
          Feeding Schedules
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
          Manage automatic feeding times • {activeCount} active schedule
          {activeCount !== 1 ? "s" : ""}
        </Typography>

        {/* Form */}
        <Paper sx={{ p: { xs: 2, sm: 4 }, mb: 4, boxSizing: "border-box" }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            {editingId ? "Edit Schedule" : "Create New Schedule"}
          </Typography>

          <FormControl fullWidth sx={{ mb: 2 }}>
            <InputLabel>Days</InputLabel>
            <Select
              multiple
              value={selectedDays}
              onChange={(e) => setSelectedDays(e.target.value)}
              renderValue={(selected) => (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                  {selected.map((value) => (
                    <Chip key={value} label={value.slice(0, 3)} size="small" />
                  ))}
                </Box>
              )}
            >
              {DAYS.map((day) => (
                <MenuItem key={day} value={day}>
                  {day}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TimePicker
            label="Feeding Time"
            value={time}
            onChange={setTime}
            slotProps={{ textField: { fullWidth: true } }}
            sx={{ mb: 2, width: "100%" }}
          />

          {/* Buttons: stack on mobile */}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
            <Button
              variant="contained"
              size="large"
              startIcon={<AddIcon />}
              onClick={handleAddOrUpdate}
              fullWidth
            >
              {editingId ? "Update" : "Add"} Schedule
            </Button>

            {editingId && (
              <Button variant="outlined" onClick={resetForm} fullWidth>
                Cancel
              </Button>
            )}
          </Stack>
        </Paper>

        {/* Active Schedules */}
        <Paper
          sx={{
            p: { xs: 2, sm: 4 },
            mb: 4,
            boxSizing: "border-box",
          }}
        >
          <Typography variant="h6" sx={{ mb: 2 }}>
            Active Schedules
          </Typography>

          {Object.keys(schedules).length === 0 ? (
            <Alert severity="info">No schedules yet. Create one above!</Alert>
          ) : (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              {Object.entries(schedules)
                .sort(([, a], [, b]) => (b?.createdAt || 0) - (a?.createdAt || 0))
                .map(([id, s]) => (
                  <Paper
                    key={id}
                    variant="outlined"
                    sx={{
                      p: 2,
                      borderRadius: 3,
                      bgcolor: id === editingId ? "action.selected" : "background.paper",
                      boxShadow: id === editingId ? "0 0 0 2px #1976d2" : "none",
                      overflow: "hidden",
                    }}
                  >
                    <Box
                      sx={{
                        display: "flex",
                        flexDirection: { xs: "column", sm: "row" },
                        alignItems: { xs: "flex-start", sm: "center" },
                        justifyContent: "space-between",
                        gap: { xs: 1.5, sm: 2 },
                      }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="h6" fontWeight={600} noWrap>
                          {s.time}
                        </Typography>

                        <Box sx={{ display: "flex", gap: 1, mt: 1, flexWrap: "wrap" }}>
                          {(s.days || []).map((day) => (
                            <Chip
                              key={day}
                              label={day}
                              size="small"
                              color="primary"
                              variant="outlined"
                            />
                          ))}
                        </Box>
                      </Box>

                      {/* Actions: never stretch the card */}
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          flexWrap: "wrap",
                          width: { xs: "100%", sm: "auto" },
                          justifyContent: { xs: "flex-start", sm: "flex-end" },
                        }}
                      >
                        <Switch
                          checked={!!s.enabled}
                          onChange={() => handleToggleEnabled(id, !!s.enabled)}
                          color="primary"
                        />

                        <Tooltip title="Edit">
                          <IconButton onClick={() => handleEdit(id, s)} size="small">
                            <EditIcon />
                          </IconButton>
                        </Tooltip>

                        <Tooltip title="Delete">
                          <IconButton onClick={() => handleDelete(id)} color="error" size="small">
                            <DeleteIcon />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </Box>
                  </Paper>
                ))}
            </Box>
          )}
        </Paper>
      </Box>
    </LocalizationProvider>
  );
}
