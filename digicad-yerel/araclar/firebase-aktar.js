#!/usr/bin/env node
'use strict';
// ═══════════════════════════════════════════════════════════════════
//  FIREBASE → YEREL SUNUCU VERİ AKTARIMI (komut satırı)
//  Aynı işlem yönetim panelindeki "Veri Aktarımı" sayfasından da yapılabilir.
//
//  Kullanım (sunucu KAPALIYKEN çalıştırın):
//    node araclar/firebase-aktar.js
//        → veriyi doğrudan Firebase'den indirir
//    node araclar/firebase-aktar.js firebase-yedek.json
//        → Firebase konsolundan "JSON olarak dışa aktar" ile aldığınız dosyayı kullanır
//    Ek seçenekler:
//      --primer DIGICAD_yedek_xxx.json   Primer Teknoloji çalışma alanının yedeği
//      --uzerine-yaz                     Mevcut yerel veritabanını tamamen değiştir
//                                        (önce otomatik yedek alınır)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const aktarim = require('../lib/aktarim');

const KOK = path.join(__dirname, '..');
const VERI = process.env.DIGICAD_VERI || path.join(KOK, 'veri');
const DOSYALAR = path.join(VERI, 'dosyalar');
const DB_DOSYASI = path.join(VERI, 'veritabani.json');
const DIZIN_DOSYASI = path.join(VERI, 'dosya-dizini.json');
const AYAR_DOSYASI = path.join(VERI, 'ayarlar.json');

const argumanlar = process.argv.slice(2);
const secenek = ad => { const i = argumanlar.indexOf(ad); return i >= 0 ? argumanlar[i + 1] : null; };
const uzerineYaz = argumanlar.includes('--uzerine-yaz');
const primerDosyasi = secenek('--primer');
const firebaseDosyasi = argumanlar.find((a, i) => !a.startsWith('--') && argumanlar[i - 1] !== '--primer');

async function main() {
  fs.mkdirSync(DOSYALAR, { recursive: true });
  if (fs.existsSync(DB_DOSYASI) && !uzerineYaz) {
    console.error('Yerel veritabanı zaten var: ' + DB_DOSYASI);
    console.error('Eksik kayıtları eklemek için yönetim panelindeki "Veri Aktarımı" sayfasını kullanın.');
    console.error('Tamamen yeniden aktarmak istiyorsanız --uzerine-yaz ekleyin (mevcut veri önce yedeklenir).');
    process.exit(1);
  }
  if (fs.existsSync(DB_DOSYASI)) {
    const y = DB_DOSYASI.replace(/\.json$/, `-aktarim-oncesi-${Date.now()}.json`);
    fs.copyFileSync(DB_DOSYASI, y);
    console.log('Mevcut veritabanı yedeklendi: ' + y);
  }

  let kaynak;
  if (firebaseDosyasi) kaynak = JSON.parse(fs.readFileSync(firebaseDosyasi, 'utf8'));
  else { console.log('Firebase\'e bağlanılıyor…'); kaynak = await aktarim.firebaseIndir(); }
  const gelen = aktarim.bicimlendir(kaynak, 'digicad');
  if (primerDosyasi) {
    const p = aktarim.bicimlendir(JSON.parse(fs.readFileSync(primerDosyasi, 'utf8')), 'primer');
    gelen.calismaAlanlari.primer = p.calismaAlanlari.primer || p.calismaAlanlari.digicad;
    console.log('Primer Teknoloji verisi eklendi: ' + primerDosyasi);
  }

  let veri = { db: gelen.calismaAlanlari, meta: { migratedToWorkspaces: true, yerelAktarimTarihi: new Date().toISOString() } };
  const dizin = fs.existsSync(DIZIN_DOSYASI) ? JSON.parse(fs.readFileSync(DIZIN_DOSYASI, 'utf8')) : {};
  const sonuc = await aktarim.dosyalariTasi(veri, dizin, DOSYALAR, (b, t) => {
    if (b === 0) console.log(`${t} dosya bağlantısı bulundu, indiriliyor…`);
    else if (b % 10 === 0 || b === t) process.stdout.write(`\r  ${b}/${t} dosya`);
  });
  if (sonuc.toplam) process.stdout.write('\n');
  veri = sonuc.veri;

  fs.writeFileSync(DIZIN_DOSYASI, JSON.stringify(dizin));
  fs.writeFileSync(DB_DOSYASI + '.tmp', JSON.stringify(veri));
  fs.renameSync(DB_DOSYASI + '.tmp', DB_DOSYASI);

  const ayarlar = fs.existsSync(AYAR_DOSYASI) ? JSON.parse(fs.readFileSync(AYAR_DOSYASI, 'utf8')) : {};
  if (!ayarlar.pin && /^\d{4}$/.test(String(gelen.eskiPin || ''))) {
    const tuz = crypto.randomBytes(16).toString('hex');
    ayarlar.pin = { tuz, ozet: crypto.scryptSync(String(gelen.eskiPin), tuz, 64).toString('hex') };
    fs.writeFileSync(AYAR_DOSYASI, JSON.stringify(ayarlar, null, 2));
    console.log('Eski yönetici şifresi yeni sunucunun PIN\'i olarak ayarlandı.');
    if (['0000', '1234', '1111'].includes(String(gelen.eskiPin))) console.log('⚠  Bu PIN çok kolay tahmin edilir! "PIN-Degistir.bat" ile hemen değiştirin.');
  }

  const ws = veri.db.digicad || {};
  const say = k => Object.keys(ws[k] || {}).length;
  console.log('\n✓ Aktarım tamamlandı');
  console.log(`  Hekim: ${say('doctors')} · Teknisyen: ${say('technicians')} · İş: ${say('jobs')} · Bekleyen: ${say('pendingJobs')} · Hekim gönderimi: ${say('doctorSubmissions')} · Sohbet: ${say('chats')}`);
  console.log(`  Ödeme: ${say('payments')} · Gider: ${say('expenses')} · Satış: ${say('sales')} · Hesap kapanışı: ${say('statementClosures')}`);
  console.log(`  Dosya: ${sonuc.indirilen} indirildi${sonuc.basarisiz.length ? `, ${sonuc.basarisiz.length} İNDİRİLEMEDİ` : ''}`);
  if (sonuc.basarisiz.length) {
    const rapor = path.join(VERI, 'indirilemeyen-dosyalar.txt');
    fs.writeFileSync(rapor, sonuc.basarisiz.map(b => `${b.hata}\t${b.adres}`).join('\n'));
    console.log(`  İndirilemeyen dosyaların listesi: ${rapor}`);
  }
}

main().catch(e => { console.error('\nHATA: ' + e.message); process.exit(1); });
