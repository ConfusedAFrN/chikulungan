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

const presetConfigs = {
  starter: [  // 0–3 weeks: high frequency (matches frequent-access recommendations)
    { time: "6:00 AM", days: DAYS },
    { time: "8:30 AM", days: DAYS },
    { time: "11:00 AM", days: DAYS },
    { time: "1:30 PM", days: DAYS },
    { time: "3:30 PM", days: DAYS },  // added for better coverage
    { time: "5:30 PM", days: DAYS },
    { time: "7:00 PM", days: DAYS },  // optional 7th if 24h light
  ],
  grower: [   // 3–6 weeks: 4 feeds (standard reduction)
    { time: "7:00 AM", days: DAYS },
    { time: "11:00 AM", days: DAYS },
    { time: "3:00 PM", days: DAYS },
    { time: "6:30 PM", days: DAYS },
  ],
  maintenance: [  // 6+ weeks / finisher: 2 feeds
    { time: "7:00 AM", days: DAYS },
    { time: "5:30 PM", days: DAYS },
  ],
};

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

  const presetGroups = useMemo(() => {
    const groups = {
      starter: [],
      grower: [],
      maintenance: [],
      custom: [],
    };
    Object.entries(schedules).forEach(([id, s]) => {
      const g = (s && s.group) || "custom";
      if (groups[g]) {
        groups[g].push({ id, ...s });
      } else {
        groups.custom.push({ id, ...s });
      }
    });
    return groups;
  }, [schedules]);

  const isPresetActive = useMemo(() => {
    return {
      starter: presetGroups.starter.length > 0 && presetGroups.starter.every((item) => item.enabled),
      grower: presetGroups.grower.length > 0 && presetGroups.grower.every((item) => item.enabled),
      maintenance: presetGroups.maintenance.length > 0 && presetGroups.maintenance.every((item) => item.enabled),
      custom: presetGroups.custom.length > 0 && presetGroups.custom.every((item) => item.enabled),
    };
  }, [presetGroups]);

  const togglePreset = async (group) => {
    const items = presetGroups[group] || [];
    const currentlyAllEnabled = items.length > 0 && items.every((item) => item.enabled === true);
    const targetEnabled = !currentlyAllEnabled;

    if (targetEnabled && items.length === 0) {
      if (group === "custom") {
        toast("No custom schedules to enable. Create some first using the form.", "warning");
        return;
      }
      const configs = presetConfigs[group];
      if (!configs) return;

      for (const cfg of configs) {
        const payload = {
          days: cfg.days,
          time: cfg.time,
          enabled: true,
          createdAt: Date.now(),
          group,
        };
        await push(ref(db, "schedules"), payload);
      }
      refreshSchedules();
      toast(`${group.charAt(0).toUpperCase() + group.slice(1)} preset enabled`, "success");
      return;
    }

    // toggle existing schedules in group
    let updatedCount = 0;
    for (const item of items) {
      const newData = { ...item, enabled: targetEnabled };
      await set(ref(db, `schedules/${item.id}`), newData);
      updatedCount++;
    }
    refreshSchedules();

    const action = targetEnabled ? "enabled" : "disabled";
    toast(`${group.charAt(0).toUpperCase() + group.slice(1)} preset ${action} (${updatedCount} schedules)`, "info");
  };

  const resetForm = () => {
    setSelectedDays([]);
    setTime(null);
    setEditingId(null);
  };

  const handleAddOrUpdate = async () => {
    if (!time || selectedDays.length === 0) {
      toast("Please select time and days", "warning");
      return;
    }

    const formattedTime = format(time, "hh:mm a").toUpperCase();
    let payload = {
      days: selectedDays,
      time: formattedTime,
      enabled: true,
      createdAt: Date.now(),
    };

    if (editingId) {
      const current = schedules[editingId];
      payload.group = current?.group || "custom";
    } else {
      payload.group = "custom";
    }

    if (editingId) {
      set(ref(db, `schedules/${editingId}`), payload).then(() => {
        toast("Schedule updated successfully!", "success");
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
        refreshSchedules();
        push(ref(db, "logs"), {
          message: `Deleted schedule: ID ${id}`,
          source: "web",
          timestamp: Date.now(),
        });
        if (editingId === id) resetForm();
      });
    }
  };

  const handleEdit = (id, sched) => {
    setEditingId(id);
    setSelectedDays(sched.days || []);

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

        {/* Toggleable Presets */}
        <Paper sx={{ p: { xs: 2, sm: 3 }, mb: 4 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Toggleable Feeding Presets
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Toggle each preset on/off. Presets auto-create schedules when enabled. Custom schedules have their own toggle.
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            {[
              { key: "starter", label: "Chick Starter (0-3 weeks)" },
              { key: "grower", label: "Grower (3-6 weeks)" },
              { key: "maintenance", label: "Maintenance (6+ weeks)" },
              { key: "custom", label: "Custom Schedules" },
            ].map(({ key, label }) => (
              <Paper key={key} variant="outlined" sx={{ p: 2, flex: 1 }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <Typography>{label}</Typography>
                  <Switch checked={isPresetActive[key]} onChange={() => togglePreset(key)} />
                </Box>
              </Paper>
            ))}
          </Stack>
        </Paper>

        {/* Active Schedules */}
        <Paper sx={{ p: { xs: 2, sm: 4 }, mb: 4, boxSizing: "border-box" }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Active Schedules
          </Typography>

          {Object.keys(schedules).length === 0 ? (
            <Alert severity="info">No schedules yet. Create some or enable a preset above.</Alert>
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
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
                    <Box sx={{ display: "flex", flexDirection: { xs: "column", sm: "row" }, alignItems: { xs: "flex-start", sm: "center" }, justifyContent: "space-between", gap: { xs: 1.5, sm: 2 } }}>
                      <Box sx={{ minWidth: 0 }}>
                        <Box sx={{ display: "flex", gap: 1, mb: 1 }}>
                          <Chip label={(s.group || "CUSTOM").toUpperCase()} size="small" color="secondary" />
                        </Box>
                        <Typography variant="h6" fontWeight={600} noWrap>
                          {s.time}
                        </Typography>

                        <Box sx={{ display: "flex", gap: 1, mt: 1, flexWrap: "wrap" }}>
                          {(s.days || []).map((day) => (
                            <Chip key={day} label={day} size="small" color="primary" variant="outlined" />
                          ))}
                        </Box>
                      </Box>

                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", width: { xs: "100%", sm: "auto" }, justifyContent: { xs: "flex-start", sm: "flex-end" } }}>
                        <Switch checked={!!s.enabled} onChange={() => handleToggleEnabled(id, !!s.enabled)} color="primary" />

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