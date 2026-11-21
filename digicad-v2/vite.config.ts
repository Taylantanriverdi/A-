import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: false,          // üretimde kaynak haritası yok
    assetsInlineLimit: 0,      // data: URI üretme (CSP img/font-src 'self')
    modulePreload: { polyfill: false }, // satır içi betik enjekte etme (CSP script-src 'self')
    chunkSizeWarningLimit: 800,
    rollupOptions: { output: { manualChunks: (id: string) => (/node_modules\/(@firebase|firebase)\//.test(id) ? 'firebase' : undefined) }, input: { index: resolve(__dirname, 'index.html'), admin: resolve(__dirname, 'admin.html'), hekim: resolve(__dirname, 'hekim.html'), teknisyen: resolve(__dirname, 'teknisyen.html'), 'gelen-isler': resolve(__dirname, 'gelen-isler.html') } },
  },
});
