import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    target: 'es2022',
    rollupOptions: { input: { index: resolve(__dirname, 'index.html'), admin: resolve(__dirname, 'admin.html'), hekim: resolve(__dirname, 'hekim.html'), teknisyen: resolve(__dirname, 'teknisyen.html'), 'gelen-isler': resolve(__dirname, 'gelen-isler.html') } },
  },
});
