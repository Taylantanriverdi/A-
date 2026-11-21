/** `npm run build:demo` — demo-dist/ altına 4 tek dosyalık demo HTML'i + BASLA.html üretir. */
import { build } from 'vite';
import { mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_OUT_NAMES, DEMO_PAGES, demoConfig } from '../vite.demo.config';
import { startPage } from './basla';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../demo-dist');

async function main(): Promise<void> {
  rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
  for (const page of DEMO_PAGES) {
    await build(demoConfig(page));
    renameSync(resolve(out, `${page}.html`), resolve(out, DEMO_OUT_NAMES[page]));
  }
  writeFileSync(resolve(out, 'BASLA.html'), startPage());
  for (const f of [...Object.values(DEMO_OUT_NAMES), 'BASLA.html']) console.log(`${f}  ${(statSync(resolve(out, f)).size / 1024).toFixed(0)} KB`);
}
main().catch((e) => { console.error(e); process.exit(1); });
