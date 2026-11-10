#!/usr/bin/env node
'use strict';
// Güvenlik testleri: geçici bir veri klasörüyle sunucuyu ayrı kapılarda
// (18080/18081) başlatır, örnek veriyi yükler ve tüm kontrolleri çalıştırır.
// Gerçek verilerinize dokunmaz. Kullanım:  node test/calistir.js
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn, execFileSync } = require('child_process');
const KOK = path.join(__dirname, '..');
const gecici = fs.mkdtempSync(path.join(os.tmpdir(), 'digicad-test-'));
const ortam = { ...process.env, DIGICAD_VERI: gecici, DIGICAD_EPOSTA_KLASORU: path.join(gecici, 'postalar') };
process.env.DIGICAD_EPOSTA_KLASORU = ortam.DIGICAD_EPOSTA_KLASORU;
execFileSync(process.execPath, [path.join(KOK, 'araclar/firebase-aktar.js'), path.join(__dirname, 'ornek-veri.json')], { env: ortam, stdio: 'ignore' });
const ayar = JSON.parse(fs.readFileSync(path.join(gecici, 'ayarlar.json'), 'utf8'));
Object.assign(ayar, { icPort: 18080, disPort: 18081, icAdres: '127.0.0.1', eposta: { acik: true, kullanici: 'lab@ornek.com', sifre: 'deneme', gonderenAd: 'Lab' } });
fs.writeFileSync(path.join(gecici, 'ayarlar.json'), JSON.stringify(ayar));
const sunucu = spawn(process.execPath, [path.join(KOK, 'sunucu.js')], { env: ortam, stdio: 'ignore' });
setTimeout(async () => {
  process.env.IC = 'http://127.0.0.1:18080'; process.env.DIS = 'http://127.0.0.1:18081';
  let kalan = 1;
  try { kalan = await require('./guvenlik-kontrolleri.js')(); } catch (e) { console.error(e); }
  sunucu.kill();
  fs.rmSync(gecici, { recursive: true, force: true });
  process.exit(kalan ? 1 : 0);
}, 1500);
