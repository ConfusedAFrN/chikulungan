// src/pages/Schedules.jsx
import React, { useState, useEffect } from 'react';
import {Paper, Typography,
  Button,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Box,
  Checkbox,
  ListItemText,
  Alert,
} from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import { format } from 'date-fns';

import { db, ref, onValue, push, remove, set } from './firebase';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function Schedules() {
  const [schedules, setSchedules] = useState({});
  const [selectedDays, setSelectedDays] = useState([]);
  const [time, setTime] = useState(new Date());
  const [logText, setLogText] = useState('Schedule system ready...\n');
  const [loading, setLoading] = useState(true);

  // Load schedules
  useEffect(() => {
    const unsub = onValue(ref(db, 'schedules'), (snap) => {
      const data = snap.val() || {};
      setSchedules(data);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Load logs from Firebase (last 30 entries)
  useEffect(() => {
    const logsRef = ref(db, 'logs');
    const unsub = onValue(logsRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        setLogText('No logs yet\n');
        return;
      }

      const logArray = Object.entries(data)
        .map(([id, entry]) => ({ id, ...entry }))
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 30); // only last 30

      const formatted = logArray
        .map(e => `[${format(e.timestamp, 'HH:mm:ss')}] ${e.message}`)
        .join('\n');

      setLogText(formatted + '\n');
    });

    return () => unsub();
  }, []);

  const addSchedule = () => {
    if (selectedDays.length === 0 || !time) {
      alert('Please select days and time');
      return;
    }

    const formattedTime = format(time, 'hh:mm a');
    const newRef = push(ref(db, 'schedules'));

    const newSchedule = {
      id: newRef.key,
      days: selectedDays,
      time: formattedTime,
      enabled: true,
      createdAt: Date.now(),
    };

    set(newRef, newSchedule).then(() => {
      push(ref(db, 'logs'), {
        message: `Added schedule: ${selectedDays.join(', ')} at ${formattedTime}`,
        source: 'web',
        timestamp: Date.now(),
      });
      setSelectedDays([]);
      setTime(new Date());
    });
  };

  const deleteSchedule = (id) => {
    remove(ref(db, `schedules/${id}`)).then(() => {
      push(ref(db, 'logs'), {
        message: 'Deleted a schedule',
        source: 'web',
        timestamp: Date.now(),
      });
    });
  };

  const toggleSchedule = (id, current) => {
    set(ref(db, `schedules/${id}/enabled`), !current).then(() => {
      push(ref(db, 'logs'), {
        message: `Schedule ${!current ? 'enabled' : 'disabled'}`,
        source: 'web',
        timestamp: Date.now(),
      });
    });
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', height: '100%' }}>
        {/* Loading */}
        {loading && <Alert severity="info">Loading schedules...</Alert>}

        {/* Main Layout */}
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', flex: 1 }}>
          {/* Form */}
          <Paper sx={{ p: 3, flex: '1 1 400px', minWidth: 300 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>Add New Schedule</Typography>
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Days</InputLabel>
              <Select
                multiple
                value={selectedDays}
                onChange={(e) => setSelectedDays(e.target.value)}
                renderValue={(selected) => selected.join(', ')}
                label="Days"
              >
                {DAYS.map((day) => (
                  <MenuItem key={day} value={day}>
                    <Checkbox checked={selectedDays.includes(day)} />
                    <ListItemText primary={day} />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TimePicker
              label="Time"
              value={time}
              onChange={setTime}
              slotProps={{ textField: { fullWidth: true, sx: { mb: 2 } } }}
              ampm
            />

            <Button variant="contained" color="success" onClick={addSchedule} fullWidth>
              Add Schedule
            </Button>
          </Paper>

          {/* List */}
          <Paper sx={{ p: 3, flex: '1 1 500px', minWidth: 300 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Active Schedules ({Object.keys(schedules).length})
            </Typography>
            {Object.keys(schedules).length === 0 ? (
              <Alert severity="info">No schedules yet</Alert>
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {Object.entries(schedules)
                  .sort(([,a], [,b]) => b.createdAt - a.createdAt)
                  .map(([id, s]) => (
                    <Paper key={id} variant="outlined" sx={{ p: 2 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Box>
                          <Typography fontWeight={600}>{s.days.join(', ')}</Typography>
                          <Typography variant="h5" color="primary">{s.time}</Typography>
                          <Typography variant="caption" color={s.enabled ? 'success.main' : 'text.secondary'}>
                            {s.enabled ? 'Active' : 'Disabled'}
                          </Typography>
                        </Box>
                        <Box>
                          <Button size="small" onClick={() => toggleSchedule(id, s.enabled)} sx={{ mr: 1 }}>
                            {s.enabled ? 'Disable' : 'Enable'}
                          </Button>
                          <Button size="small" color="error" onClick={() => deleteSchedule(id)}>
                            Delete
                          </Button>
                        </Box>
                      </Box>
                    </Paper>
                  ))}
              </Box>
            )}
          </Paper>
        </div>

        {/* Log — now from Firebase */}
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>Schedule Log</Typography>
          <TextField
            multiline
            rows={6}
            fullWidth
            value={logText}
            InputProps={{ readOnly: true }}
            sx={{
              backgroundColor: '#000',
              color: '#0f0',
              fontFamily: 'monospace',
              fontSize: '0.875rem',
              '& .MuiOutlinedInput-root': { color: '#0f0' },
            }}
          />
        </Paper>
      </div>
    </LocalizationProvider>
  );
}