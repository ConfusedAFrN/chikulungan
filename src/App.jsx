// src/App.jsx
import React, { useState, useEffect } from "react";
import { GlobalFeedback } from "./components/GlobalFeedback";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  useLocation,
} from "react-router-dom";
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
  Divider,
  Tooltip,
  createTheme,
  ThemeProvider,
  CssBaseline,
} from "@mui/material";
import {
  Menu as MenuIcon,
  Dashboard as DashboardIcon,
  Schedule as ScheduleIcon,
  Notifications as NotificationsIcon,
  Description as DescriptionIcon,
  LightMode as LightModeIcon,
  DarkMode as DarkModeIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  History as HistoryIcon,
} from "@mui/icons-material";
import { format } from "date-fns";

// Pages
import Dashboard from "./Dashboard";
import Schedules from "./Schedules";
import Alerts from "./Alerts";
import Logs from "./Logs";
import History from "./History";

const fullDrawerWidth = 260;
const miniDrawerWidth = 56;

const menu = [
  { text: "Dashboard", icon: <DashboardIcon />, path: "/" },
  { text: "Schedules", icon: <ScheduleIcon />, path: "/schedules" },
  { text: "Alerts", icon: <NotificationsIcon />, path: "/alerts" },
  { text: "Logs", icon: <DescriptionIcon />, path: "/logs" },
  { text: 'History', icon: <HistoryIcon />, path: "/history" },
];

const getTooltipText = (text) => {
  switch (text) {
    case 'Dashboard':
      return 'Dashboard';
    case 'Schedules':
      return 'Schedule';
    case 'Alerts':
      return 'Alerts';
    case 'Logs':
      return 'Logs';
    default:
      return text;  // Fallback
  }
};

function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [collapsed, setCollapsed] = useState(true); // Default to collapsed
  const [clock, setClock] = useState(new Date());
  const location = useLocation();

  const drawerWidth = collapsed ? miniDrawerWidth : fullDrawerWidth;

  const theme = createTheme({
    palette: {
      mode: darkMode ? "dark" : "light",
      primary: { main: "#1976d2" },
      secondary: { main: "#ffb400" },
      background: darkMode
        ? { default: "#0d1117", paper: "#161b22" }
        : { default: "#f6f8fa", paper: "#ffffff" },
      text: darkMode ? { primary: "#f0f6fc" } : { primary: "#24292f" },
    },
    typography: {
      fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
      h6: { fontWeight: 600 },
    },
    components: {
      MuiPaper: { defaultProps: { elevation: 3 } },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: darkMode ? "#161b22" : "#ffffff",
            color: darkMode ? "#f0f6fc" : "#24292f",
            borderRight: "1px solid #30363d",
          },
        },
      },
    },
  });


  

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const currentTitle =
    menu.find((m) => m.path === location.pathname)?.text || "ChicKulungan";

  const drawerContent = (
    <>
      <Toolbar sx={{ justifyContent: collapsed ? "center" : "space-between" }}>
        {!collapsed && (
          <Typography variant="h6" fontWeight={600} noWrap>
            ChicKulungan
          </Typography>
        )}
        <IconButton onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <MenuIcon /> : <ChevronLeftIcon />}
        </IconButton>
      </Toolbar>
      {!collapsed && <Divider />}
      <List sx={{ px: collapsed ? 0 : 2 }}>
        {menu.map((item) => (
          <ListItem
  key={item.text}
  button
  component={Link}
  to={item.path}
  selected={location.pathname === item.path}
  onClick={() => setMobileOpen(false)}
  sx={{
    justifyContent: collapsed ? 'center' : 'flex-start',
    px: collapsed ? 1.5 : 2,
    borderRadius: 2,
    mb: 0.5,
    '&.Mui-selected': {
      backgroundColor: darkMode ? '#1976d2' : '#e3f2fd',
      fontWeight: 600,
      '& .MuiListItemIcon-root': { color: 'inherit' },
    },
    '&:hover': {
      backgroundColor: darkMode ? 'rgba(25, 118, 210, 0.2)' : 'rgba(25, 118, 210, 0.08)',
    },
  }}
>
  <Tooltip
    title={getTooltipText(item.text)}  // Dynamic based on item
    placement="right"  // Shows to the right for sidebar
    arrow
    enterDelay={500}  // Slight delay to avoid flicker
  >
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      <ListItemIcon
        sx={{
          color: location.pathname === item.path ? 'inherit' : 'text.secondary',
          minWidth: collapsed ? 'auto' : 40,
        }}
      >
        {item.icon}
      </ListItemIcon>
      {!collapsed && <ListItemText primary={item.text} sx={{ ml: 2 }} />}
    </Box>
  </Tooltip>
</ListItem>
        ))}
      </List>
    </>
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalFeedback />
      <Box
        sx={{
          display: "flex",
          height: "100vh",
          width: "100vw",
          bgcolor: "background.default",
        }}
      >
        {/* Mobile Drawer */}
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: "block", sm: "none" },
            "& .MuiDrawer-paper": { width: fullDrawerWidth , touchAction: 'none'},
            
          }}
        >
          {drawerContent}
        </Drawer>

        {/* Desktop Drawer */}
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: "none", sm: "block" },
            width: drawerWidth,
            flexShrink: 0,
            "& .MuiDrawer-paper": {
              width: drawerWidth,
              transition: "width 0.3s",
            },
          }}
        >
          {drawerContent}
        </Drawer>

        {/* Main Content */}
        <Box
          component="main"
          sx={{ flexGrow: 1, display: "flex", flexDirection: "column" }}
        >
          <AppBar
            position="fixed"
            sx={{
              width: { sm: `calc(100% - ${drawerWidth}px)` },
              ml: { sm: `${drawerWidth}px` },
              bgcolor: "background.paper",
              color: "text.primary",
              boxShadow: 1,
              transition: "margin-left 0.3s, width 0.3s",
            }}
          >
            <Toolbar>
              <IconButton
                color="inherit"
                edge="start"
                onClick={() => setMobileOpen(true)}
                sx={{ mr: 2, display: { sm: "none" } }}
              >
                <MenuIcon />
              </IconButton>
              <Typography variant="h6" noWrap sx={{ flexGrow: 1 }}>
                {currentTitle}
              </Typography>
              <Typography variant="body2" sx={{ mr: 3 }}>
                {format(clock, "PPP p")}
              </Typography>
              <Tooltip
                title={
                  darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"
                }
              >
                <IconButton
                  onClick={() => setDarkMode(!darkMode)}
                  color="inherit"
                >
                  {darkMode ? <LightModeIcon /> : <DarkModeIcon />}
                </IconButton>
              </Tooltip>
            </Toolbar>
          </AppBar>

          <Box
            sx={{
              flexGrow: 1,
              p: 3,
              pt: 10,
              overflow: "auto",
              transition: "padding-left 0.3s",
            }}
          >
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/schedules" element={<Schedules />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/logs" element={<Logs />} />
              <Route path="/history" element={<History />} />
            </Routes>
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
}

export default function App() {
  return (
    <Router>
      <Layout />
    </Router>
  );
}
