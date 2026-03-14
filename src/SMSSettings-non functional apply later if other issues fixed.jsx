// src/pages/SMSSettings.jsx
import React, { useState, useEffect } from "react";
import {
  Paper,
  Typography,
  Box,
  TextField,
  Switch,
  Button,
  FormControlLabel,
  Alert,
  Stack,
} from "@mui/material";
import { db, ref, onValue, set } from "./firebase";
import { toast } from "./utils/feedback";
import { refreshSchedules } from "./mqtt"; // reuse existing refresh function (we will extend it later)

export default function SMSSettings() {
  const [phone, setPhone] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load from Firebase
  useEffect(() => {
    const unsub = onValue(ref(db, "smsSettings"), (snap) => {
      const data = snap.val() || { phone: "", enabled: false };
      setPhone(data.phone || "");
      setEnabled(!!data.enabled);
      setLoading(false);
    });

    return () => unsub();
  }, []);

  const saveSettings = () => {
    const cleanPhone = phone.trim();
    if (enabled && (!cleanPhone || !cleanPhone.startsWith("+63") || cleanPhone.length !== 13)) {
      toast("Phone number must be +63 followed by 10 digits", "warning");
      return;
    }

    set(ref(db, "smsSettings"), {
      phone: cleanPhone,
      enabled,
      lastUpdated: Date.now(),
    }).then(() => {
      toast("SMS settings saved", "success");

      // Tell ESP32 to refresh (we will extend mqtt.js later)
      refreshSchedules(); // reuse for now; rename later if needed
    });
  };

  const sendTestSMS = () => {
    if (!enabled || !phone) {
      toast("Enable SMS and set a valid number first", "warning");
      return;
    }

    // Push test command to Firebase (ESP32 will later read this)
    set(ref(db, "smsSettings/testTrigger"), {
      command: "TEST_SMS",
      timestamp: Date.now(),
    });

    toast("Test SMS command sent (ESP32 will process when connected)", "info");
  };

  if (loading) {
    return (
      <Box sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography>Loading SMS settings...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        SMS Alert Settings
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        Manage the single phone number for critical alerts only (Low Feed, High Temperature, Device Offline).
      </Typography>

      <Paper sx={{ p: { xs: 2, sm: 4 }, mb: 4 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          SMS Configuration
        </Typography>

        <TextField
          label="Phone Number"
          placeholder="+639123456789"
          fullWidth
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          sx={{ mb: 3 }}
          helperText="Must start with +63 (Philippines format)"
        />

        <FormControlLabel
          control={
            <Switch
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              color="primary"
            />
          }
          label="Enable SMS Alerts for Critical Events"
          sx={{ mb: 3, display: "block" }}
        />

        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <Button variant="contained" size="large" onClick={saveSettings}>
            Save Settings
          </Button>
          <Button
            variant="outlined"
            size="large"
            onClick={sendTestSMS}
            disabled={!enabled || !phone}
          >
            Send Test SMS
          </Button>
        </Stack>
      </Paper>

      <Alert severity="info">
        Only critical alerts will be sent via SMS. Normal sensor updates and schedules remain on WiFi/Firebase.
      </Alert>
    </Box>
  );
}