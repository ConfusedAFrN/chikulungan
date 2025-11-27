import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#1976d2' },
    secondary: { main: '#ffb400' },
    background: { default: '#0d1117', paper: '#161b22' },
    text: { primary: '#f0f6fc' },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    h4: { fontWeight: 600 },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 500 },
  },
  components: {
    MuiPaper: { defaultProps: { elevation: 3 } },
    MuiCard: { styleOverrides: { root: { borderRadius: 12 } } },
  },
});