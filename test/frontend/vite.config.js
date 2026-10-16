import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Three pages:
//   /              landing    -> TorqueTwin intro (WebGL), links to the dashboard
//   /dashboard     dashboard  -> /api  proxied to the dashboard API (backend/app.py, port 8000)
//   /vehicle.html  vehicle    -> /vapi proxied to the vehicle node   (vehicle/node.py, port 8200)
// Vite's dev server serves /dashboard from dashboard.html; backend/app.py does the same in single-port mode.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', ws: true },
      '/vapi': { target: 'http://127.0.0.1:8200', rewrite: (p) => p.replace(/^\/vapi/, '/api') },
    },
  },
  build: {
    rollupOptions: {
      input: {
        landing: resolve(__dirname, 'index.html'),
        dashboard: resolve(__dirname, 'dashboard.html'),
        vehicle: resolve(__dirname, 'vehicle.html'),
      },
    },
  },
});
