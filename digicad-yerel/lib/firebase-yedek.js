'use strict';
// ═══════════════════════════════════════════════════════════════════
//  FIREBASE TAM YEDEĞİ (salt-okunur)
//  Eski sistemin veritabanını ve tüm dosyalarını bu bilgisayardaki bir
//  klasöre kopyalar. Firebase'e yalnızca okuma isteği gönderilir
//  (bkz. lib/firebase-okuyucu.js).
//
//  Oluşan klasör (veri/firebase-yedekleri/2026-11-05_16-30/):
//    veritabani.json   Firebase'in gönderdiği veri, HİÇ DEĞİŞTİRİLMEDEN
//    dosyalar/...      Tüm dosyalar, Firebase'deki klasör yapısıyla
//    dosya-listesi.json Her dosyanın boyutu, SHA-256 özeti, hangi bağlantıdan geldiği
//    bilgi.json        Özet (sayılar, sağlama değerleri) — program okur
//    OZET.txt          Aynı özetin okunabilir hâli
//  Yedek tamamlanınca tüm dosyalar SALT-OKUNUR yapılır.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const okuyucu = require('./firebase-okuyucu');

const STORAGE_DESENI = /https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/\s"'<>]+\/o\/[^\s"'<>)]+/g;
const ADLAR = {
  doctors: 'Hekim', technicians: 'Teknisyen', jobs: 'İş / hasta kaydı', pendingJobs: 'Onay bekleyen iş',
  doctorSubmissions: 'Hekimden gelen', orderForms: 'Sipariş formu', payments: 'Ödeme (kasa)',
  expenses: 'Gider (kasa)', sales: 'Satış', statementClosures: 'Hesap kapanışı (arşiv)', chats: 'Mesaj dizisi',
};

