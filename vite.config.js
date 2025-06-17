import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import crypto from 'crypto-browserify';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    'process.env': {},
    global: 'window',
    crypto: crypto
  }
});
