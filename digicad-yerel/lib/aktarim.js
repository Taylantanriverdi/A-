'use strict';
// ═══════════════════════════════════════════════════════════════════
//  VERİ AKTARIMI — eski sistemden (Firebase / yedek dosyası) yerel sisteme
//  Hem komut satırı aracı (araclar/firebase-aktar.js) hem de yönetim
//  panelindeki "Veri Aktarımı" sayfası bu modülü kullanır.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { temizle } = require('./agac');

const FIREBASE = {
  apiKey: 'AIzaSyBKf0ze58oEbOcSVfPPdqX1ElTaxm7JN8E',
  databaseURL: 'https://primer-dental-default-rtdb.europe-west1.firebasedatabase.app',
};

// Ekranda gösterilecek Türkçe adlar
const KOLEKSIYON_ADLARI = {
  doctors: 'Hekimler',
  technicians: 'Teknisyenler',
  jobs: 'İşler / hasta kayıtları (arşiv dahil)',
  pendingJobs: 'Onay bekleyen işler',
  doctorSubmissions: 'Hekimden gelenler',
  orderForms: 'Sipariş formları',
  payments: 'Ödemeler / tahsilatlar (kasa)',
  expenses: 'Giderler (kasa)',
  sales: 'Satışlar',
  statementClosures: 'Hesap kapanışları (arşiv)',
  chats: 'Mesajlar',
  settings: 'Ayarlar',
  mailFilters: 'Mail filtreleri',
};
// Bir çalışma alanı verisinde bulunabilecek koleksiyonlar (format tanıma için)
const BILINEN = Object.keys(KOLEKSIYON_ADLARI);

async function firebaseIndir() {
  const g = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE.apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
  });
  const gj = await g.json().catch(() => ({}));
  const token = gj.idToken;
  const r = await fetch(`${FIREBASE.databaseURL}/.json${token ? '?auth=' + encodeURIComponent(token) : ''}`);
  if (!r.ok) throw new Error(`Firebase verisi indirilemedi (HTTP ${r.status}). Firebase kapatılmış olabilir; bunun yerine yedek dosyası yükleyin.`);
  const v = await r.json();
  if (!v) throw new Error('Firebase boş döndü (veri silinmiş ya da erişim kapatılmış olabilir).');
  return v;
}

// Eski formatlarda koleksiyonlar dizi olabilir → { id: kayıt } nesnesine çevir
function nesneyeCevir(v) {
  if (!Array.isArray(v)) return v;
  const o = {};
  v.forEach((x, i) => { if (x !== null && x !== undefined) o[x && x.id !== undefined ? x.id : i] = x; });
  return o;
}
function calismaAlaniTemizle(ws) {
  if (!ws || typeof ws !== 'object') return {};
  const n = {};
  for (const [k, v] of Object.entries(ws)) {
    if (k === 'pass') continue; // eski düz metin şifre — taşınmaz
    if (['activeDr', 'mails', 'readIds', 'open'].includes(k)) continue; // tarayıcıya özel geçici alanlar
    n[k] = (k === 'mailFilters' || k === 'settings') ? v : nesneyeCevir(v);
  }
  // Yerel veritabanı gibi boş değerleri ({}, [], null) temizle — aksi halde
  // aynı kayıtlar "farklı" görünür
  return temizle(n) || {};
}

