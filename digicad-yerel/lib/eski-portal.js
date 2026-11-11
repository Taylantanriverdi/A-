'use strict';
// ═══════════════════════════════════════════════════════════════════
//  ESKİ HEKİM PORTALI KÖPRÜSÜ
//  Bazı hekimler eski adresi (github.io — Firebase'e yazan eski portal)
//  kullanmaya devam edebilir. O portal işi Firebase'e kaydedip "gönderildi"
//  der; iş yeni sisteme hiç gelmez. Bu köprü Firebase'deki hekim
//  gönderimlerini birkaç dakikada bir OKUR ve yeni sistemde olmayanları
//  yerel veritabanına ekler (tarama dosyalarını da indirir).
//
//  Firebase'e yalnızca okuma isteği gider (lib/firebase-okuyucu.js);
//  Firebase'deki hiçbir kayıt değiştirilmez ya da silinmez.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const okuyucu = require('./firebase-okuyucu');
const aktarim = require('./aktarim');
const agac = require('./agac');

const ALAN = 'digicad';
const GUN = 864e5;

function durumDosyasi(veriKlasoru) { return path.join(veriKlasoru, 'eski-portal.json'); }
function durumOku(veriKlasoru) {
  try { return { aktarilan: [], gizlenen: [], ...JSON.parse(fs.readFileSync(durumDosyasi(veriKlasoru), 'utf8')) }; }
  catch (e) { return { aktarilan: [], gizlenen: [] }; }
}
function durumYaz(veriKlasoru, d) {
  d.aktarilan = d.aktarilan.slice(-5000); d.gizlenen = d.gizlenen.slice(-5000);
  fs.writeFileSync(durumDosyasi(veriKlasoru) + '.tmp', JSON.stringify(d));
  fs.renameSync(durumDosyasi(veriKlasoru) + '.tmp', durumDosyasi(veriKlasoru));
}

// Firebase'de olup yeni sistemde karşılığı olmayan hekim gönderimleri
async function adaylar(kok, veriKlasoru) {
  const uzak = await okuyucu.yolOku(`db/${ALAN}/doctorSubmissions`);
  const yerelGonderim = agac.al(kok, ['db', ALAN, 'doctorSubmissions']) || {};
  const bagli = new Set();
  for (const kol of ['jobs', 'pendingJobs']) {
    for (const j of Object.values(agac.al(kok, ['db', ALAN, kol]) || {})) if (j && j.sourceDoctorSubmissionId != null) bagli.add(String(j.sourceDoctorSubmissionId));
  }
  const d = durumOku(veriKlasoru);
  const atla = new Set([...d.aktarilan, ...d.gizlenen].map(String));
  const yerelIdler = new Set(Object.values(yerelGonderim).filter(Boolean).map(s => String(s.id)).concat(Object.keys(yerelGonderim)));
  const liste = [];
  for (const [anahtar, s] of Object.entries(uzak && typeof uzak === 'object' ? uzak : {})) {
    if (!s || typeof s !== 'object') continue;
    const id = String(s.id != null ? s.id : anahtar);
    if (yerelIdler.has(id) || yerelIdler.has(anahtar) || bagli.has(id) || atla.has(id)) continue;
    liste.push({ anahtar, id, kayit: s });
  }
  return liste.sort((a, b) => String(b.kayit.createdAt || '').localeCompare(String(a.kayit.createdAt || '')));
}

// Seçilen gönderimleri yerel veritabanına alır. Dönüş: alınan kayıtların id listesi
async function al(secilenler, { kok, veriKlasoru, dosyaDizini, dosyalarKlasoru, uygula, dizinKaydet }) {
  if (!secilenler.length) return { alinan: [], indirilemeyen: 0 };
  const veri = {};
  for (const a of secilenler) veri[a.anahtar] = { ...a.kayit, eskiPortaldan: true };
  // Tarama dosyalarını Firebase'den indir (okuma), bağlantıları yerel adrese çevir
  const sonuc = await aktarim.dosyalariTasi(veri, dosyaDizini, dosyalarKlasoru, () => {}, null);
  dizinKaydet();
  const yeni = sonuc.veri;
  // Bu arada (indirme sürerken) aynı iş yerelde oluşmuşsa üzerine yazma
  const mevcut = agac.al(kok(), ['db', ALAN, 'doctorSubmissions']) || {};
  const islemler = Object.entries(yeni).filter(([k]) => !mevcut[k]).map(([k, v]) => ({ parcalar: ['db', ALAN, 'doctorSubmissions', k], deger: v }));
  uygula(islemler);
  const d = durumOku(veriKlasoru);
  for (const a of secilenler) d.aktarilan.push(a.id);
  durumYaz(veriKlasoru, d);
  return { alinan: islemler.map(i => i.parcalar[3]), indirilemeyen: sonuc.basarisiz.length };
}

function gizle(veriKlasoru, idler) {
  const d = durumOku(veriKlasoru);
  for (const id of idler) if (!d.gizlenen.includes(String(id))) d.gizlenen.push(String(id));
  durumYaz(veriKlasoru, d);
}

// Otomatik alınacaklar: köprü açıldığından en çok 14 gün önce gönderilmiş olanlar.
// (Daha eskiler yönetim panelinde listelenir; elle alınır ya da gizlenir.)
function otomatikSecilir(a, baslangic) {
  const t = Date.parse(a.kayit.createdAt || '');
  return Number.isFinite(t) && t >= Date.parse(baslangic) - 14 * GUN;
}

module.exports = { adaylar, al, gizle, otomatikSecilir, durumOku };
