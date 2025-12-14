// src/pages/History.jsx
import React, { useState } from "react";
import {
  Paper,
  Typography,
  Box,
  Button,
  Tabs,
  Tab,
  TextField,
  Grid,
} from "@mui/material";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { DataGrid } from "@mui/x-data-grid";
import { toast } from "./utils/feedback";
import { useTheme } from '@mui/material/styles';

// Placeholder – replace with real Firebase data
const mockSensorData = [
  { date: "Dec 01", temp: 28, humidity: 75, feed: 80, water: 90 },
  { date: "Dec 02", temp: 30, humidity: 78, feed: 70, water: 85 },
  { date: "Dec 03", temp: 29, humidity: 76, feed: 65, water: 80 },
  { date: "Dec 04", temp: 31, humidity: 77, feed: 60, water: 75 },
  { date: "Dec 05", temp: 30, humidity: 74, feed: 58, water: 72 },
  { date: "Dec 06", temp: 32, humidity: 79, feed: 55, water: 70 },
  { date: "Dec 07", temp: 29, humidity: 73, feed: 52, water: 68 },
  { date: "Dec 08", temp: 28, humidity: 71, feed: 50, water: 65 },
  { date: "Dec 09", temp: 27, humidity: 70, feed: 48, water: 63 },
  { date: "Dec 10", temp: 30, humidity: 75, feed: 47, water: 60 },
  { date: "Dec 11", temp: 31, humidity: 78, feed: 45, water: 58 },
  { date: "Dec 12", temp: 29, humidity: 74, feed: 43, water: 55 },
  { date: "Dec 13", temp: 28, humidity: 72, feed: 40, water: 53 },
  { date: "Dec 14", temp: 30, humidity: 76, feed: 38, water: 50 },
];

// Placeholder for calculated consumption
const mockConsumption = [
  { date: "Dec 01", feedUsed: 10, waterUsed: 5 },
  { date: "Dec 02", feedUsed: 15, waterUsed: 10 },
  { date: "Dec 03", feedUsed: 5, waterUsed: 8 },
  { date: "Dec 04", feedUsed: 7, waterUsed: 6 },
  { date: "Dec 05", feedUsed: 6, waterUsed: 5 },
  { date: "Dec 06", feedUsed: 8, waterUsed: 7 },
  { date: "Dec 07", feedUsed: 5, waterUsed: 4 },
  { date: "Dec 08", feedUsed: 4, waterUsed: 3 },
  { date: "Dec 09", feedUsed: 6, waterUsed: 4 },
  { date: "Dec 10", feedUsed: 3, waterUsed: 3 },
  { date: "Dec 11", feedUsed: 5, waterUsed: 4 },
  { date: "Dec 12", feedUsed: 4, waterUsed: 3 },
  { date: "Dec 13", feedUsed: 6, waterUsed: 2 },
  { date: "Dec 14", feedUsed: 3, waterUsed: 2 },
];

const mockLogs = [
  // Placeholder
  {
    id: 1,
    timestamp: "2025-12-08 10:00",
    message: "Temp high alert",
    source: "ESP32",
  },
];