// Her türlü yedek biçimini { calismaAlanlari: { digicad: {...}, primer: {...} }, meta } yapısına çevirir.
//  - Firebase konsolu tam dışa aktarım ({ db: { digicad, primer }, meta })
//  - Sadece /db dalı ({ digicad, primer })
//  - Tek çalışma alanı (/db/digicad dalı ya da panelin "Yedek İndir" dosyası) → hedef alana
//  - Bu sistemin kendi "Tam yedek" dosyası (aynı { db, meta } yapısı)
function bicimlendir(veri, hedef) {
  if (!veri || typeof veri !== 'object') throw new Error('Dosya geçerli bir yedek değil');
  let alanlar = null;
  if (veri.db && typeof veri.db === 'object') {
    alanlar = {};
    for (const [k, v] of Object.entries(veri.db)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && (k === 'digicad' || k === 'primer' || BILINEN.some(b => b in v))) alanlar[k] = v;
    }
    // Çok eski yapı: koleksiyonlar doğrudan /db altında
    if (!Object.keys(alanlar).length && BILINEN.some(b => b in veri.db)) alanlar = { digicad: veri.db };
  } else if ((veri.digicad || veri.primer) && !BILINEN.some(b => b in veri)) {
    alanlar = {};
    if (veri.digicad) alanlar.digicad = veri.digicad;
    if (veri.primer) alanlar.primer = veri.primer;
  } else if (BILINEN.some(b => b in veri)) {
    if (!hedef) throw new Error('Bu yedek tek bir çalışma alanına ait. Hedef (DIGICAD / Primer) seçin.');
    alanlar = { [hedef]: veri };
  }
  if (!alanlar || !Object.keys(alanlar).length) throw new Error('Dosyada tanınan bir veri bulunamadı (hekim, iş vb. yok)');
  const sonuc = {};
  for (const [k, v] of Object.entries(alanlar)) {
    if (k !== 'digicad' && k !== 'primer') continue;
    sonuc[k] = calismaAlaniTemizle(v);
  }
  if (!Object.keys(sonuc).length) throw new Error('Dosyada DIGICAD ya da Primer verisi bulunamadı');
  const eskiPin = (veri.meta && veri.meta.pass) || (veri.db && veri.db.digicad && veri.db.digicad.pass) || (veri.db && veri.db.pass) || null;
  return { calismaAlanlari: sonuc, eskiPin };
}

const esit = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Gelen veri ile yerel veriyi karşılaştırır
function ozetle(yerelKok, gelen) {
  const sonuc = {};
  for (const [ws, gelenWs] of Object.entries(gelen.calismaAlanlari)) {
    const yerelWs = (yerelKok.db && yerelKok.db[ws]) || {};
    const satirlar = [];
    const koleksiyonlar = [...new Set([...Object.keys(gelenWs), ...Object.keys(yerelWs)])]
      .filter(k => k !== 'pass')
      .sort((a, b) => (BILINEN.indexOf(a) + 1 || 99) - (BILINEN.indexOf(b) + 1 || 99));
    for (const k of koleksiyonlar) {
      const g = gelenWs[k], y = yerelWs[k];
      const satir = { anahtar: k, ad: KOLEKSIYON_ADLARI[k] || k, yerel: 0, gelen: 0, yeni: 0, ayni: 0, farkli: 0 };
      if (k === 'chats') {
        const say = o => Object.values(o || {}).reduce((t, s) => t + Object.keys((s && s.messages) || {}).length, 0);
        satir.yerel = say(y); satir.gelen = say(g); satir.birim = 'mesaj';
        for (const [tid, s] of Object.entries(g || {})) {
          for (const [mid, m] of Object.entries((s && s.messages) || {})) {
            const ym = y && y[tid] && y[tid].messages && y[tid].messages[mid];
            if (!ym) satir.yeni++; else if (esit(ym, m)) satir.ayni++; else satir.farkli++;
          }
        }
      } else if (g && typeof g === 'object' && !Array.isArray(g) && k !== 'settings') {
        satir.yerel = Object.keys(y || {}).length; satir.gelen = Object.keys(g).length;
        for (const [id, kayit] of Object.entries(g)) {
          const yk = y && y[id];
          if (yk === undefined || yk === null) satir.yeni++; else if (esit(yk, kayit)) satir.ayni++; else satir.farkli++;
        }
      } else {
        satir.yerel = y === undefined ? 0 : 1; satir.gelen = g === undefined ? 0 : 1; satir.birim = 'ayar';
        if (g !== undefined) { if (y === undefined) satir.yeni = 1; else if (esit(y, g)) satir.ayni = 1; else satir.farkli = 1; }
      }
      satirlar.push(satir);
    }
    sonuc[ws] = satirlar;
  }
  return sonuc;
}

