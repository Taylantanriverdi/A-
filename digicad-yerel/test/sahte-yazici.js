'use strict';
// TEST YARDIMCISI — yazdir.ps1 yerine geçen sahte yazıcı.
// DIGICAD_YAZDIR_KOMUTU=test/sahte-yazici.js ile kullanılır. Yazdırılan
// formları SAHTE_YAZICI_CIKTI klasörüne JSON olarak kaydeder.
const fs = require('fs'), path = require('path');
const a = process.argv.slice(2);
const YAZICILAR = [{ ad: 'Ofis Yazıcısı', varsayilan: true, cevrimdisi: false }, { ad: 'Laboratuvar HP LaserJet', varsayilan: false, cevrimdisi: false }];
if (a.includes('-Liste')) { process.stdout.write(JSON.stringify(YAZICILAR)); process.exit(0); }
const deger = ad => { const i = a.indexOf(ad); return i >= 0 ? a[i + 1] : null; };
const yazici = deger('-Yazici');
if (yazici && !YAZICILAR.some(y => y.ad === yazici)) { process.stderr.write('Yazıcı bulunamadı: ' + yazici); process.exit(1); }
const form = JSON.parse(fs.readFileSync(deger('-Veri'), 'utf8'));
const klasor = process.env.SAHTE_YAZICI_CIKTI;
fs.mkdirSync(klasor, { recursive: true });
fs.writeFileSync(path.join(klasor, Date.now() + '-' + Math.random().toString(36).slice(2, 6) + '.json'), JSON.stringify({ yazici: yazici || '(varsayılan)', kopya: deger('-Kopya'), kagit: deger('-Kagit'), form }, null, 1));
process.stdout.write('YAZDIRILDI');
