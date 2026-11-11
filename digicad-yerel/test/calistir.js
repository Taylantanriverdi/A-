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
// Eski portal köprüsü için sahte Firebase: gerçek Firebase'e hiçbir istek gitmez.
// Firebase'de, yeni sistemde olmayan bir hekim gönderimi var (eski portaldan gönderilmiş gibi).
const ekDosya = path.join(gecici, 'firebase-ek.json');
fs.writeFileSync(ekDosya, JSON.stringify({ fb900: { id: 'fb900', drId: 1, doctorName: 'Dr Ali Kaya', patient: 'ESKİ PORTAL HASTASI', jobType: 'Zirkon',
  createdAt: new Date().toISOString(), status: 'Yeni', files: [{ name: 'üst çene.stl', url: 'https://firebasestorage.googleapis.com/v0/b/primer-dental.firebasestorage.app/o/' + encodeURIComponent('doctorScans/digicad/600/üst çene.stl') + '?alt=media&token=t-1' }] },
  fb800: { id: 'fb800', drId: 2, doctorName: 'Dr Ayşe', patient: 'ÇOK ESKİ HASTA', createdAt: new Date(Date.now() - 60 * 864e5).toISOString(), status: 'Yeni' } }));
Object.assign(ortam, { SAHTE_FIREBASE_EK: ekDosya, SAHTE_FIREBASE_KAYIT: path.join(gecici, 'firebase-istekleri.log'), DIGICAD_KOPRU_ILK_MS: '300', DIGICAD_KOPRU_ARALIK_MS: '600000' });
process.env.SAHTE_FIREBASE_KAYIT = ortam.SAHTE_FIREBASE_KAYIT;
const sunucu = spawn(process.execPath, ['-r', path.join(__dirname, 'sahte-firebase.js'), path.join(KOK, 'sunucu.js')], { env: ortam, stdio: 'ignore' });
setTimeout(async () => {
  process.env.IC = 'http://127.0.0.1:18080'; process.env.DIS = 'http://127.0.0.1:18081';
  let kalan = 1;
  try { kalan = await require('./guvenlik-kontrolleri.js')(); } catch (e) { console.error(e); }
  sunucu.kill();
  fs.rmSync(gecici, { recursive: true, force: true });
  process.exit(kalan ? 1 : 0);
}, 1500);
