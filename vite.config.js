import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: true },
      includeAssets: ['favicon.ico', 'Logo-chikulungan.png'],
      manifest: {
        name: 'ChicKulungan Dashboard',
        short_name: 'ChicKulungan',
        description: 'Poultry Monitoring System',
        theme_color: '#1976d2',
        background_color: '#0d1117',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,  // 4MB limit - adjust higher if needed
      }
    })
  ]
});