import React, { useState, useEffect } from 'react';
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  useLocation,
} from 'react-router-dom';
import {
  Drawer,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Box,
  FormControl,
  Tooltip,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import DashboardIcon from '@mui/icons-material/Dashboard';
import ScheduleIcon from '@mui/icons-material/Schedule';
import NotificationsIcon from '@mui/icons-material/Notifications';
import DescriptionIcon from '@mui/icons-material/Description';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import { format } from 'date-fns';
import Dashboard from './Dashboard';
import Schedules from './Schedules';
import Alerts from './Alerts';
import Logs from './Logs';

const drawerWidth = 260;

function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [clock, setClock] = useState(new Date());
  const location = useLocation();

  const menu = [
    { text: 'Dashboard', icon: <DashboardIcon />, path: '/' },
    { text: 'Schedules', icon: <ScheduleIcon />, path: '/schedules' },
    { text: 'Alerts', icon: <NotificationsIcon />, path: '/alerts' },
    { text: 'Logs', icon: <DescriptionIcon />, path: '/logs' },
  ];

  const pageTitle = menu.find(m => m.path === location.pathname)?.text || 'ChicKulungan';

  useEffect(() => {
    const iv = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(iv);
  }, []);

  return (
    <Box sx={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden', bgcolor: darkMode ? '#0d1117' : '#f6f8fa' }}>
      {/* Sidebar */}
      <Drawer
        variant="permanent"
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: drawerWidth,
            backgroundColor: darkMode ? '#161b22' : '#ffffff',
            color: darkMode ? '#f0f6fc' : '#24292f',
            borderRight: '1px solid #30363d',
          },
        }}
      >
        <Toolbar />
        <Box sx={{ p: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
            ChicKulungan
          </Typography>
        </Box>
        <List>
          {menu.map(item => (
            <ListItem
              button
              key={item.text}
              component={Link}
              to={item.path}
              selected={location.pathname === item.path}
              sx={{
                '&.Mui-selected': { backgroundColor: darkMode ? '#1976d2' : '#e3f2fd' },
                borderRadius: 1,
                mx: 1,
                mb: 0.5,
                transition: 'all 0.2s',
                '&:hover': { transform: 'translateX(4px)' },
              }}
            >
              <ListItemIcon sx={{ color: 'inherit' }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.text} />
            </ListItem>
          ))}
        </List>
      </Drawer>

      {/* Main */}
      <Box component="main" sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        <AppBar
          position="fixed"
          sx={{
            width: { sm: `calc(100% - ${drawerWidth}px)` },
            ml: { sm: `${drawerWidth}px` },
            backgroundColor: darkMode ? '#161b22' : '#ffffff',
            color: darkMode ? '#f0f6fc' : '#24292f',
            borderBottom: '1px solid #30363d',
          }}
        >
          <Toolbar>
            <IconButton
              color="inherit"
              edge="start"
              onClick={() => setMobileOpen(!mobileOpen)}
              sx={{ mr: 2, display: { sm: 'none' } }}
            >
              <MenuIcon />
            </IconButton>
            <Typography variant="h6" noWrap sx={{ flexGrow: 1 }}>
              {pageTitle}
            </Typography>
            <Typography variant="body2" sx={{ mr: 2 }}>
              {format(clock, 'PPP p')}
            </Typography>
            <Tooltip title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}>
              <IconButton onClick={() => setDarkMode(!darkMode)} color="inherit">
                {darkMode ? <LightModeIcon /> : <DarkModeIcon />}
              </IconButton>
            </Tooltip>
          </Toolbar>
        </AppBar>

        <Box sx={{ flexGrow: 1, p: 3, pt: 10, overflow: 'auto' }}>
          <Routes>
            <Route path="/" element={<Dashboard darkMode={darkMode} />} />
            <Route path="/schedules" element={<Schedules darkMode={darkMode} />} />
            <Route path="/alerts" element={<Alerts darkMode={darkMode} />} />
            <Route path="/logs" element={<Logs darkMode={darkMode} />} />
          </Routes>
        </Box>
      </Box>
    </Box>
  );
}

export default function App() {
  return (
    <Router>
      <Layout />
    </Router>
  );
}