// src/theme.js   (or theme.jsx if you prefer)
import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'dark', // will be overridden dynamically in App.jsx
    primary: {
      main: '#1976d2',
      light: '#42a5f5',
      dark: '#1565c0',
    },
    secondary: {
      main: '#ffb400',
      light: '#ffca28',
      dark: '#ff8f00',
    },
    background: {
      default: '#0d1117',
      paper: '#161b22',
    },
    error: { main: '#f44336' },
    warning: { main: '#ff9800' },
    success: { main: '#4caf50' },
  },
  shape: {
    borderRadius: 12, // everything nicely rounded
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    h6: { fontWeight: 600 },
    button: {
      fontWeight: 600,
    },
  },
  components: {
    // Cards & Papers
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'unset',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          transition: 'all 0.3s ease-in-out',
          '&:hover': {
            boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
            transform: 'translateY(-2px)',
          },
        },
      },
    },

    MuiCssBaseline: {
    styleOverrides: `
      @keyframes pulse {
        0% { box-shadow: 0 0 0 0 rgba(244, 67, 54, 0.7); }
        70% { box-shadow: 0 0 0 10px rgba(244, 67, 54, 0); }
        100% { box-shadow: 0 0 0 0 rgba(244, 67, 54, 0); }
      }
    `,
  },

    // Buttons
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          textTransform: 'none',
          fontWeight: 600,
          padding: '10px 20px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          '&:hover': {
            boxShadow: '0 6px 16px rgba(0,0,0,0.4)',
            transform: 'translateY(-1px)',
          },
        },
        containedPrimary: {
          background: 'linear-gradient(45deg, #1976d2 30%, #42a5f5 90%)',
        },
      },
    },

    // AppBar gradient when sidebar is expanded
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: 'linear-gradient(to right, #161b22, #1f6feb)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        },
      },
    },

    // Drawer polish
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#161b22',
          borderRight: '1px solid #30363d',
        },
      },
    },

    // DataGrid (Alerts page)
    MuiDataGrid: {
      styleOverrides: {
        root: {
          border: 'none',
          '& .MuiDataGrid-row:hover': {
            backgroundColor: 'rgba(25, 118, 210, 0.15)',
          },
        },
      },
    },
    
  },
});