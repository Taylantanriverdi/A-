// SIMULASYON.html üretir:
//   1) RobotKol_PS4.ino'dan eksen tablosunu ve kontrol sabitlerini okur
//   2) src/main.js'i three.js ile tek dosyaya paketler (esbuild)
//   3) sablon.html içine gömüp ../SIMULASYON.html olarak yazar (internet gerekmez)
import { readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

const ino = readFileSync(new URL('../RobotKol_PS4.ino', import.meta.url), 'utf8');
const sayi = ad => {
  const m = ino.match(new RegExp(`const\\s+\\w+\\s+${ad}\\s*=\\s*([-\\d.]+)f?;`));
  if (!m) throw new Error(`${ad} .ino icinde bulunamadi`);
  return parseFloat(m[1]);
};
const hizlar = ino.match(/SPEED_LEVELS\[\]\s*=\s*\{([^}]*)\}/)[1].split(',').map(s => parseFloat(s));
const tablo = ino.match(/Joint joints\[6\]\s*=\s*\{([\s\S]*?)\n\};/)[1];
const eksenler = [...tablo.matchAll(/\{"([^"]+)",\s*(\d+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([+-]?\d+),\s*(\d+),\s*(\d+)\}/g)]
  .map(m => ({ ad: m[1], kanal: +m[2], min: +m[3], max: +m[4], home: +m[5], hiz: +m[6], yon: +m[7], usMin: +m[8], usMax: +m[9] }));
if (eksenler.length !== 6) throw new Error('Eksen tablosu okunamadi');
// .ino'daki ASCII adları ekranda Türkçe göster
const TURKCE = { 'Bilek Egim': 'Bilek Eğim', 'Bilek Donus': 'Bilek Dönüş', 'Kiskac': 'Kıskaç' };
for (const e of eksenler) e.ad = TURKCE[e.ad] || e.ad;

const AYAR = {
  eksenler, SPEED_LEVELS: hizlar,
  LOOP_MS: sayi('LOOP_MS'), STICK_DEAD: sayi('STICK_DEAD'), TRIG_DEAD: sayi('TRIG_DEAD'),
  EXPO: sayi('EXPO'), SMOOTHING: sayi('SMOOTHING'),
};
writeFileSync(new URL('./src/ayarlar_uretilen.js', import.meta.url),
  `// Otomatik uretildi (derle.mjs) - elle degistirmeyin\nexport const AYAR = ${JSON.stringify(AYAR, null, 2)};\n`);

const sonuc = await build({
  entryPoints: [new URL('./src/main.js', import.meta.url).pathname],
  bundle: true, minify: true, format: 'iife', target: 'es2020', write: false, legalComments: 'none',
});
const kod = sonuc.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const sablon = readFileSync(new URL('./sablon.html', import.meta.url), 'utf8');
const html = sablon.replace('/*__UYGULAMA__*/', () => kod);
writeFileSync(new URL('../SIMULASYON.html', import.meta.url), html);
console.log(`SIMULASYON.html yazildi (${(html.length / 1024).toFixed(0)} KB)`);
