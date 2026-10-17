import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Two pages, one per laptop:
//   /              dashboard  -> /api  proxied to the dashboard API (backend/app.py, port 8000)
//   /vehicle.html  vehicle    -> /vapi proxied to the vehicle node   (vehicle/node.py, port 8200)
// AUTOPULSE_API_PORT moves the dashboard API when 8000 is taken by something else.
const API_PORT = process.env.AUTOPULSE_API_PORT || 8000;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: `http://127.0.0.1:${API_PORT}`, ws: true },
      '/vapi': { target: 'http://127.0.0.1:8200', rewrite: (p) => p.replace(/^\/vapi/, '/api') },
    },
  },
  build: {
    rollupOptions: {
      input: { dashboard: resolve(__dirname, 'index.html'), vehicle: resolve(__dirname, 'vehicle.html') },
    },
  },
});
