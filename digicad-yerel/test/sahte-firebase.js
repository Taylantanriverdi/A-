'use strict';
// TEST YARDIMCISI — gerçek Firebase yerine sahte bir Firebase.
// `node -r ./test/sahte-firebase.js sunucu.js` ile yüklenir; global fetch'i
// değiştirir. Gerçek internete HİÇBİR istek gitmez. Gelen her istek
// SAHTE_FIREBASE_KAYIT dosyasına yazılır (testler yöntemleri kontrol eder).
const fs = require('fs');
const path = require('path');

const KAYIT = process.env.SAHTE_FIREBASE_KAYIT;
const VERI = path.join(__dirname, 'sahte-firebase-verisi.json');
const BUCKET = 'primer-dental.firebasestorage.app';
const url = p => `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(p)}?alt=media&token=t-${p.length}`;

const DOSYALAR = {
  'doctorScans/digicad/600/üst çene.stl': 'solid ust_cene\nendsolid',
  'chatFiles/digicad/job_100/foto.jpg': '\xff\xd8\xff sahte jpeg',
  'techDesigns/digicad/100/tasarim.stl': 'solid tasarim\nendsolid',
  'eski/sahipsiz-dosya.pdf': '%PDF-1.4 sahipsiz',
};
const SILINMIS = 'doctorScans/digicad/600/silinmis.stl';

function veriMetni() {
  const v = JSON.parse(fs.readFileSync(path.join(__dirname, 'ornek-veri.json'), 'utf8'));
  const w = v.db.digicad;
  w.doctorSubmissions['600'] = { id: 600, drId: 1, patient: 'Şükrü Öztürk', files: [
    { name: 'üst çene.stl', url: url('doctorScans/digicad/600/üst çene.stl') },
    { name: 'silinmis.stl', url: url(SILINMIS) },
  ] };
  w.jobs['100'].designFiles = [{ name: 'tasarim.stl', url: url('techDesigns/digicad/100/tasarim.stl') }];
  w.chats.job_100.messages.m7 = { id: 'm7', senderRole: 'doctor', fileUrl: url('chatFiles/digicad/job_100/foto.jpg'), fileName: 'foto.jpg' };
  w.payments = { p1: { id: 'p1', drId: 1, amount: 1000, currency: 'TRY' } };
  w.statementClosures = { s1: { id: 's1', drId: 2, period: '2026-10' } };
  v.db.primer = { sales: { x1: { id: 'x1', product: 'Frez', qty: 3 } } };
  // Firebase'in gönderdiği biçimi taklit: tek satır, özel sıralama
  return JSON.stringify(v);
}

function kaydet(yontem, adres) {
  if (KAYIT) fs.appendFileSync(KAYIT, JSON.stringify({ yontem, adres }) + '\n');
}

globalThis.fetch = async function sahteFetch(adres, secenek = {}) {
  const yontem = (secenek.method || 'GET').toUpperCase();
  const u = new URL(String(adres));
  kaydet(yontem, u.hostname + u.pathname);
  const yanit = (govde, durum = 200, basliklar = {}) => new Response(govde, { status: durum, headers: basliklar });

  if (u.hostname === 'identitytoolkit.googleapis.com') return yanit(JSON.stringify({ idToken: 'sahte-anahtar' }));
  if (u.hostname === 'primer-dental-default-rtdb.europe-west1.firebasedatabase.app') {
    if (yontem !== 'GET') return yanit('{"error":"yazma"}', 400);
    if (!u.searchParams.get('auth')) return yanit('{"error":"Permission denied"}', 401);
    let m = veriMetni();
    // Belirli bir dal istendiyse (ör. /db/digicad/doctorSubmissions.json) yalnızca o dal
    const dal = decodeURIComponent(u.pathname.replace(/\.json$/, '')).split('/').filter(Boolean);
    if (dal.length) {
      let v = JSON.parse(m);
      if (process.env.SAHTE_FIREBASE_EK) { // testlerin eklediği yeni kayıtlar
        const ek = JSON.parse(fs.readFileSync(process.env.SAHTE_FIREBASE_EK, 'utf8'));
        Object.assign(v.db.digicad.doctorSubmissions, ek);
      }
      for (const p of dal) v = v && typeof v === 'object' ? v[p] : undefined;
      m = JSON.stringify(v === undefined ? null : v);
    }
    return yanit(m, 200, { 'content-type': 'application/json' });
  }
  if (u.hostname === 'firebasestorage.googleapis.com') {
    if (yontem !== 'GET') return yanit('{}', 400);
    const parca = u.pathname.split('/o/')[1];
    if (u.pathname.endsWith('/o') || u.pathname.endsWith('/o/')) {
      return yanit(JSON.stringify({ items: [...Object.keys(DOSYALAR), SILINMIS].map(name => ({ name, bucket: BUCKET })) }));
    }
    const depoYolu = decodeURIComponent(parca || '');
    if (!(depoYolu in DOSYALAR)) return yanit('Not found', 404);
    const b = Buffer.from(DOSYALAR[depoYolu], 'latin1');
    return yanit(b, 200, { 'content-length': String(b.length) });
  }
  throw new Error('SAHTE FIREBASE: gerçek ağa çıkış engellendi → ' + u.hostname);
};
globalThis.fetch.sahte = true;
module.exports = { DOSYALAR, veriMetni };
