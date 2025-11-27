import React, { useState, useEffect } from 'react';
import { Paper, Typography, Button, TextField, Box } from '@mui/material';
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line, Legend } from 'recharts';
import { Gauge } from '@mui/x-charts/Gauge';
import { publishFeed } from './mqtt';
import { db, ref, onValue, push } from './firebase';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';

export default function Dashboard() {
  const [sensors, setSensors] = useState({ temp: 0, humidity: 0, feed: 0 });
  const [setLog] = useState('System ready...\n');
  const [online, setOnline] = useState(false);
  const [lastMqttTime, setLastMqttTime] = useState(0);
  const [history, setHistory] = useState([]);
  const [uptimeData, setUptimeData] = useState([]); // Now dynamic
  const [incidents, setIncidents] = useState(0);

  // === MQTT Listener ===
  useEffect(() => {
    const handler = (e) => {
      const { topic, payload } = e.detail;
      const now = Date.now();

      if (topic === 'chickulungan/sensor/temp') {
        const val = parseFloat(payload) || 0;
        setSensors(prev => ({ ...prev, temp: val }));
        addToHistory('temp', val, now);
      }
      if (topic === 'chickulungan/sensor/humidity') {
        const val = parseFloat(payload) || 0;
        setSensors(prev => ({ ...prev, humidity: val }));
        addToHistory('humidity', val, now);
      }
      if (topic === 'chickulungan/sensor/feed') {
        setSensors(prev => ({ ...prev, feed: parseInt(payload) || 0 }));
      }
      if (topic === 'chickulungan/log') {
        setLog(prev => prev + payload + '\n');
      }
      if (topic === 'chickulungan/status') {
        setOnline(payload === 'online');
      }

      setLastMqttTime(now);
    };

    window.addEventListener('mqtt-message', handler);
    return () => window.removeEventListener('mqtt-message', handler);
  },);
  

  // Helper to add to live chart (improved with labels)
  const addToHistory = (type, value, now) => {
    const time = new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setHistory(prev => {
      const updated = prev.filter(p => p.time !== time);
      updated.push({ time, [type]: value });
      return updated.slice(-10);
    });
  };

  const [alertThresholds] = useState({
    lowFeed: 20,       // Feed < 20%
    highTemp: 35,      // Temp > 35°C
    lowTemp: 18,       // Temp < 18°C
    highHumidity: 80,  // Humidity > 80%
    lowHumidity: 40,   // Humidity < 40%
  });


  useEffect(() => {
  const checkAndAlert = () => {
    if (sensors.feed < alertThresholds.lowFeed) {
      push(ref(db, 'alerts'), {
        type: 'Low Feed',
        message: `Feed level is low (${sensors.feed}%)`,
        severity: 'critical',
        timestamp: Date.now(),
        resolved: false,
      });
    }
    if (sensors.temp > alertThresholds.highTemp) {
      push(ref(db, 'alerts'), {
        type: 'High Temperature',
        message: `Temperature is high (${sensors.temp}°C)`,
        severity: 'warning',
        timestamp: Date.now(),
        resolved: false,
      });
    }
    if (sensors.temp < alertThresholds.lowTemp) {
      push(ref(db, 'alerts'), {
        type: 'Low Temperature',
        message: `Temperature is low (${sensors.temp}°C)`,
        severity: 'warning',
        timestamp: Date.now(),
        resolved: false,
      });
    }
    if (sensors.humidity > alertThresholds.highHumidity) {
      push(ref(db, 'alerts'), {
        type: 'High Humidity',
        message: `Humidity is high (${sensors.humidity}%)`,
        severity: 'warning',
        timestamp: Date.now(),
        resolved: false,
      });
    }
    if (sensors.humidity < alertThresholds.lowHumidity) {
      push(ref(db, 'alerts'), {
        type: 'Low Humidity',
        message: `Humidity is low (${sensors.humidity}%)`,
        severity: 'warning',
        timestamp: Date.now(),
        resolved: false,
      });
    }
  };

  if (online) checkAndAlert();  // Only check when live (MQTT active)
}, [sensors, online, alertThresholds.lowFeed, alertThresholds.highTemp, alertThresholds.lowTemp, alertThresholds.highHumidity, alertThresholds.lowHumidity]);  // Run on sensor change or status change

  // === Firebase Fallback ===
  useEffect(() => {
    const interval = setInterval(() => {
      if (Date.now() - lastMqttTime > 15000) {
        const backupRef = ref(db, 'sensors');
        onValue(backupRef, (snap) => {
          const data = snap.val();
          if (data) {
            setSensors({
              temp: data.temperature || 0,
              humidity: data.humidity || 0,
              feed: data.feedLevel || 0,
            });
            setOnline(false);
          }
        }, { onlyOnce: true });
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [lastMqttTime]);

  // === Load Real Uptime & Incidents from Firebase ===
  useEffect(() => {
    // Uptime from status
    onValue(ref(db, 'status/lastSeen'), (snap) => {
      const lastSeen = snap.val();
      if (lastSeen) {
        const diff = Date.now() - lastSeen;
        const d = Math.floor(diff / 86400000);
        const h = Math.floor((diff % 86400000) / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        setUptimeData([
          { day: 'Today', uptime: m > 0 ? 100 : 0 },
          { day: 'Yesterday', uptime: h > 24 ? 100 : 0 },
          { day: '2 Days Ago', uptime: d > 2 ? 100 : 0 },
        ]);
      }
    });

    // Incidents from alerts
    onValue(ref(db, 'alerts'), (snap) => {
      const data = snap.val();
      setIncidents(Object.keys(data || {}).length);
    });
  }, []);


// Isolate for now
  const feedNow = () => {
    publishFeed();
    push(ref(db, 'logs'), );
  };

  const navigate = useNavigate();

  const setSched = () => {
    navigate('/schedules');
  };

//


  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', height: '100%' }}>
      {/* Connection Status */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: -2 }}>
        {online ? 
          <Typography variant="caption" color="success.main" sx={{ fontWeight: 600 }}>● Online (Live)</Typography> :
          <Typography variant="caption" color="warning.main" sx={{ fontWeight: 600 }}>● Offline (Fallback)</Typography>
        }
      </Box>

      {/* === ROW 1: Gauges === */}
      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" sx={{ mb: 2, textAlign: 'center' }}>Current Sensors</Typography>
        <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          {[
            { label: 'Temp', value: sensors.temp, max: 50, unit: '°C' },
            { label: 'Humidity', value: sensors.humidity, max: 100, unit: '%' },
            { label: 'Feed', value: sensors.feed, max: 100, unit: '%' },
          ].map((item) => (
            <Box key={item.label} sx={{ textAlign: 'center', minWidth: 150 }}>
              <Gauge width={130} height={130} value={item.value} valueMin={0} valueMax={item.max} />
              <Typography variant="body1" sx={{ mt: 1, fontWeight: 500 }}>
                {item.label}: {item.value}{item.unit}
              </Typography>
            </Box>
          ))}
        </div>
      </Paper>

      {/* === ROW 2: Uptime + Live Trends === */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', flex: 1 }}>
        <Paper sx={{ p: 2, flex: '0 0 360px', minWidth: 300, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="h6" sx={{ mb: 1 }}>Uptime</Typography>
            <BarChart width={320} height={140} data={uptimeData}>
              <CartesianGrid strokeDasharray="2 2" stroke="#333" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Bar dataKey="uptime" fill={e => e.uptime ? '#00c853' : '#d32f2f'} />
            </BarChart>
            <Typography variant="body2" sx={{ mt: 0.5 }}>Incidents: {incidents}</Typography>
          </Box>

          <Box sx={{ mt: 2 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>Controls</Typography>
            <Button variant="contained" size="small" onClick={feedNow} sx={{ mr: 1, minWidth: 110 }}>
              FEED NOW
            </Button>
            <Button variant="outlined" size="small" onClick={setSched} sx={{ minWidth: 110 }}>
              SET SCHEDULE
            </Button>
          </Box>
        </Paper>

        <Paper sx={{ p: 2, flex: '1 1 400px', minWidth: 300 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>Sensor Trends (Live)</Typography>
          {history.length === 0 ? (
            <Typography color="textSecondary" sx={{ textAlign: 'center', mt: 8 }}>
              Waiting for data...
            </Typography>
          ) : (
            <LineChart width={380} height={260} data={history}>
              <CartesianGrid strokeDasharray="2 2" stroke="#333" />
              <XAxis dataKey="time" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip contentStyle={{ backgroundColor: '#161b22', border: '1px solid #333' }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="temp" stroke="#ffb400" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="humidity" stroke="#1976d2" strokeWidth={2} dot={false} />
            </LineChart>
          )}
        </Paper>
      </div>

      {/* === ROW 3: Terminal Log === */}
      {/* === ROW 3: Terminal Log === */}
      <Paper sx={{ p: 2, mt: 0 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>Terminal Log</Typography>
          <LiveLog />
      </Paper>
    </div>
  );
}

// Helper component for log (shared)
function LiveLog() {
  const [log, setLog] = useState('');

  useEffect(() => {
    const unsub = onValue(ref(db, 'logs'), (snap) => {
      const data = snap.val();
      if (data) {
        const arr = Object.values(data)
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, 30)
          .map(e => `[${format(e.timestamp, 'HH:mm:ss')}] ${e.message}`)
          .join('\n');
        setLog(arr);
      }
    });
    return () => unsub();
  }, []);

  return (
    <TextField
      multiline
      rows={6}
      fullWidth
      value={log || 'No logs yet'}
      InputProps={{ readOnly: true }}
      sx={{
        backgroundColor: '#000',
        color: '#0f0',
        fontFamily: 'monospace',
        fontSize: '0.875rem',
      }}
    />
  );
}