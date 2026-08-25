import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  server: {
    port: 5180,
    proxy: {
      '/bridge': { target: 'ws://127.0.0.1:8787', ws: true }
    }
  },
  build: { outDir: 'dist' }
});
