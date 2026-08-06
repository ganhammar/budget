import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  server: {
    // Same origin in production behind CloudFront; proxied here so it matches.
    proxy: { '/api': 'http://localhost:5080' },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      // The generated worker handles caching; push and notification clicks come
      // from a hand-written file it imports.
      workbox: { importScripts: ['/push-sw.js'] },
      manifest: {
        name: 'Budget',
        short_name: 'Budget',
        description: 'Hushållsbudget med fördelning, lån och kontoprognos',
        lang: 'sv-SE',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        background_color: '#f9f9f7',
        theme_color: '#f9f9f7',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
    }),
  ],
});