export default function History() {
  const [tab, setTab] = useState(0);
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);
  const theme = useTheme();  // Gets current theme (dark/light)

  const handleExport = () => {
    toast("Exporting data as CSV...", "info");
    // Functional later: Blob download
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <Box sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h4" fontWeight={700} gutterBottom>
          Historical Data & Analytics
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
          Analyze long-term trends, consumption, and predictions for better
          poultry management
        </Typography>

        {/* Date Filter */}
        <Box sx={{ display: "flex", gap: 2, mb: 4, flexWrap: "wrap" }}>
          <DatePicker
            label="Start Date"
            value={startDate}
            onChange={setStartDate}
            renderInput={(params) => <TextField {...params} />}
          />
          <DatePicker
            label="End Date"
            value={endDate}
            onChange={setEndDate}
            renderInput={(params) => <TextField {...params} />}
          />
          <Button
            variant="contained"
            onClick={() => toast("Filtering data...", "info")}
          >
            Apply
          </Button>
          <Button variant="outlined" onClick={handleExport}>
            Export CSV
          </Button>
        </Box>

        {/* Tabs */}
        <Tabs value={tab} onChange={(e, v) => setTab(v)} sx={{ mb: 4 }}>
          <Tab label="Sensor Trends" />
          <Tab label="Consumption Analytics" />
          <Tab label="Logs & Alerts" />
        </Tabs>

        {tab === 0 && (
  <Box>
    {/* Top Section: Environmental Trends */}
    <Typography variant="h6" sx={{ mb: 2, mt: 4 }}>Environmental Trends</Typography>
    
    {/* Temp Chart - Full width */}
    <Paper sx={{ p: 3, mb: 3 }}>
      <Typography variant="subtitle1" sx={{ mb: 2 }}>Temperature Over Time</Typography>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={mockSensorData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis domain={[0, 50]} />
          <Tooltip
            contentStyle={{
              backgroundColor: theme.palette.background.paper,
              color: theme.palette.text.primary,
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: theme.shape.borderRadius,
              padding: '8px 12px',
              boxShadow: theme.shadows[4],
            }}
            itemStyle={{ color: theme.palette.text.primary }}  // For list items
            labelStyle={{ color: theme.palette.text.secondary }}  // For date labels
            //formatter={(v) => `${v.toFixed(1)}°C`}  // Adjust per chart
          />
          <Line type="monotone" dataKey="temp" stroke="#ffb400" />
        </LineChart>
      </ResponsiveContainer>
    </Paper>

    {/* Humidity Chart - Full width */}
    <Paper sx={{ p: 3 }}>
      <Typography variant="subtitle1" sx={{ mb: 2 }}>Humidity Over Time</Typography>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={mockSensorData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis domain={[0, 100]} />
          <Tooltip
            contentStyle={{
              backgroundColor: theme.palette.background.paper,
              color: theme.palette.text.primary,
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: theme.shape.borderRadius,
              padding: '8px 12px',
              boxShadow: theme.shadows[4],
            }}
            itemStyle={{ color: theme.palette.text.primary }}  // For list items
            labelStyle={{ color: theme.palette.text.secondary }}  // For date labels
            //formatter={(v) => `${v.toFixed(1)}°C`}  // Adjust per chart
          />
          <Line type="monotone" dataKey="humidity" stroke="#1976d2" />
        </LineChart>
      </ResponsiveContainer>
    </Paper>

    {/* Bottom Section: Resource Levels Over Time */}
    <Typography variant="h6" sx={{ mb: 2, mt: 4 }}>Resource Levels Over Time</Typography>
    
    {/* Feed Chart - Full width */}
    <Paper sx={{ p: 3, mb: 3 }}>
      <Typography variant="subtitle1" sx={{ mb: 2 }}>Feed Level Over Time</Typography>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={mockSensorData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis domain={[0, 100]} />
          <Tooltip
            contentStyle={{
              backgroundColor: theme.palette.background.paper,
              color: theme.palette.text.primary,
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: theme.shape.borderRadius,
              padding: '8px 12px',
              boxShadow: theme.shadows[4],
            }}
            itemStyle={{ color: theme.palette.text.primary }}  // For list items
            labelStyle={{ color: theme.palette.text.secondary }}  // For date labels
            //formatter={(v) => `${v.toFixed(1)}°C`}  // Adjust per chart
          />
          <Bar dataKey="feed" fill="#ffb400" />
        </BarChart>
      </ResponsiveContainer>
    </Paper>

    {/* Water Chart - Full width */}
    <Paper sx={{ p: 3 }}>
      <Typography variant="subtitle1" sx={{ mb: 2 }}>Water Level Over Time</Typography>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={mockSensorData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" />
          <YAxis domain={[0, 100]} />
          <Tooltip
            contentStyle={{
              backgroundColor: theme.palette.background.paper,
              color: theme.palette.text.primary,
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: theme.shape.borderRadius,
              padding: '8px 12px',
              boxShadow: theme.shadows[4],
            }}
            itemStyle={{ color: theme.palette.text.primary }}  // For list items
            labelStyle={{ color: theme.palette.text.secondary }}  // For date labels
            //formatter={(v) => `${v.toFixed(1)}°C`}  // Adjust per chart
          />
          <Bar dataKey="water" fill="#1976d2" />
        </BarChart>
      </ResponsiveContainer>
    </Paper>
  </Box>
)}

        {tab === 1 && (
          <Box>
            {/* Feed Consumption */}
            <Paper sx={{ p: 3, mb: 4 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Feed Consumption Over Time
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Total consumed: 45% last week • Avg daily: 6.4% • Refill in ~4
                days
              </Typography>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={mockConsumption}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip formatter={(v) => `${v}% used`} />
                  <Bar dataKey="feedUsed" fill="#ffb400" />
                </BarChart>
              </ResponsiveContainer>
            </Paper>

            {/* Water Consumption */}
            <Paper sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Water Consumption Over Time
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Total consumed: 35% last week • Avg daily: 5% • Refill in ~5
                days
              </Typography>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={mockConsumption}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip formatter={(v) => `${v}% used`} />
                  <Bar dataKey="waterUsed" fill="#1976d2" />
                </BarChart>
              </ResponsiveContainer>
            </Paper>
          </Box>
        )}

        {tab === 2 && (
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Historical Logs & Alerts
            </Typography>
            <DataGrid
              rows={mockLogs}
              columns={[
                { field: "timestamp", headerName: "Time", flex: 1 },
                { field: "message", headerName: "Message", flex: 2 },
                { field: "source", headerName: "Source", flex: 1 },
              ]}
              autoHeight
              pageSize={10}
              rowsPerPageOptions={[10, 25, 50]}
              disableSelectionOnClick
            />
          </Paper>
        )}
      </Box>
    </LocalizationProvider>
  );
}
