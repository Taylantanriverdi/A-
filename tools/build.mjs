#!/usr/bin/env node
// src/core.js'i tek dosyalık NC_Simulator/NC_Simulator.html içine (<script id="nc-core">) yerleştirir.
// Kullanım: node tools/build.mjs          → HTML'i günceller
//           node tools/build.mjs --check  → HTML güncel değilse hata verir (test/CI için)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = path.join(root, 'NC_Simulator', 'NC_Simulator.html');
const core = fs.readFileSync(path.join(root, 'src', 'core.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const html = fs.readFileSync(htmlPath, 'utf8');
const re = /(<script id="nc-core">\n)[\s\S]*?(\n<\/script>)/;
if (!re.test(html)) { console.error('NC_Simulator.html içinde <script id="nc-core"> bulunamadı'); process.exit(1); }
const out = html.replace(re, (_, a, b) => a + core.replace(/\n$/, '') + b);
if (process.argv.includes('--check')) {
  if (out !== html) { console.error('NC_Simulator.html güncel değil: node tools/build.mjs çalıştırın'); process.exit(1); }
  console.log('NC_Simulator.html güncel');
} else {
  fs.writeFileSync(htmlPath, out);
  console.log('NC_Simulator.html güncellendi');
}
