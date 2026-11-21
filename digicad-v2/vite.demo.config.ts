/**
 * DEMO derlemesi (Firebase'siz, çift tıklanarak açılır). Üretim derlemesinden (vite.config.ts) tamamen ayrıdır.
 * Her sayfa için ayrı çalıştırılır (vite-plugin-singlefile çok girişli derlemeyi desteklemez): `npm run build:demo`.
 * Uygulama kodu değişmez; yalnızca firebase/* içe aktarmaları demo/mock/* taklitlerine yönlendirilir.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { InlineConfig, Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export type DemoPage = 'admin' | 'hekim' | 'teknisyen' | 'gelen-isler';
export const DEMO_PAGES: DemoPage[] = ['admin', 'hekim', 'teknisyen', 'gelen-isler'];
export const DEMO_OUT_NAMES: Record<DemoPage, string> = { admin: 'DigiCAD-Demo-Admin.html', hekim: 'DigiCAD-Demo-Hekim.html', teknisyen: 'DigiCAD-Demo-Teknisyen.html', 'gelen-isler': 'DigiCAD-Demo-GelenIsler.html' };

const ROOT = dirname(fileURLToPath(import.meta.url));
const mock = (f: string): string => resolve(ROOT, 'demo/mock', f);

/** Google Identity Services betiğini çıkarır (demo'da yüklenmez) ve başlığa DEMO ekler. */
const demoHtml = (): Plugin => ({
  name: 'digicad-demo-html',
  transformIndexHtml: (html) => html.replace(/\s*<script[^>]*accounts\.google\.com[^>]*><\/script>/g, '').replace(/<title>([^<]*)<\/title>/, '<title>DEMO — $1</title>'),
});

/** Üretim yapılandırmasının (.env) sızmaması için ortam değişkenleri burada sabitlenir; `envDir` boş bir klasördür. */
export const DEMO_ENV: Record<string, string> = {
  VITE_FIREBASE_API_KEY: 'demo', VITE_FIREBASE_AUTH_DOMAIN: 'demo.invalid', VITE_FIREBASE_PROJECT_ID: 'demo', VITE_FIREBASE_STORAGE_BUCKET: 'demo.invalid', VITE_FIREBASE_MESSAGING_SENDER_ID: '0', VITE_FIREBASE_APP_ID: 'demo',
  VITE_RECAPTCHA_SITE_KEY: 'demo', VITE_GOOGLE_CLIENT_ID: 'demo.apps.googleusercontent.com', VITE_USE_EMULATORS: 'false', VITE_OFFLINE_CACHE: 'false', VITE_AUTH_PERSISTENCE: 'session',
};

export function demoConfig(page: DemoPage): InlineConfig {
  Object.assign(process.env, DEMO_ENV);
  return {
    configFile: false,
    root: ROOT,
    base: './',
    envDir: resolve(ROOT, 'demo'),
    logLevel: 'warn',
    plugins: [demoHtml(), viteSingleFile()],
    define: { __DEMO_PAGE__: JSON.stringify(page) },
    resolve: {
      alias: [
        { find: /^firebase\/app$/, replacement: mock('app.ts') },
        { find: /^firebase\/app-check$/, replacement: mock('app.ts') },
        { find: /^firebase\/auth$/, replacement: mock('auth.ts') },
        { find: /^firebase\/firestore$/, replacement: mock('firestore.ts') },
        { find: /^firebase\/storage$/, replacement: mock('storage.ts') },
        { find: /^firebase\/functions$/, replacement: mock('functions.ts') },
      ],
    },
    build: {
      target: 'es2022', sourcemap: false, outDir: resolve(ROOT, 'demo-dist'), emptyOutDir: false,
      assetsInlineLimit: 100_000_000, cssCodeSplit: false, modulePreload: false, chunkSizeWarningLimit: 4000,
      rollupOptions: { input: resolve(ROOT, `${page}.html`) },
    },
  };
}

/** `vite build -c vite.demo.config.ts` (DEMO_PAGE ortam değişkeniyle) için. */
export default (): InlineConfig => demoConfig((process.env.DEMO_PAGE as DemoPage | undefined) ?? 'admin');
