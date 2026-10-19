// Kılavuzdaki gerçekçi görselleri SIMULASYON.html'deki 3D modelden üretir (belge/gorseller/*.jpg).
//   node belge/gorsel_uret.mjs   (Playwright + Chromium gerekir)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = createRequire('/opt/node22/lib/node_modules/')('playwright'); }

const burada = path.dirname(fileURLToPath(import.meta.url));
const sim = 'file://' + path.resolve(burada, '../SIMULASYON.html');
const cikti = ad => path.join(burada, 'gorseller', ad + '.jpg');

const HOME = [90, 90, 90, 90, 90, 60];
const TAM = { poz: [380, 300, 560], hedef: [0, 160, 90] };
const CIZIMLER = {
  kapak: { acilar: [68, 112, 118, 72, 90, 85], etiket: true, kamera: { poz: [340, 330, 590], hedef: [0, 150, 110] } },
  baslangic: { acilar: HOME, etiket: false, kamera: { poz: [620, 230, 90], hedef: [0, 160, 90] } },
  adim1: { adim: 1, vurgu: 1, seffafGovde: true, acilar: HOME, kamera: { poz: [200, 170, 260], hedef: [0, 35, 0] } },
  adim2: { adim: 2, vurgu: 2, acilar: HOME, kamera: { poz: [200, 170, 260], hedef: [0, 40, 0] } },
  adim3: { adim: 3, vurgu: 3, acilar: HOME, kamera: { poz: [240, 200, 320], hedef: [0, 80, 0] } },
  adim4: { adim: 4, vurgu: 4, acilar: HOME, kamera: { poz: [330, 270, 430], hedef: [0, 140, 20] } },
  adim5: { adim: 5, vurgu: 5, acilar: HOME, kamera: TAM },
  adim6: { adim: 6, vurgu: 6, acilar: HOME, kamera: TAM },
  adim7: { adim: 7, vurgu: 7, acilar: HOME, kamera: TAM },
  elektronik: { acilar: HOME, kamera: { poz: [-70, 170, 0], hedef: [-128, 8, -92] } },
};

const secili = process.argv.slice(2);
const iste = ad => !secili.length || secili.includes(ad);
for (const ad of Object.keys(CIZIMLER)) if (!iste(ad)) delete CIZIMLER[ad];

const b = await playwright.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const hatalar = [];
if (Object.keys(CIZIMLER).length) {
  const p = await b.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 2 });
  p.on('pageerror', e => hatalar.push(e.message));
  await p.goto(sim + '#render', { timeout: 120000 });
  await p.waitForFunction(() => window.__hazir, null, { timeout: 60000 });
  for (const [ad, o] of Object.entries(CIZIMLER)) {
    await p.evaluate(o => window.__cizim(o), o);
    await p.waitForTimeout(200);
    await p.screenshot({ path: cikti(ad), type: 'jpeg', quality: 86 });
    console.log('cizildi:', ad);
  }
  await p.close();   // yazılım tabanlı WebGL yavaş: iki sahne aynı anda çizilmesin
}
if (iste('simulasyon')) { // simülasyon ekranı (arayüzle birlikte)
  const p = await b.newPage({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 1.3 });
  p.on('pageerror', e => hatalar.push(e.message));
  await p.goto(sim, { timeout: 120000 });
  await p.waitForFunction(() => window.__hazir, null, { timeout: 60000 });
  const poz = [70, 115, 115, 75, 90, 85];
  for (let i = 0; i < 6; i++) {
    await p.$eval('#k' + i, (k, v) => { k.value = v; k.dispatchEvent(new Event('change')); }, poz[i]);
  }
  await p.waitForTimeout(6000);
  await p.click('#pozKaydet');
  await p.waitForTimeout(500);
  await p.click('#yardimKapat');
  await p.screenshot({ path: cikti('simulasyon'), type: 'jpeg', quality: 86 });
  console.log('cizildi: simulasyon');
}
await b.close();
if (hatalar.length) { console.error(hatalar); process.exit(1); }
