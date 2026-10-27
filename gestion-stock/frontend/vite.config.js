// ============================================================
// CONFIGURATION VITE — Configure le serveur de développement React
// ============================================================
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000, // React tournera sur http://localhost:3000
  },
});
