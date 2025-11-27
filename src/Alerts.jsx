// src/pages/Alerts.jsx
import React, { useState, useEffect } from 'react';
import {
  Paper,
  Typography,
  Button,
  Box,
  Chip,
  Alert,
  CircularProgress,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { format } from 'date-fns';
import { db, ref, onValue } from './firebase';

export default function Alerts() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const alertsRef = ref(db, 'alerts');
    const unsub = onValue(alertsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const list = Object.entries(data)
          .map(([id, alert]) => ({
            id,
            ...alert,
            // Ensure timestamp is always a number
            timestamp: Number(alert.timestamp) || Date.now(),
          }))
          .sort((a, b) => b.timestamp - a.timestamp);

        setAlerts(list);
      } else {
        setAlerts([]);
      }
      setLoading(false);
    });

    return () => unsub();
  }, []);

  const resolveAlert = (id) => {
    // We'll add Firebase write later — for now just mark locally
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, resolved: true } : a));
  };

  const resolveAll = () => {
    setAlerts(prev => prev.map(a => ({ ...a, resolved: true })));
  };

  const getSeverityColor = (severity) => {
    return severity === 'critical' ? '#d32f2f' : '#ed6c02';
  };

  const columns = [
    {
      field: 'timestamp',
      headerName: 'Time',
      width: 180,
      valueFormatter: (params) => {
        const ts = params.value;
        try {
          return format(new Date(ts), 'MMM dd, yyyy – HH:mm:ss');
        } catch {
          return 'Unknown time';
        }
      },
    },
    {
      field: 'type',
      headerName: 'Type',
      width: 150,
      renderCell: (params) => (
        <Chip
          label={params.value}
          size="small"
          sx={{
            backgroundColor: getSeverityColor(params.row.severity || 'warning'),
            color: 'white',
            fontWeight: 'bold',
          }}
        />
      ),
    },
    { field: 'message', headerName: 'Message', flex: 1 },
    {
      field: 'resolved',
      headerName: 'Status',
      width: 120,
      renderCell: (params) =>
        params.value ? (
          <Chip label="Resolved" color="success" size="small" />
        ) : (
          <Chip label="Active" color="error" size="small" />
        ),
    },
    {
      field: 'actions',
      headerName: '',
      width: 100,
      renderCell: (params) =>
        !params.row.resolved && (
          <Button size="small" variant="outlined" onClick={() => resolveAlert(params.row.id)}>
            Resolve
          </Button>
        ),
    },
  ];

  return (
    <div style={{ padding: '16px', height: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Paper sx={{ p: 3, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="h5" fontWeight="bold">
              Alert Center
            </Typography>
            {alerts.filter(a => !a.resolved).length > 0 && (
              <Chip
                label={`${alerts.filter(a => !a.resolved).length} Active`}
                color="error"
                size="small"
              />
            )}
          </Box>
          <Button
            variant="contained"
            color="primary"
            onClick={resolveAll}
            disabled={alerts.filter(a => !a.resolved).length === 0}
          >
            Resolve All
          </Button>
        </Box>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', my: 8 }}>
            <CircularProgress />
          </Box>
        ) : alerts.length === 0 ? (
          <Alert severity="success">No alerts — system running smoothly!</Alert>
        ) : (
          <Box sx={{ flex: 1 }}>
            <DataGrid
              rows={alerts}
              columns={columns}
              pageSize={10}
              rowsPerPageOptions={[10, 20]}
              disableSelectionOnClick
              sx={{
                backgroundColor: '#161b22',
                border: 'none',
                color: '#f0f6fc',
                '& .MuiDataGrid-cell': { borderBottom: '1px solid #30363d' },
              }}
            />
          </Box>
        )}
      </Paper>
    </div>
  );
}