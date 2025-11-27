// src/pages/Logs.jsx
import React, { useState, useEffect } from 'react';
import {
  Paper,
  Typography,
  TextField,
  Button,
  Box,
  Chip,
  CircularProgress,
  Alert,
} from '@mui/material';
import { format } from 'date-fns';
import { db, ref, onValue, push, serverTimestamp, set } from './firebase';

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Real-time listener from Firebase
  useEffect(() => {
    const logsRef = ref(db, 'logs');
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
    push(ref(db, 'logs'), {
      message: 'Test log from web interface',
      source: 'web',
      timestamp: serverTimestamp(),
    });
  };

  const clearLogs = () => {
    if (window.confirm('Delete ALL logs permanently?')) {
      set(ref(db, 'logs'), null);
    }
  };

  const exportLogs = () => {
    const filtered = logs
      .filter(log => log.message.toLowerCase().includes(search.toLowerCase()))
      .map(log => `${format(log.timestamp, 'PP p')} [${log.source}] ${log.message}`)
      .join('\n');

    const blob = new Blob([filtered], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chickulungan_logs_${format(new Date(), 'yyyy-MM-dd_HHmm')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredLogs = logs
    .filter(log => log.message.toLowerCase().includes(search.toLowerCase()))
    .map(log => 
      `${format(log.timestamp, 'MMM dd, yyyy │ hh:mm:ss a')}  ` +
      `${log.source === 'esp32' ? 'ESP32' : log.source === 'web' ? 'Web' : 'System'}  ${log.message}`
    )
    .join('\n');

  return (
    <div style={{ padding: '16px', height: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Paper sx={{ p: 3, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="h5" fontWeight="bold">
              System Logs
            </Typography>
            <Chip 
              label={`${logs.length} entries`} 
              size="small" 
              color="primary" 
            />
          </Box>

          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="outlined" size="small" onClick={addTestLog}>
              Test Log
            </Button>
            <Button variant="outlined" color="warning" size="small" onClick={clearLogs}>
              Clear All
            </Button>
            <Button variant="contained" color="success" size="small" onClick={exportLogs}>
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
          sx={{ mb: 2 }}
        />

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', my: 8 }}>
            <CircularProgress />
          </Box>
        ) : logs.length === 0 ? (
          <Alert severity="info">No logs yet. System events will appear here.</Alert>
        ) : (
          <TextField
            multiline
            fullWidth
            value={filteredLogs || 'No matching logs.'}
            InputProps={{ readOnly: true }}
            sx={{
              flex: 1,
              backgroundColor: '#000',
              fontFamily: 'monospace',
              fontSize: '0.875rem',
              '& .MuiOutlinedInput-root': {
                color: '#0f0',
                height: '100%',
              },
              '& .MuiOutlinedInput-input': {
                overflow: 'auto !important',
                height: '100% !important',
              },
            }}
          />
        )}
      </Paper>
    </div>
  );
}