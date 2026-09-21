import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages serves this repo from /spiro-designer/, not the domain root.
  base: '/spiro-designer/',
  plugins: [react()],
  server: { port: 5173, host: '127.0.0.1' },
});
