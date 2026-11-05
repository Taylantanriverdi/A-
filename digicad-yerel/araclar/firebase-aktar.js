#!/usr/bin/env node
'use strict';
// ═══════════════════════════════════════════════════════════════════
//  FIREBASE → YEREL SUNUCU VERİ AKTARIMI (bir kez çalıştırılır)
//
//  1) Firebase Realtime Database'deki tüm veriyi indirir
//  2) Firebase Storage'daki tüm dosyaları (STL, fotoğraf, PDF…) indirir ve
//     kayıtlardaki bağlantıları yerel adreslerle değiştirir
//  3) Eski 4 haneli yönetici şifresini yeni sunucunun PIN'i olarak alır
//
//  Kullanım (sunucu KAPALIYKEN çalıştırın):
//    node araclar/firebase-aktar.js
//        → veriyi doğrudan Firebase'den indirmeyi dener
//    node araclar/firebase-aktar.js firebase-yedek.json
//        → Firebase konsolundan "JSON olarak dışa aktar" ile aldığınız dosyayı kullanır
//    Ek seçenekler:
//      --primer DIGICAD_yedek_xxx.json   Primer Teknoloji çalışma alanının yedeği
//                                        (eski sitede Ayarlar → "Yedek indir" ile alınır)
//      --uzerine-yaz                     Mevcut yerel veritabanının üzerine yaz
//                                        (önce otomatik yedek alınır)
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const FIREBASE = {
  apiKey: 'AIzaSyBKf0ze58oEbOcSVfPPdqX1ElTaxm7JN8E',
  databaseURL: 'https://primer-dental-default-rtdb.europe-west1.firebasedatabase.app',
};

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

async function firebaseIndir() {
  console.log('Firebase\'e bağlanılıyor…');
  const g = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE.apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
  });
  const gj = await g.json();
  const token = gj.idToken;
  const adres = `${FIREBASE.databaseURL}/.json${token ? '?auth=' + encodeURIComponent(token) : ''}`;
  const r = await fetch(adres);
  if (!r.ok) throw new Error(`Firebase verisi indirilemedi (HTTP ${r.status}). Firebase konsolundan JSON dışa aktarıp dosya olarak verin.`);
  return r.json();
}

// Firebase Storage indirme bağlantıları
const STORAGE_DESENI = /https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/\s"'<>]+\/o\/[^\s"'<>)]+/g;

function dolas(v, fn) {
  if (typeof v === 'string') return fn(v);
  if (Array.isArray(v)) return v.map(x => dolas(x, fn));
  if (v && typeof v === 'object') { const n = {}; for (const k of Object.keys(v)) n[k] = dolas(v[k], fn); return n; }
  return v;
}

function guvenliAd(ad) {
  return (String(ad || 'dosya').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '').slice(-150)) || 'dosya';
}

async function dosyaIndir(adres, dizin) {
  const u = new URL(adres.replace(/&amp;/g, '&'));
  const depoYolu = decodeURIComponent(u.pathname.split('/o/')[1] || '');
  if (dizin[depoYolu]) return dizin[depoYolu].adres;
  const ad = guvenliAd(depoYolu.split('/').pop());
  let sonHata;
  for (let deneme = 1; deneme <= 3; deneme++) {
    try {
      const r = await fetch(u.toString());
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const belirtec = crypto.randomBytes(24).toString('base64url');
      const klasor = path.join(DOSYALAR, belirtec);
      fs.mkdirSync(klasor, { recursive: true });
      await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(path.join(klasor, ad)));
      const yerel = `/dosya/${belirtec}/${encodeURIComponent(ad)}`;
      dizin[depoYolu] = { adres: yerel, boyut: fs.statSync(path.join(klasor, ad)).size, tarih: new Date().toISOString(), yukleyen: 'firebase-aktarim' };
      return yerel;
    } catch (e) { sonHata = e; await new Promise(c => setTimeout(c, 1000 * deneme)); }
  }
  throw sonHata;
}

