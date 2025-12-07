// src/components/GlobalFeedback.jsx
import React, { useState, useEffect } from 'react';
import { Snackbar, Alert, CircularProgress, Box, Backdrop } from '@mui/material';
import { registerFeedback } from '../utils/feedback';

export function GlobalFeedback() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState('info');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    registerFeedback(
      (msg, sev = 'info') => {
        setMessage(msg);
        setSeverity(sev);
        setOpen(true);
      },
      setLoading
    );
  }, []);

  return (
    <>
      <Backdrop open={loading} sx={{ color: '#fff', zIndex: 9999 }}>
        <Box textAlign="center">
          <CircularProgress color="inherit" size={60} thickness={5} />
          <Box mt={2} fontWeight={600}>Connecting to ChicKulungan...</Box>
        </Box>
      </Backdrop>

      <Snackbar
        open={open}
        autoHideDuration={6000}
        onClose={() => setOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setOpen(false)} severity={severity} variant="filled" sx={{ minWidth: 300 }}>
          {message}
        </Alert>
      </Snackbar>
    </>
  );
}