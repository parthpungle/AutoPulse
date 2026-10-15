import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The UI talks to the Python API (backend/app.py) through /api, proxied in development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:8000', ws: true } },
  },
});
