'use strict';
// ═══════════════════════════════════════════════════════════════════
//  FIREBASE SALT-OKUNUR ERİŞİM
//  Eski sisteme (Firebase) giden TÜM istekler bu dosyadan geçer.
//
//  GÜVENCE: Veritabanına ve dosya deposuna yalnızca GET (okuma) isteği
//  gönderilebilir. Kod içinde yanlışlıkla bile PUT / POST / PATCH / DELETE
//  gönderilmeye çalışılırsa `guvenliIstek` işlemi durdurur. Firebase
//  verileri bu yazılım tarafından DEĞİŞTİRİLEMEZ.
//
//  Tek istisna: veritabanı kimliksiz okumaya izin vermiyorsa, eski sitenin
//  de her açılışta yaptığı gibi "anonim oturum" açılır (Firebase Auth'a
//  bir POST). Bu işlem veritabanındaki ve dosyalardaki hiçbir veriye
//  dokunmaz.
// ═══════════════════════════════════════════════════════════════════

const FIREBASE = {
  apiKey: 'AIzaSyBKf0ze58oEbOcSVfPPdqX1ElTaxm7JN8E',
  databaseURL: 'https://primer-dental-default-rtdb.europe-west1.firebasedatabase.app',
  storageBucket: 'primer-dental.firebasestorage.app',
};

const VERI_SUNUCULARI = ['primer-dental-default-rtdb.europe-west1.firebasedatabase.app', 'firebasestorage.googleapis.com'];
const OTURUM_ADRESI = 'https://identitytoolkit.googleapis.com/v1/accounts:signUp';

function guvenliIstek(adres, secenek = {}) {
  const u = new URL(adres);
  const yontem = (secenek.method || 'GET').toUpperCase();
  if (VERI_SUNUCULARI.includes(u.hostname) && yontem !== 'GET') {
    throw new Error(`GÜVENLİK: Firebase'e ${yontem} isteği engellendi — bu yazılım Firebase'e yalnızca okuma yapabilir`);
  }
  if (!VERI_SUNUCULARI.includes(u.hostname) && !(adres.startsWith(OTURUM_ADRESI) && yontem === 'POST')) {
    throw new Error('GÜVENLİK: Beklenmeyen adres engellendi: ' + u.hostname);
  }
  return fetch(adres, { ...secenek, method: yontem, redirect: 'follow' });
}

let _anahtar = null;
async function anonimOturum() {
  if (_anahtar) return _anahtar;
  const r = await guvenliIstek(`${OTURUM_ADRESI}?key=${FIREBASE.apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.idToken) throw new Error('Firebase anonim oturumu açılamadı' + (j.error ? ': ' + j.error.message : ''));
  _anahtar = j.idToken;
  return _anahtar;
}

// Veritabanının tamamını HAM METİN olarak okur (Firebase'in gönderdiği baytlar aynen)
async function veritabaniniOku() {
  let r = await guvenliIstek(`${FIREBASE.databaseURL}/.json`);
  let yontem = 'kimliksiz okuma';
  if (r.status === 401 || r.status === 403) {
    const t = await anonimOturum();
    r = await guvenliIstek(`${FIREBASE.databaseURL}/.json?auth=${encodeURIComponent(t)}`);
    yontem = 'anonim oturumla okuma';
  }
  if (!r.ok) throw new Error(`Firebase veritabanı okunamadı (HTTP ${r.status}). Firebase kapatılmış ya da erişim kısıtlanmış olabilir.`);
  const metin = await r.text();
  if (!metin || metin === 'null') throw new Error('Firebase veritabanı boş döndü');
  return { metin, yontem };
}

// Dosya deposundaki tüm dosyaların listesi (kurallar izin veriyorsa).
// İzin yoksa null döner — o durumda sadece veritabanında bağlantısı olan dosyalar yedeklenir.
async function depoListesi() {
  const sonuc = [];
  let sayfa = null;
  const basliklar = {};
  try { basliklar.Authorization = 'Firebase ' + await anonimOturum(); } catch (e) { /* kimliksiz dene */ }
  for (let i = 0; i < 1000; i++) {
    const adres = `https://firebasestorage.googleapis.com/v0/b/${FIREBASE.storageBucket}/o?maxResults=1000${sayfa ? '&pageToken=' + encodeURIComponent(sayfa) : ''}`;
    const r = await guvenliIstek(adres, { headers: basliklar });
    if (!r.ok) return null;
    const j = await r.json();
    for (const it of j.items || []) sonuc.push(it.name);
    if (!j.nextPageToken) break;
    sayfa = j.nextPageToken;
  }
  return sonuc;
}

// Bir dosyayı okur: önce veritabanındaki indirme bağlantısı (içinde erişim anahtarı var),
// yoksa depo yolu ile (oturum başlığıyla).
async function dosyaOku(depoYolu, indirmeAdresi) {
  if (indirmeAdresi) {
    const r = await guvenliIstek(indirmeAdresi.replace(/&amp;/g, '&'));
    if (r.ok) return r;
    if (r.status !== 403 && r.status !== 401) return r;
  }
  const basliklar = {};
  try { basliklar.Authorization = 'Firebase ' + await anonimOturum(); } catch (e) { /* yoksay */ }
  return guvenliIstek(`https://firebasestorage.googleapis.com/v0/b/${FIREBASE.storageBucket}/o/${encodeURIComponent(depoYolu)}?alt=media`, { headers: basliklar });
}

module.exports = { FIREBASE, guvenliIstek, veritabaniniOku, depoListesi, dosyaOku };