// mod: 'birlestir' — sadece yerelde OLMAYAN kayıtları ekler; yereldeki kayıtlara dokunmaz.
//      'degistir'  — çalışma alanını tamamen gelen veriyle değiştirir.
// Dönüş: { [ws]: yeniCalismaAlaniVerisi }
function birlestir(yerelKok, gelen, mod) {
  const sonuc = {};
  for (const [ws, gelenWs] of Object.entries(gelen.calismaAlanlari)) {
    if (mod === 'degistir') { sonuc[ws] = JSON.parse(JSON.stringify(gelenWs)); continue; }
    const n = JSON.parse(JSON.stringify((yerelKok.db && yerelKok.db[ws]) || {}));
    for (const [k, g] of Object.entries(gelenWs)) {
      if (g === null || g === undefined) continue;
      if (k === 'chats') {
        n.chats = n.chats || {};
        for (const [tid, s] of Object.entries(g)) {
          if (!s || typeof s !== 'object') continue;
          if (!n.chats[tid]) { n.chats[tid] = s; continue; }
          for (const [ek, ev] of Object.entries(s)) {
            if (ek === 'messages') {
              n.chats[tid].messages = n.chats[tid].messages || {};
              for (const [mid, m] of Object.entries(ev || {})) if (!n.chats[tid].messages[mid]) n.chats[tid].messages[mid] = m;
            } else if (n.chats[tid][ek] === undefined) n.chats[tid][ek] = ev;
          }
        }
      } else if (typeof g === 'object' && !Array.isArray(g) && k !== 'settings') {
        n[k] = n[k] || {};
        for (const [id, kayit] of Object.entries(g)) if (n[k][id] === undefined || n[k][id] === null) n[k][id] = kayit;
      } else if (n[k] === undefined) {
        n[k] = g;
      }
    }
    sonuc[ws] = n;
  }
  return sonuc;
}

// ── Firebase Storage dosyalarını indirip bağlantıları yerel adrese çevirme ──
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
async function dosyaIndir(adres, dizin, dosyalarKlasoru) {
  const u = new URL(adres.replace(/&amp;/g, '&'));
  const depoYolu = decodeURIComponent(u.pathname.split('/o/')[1] || '');
  if (dizin[depoYolu]) return dizin[depoYolu].adres;
  const ad = guvenliAd(depoYolu.split('/').pop());
  let sonHata;
  for (let deneme = 1; deneme <= 3; deneme++) {
    try {
      const r = await fetch(u.toString());
      if (!r.ok) throw new Error(r.status === 404 ? 'Firebase\'de bulunamadı (silinmiş)' : 'HTTP ' + r.status);
      const belirtec = crypto.randomBytes(24).toString('base64url');
      const klasor = path.join(dosyalarKlasoru, belirtec);
      fs.mkdirSync(klasor, { recursive: true });
      await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(path.join(klasor, ad)));
      const yerel = `/dosya/${belirtec}/${encodeURIComponent(ad)}`;
      dizin[depoYolu] = { adres: yerel, boyut: fs.statSync(path.join(klasor, ad)).size, tarih: new Date().toISOString(), yukleyen: 'firebase-aktarim' };
      return yerel;
    } catch (e) {
      sonHata = e;
      if (/bulunamadı/.test(e.message)) break; // silinmiş dosyayı tekrar denemeye gerek yok
      await new Promise(c => setTimeout(c, 1000 * deneme));
    }
  }
  throw sonHata;
}

// Verideki tüm Firebase dosya bağlantılarını indirir, bağlantıları değiştirir.
async function dosyalariTasi(veri, dizin, dosyalarKlasoru, ilerleme = () => {}) {
  const adresler = new Set();
  dolas(veri, s => { for (const m of s.match(STORAGE_DESENI) || []) adresler.add(m); return s; });
  const liste = [...adresler];
  const eslesme = new Map(), basarisiz = [];
  let sira = 0, biten = 0;
  ilerleme(0, liste.length);
  async function isci() {
    while (sira < liste.length) {
      const a = liste[sira++];
      try { eslesme.set(a, await dosyaIndir(a, dizin, dosyalarKlasoru)); }
      catch (e) { basarisiz.push({ adres: a, hata: e.message }); }
      ilerleme(++biten, liste.length);
    }
  }
  await Promise.all([1, 2, 3, 4].map(isci));
  return { veri: adresleriDegistir(veri, eslesme), eslesme, toplam: liste.length, indirilen: eslesme.size, basarisiz };
}
function adresleriDegistir(veri, eslesme) {
  return dolas(veri, s => s.replace(STORAGE_DESENI, m => eslesme.get(m) || m));
}

module.exports = { firebaseIndir, bicimlendir, ozetle, birlestir, dosyalariTasi, adresleriDegistir, KOLEKSIYON_ADLARI, STORAGE_DESENI };