const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const zamanDamgasi = () => {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};
// Windows'ta geçersiz karakterleri temizler (her klasör/dosya adı için)
const guvenliParca = s => (String(s).replace(/[\\:*?"<>|\x00-\x1f]/g, '_').replace(/[. ]+$/, '_').slice(0, 120)) || '_';

function adresleriTopla(v, kume) {
  if (typeof v === 'string') { for (const m of v.match(STORAGE_DESENI) || []) kume.add(m); return; }
  if (v && typeof v === 'object') for (const k of Object.keys(v)) adresleriTopla(v[k], kume);
}
function depoYoluBul(adres) {
  try { return decodeURIComponent(new URL(adres.replace(/&amp;/g, '&')).pathname.split('/o/')[1] || ''); } catch (e) { return ''; }
}

function sayilar(veri) {
  const s = {};
  const alanlar = veri && veri.db && typeof veri.db === 'object' ? veri.db : {};
  for (const [ws, v] of Object.entries(alanlar)) {
    if (!v || typeof v !== 'object' || !['digicad', 'primer'].includes(ws)) continue;
    s[ws] = {};
    for (const k of Object.keys(ADLAR)) if (v[k] && typeof v[k] === 'object') s[ws][k] = Object.keys(v[k]).length;
  }
  return s;
}

function saltOkunurYap(klasor) {
  for (const g of fs.readdirSync(klasor, { withFileTypes: true })) {
    const t = path.join(klasor, g.name);
    if (g.isDirectory()) saltOkunurYap(t); else fs.chmodSync(t, 0o444);
  }
}

async function yedekAl({ kokKlasor, ilerleme = () => {} }) {
  const ad = zamanDamgasi();
  const hedef = path.join(kokKlasor, ad);
  const gecici = hedef + '.yarim';
  fs.mkdirSync(path.join(gecici, 'dosyalar'), { recursive: true });
  try {
    // 1) Veritabanı — ham metin olarak, olduğu gibi
    ilerleme({ asama: 'Firebase veritabanı okunuyor…' });
    const { metin, yontem } = await okuyucu.veritabaniniOku();
    const veri = JSON.parse(metin); // sadece geçerli JSON olduğunu doğrulamak ve saymak için
    fs.writeFileSync(path.join(gecici, 'veritabani.json'), metin, 'utf8');
    const dbOzet = sha256(Buffer.from(metin, 'utf8'));
    if (sha256(fs.readFileSync(path.join(gecici, 'veritabani.json'))) !== dbOzet) throw new Error('Veritabanı dosyası diske doğru yazılamadı');

    // 2) Dosya listesi: veritabanındaki bağlantılar + (izin varsa) depodaki tüm dosyalar
    ilerleme({ asama: 'Dosya listesi çıkarılıyor…' });
    const adresler = new Set();
    adresleriTopla(veri, adresler);
    const dosyalar = new Map(); // depoYolu -> { adresler: [] }
    for (const a of adresler) {
      const y = depoYoluBul(a);
      if (!y) continue;
      if (!dosyalar.has(y)) dosyalar.set(y, { adresler: [] });
      dosyalar.get(y).adresler.push(a);
    }
    const liste = await okuyucu.depoListesi().catch(() => null);
    if (liste) for (const y of liste) if (!dosyalar.has(y)) dosyalar.set(y, { adresler: [], sadeceDepoda: true });

    // 3) Dosyaları indir — her biri için boyut ve SHA-256 kontrolü
    const kayitlar = [];
    const isler = [...dosyalar.entries()];
    let sira = 0, biten = 0;
    ilerleme({ asama: 'Dosyalar indiriliyor…', dosya: { biten: 0, toplam: isler.length } });
    async function isci() {
      while (sira < isler.length) {
        const [depoYolu, bilgi] = isler[sira++];
        const goreli = path.join('dosyalar', ...depoYolu.split('/').filter(Boolean).map(guvenliParca));
        const kayit = { depoYolu, dosya: goreli.split(path.sep).join('/'), adresler: bilgi.adresler, sadeceDepoda: !!bilgi.sadeceDepoda };
        let sonHata = null;
        for (let deneme = 1; deneme <= 3; deneme++) {
          try {
            const r = await okuyucu.dosyaOku(depoYolu, bilgi.adresler[0]);
            if (!r.ok) throw new Error(r.status === 404 ? 'Firebase\'de bulunamadı (silinmiş)' : 'HTTP ' + r.status);
            const beklenen = Number(r.headers.get('content-length') || 0);
            const tam = path.join(gecici, goreli);
            fs.mkdirSync(path.dirname(tam), { recursive: true });
            const h = crypto.createHash('sha256');
            let boyut = 0;
            const sayac = new Transform({ transform(p, e, cb) { h.update(p); boyut += p.length; cb(null, p); } });
            await pipeline(Readable.fromWeb(r.body), sayac, fs.createWriteStream(tam));
            if (beklenen && beklenen !== boyut) throw new Error(`Eksik indirildi (${boyut}/${beklenen} bayt)`);
            kayit.boyut = boyut; kayit.sha256 = h.digest('hex'); kayit.durum = 'tamam';
            sonHata = null;
            break;
          } catch (e) {
            sonHata = e;
            if (/bulunamadı/.test(e.message)) break;
            await new Promise(c => setTimeout(c, 1000 * deneme));
          }
        }
        if (sonHata) { kayit.durum = 'hata'; kayit.hata = sonHata.message; }
        kayitlar.push(kayit);
        ilerleme({ asama: 'Dosyalar indiriliyor…', dosya: { biten: ++biten, toplam: isler.length } });
      }
    }
    await Promise.all([1, 2, 3, 4].map(isci));
    kayitlar.sort((a, b) => a.depoYolu.localeCompare(b.depoYolu));
    fs.writeFileSync(path.join(gecici, 'dosya-listesi.json'), JSON.stringify(kayitlar, null, 1));

    // 4) Özet
    const tamam = kayitlar.filter(k => k.durum === 'tamam');
    const hatali = kayitlar.filter(k => k.durum !== 'tamam');
    const bilgi = {
      surum: 1,
      ad,
      tarih: new Date().toISOString(),
      kaynak: okuyucu.FIREBASE.databaseURL,
      okumaYontemi: yontem,
      depoListesiAlindi: !!liste,
      veritabani: { dosya: 'veritabani.json', boyut: Buffer.byteLength(metin, 'utf8'), sha256: dbOzet },
      sayilar: sayilar(veri),
      dosyalar: { toplam: kayitlar.length, tamam: tamam.length, hatali: hatali.length, toplamBoyut: tamam.reduce((t, k) => t + k.boyut, 0) },
    };
    fs.writeFileSync(path.join(gecici, 'bilgi.json'), JSON.stringify(bilgi, null, 2));
    const satirlar = [
      'DIGICAD DENTAL — FIREBASE (ESKİ SİSTEM) TAM YEDEĞİ',
      '='.repeat(55),
      `Tarih            : ${new Date().toLocaleString('tr-TR')}`,
      `Kaynak           : ${bilgi.kaynak}`,
      `Okuma            : ${yontem} (Firebase'e yalnızca okuma isteği gönderildi)`,
      `veritabani.json  : ${bilgi.veritabani.boyut} bayt`,
      `SHA-256          : ${dbOzet}`,
      '',
      ...Object.entries(bilgi.sayilar).flatMap(([ws, s]) => [
        ws === 'digicad' ? 'DIGICAD Dental:' : 'Primer Teknoloji:',
        ...Object.entries(s).map(([k, n]) => `  ${(ADLAR[k] || k).padEnd(26)} ${n}`),
      ]),
      '',
      `Dosyalar         : ${tamam.length} / ${kayitlar.length} indirildi (${(bilgi.dosyalar.toplamBoyut / 1048576).toFixed(1)} MB)`,
      liste ? '                   (Firebase deposundaki tüm dosyalar listelendi)' : '                   (Depo listesi alınamadı — veritabanında bağlantısı olan dosyalar yedeklendi)',
      ...(hatali.length ? ['', 'İNDİRİLEMEYEN DOSYALAR:', ...hatali.map(k => `  ${k.depoYolu}  →  ${k.hata}`)] : []),
      '',
      'Bu klasördeki dosyalar salt-okunurdur. Değiştirmeyin; yeni sisteme yüklemek için',
      'yönetim panelindeki "Veri Aktarımı" sayfasını kullanın.',
    ];
    fs.writeFileSync(path.join(gecici, 'OZET.txt'), '﻿' + satirlar.join('\r\n'), 'utf8');

    // 5) Tamamlandı: klasörü asıl adına çevir ve salt-okunur yap
    fs.renameSync(gecici, hedef);
    saltOkunurYap(hedef);
    return { ...bilgi, klasor: hedef, hatali };
  } catch (e) {
    // Yarım kalan yedek klasörünü bırakma (Firebase'e dokunulmadı)
    try { fs.rmSync(gecici, { recursive: true, force: true }); } catch (x) { /* yoksay */ }
    throw e;
  }
}

// Mevcut yedeklerin listesi
function yedekleriListele(kokKlasor) {
  if (!fs.existsSync(kokKlasor)) return [];
  return fs.readdirSync(kokKlasor, { withFileTypes: true })
    .filter(g => g.isDirectory() && /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(g.name))
    .map(g => { try { return JSON.parse(fs.readFileSync(path.join(kokKlasor, g.name, 'bilgi.json'), 'utf8')); } catch (e) { return null; } })
    .filter(Boolean)
    .sort((a, b) => (a.ad < b.ad ? 1 : -1));
}

// Bir yedeği okur, bütünlüğünü doğrular; veriyi ve adres→yerel dosya eşlemesini döner
function yedegiOku(kokKlasor, ad) {
  if (!/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/.test(String(ad))) throw new Error('Geçersiz yedek adı');
  const klasor = path.join(kokKlasor, ad);
  const bilgi = JSON.parse(fs.readFileSync(path.join(klasor, 'bilgi.json'), 'utf8'));
  const metin = fs.readFileSync(path.join(klasor, 'veritabani.json'), 'utf8');
  if (sha256(Buffer.from(metin, 'utf8')) !== bilgi.veritabani.sha256) {
    throw new Error('Yedeğin veritabani.json dosyası değişmiş ya da bozulmuş (SHA-256 tutmuyor). Bu yedek yüklenmedi.');
  }
  const liste = JSON.parse(fs.readFileSync(path.join(klasor, 'dosya-listesi.json'), 'utf8'));
  const yerelDosyalar = new Map(); // indirme adresi -> { yol, depoYolu }
  for (const k of liste) {
    if (k.durum !== 'tamam') continue;
    const yol = path.join(klasor, ...k.dosya.split('/'));
    for (const a of k.adresler) yerelDosyalar.set(a, { yol, depoYolu: k.depoYolu });
  }
  return { veri: JSON.parse(metin), bilgi, yerelDosyalar };
}

module.exports = { yedekAl, yedekleriListele, yedegiOku };
