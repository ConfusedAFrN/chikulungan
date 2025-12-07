// src/pages/History.jsx
import React, { useState } from 'react';
import {
  Paper, Typography, Box, Tabs, Tab, Grid,
  TextField, Button
} from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart, Bar } from 'recharts';
import { format, subDays } from 'date-fns';
import { toast } from "./utils/feedback";

const mockSensorData = Array.from({ length: 30 }, (_, i) => ({
  date: format(subDays(new Date(), i), 'MMM dd'),
  temp: Math.random() * 10 + 25,
  humidity: Math.random() * 20 + 60,
  feed: Math.random() * 50 + 50,
  water: Math.random() * 50 + 50,
}));

const mockStatsData = mockSensorData.map(d => ({
  date: d.date,
  avgTemp: d.temp,
  totalFeed: Math.floor(Math.random() * 100 + 50),
}));

const mockEvents = [
  { date: 'Dec 06', type: 'Alert', message: 'High Temp' },
  { date: 'Dec 05', type: 'Feed', message: 'Auto-feed' },
  // Add more mocks
];

export default function History() {
  const [tab, setTab] = useState(0);
  const [startDate, setStartDate] = useState(subDays(new Date(), 7));
  const [endDate, setEndDate] = useState(new Date());

  const handleTabChange = (event, newValue) => {
    setTab(newValue);
  };

  const filteredSensors = mockSensorData.filter(d => new Date(d.date) >= startDate && new Date(d.date) <= endDate).reverse();

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="h4" fontWeight={700} gutterBottom>
        Historical Data
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        View long-term trends, stats, and events
      </Typography>

      {/* Date Range Selector */}
      <Paper sx={{ p: 3, mb: 4 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={5}>
            <DatePicker
              label="Start Date"
              value={startDate}
              onChange={setStartDate}
              renderInput={(params) => <TextField {...params} fullWidth />}
            />
          </Grid>
          <Grid item xs={12} sm={5}>
            <DatePicker
              label="End Date"
              value={endDate}
              onChange={setEndDate}
              renderInput={(params) => <TextField {...params} fullWidth />}
            />
          </Grid>
          <Grid item xs={12} sm={2}>
            <Button variant="contained" fullWidth onClick={() => toast('Data refreshed', 'success')}>
              Refresh
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {/* Tabs for Sections */}
      <Tabs value={tab} onChange={handleTabChange} centered sx={{ mb: 4 }}>
        <Tab label="Sensor Trends" />
        <Tab label="Stats & Aggregates" />
        <Tab label="Event History" />
      </Tabs>

      {/* Tab Content */}
      {tab === 0 && (
        <Grid container spacing={3}>
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>Temperature Trend</Typography>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={filteredSensors}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis domain={[0, 50]} />
                  <Tooltip formatter={(v) => `${v.toFixed(1)}°C`} />
                  <Line type="monotone" dataKey="temp" stroke="#ffb400" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </Paper>
          </Grid>
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>Humidity Trend</Typography>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={filteredSensors}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip formatter={(v) => `${v.toFixed(1)}%`} />
                  <Line type="monotone" dataKey="humidity" stroke="#1976d2" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </Paper>
          </Grid>
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>Feed Level Trend</Typography>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={filteredSensors}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip formatter={(v) => `${v.toFixed(1)}%`} />
                  <Line type="monotone" dataKey="feed" stroke="#ff8f00" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </Paper>
          </Grid>
          <Grid item xs={12} md={6}>
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>Water Level Trend</Typography>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={filteredSensors}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip formatter={(v) => `${v.toFixed(1)}%`} />
                  <Line type="monotone" dataKey="water" stroke="#42a5f5" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </Paper>
          </Grid>
        </Grid>
      )}

      {tab === 1 && (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>Daily Averages & Totals</Typography>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={mockStatsData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis yAxisId="left" domain={[0, 50]} label={{ value: 'Avg Temp (°C)', angle: -90 }} />
              <YAxis yAxisId="right" orientation="right" domain={[0, 200]} label={{ value: 'Total Feed (g)', angle: 90 }} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="left" dataKey="avgTemp" fill="#ffb400" name="Avg Temp" />
              <Bar yAxisId="right" dataKey="totalFeed" fill="#ff8f00" name="Total Feed" />
            </BarChart>
          </ResponsiveContainer>
        </Paper>
      )}

      {tab === 2 && (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>Event History</Typography>
          {mockEvents.length === 0 ? (
            <Alert severity="info">No events in range</Alert>
          ) : (
            <Box sx={{ maxHeight: 300, overflowY: 'auto' }}>
              {mockEvents.map((e, i) => (
                <Box key={i} sx={{ display: 'flex', gap: 2, py: 2, borderBottom: '1px solid divider' }}>
                  <Typography variant="body2" color="text.secondary">{e.date}</Typography>
                  <Chip label={e.type} size="small" color="primary" variant="outlined" />
                  <Typography variant="body1">{e.message}</Typography>
                </Box>
              ))}
            </Box>
          )}
        </Paper>
      )}
    </Box>
  );
}