async function main() {
  fs.mkdirSync(DOSYALAR, { recursive: true });
  if (fs.existsSync(DB_DOSYASI) && !uzerineYaz) {
    console.error('Yerel veritabanı zaten var: ' + DB_DOSYASI);
    console.error('Yeniden aktarmak istiyorsanız --uzerine-yaz ekleyin (mevcut veri önce yedeklenir).');
    process.exit(1);
  }
  if (fs.existsSync(DB_DOSYASI)) {
    const y = DB_DOSYASI.replace(/\.json$/, `-aktarim-oncesi-${Date.now()}.json`);
    fs.copyFileSync(DB_DOSYASI, y);
    console.log('Mevcut veritabanı yedeklendi: ' + y);
  }

  let veri = firebaseDosyasi ? JSON.parse(fs.readFileSync(firebaseDosyasi, 'utf8')) : await firebaseIndir();
  if (!veri || typeof veri !== 'object') throw new Error('Firebase verisi boş görünüyor');
  // Konsoldan sadece /db dalı dışa aktarıldıysa tam yapıya çevir
  if (!veri.db && (veri.digicad || veri.primer)) veri = { db: veri };
  veri.db = veri.db || {};
  veri.db.digicad = veri.db.digicad || {};

  // Eski 4 haneli şifre → yeni sunucunun PIN'i
  const eskiPin = (veri.meta && veri.meta.pass) || veri.db.digicad.pass || veri.db.pass || null;

  // Primer Teknoloji çalışma alanı (eskiden sadece tarayıcıda duruyordu)
  if (primerDosyasi) {
    const p = JSON.parse(fs.readFileSync(primerDosyasi, 'utf8'));
    delete p.pass;
    veri.db.primer = p;
    console.log('Primer Teknoloji verisi eklendi: ' + primerDosyasi);
  }

  // Düz metin şifre alanlarını temizle
  if (veri.meta) delete veri.meta.pass;
  delete veri.db.pass;
  for (const ws of Object.keys(veri.db)) if (veri.db[ws] && typeof veri.db[ws] === 'object') delete veri.db[ws].pass;
  veri.meta = { ...(veri.meta || {}), migratedToWorkspaces: true, yerelAktarimTarihi: new Date().toISOString() };

  // Dosyaları indir
  const adresler = new Set();
  dolas(veri, s => { for (const m of s.match(STORAGE_DESENI) || []) adresler.add(m); return s; });
  console.log(`${adresler.size} dosya bağlantısı bulundu, indiriliyor…`);
  const dizin = fs.existsSync(DIZIN_DOSYASI) ? JSON.parse(fs.readFileSync(DIZIN_DOSYASI, 'utf8')) : {};
  const eslesme = new Map(), basarisiz = [];
  const liste = [...adresler];
  let sira = 0, biten = 0;
  async function isci() {
    while (sira < liste.length) {
      const a = liste[sira++];
      try { eslesme.set(a, await dosyaIndir(a, dizin)); }
      catch (e) { basarisiz.push([a, e.message]); }
      biten++;
      if (biten % 10 === 0 || biten === liste.length) process.stdout.write(`\r  ${biten}/${liste.length} dosya`);
    }
  }
  await Promise.all([1, 2, 3, 4].map(isci));
  if (liste.length) process.stdout.write('\n');
  veri = dolas(veri, s => s.replace(STORAGE_DESENI, m => eslesme.get(m) || m));

  fs.writeFileSync(DIZIN_DOSYASI, JSON.stringify(dizin));
  fs.writeFileSync(DB_DOSYASI + '.tmp', JSON.stringify(veri));
  fs.renameSync(DB_DOSYASI + '.tmp', DB_DOSYASI);

  // PIN
  const ayarlar = fs.existsSync(AYAR_DOSYASI) ? JSON.parse(fs.readFileSync(AYAR_DOSYASI, 'utf8')) : {};
  if (!ayarlar.pin && /^\d{4}$/.test(String(eskiPin || ''))) {
    const tuz = crypto.randomBytes(16).toString('hex');
    ayarlar.pin = { tuz, ozet: crypto.scryptSync(String(eskiPin), tuz, 64).toString('hex') };
    fs.writeFileSync(AYAR_DOSYASI, JSON.stringify(ayarlar, null, 2));
    console.log('Eski yönetici şifresi yeni sunucunun PIN\'i olarak ayarlandı.');
    if (['0000', '1234', '1111'].includes(String(eskiPin))) {
      console.log('⚠  Bu PIN çok kolay tahmin edilir! "PIN-Degistir.bat" ile hemen değiştirin.');
    }
  }

  const ws = veri.db.digicad || {};
  const say = k => Object.keys(ws[k] || {}).length;
  console.log('\n✓ Aktarım tamamlandı');
  console.log(`  Hekim: ${say('doctors')} · Teknisyen: ${say('technicians')} · İş: ${say('jobs')} · Bekleyen: ${say('pendingJobs')} · Hekim gönderimi: ${say('doctorSubmissions')} · Sohbet: ${say('chats')}`);
  console.log(`  Dosya: ${eslesme.size} indirildi${basarisiz.length ? `, ${basarisiz.length} İNDİRİLEMEDİ` : ''}`);
  if (basarisiz.length) {
    const rapor = path.join(VERI, 'indirilemeyen-dosyalar.txt');
    fs.writeFileSync(rapor, basarisiz.map(([a, h]) => `${h}\t${a}`).join('\n'));
    console.log(`  İndirilemeyen dosyaların listesi: ${rapor}`);
    console.log('  (Bu dosyaların bağlantıları değiştirilmedi. Aktarımı tekrar çalıştırmak için --uzerine-yaz kullanın.)');
  }
}

main().catch(e => { console.error('\nHATA: ' + e.message); process.exit(1); });
