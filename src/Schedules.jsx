// src/pages/Schedules.jsx
import React, { useState, useEffect } from 'react';
import {
  Paper, Typography, Button, Box, Chip, IconButton, Divider,
  Select, MenuItem, FormControl, InputLabel, Alert, Tooltip, TextField, Switch
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon } from '@mui/icons-material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import { format } from 'date-fns';
import { db, ref, onValue, push, remove, set } from './firebase';
import { toast } from './utils/feedback';
import { useTheme } from '@mui/material/styles';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function Schedules() {
  const [schedules, setSchedules] = useState({});
  const [selectedDays, setSelectedDays] = useState([]);
  const [time, setTime] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [logText, setLogText] = useState('Schedule system ready...\n');
  const theme = useTheme();

  // Load schedules
  useEffect(() => {
    const unsub = onValue(ref(db, 'schedules'), (snap) => {
      const data = snap.val() || {};
      setSchedules(data);
    });
    return () => unsub();
  }, []);

  // Load logs
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
        .slice(0, 30);

      const formatted = logArray
        .map(e => `[${format(e.timestamp, 'HH:mm:ss')}] ${e.message}`)
        .join('\n');

      setLogText(formatted + '\n');
    });

    return () => unsub();
  }, []);

  const handleAddOrUpdate = () => {
    if (!time || selectedDays.length === 0) {
      toast('Please select time and days', 'warning');
      return;
    }

    const formattedTime = format(time, 'hh:mm a');
    const payload = {
      days: selectedDays,
      time: formattedTime,
      enabled: true,
      createdAt: Date.now(),
    };

    if (editingId) {
      set(ref(db, `schedules/${editingId}`), payload)
        .then(() => {
          toast('Schedule updated successfully!', 'success');
          push(ref(db, 'logs'), {
            message: `Updated schedule: ${selectedDays.join(', ')} at ${formattedTime}`,
            source: 'web',
            timestamp: Date.now(),
          });
          resetForm();
        });
    } else {
      push(ref(db, 'schedules'), payload)
        .then(() => {
          toast('Schedule added successfully!', 'success');
          push(ref(db, 'logs'), {
            message: `Added schedule: ${selectedDays.join(', ')} at ${formattedTime}`,
            source: 'web',
            timestamp: Date.now(),
          });
          resetForm();
        });
    }
  };

  const handleToggleEnabled = (id, currentEnabled) => {
    set(ref(db, `schedules/${id}/enabled`), !currentEnabled)
      .then(() => {
        toast(`Schedule ${!currentEnabled ? 'enabled' : 'disabled'}`, 'info');
        push(ref(db, 'logs'), {
          message: `Schedule ${!currentEnabled ? 'enabled' : 'disabled'}: ID ${id}`,
          source: 'web',
          timestamp: Date.now(),
        });
      });
  };

  const handleDelete = (id) => {
    if (window.confirm('Delete this schedule permanently?')) {
      remove(ref(db, `schedules/${id}`))
        .then(() => {
          toast('Schedule deleted', 'info');
          push(ref(db, 'logs'), {
            message: `Deleted schedule: ID ${id}`,
            source: 'web',
            timestamp: Date.now(),
          });
        });
    }
  };

  const handleEdit = (id, sched) => {
    setEditingId(id);
    setSelectedDays(sched.days);
    const [t, period] = sched.time.split(' ');
    const [h, m] = t.split(':');
    let hours = parseInt(h);
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    setTime(new Date(2000, 0, 1, hours, parseInt(m)));
  };

  const resetForm = () => {
    setSelectedDays([]);
    setTime(null);
    setEditingId(null);
  };

  const activeCount = Object.values(schedules).filter(s => s.enabled).length;

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <Box sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h4" fontWeight={700} gutterBottom>
          Feeding Schedules
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
          Manage automatic feeding times • {activeCount} active schedule{activeCount !== 1 ? 's' : ''}
        </Typography>

        {/* Form on top */}
        <Paper sx={{ p: { xs: 3, sm: 4 }, mb: 4, boxSizing: 'border-box' }}>
          <Typography variant="h6" sx={{ mb: 3 }}>
            {editingId ? 'Edit Schedule' : 'Create New Schedule'}
          </Typography>

          <FormControl fullWidth sx={{ mb: 3 }}>
            <InputLabel>Days</InputLabel>
            <Select
              multiple
              value={selectedDays}
              onChange={(e) => setSelectedDays(e.target.value)}
              renderValue={(selected) => (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
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
  renderInput={(params) => <TextField {...params} fullWidth />}
  sx={{ mb: 3, width: '100%' }}  // Ensure full width with bottom margin
/>

          <Box sx={{ display: 'flex', gap: 2 }}>
            <Button
              variant="contained"
              size="large"
              startIcon={<AddIcon />}
              onClick={handleAddOrUpdate}
              fullWidth
            >
              {editingId ? 'Update' : 'Add'} Schedule
            </Button>
            {editingId && (
              <Button variant="outlined" onClick={resetForm}>
                Cancel
              </Button>
            )}
          </Box>
        </Paper>

        {/* Active Schedules – scrollable + full width */}
        <Paper sx={{ p: { xs: 3, sm: 4 }, mb: 4, flexGrow: 1, display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
          <Typography variant="h6" sx={{ mb: 3 }}>
            Active Schedules
          </Typography>

          {Object.keys(schedules).length === 0 ? (
            <Alert severity="info">No schedules yet. Create one above!</Alert>
          ) : (
            <Box 
  sx={{ 
    height: '100%', 
    overflowY: 'auto', 
    px: { xs: 2, sm: 3 },  // Dynamic left/right padding
    display: 'flex',
    flexDirection: 'column',
    gap: 2
  }}
>
              {Object.entries(schedules)
                .sort(([, a], [, b]) => b.createdAt - a.createdAt)
                .map(([id, s]) => (
                  <Paper 
                    key={id} 
                    variant="outlined" 
                    sx={{ 
                      p: 3, 
                      borderRadius: 3,
                      bgcolor: id === editingId ? 'action.selected' : 'background.paper',
                      boxShadow: id === editingId ? '0 0 0 2px #1976d2' : 'none'
                    }}
                    >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Box>
                        <Typography variant="h6" fontWeight={600}>
                          {s.time}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                          {s.days.map(day => (
                            <Chip key={day} label={day} size="small" color="primary" variant="outlined" />
                          ))}
                        </Box>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Switch
                          checked={s.enabled}
                          onChange={() => handleToggleEnabled(id, s.enabled)}
                          color="primary"
                        />
                        <Tooltip title="Edit">
                          <IconButton onClick={() => handleEdit(id, s)}>
                            <EditIcon />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton color="error" onClick={() => handleDelete(id)}>
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

        {/* Schedule Log */}
        <Paper sx={{ p: { xs: 3, sm: 4 }, mb: 4, boxSizing: 'border-box' }}>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Schedule Log
          </Typography>
          <TextField
            multiline
            rows={10}
            fullWidth
            value={logText}
            InputProps={{ readOnly: true }}
            sx={{
  backgroundColor: theme.palette.mode === 'dark' ? '#000' : '#f5f5f5',  // Dark: black, Light: light gray
  color: theme.palette.mode === 'dark' ? '#0f0' : '#000',  // Dark: green, Light: black
  fontFamily: 'monospace',
  fontSize: '0.875rem',
  '& .MuiOutlinedInput-root': {
    color: theme.palette.mode === 'dark' ? '#0f0' : '#000',
  },
  '& .MuiOutlinedInput-notchedOutline': {
    borderColor: theme.palette.divider,
  },
}}
          />
        </Paper>
      </Box>
    </LocalizationProvider>
  );
}