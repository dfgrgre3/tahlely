import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri dev server port must match tauri.conf.json > build > devUrl.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
  },
});
