'use strict';
// ═══════════════════════════════════════════════════════════════════
//  DIGICAD Dental — YEREL SUNUCU
//  Firebase'in yerine geçer: veriler ve dosyalar bu bilgisayarda durur.
//  Hiçbir ek paket gerektirmez (sadece Node.js).
//
//  İki kapı (port) açar:
//    İÇ KAPI  (varsayılan 8080) — laboratuvar ağı. Yönetim paneli, Gelen
//             İşler paneli, Teknisyen ve Hekim portalları.
//    DIŞ KAPI (varsayılan 8081, sadece bu bilgisayardan erişilebilir) —
//             internet tüneli (Tailscale Funnel / Cloudflare Tunnel) BURAYA
//             bağlanır. Sadece Hekim ve Teknisyen portallarını sunar;
//             yönetim paneline dışarıdan erişim İMKÂNSIZDIR.
// ═══════════════════════════════════════════════════════════════════

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const agac = require('./lib/agac');
const Depo = require('./lib/depo');
const yetki = require('./lib/yetki');
const aktarim = require('./lib/aktarim');
const firebaseYedek = require('./lib/firebase-yedek');
const yazdirma = require('./lib/yazdirma');

const KOK = __dirname;
const GENEL = path.join(KOK, 'public');
const VERI = process.env.DIGICAD_VERI || path.join(KOK, 'veri');
const DOSYALAR = path.join(VERI, 'dosyalar');
const AYAR_DOSYASI = path.join(VERI, 'ayarlar.json');
const OTURUM_DOSYASI = path.join(VERI, 'oturumlar.json');
const DOSYA_DIZINI = path.join(VERI, 'dosya-dizini.json');
const FIREBASE_YEDEKLERI = path.join(VERI, 'firebase-yedekleri');
fs.mkdirSync(DOSYALAR, { recursive: true });

// ── AYARLAR ─────────────────────────────────────────────────────────
const VARSAYILAN_AYARLAR = {
  icPort: 8080,
  icAdres: '0.0.0.0',
  disPort: 8081,
  disAdres: '127.0.0.1',
  yoneticiYalnizcaYerelAg: true,
  maksDosyaMB: 500,
  yedekKlasoru: '',
  pin: null,
};
function ayarlariOku() {
  let a = {};
  if (fs.existsSync(AYAR_DOSYASI)) a = JSON.parse(fs.readFileSync(AYAR_DOSYASI, 'utf8'));
  return { ...VARSAYILAN_AYARLAR, ...a };
}
function ayarlariYaz(a) {
  fs.writeFileSync(AYAR_DOSYASI + '.tmp', JSON.stringify(a, null, 2));
  fs.renameSync(AYAR_DOSYASI + '.tmp', AYAR_DOSYASI);
}
let ayarlar = ayarlariOku();

const ozet = s => crypto.createHash('sha256').update(String(s)).digest();
const esitMi = (a, b) => { const x = ozet(a), y = ozet(b); return crypto.timingSafeEqual(x, y); };

function pinOzetle(pin, tuz = crypto.randomBytes(16).toString('hex')) {
  return { tuz, ozet: crypto.scryptSync(String(pin), tuz, 64).toString('hex') };
}
function pinDogruMu(pin) {
  if (!ayarlar.pin) return false;
  const h = crypto.scryptSync(String(pin), ayarlar.pin.tuz, 64);
  return crypto.timingSafeEqual(h, Buffer.from(ayarlar.pin.ozet, 'hex'));
}
const pinGecerliMi = pin => /^\d{4}$/.test(String(pin || ''));

// ── VERİTABANI ve DOSYA DİZİNİ ──────────────────────────────────────
const depo = new Depo(VERI);
let dosyaDizini = fs.existsSync(DOSYA_DIZINI) ? JSON.parse(fs.readFileSync(DOSYA_DIZINI, 'utf8')) : {};
function dosyaDiziniKaydet() {
  fs.writeFileSync(DOSYA_DIZINI + '.tmp', JSON.stringify(dosyaDizini));
  fs.renameSync(DOSYA_DIZINI + '.tmp', DOSYA_DIZINI);
}

// ── OTURUMLAR ───────────────────────────────────────────────────────
// Çerezdeki rastgele anahtar tarayıcıda kalır; sunucu sadece özetini saklar.
const SURE = { yonetici: 12 * 3600e3, hekim: 30 * 24 * 3600e3, teknisyen: 30 * 24 * 3600e3 };
const CEREZ_ADI = { yonetici: 'dl_yonetici', hekim: 'dl_hekim', teknisyen: 'dl_teknisyen' };
let oturumlar = fs.existsSync(OTURUM_DOSYASI) ? JSON.parse(fs.readFileSync(OTURUM_DOSYASI, 'utf8')) : {};
let oturumKayitZamanlayici = null;
function oturumlariHemenKaydet() {
  if (oturumKayitZamanlayici) { clearTimeout(oturumKayitZamanlayici); oturumKayitZamanlayici = null; }
  fs.writeFileSync(OTURUM_DOSYASI + '.tmp', JSON.stringify(oturumlar));
  fs.renameSync(OTURUM_DOSYASI + '.tmp', OTURUM_DOSYASI);
}
function oturumlariKaydet() {
  if (oturumKayitZamanlayici) return;
  oturumKayitZamanlayici = setTimeout(oturumlariHemenKaydet, 1000);
}
const anahtarOzeti = t => ozet(t).toString('hex');

function kisiKayitlari(rol) {
  const kol = rol === 'hekim' ? 'doctors' : 'technicians';
  return Object.values(depo.oku(['db', yetki.CALISMA_ALANI, kol]) || {}).filter(Boolean);
}
const sifreIzi = k => ozet((k.username || '').toLowerCase() + '\n' + (k.password || '')).toString('hex');

function oturumAc(rol, id, iz) {
  const anahtar = crypto.randomBytes(32).toString('base64url');
  oturumlar[anahtarOzeti(anahtar)] = { rol, id, iz: iz || null, son: Date.now() };
  oturumlariHemenKaydet();
  return anahtar;
}

// Oturum hâlâ geçerli mi? (süre, kişi silinmiş mi, şifresi değişmiş mi)
function oturumGetir(anahtar, rol) {
  if (!anahtar) return null;
  const h = anahtarOzeti(anahtar);
  const o = oturumlar[h];
  if (!o || o.rol !== rol) return null;
  if (Date.now() - o.son > SURE[o.rol]) { delete oturumlar[h]; oturumlariKaydet(); return null; }
  if (o.rol !== 'yonetici') {
    const k = kisiKayitlari(o.rol).find(x => yetki.ayni(x.id, o.id));
    if (!k || !k.password || sifreIzi(k) !== o.iz) { delete oturumlar[h]; oturumlariKaydet(); return null; }
  }
  if (Date.now() - o.son > 60e3) { o.son = Date.now(); oturumlariKaydet(); }
  return { rol: o.rol, id: o.id };
}
function oturumKapat(anahtar) {
  if (!anahtar) return;
  delete oturumlar[anahtarOzeti(anahtar)];
  oturumlariKaydet();
}
setInterval(() => {
  let degisti = false;
  for (const [h, o] of Object.entries(oturumlar)) {
    if (Date.now() - o.son > SURE[o.rol]) { delete oturumlar[h]; degisti = true; }
  }
  if (degisti) oturumlariKaydet();
}, 3600e3).unref();

// ── GİRİŞ DENEME SINIRI ─────────────────────────────────────────────
// 5 hatalı denemeden sonra 15 dakika kilit (hem kullanıcı adı hem kapı başına)
const denemeler = new Map();
const KILIT_DENEME = 5, KILIT_SURE = 15 * 60e3;
function kilitliMi(anahtar) {
  const d = denemeler.get(anahtar);
  if (!d) return 0;
  if (d.kilit && d.kilit > Date.now()) return Math.ceil((d.kilit - Date.now()) / 60e3);
  if (d.kilit) denemeler.delete(anahtar);
  return 0;
}
function hataliDeneme(anahtar) {
  const d = denemeler.get(anahtar) || { sayi: 0, kilit: 0 };
  d.sayi++;
  if (d.sayi >= KILIT_DENEME) { d.kilit = Date.now() + KILIT_SURE; d.sayi = 0; }
  denemeler.set(anahtar, d);
}

// ── YARDIMCILAR ─────────────────────────────────────────────────────
function cerezleriOku(req) {
  const c = {};
  for (const parca of (req.headers.cookie || '').split(';')) {
    const i = parca.indexOf('=');
    if (i > 0) c[parca.slice(0, i).trim()] = decodeURIComponent(parca.slice(i + 1).trim());
  }
  return c;
}
function httpsMi(req) { return (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'; }
function cerezYaz(res, req, ad, deger, sureMs) {
  const parcalar = [`${ad}=${deger ? encodeURIComponent(deger) : ''}`, 'Path=/', 'HttpOnly', 'SameSite=Strict',
    deger ? `Max-Age=${Math.floor(sureMs / 1000)}` : 'Max-Age=0'];
  if (httpsMi(req)) parcalar.push('Secure');
  const mevcut = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', [].concat(mevcut || [], parcalar.join('; ')));
}
function guvenlikBasliklari(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // Google ile giriş (Gmail) açılır penceresinin sonucu panele iletebilmesi için
  // 'same-origin-allow-popups' gerekir; 'same-origin' bu pencereyi koparır.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
}
function json(res, durum, veri) {
  const govde = JSON.stringify(veri);
  res.writeHead(durum, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(govde);
}
function govdeOku(req, sinir) {
  return new Promise((coz, reddet) => {
    const parcalar = []; let boyut = 0;
    req.on('data', p => {
      boyut += p.length;
      if (boyut > sinir) { reddet(Object.assign(new Error('İstek çok büyük'), { durum: 413 })); req.destroy(); return; }
      parcalar.push(p);
    });
    req.on('end', () => coz(Buffer.concat(parcalar)));
    req.on('error', reddet);
  });
}
async function jsonOku(req) {
  if (!/^application\/json/.test(req.headers['content-type'] || '')) throw Object.assign(new Error('JSON bekleniyor'), { durum: 415 });
  const b = await govdeOku(req, 200 * 1024 * 1024);
  return b.length ? JSON.parse(b.toString('utf8')) : {};
}
function ipAdresi(req) { return (req.socket.remoteAddress || '').replace(/^::ffff:/, ''); }
// Deneme sınırı için istemci adresi: tünelden gelenlerin hepsi 127.0.0.1 görünür,
// bu yüzden dış kapıda tünelin bildirdiği gerçek adres kullanılır (kullanıcı adı
// başına sınır ayrıca her zaman geçerlidir).
function istemciAdresi(req, kapi) {
  if (kapi !== 'dis') return ipAdresi(req);
  const b = req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return b || ipAdresi(req);
}
function yerelAgMi(ip) {
  return ip === '127.0.0.1' || ip === '::1' || /^10\./.test(ip) || /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) || /^f[cd][0-9a-f]{2}:/i.test(ip) || /^fe80:/i.test(ip);
}
// Bir tünel/vekil üzerinden mi gelmiş? (yönetici girişi için ek güvenlik)
function vekilUzerindenMi(req) {
  return ['x-forwarded-for', 'forwarded', 'cf-connecting-ip', 'tailscale-funnel-request', 'x-real-ip', 'cf-ray']
    .some(b => req.headers[b] !== undefined);
}

const PANELLER = ['yonetici', 'hekim', 'teknisyen'];

// ── STATİK DOSYALAR ─────────────────────────────────────────────────
const TURLER = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.pdf': 'application/pdf', '.stl': 'model/stl',
  '.gif': 'image/gif', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.zip': 'application/zip',
};
// Dış kapıdan (internet) sadece bunlar açılabilir
const DIS_SAYFALAR = /^\/(dis-index\.html|HekimPortali(Mobil)?\.html|TeknisyenPaneli(Mobil)?\.html|firebase-yerel\.js|jszip\.min\.js|sw\.js|favicon\.ico|hekim\.webmanifest|simge-(192|512)\.png)$/;

function statikSun(req, res, kapi) {
  let yol = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (yol === '/') yol = kapi === 'dis' ? '/dis-index.html' : '/index.html';
  if (kapi === 'dis' && !DIS_SAYFALAR.test(yol)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Bulunamadı'); return; }
  const tam = path.normalize(path.join(GENEL, yol));
  if (!tam.startsWith(GENEL + path.sep)) { res.writeHead(400); res.end(); return; }
  fs.stat(tam, (hata, st) => {
    if (hata || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Bulunamadı'); return; }
    res.writeHead(200, {
      'Content-Type': TURLER[path.extname(tam).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(tam).pipe(res);
  });
}

// ── YÜKLENEN DOSYALARI SUNMA ────────────────────────────────────────
function dosyaSun(req, res, oturumVarMi) {
  if (!oturumVarMi) { res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Dosyayı görmek için giriş yapın'); return; }
  const m = /^\/dosya\/([A-Za-z0-9_-]{20,})\/([^/]+)$/.exec(new URL(req.url, 'http://x').pathname);
  if (!m) { res.writeHead(404); res.end(); return; }
  const klasor = path.join(DOSYALAR, m[1]);
  let ad;
  try { ad = fs.readdirSync(klasor)[0]; } catch (e) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Bulunamadı'); return; }
  if (!ad) { res.writeHead(404); res.end(); return; }
  const tam = path.join(klasor, ad);
  const st = fs.statSync(tam);
  const uzanti = path.extname(ad).toLowerCase();
  const tur = TURLER[uzanti] || 'application/octet-stream';
  // Resim ve PDF tarayıcıda açılır; diğer her şey (özellikle html/svg) indirilir
  const satirIci = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(tur);
  res.writeHead(200, {
    'Content-Type': satirIci ? tur : 'application/octet-stream',
    'Content-Length': st.size,
    'Content-Disposition': indirmeBasligi(ad, satirIci ? 'inline' : 'attachment'),
    'Cache-Control': 'private, max-age=86400',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  });
  fs.createReadStream(tam).pipe(res);
}

// İndirme başlığı: Türkçe karakterli ad (filename*) + eski tarayıcılar için sadeleştirilmiş ad (filename)
function indirmeBasligi(ad, tur = 'attachment') {
  const sade = String(ad).replace(/[çÇğĞıİöÖşŞüÜ]/g, c => ({ ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I', ö: 'o', Ö: 'O', ş: 's', Ş: 'S', ü: 'u', Ü: 'U' }[c]))
    .replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${tur}; filename="${sade}"; filename*=UTF-8''${encodeURIComponent(ad)}`;
}

function guvenliDosyaAdi(ad) {
  let s = String(ad || 'dosya').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '').slice(-150);
  return s || 'dosya';
}

// ── CANLI BAĞLANTILAR (Server-Sent Events) ──────────────────────────
// Tarayıcı /api/akis adresine tek bir uzun bağlantı açar; abone olduğu
// yollardaki değişiklikler bu bağlantıdan anında gönderilir.
const baglantilar = new Map(); // id -> { res, panel, anahtar, kapi, abonelikler: Map }

function olayGonder(b, olay, veri) {
  b.res.write(`event: ${olay}\ndata: ${JSON.stringify(veri)}\n\n`);
}
function aboneDegeriGonder(b, abone, oturum) {
  let deger, hata = null;
  try { deger = agac.sorguUygula(yetki.oku(depo.kok, oturum, abone.parcalar), abone.sorgu); }
  catch (e) { hata = e.message; deger = null; }
  const metin = JSON.stringify(deger === undefined ? null : deger);
  if (metin === abone.son && !hata) return;
  abone.son = metin;
  b.res.write(`event: veri\ndata: {"abone":${JSON.stringify(abone.id)},"deger":${metin}${hata ? ',"hata":' + JSON.stringify(hata) : ''}}\n\n`);
}

let bekleyenDegisiklikler = [];
let yayinPlanli = false;
depo.on('degisti', yollar => {
  bekleyenDegisiklikler.push(...yollar);
  if (yayinPlanli) return;
  yayinPlanli = true;
  setTimeout(() => {
    yayinPlanli = false;
    const degisen = bekleyenDegisiklikler; bekleyenDegisiklikler = [];
    for (const b of baglantilar.values()) {
      const oturum = oturumGetir(b.anahtar, b.panel);
      if (b.anahtar && !oturum) { olayGonder(b, 'oturum-bitti', {}); }
      for (const abone of b.abonelikler.values()) {
        if (yetki.etkilerMi(oturum, abone.parcalar, degisen)) aboneDegeriGonder(b, abone, oturum);
      }
    }
  }, 30);
});
setInterval(() => { for (const b of baglantilar.values()) b.res.write(': canli\n\n'); }, 25e3).unref();

// ── HEKİM PORTALI: paylaşım bağlantıları ve kurulum dosyası ─────────
// İsteğin geldiği internet adresi (Tailscale/Cloudflare tüneli üzerinden)
function istekAdresi(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
  if (!host || /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(host) || !/^[a-z0-9.-]+(:\d+)?$/.test(host)) return null;
  const https = httpsMi(req) || /\.ts\.net(:\d+)?$/.test(host) || !!req.headers['cf-ray'];
  return (https ? 'https://' : 'http://') + host;
}
function genelAdresiOgren(req) {
  const adres = istekAdresi(req);
  if (!adres || ayarlar.genelAdres === adres) return;
  try {
    ayarlar = ayarlariOku(); ayarlar.genelAdres = adres; ayarlariYaz(ayarlar);
    console.log('[ayar] Hekim portalının internet adresi: ' + adres);
  } catch (e) { /* yoksay */ }
}
function oturumuVarMi(req, kapi) {
  const c = cerezleriOku(req);
  return PANELLER.some(p => (kapi === 'ic' || p !== 'yonetici') && oturumGetir(c[CEREZ_ADI[p]], p));
}
// Hekimin gönderdiği paylaşım bağlantısı (WeTransfer, Drive…):
// tıklanınca bağlantıya yönlendirir; programdan (ZIP indirme) istenirse
// çift tıklanabilir bir internet kısayolu (.url) dosyası verir.
function baglantiSun(req, res, kapi, url) {
  if (!oturumuVarMi(req, kapi)) { res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Bağlantıyı açmak için giriş yapın'); return; }
  let hedef = null;
  try { hedef = new URL(url.searchParams.get('u') || ''); } catch (e) { hedef = null; }
  if (!hedef || !/^https?:$/.test(hedef.protocol)) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Geçersiz bağlantı'); return; }
  const amac = req.headers['sec-fetch-dest'];
  if (amac === 'document' || amac === 'iframe' || (!amac && /text\/html/.test(req.headers.accept || ''))) {
    res.writeHead(302, { Location: hedef.href, 'Cache-Control': 'no-store' }); res.end(); return;
  }
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="baglanti.url"', 'Cache-Control': 'no-store' });
  res.end(`[InternetShortcut]\r\nURL=${hedef.href}\r\n`);
}
// Hekim bilgisayarı için kurulum dosyası — sistemin internet adresi içine yazılır
function hekimKurulumSun(req, res, kapi) {
  const adres = (kapi === 'dis' && istekAdresi(req)) || ayarlar.genelAdres;
  if (!adres) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Hekim portalının internet adresi henüz bilinmiyor. Hekim portalını bir kez internet adresinden (ör. https://...ts.net/HekimPortali.html) açın, sonra tekrar deneyin.');
    return;
  }
  const metin = fs.readFileSync(path.join(KOK, 'araclar', 'hekim-kurulum-sablonu.bat'), 'utf8').split('__ADRES__').join(adres);
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': 'attachment; filename="DIGICAD-Hekim-Portali-Kurulum.bat"',
    'Cache-Control': 'no-store',
  });
  res.end(metin);
}

// ── İSTEK İŞLEYİCİ ──────────────────────────────────────────────────
function isleyiciOlustur(kapi) {
  return async (req, res) => {
    guvenlikBasliklari(res);
    const url = new URL(req.url, 'http://x');
    const yol = url.pathname;
    try {
      // Dış kapıdan (internet) gelen isteklerden sistemin internet adresini öğren
      // (hekim kurulum dosyası bu adresi kullanır)
      if (kapi === 'dis') genelAdresiOgren(req);
      if (yol === '/baglanti' && (req.method === 'GET' || req.method === 'HEAD')) return baglantiSun(req, res, kapi, url);
      if (yol === '/HekimPortaliKurulum.bat' && req.method === 'GET') return hekimKurulumSun(req, res, kapi);

      if (!yol.startsWith('/api/') && !yol.startsWith('/dosya/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
        return statikSun(req, res, kapi);
      }

      const cerezler = cerezleriOku(req);
      // Hangi panelden geliyor? (her panelin kendi oturum çerezi vardır)
      const panel = req.headers['x-dl-panel'] || url.searchParams.get('panel');

      if (yol.startsWith('/dosya/')) {
        const oturumVar = PANELLER.some(p => (kapi === 'ic' || p !== 'yonetici') && oturumGetir(cerezler[CEREZ_ADI[p]], p));
        return dosyaSun(req, res, oturumVar);
      }

      if (!PANELLER.includes(panel)) return json(res, 400, { hata: 'Panel belirtilmedi' });
      const yoneticiYasak = panel === 'yonetici' && (kapi === 'dis' || vekilUzerindenMi(req) ||
        (ayarlar.yoneticiYalnizcaYerelAg && !yerelAgMi(ipAdresi(req))));
      if (yoneticiYasak) return json(res, 403, { hata: 'Yönetim paneline sadece laboratuvar ağından erişilebilir' });

      // POST isteklerinde özel başlık zorunlu: başka bir siteden gizlice
      // istek gönderilmesini (CSRF) engeller.
      if (req.method === 'POST' && !req.headers['x-dl-panel']) return json(res, 403, { hata: 'Geçersiz istek' });
      if (req.headers.origin) {
        let kaynak; try { kaynak = new URL(req.headers.origin).host; } catch (e) { kaynak = ''; }
        if (kaynak !== req.headers.host) return json(res, 403, { hata: 'Geçersiz kaynak' });
      }

      const anahtar = cerezler[CEREZ_ADI[panel]];
      const oturum = oturumGetir(anahtar, panel);

      // ── Giriş ───────────────────────────────────────────
      if (yol === '/api/giris' && req.method === 'POST') {
        const g = await jsonOku(req);
        if (panel === 'yonetici') {
          const k = 'yonetici:' + kapi;
          const dk = kilitliMi(k);
          if (dk) return json(res, 429, { hata: `Çok fazla hatalı deneme. ${dk} dakika sonra tekrar deneyin.` });
          if (!pinDogruMu(g.pin)) { hataliDeneme(k); console.warn(`[güvenlik] Hatalı yönetici PIN denemesi (${ipAdresi(req)})`); return json(res, 401, { hata: 'Hatalı şifre!' }); }
          denemeler.delete(k);
          oturumKapat(anahtar);
          cerezYaz(res, req, CEREZ_ADI.yonetici, oturumAc('yonetici', 'yonetici'), SURE.yonetici);
          return json(res, 200, { kullanici: { rol: 'yonetici' } });
        }
        const kAdi = String(g.kullaniciAdi || '').trim().toLowerCase();
        const sifre = String(g.sifre || '');
        const k1 = panel + ':' + kAdi, k2 = panel + ':kapi:' + kapi + ':' + istemciAdresi(req, kapi);
        const dk = Math.max(kilitliMi(k1), kilitliMi(k2));
        if (dk) return json(res, 429, { hata: `Çok fazla hatalı deneme. ${dk} dakika sonra tekrar deneyin.` });
        const kisi = kisiKayitlari(panel).find(x => (x.username || '').toLowerCase() === kAdi && kAdi);
        // Kişi bulunamasa da aynı sürede yanıt ver (kullanıcı adı tahminini zorlaştırır)
        const dogru = esitMi(kisi && kisi.password ? kisi.password : crypto.randomBytes(16).toString('hex'), sifre) && !!(kisi && kisi.password);
        if (!dogru) {
          hataliDeneme(k1); hataliDeneme(k2);
          return json(res, 401, { hata: 'Kullanıcı adı veya şifre hatalı.' });
        }
        denemeler.delete(k1);
        oturumKapat(anahtar);
        cerezYaz(res, req, CEREZ_ADI[panel], oturumAc(panel, kisi.id, sifreIzi(kisi)), SURE[panel]);
        return json(res, 200, { kullanici: yetki.sifresiz(kisi) });
      }

      if (yol === '/api/ben' && req.method === 'GET') {
        if (!oturum) return json(res, 200, { kullanici: null });
        if (oturum.rol === 'yonetici') return json(res, 200, { kullanici: { rol: 'yonetici' } });
        const kisi = kisiKayitlari(oturum.rol).find(x => yetki.ayni(x.id, oturum.id));
        return json(res, 200, { kullanici: kisi ? yetki.sifresiz(kisi) : null });
      }

      if (yol === '/api/cikis' && req.method === 'POST') {
        oturumKapat(anahtar);
        cerezYaz(res, req, CEREZ_ADI[panel], '', 0);
        return json(res, 200, { tamam: true });
      }

      if (yol === '/api/pin-degistir' && req.method === 'POST') {
        if (!oturum || oturum.rol !== 'yonetici') return json(res, 401, { hata: 'Giriş yapmanız gerekiyor' });
        const g = await jsonOku(req);
        if (!pinDogruMu(g.eski)) return json(res, 400, { hata: 'Mevcut şifre hatalı!' });
        if (!pinGecerliMi(g.yeni)) return json(res, 400, { hata: 'Yeni şifre 4 haneli rakam olmalı!' });
        ayarlar = ayarlariOku();
        ayarlar.pin = pinOzetle(g.yeni);
        ayarlariYaz(ayarlar);
        // Diğer tüm yönetici oturumlarını kapat
        for (const [h, o] of Object.entries(oturumlar)) if (o.rol === 'yonetici' && h !== anahtarOzeti(anahtar)) delete oturumlar[h];
        oturumlariKaydet();
        return json(res, 200, { tamam: true });
      }

      // ── Canlı akış ──────────────────────────────────────
      if (yol === '/api/akis' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
        });
        const id = crypto.randomBytes(16).toString('hex');
        const b = { res, panel, anahtar: oturum ? anahtar : null, kapi, abonelikler: new Map() };
        baglantilar.set(id, b);
        res.write('retry: 3000\n\n');
        olayGonder(b, 'merhaba', { baglanti: id, oturum: !!oturum });
        req.on('close', () => baglantilar.delete(id));
        return;
      }

      if (yol === '/api/abone' && req.method === 'POST') {
        const g = await jsonOku(req);
        const b = baglantilar.get(g.baglanti);
        if (!b || b.panel !== panel) return json(res, 404, { hata: 'Bağlantı bulunamadı' });
        const abone = { id: String(g.abone), parcalar: agac.parcala(g.yol), sorgu: g.sorgu || null, son: undefined };
        b.abonelikler.set(abone.id, abone);
        aboneDegeriGonder(b, abone, oturumGetir(b.anahtar, b.panel));
        return json(res, 200, { tamam: true });
      }

      if (yol === '/api/abonelik-iptal' && req.method === 'POST') {
        const g = await jsonOku(req);
        const b = baglantilar.get(g.baglanti);
        if (b) b.abonelikler.delete(String(g.abone));
        return json(res, 200, { tamam: true });
      }

      // ── Okuma / yazma ───────────────────────────────────
      if (yol === '/api/oku' && req.method === 'POST') {
        const g = await jsonOku(req);
        const deger = agac.sorguUygula(yetki.oku(depo.kok, oturum, agac.parcala(g.yol)), g.sorgu);
        return json(res, 200, { deger: deger === undefined ? null : deger });
      }

      if (yol === '/api/yaz' && req.method === 'POST') {
        const g = await jsonOku(req);
        const islemler = yetki.yazimDenetle(depo.kok, oturum, agac.islemleriAc(g.islem, g.yol, g.deger));
        // Hekim portalından YENİ bir iş mi geldi? (otomatik yazdırma için)
        const yeniGonderimler = oturum && oturum.rol === 'hekim'
          ? [...new Set(islemler.map(i => i.parcalar).filter(p => p[0] === 'db' && p[1] === yetki.CALISMA_ALANI && p[2] === 'doctorSubmissions' && p[3]).map(p => p[3]))]
              .filter(id => depo.oku(['db', yetki.CALISMA_ALANI, 'doctorSubmissions', id]) === null)
          : [];
        depo.uygula(islemler);
        for (const id of yeniGonderimler) otomatikYazdir(id);
        return json(res, 200, { tamam: true });
      }

      // ── Mail Kutusu: tarama dosyasını anlamlı adla indirme (sadece yönetici) ──
      // Runyes 3DS gibi mailerdeki S3 bağlantısı sunucu üzerinden alınır ve
      // "KLİNİK - HASTA - tarih.zip" adıyla verilir (tarayıcı başka sitedeki
      // dosyanın adını değiştiremediği için). Sadece izinli adresler (S3).
      if (yol === '/api/mail-indir' && req.method === 'GET') {
        if (!oturum || oturum.rol !== 'yonetici') { res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Yönetici girişi gerekiyor'); return; }
        let hedef = null;
        try { hedef = new URL(url.searchParams.get('u') || ''); } catch (e) { hedef = null; }
        const izin = new RegExp(process.env.DIGICAD_MAIL_INDIR_IZIN || '(^|\\.)amazonaws\\.com$', 'i');
        const protokolUygun = hedef && (hedef.protocol === 'https:' || (process.env.DIGICAD_MAIL_INDIR_IZIN && hedef.protocol === 'http:'));
        if (!hedef || !protokolUygun || !izin.test(hedef.hostname)) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Bu bağlantı türü bu yolla indirilemez'); return;
        }
        const ad = guvenliDosyaAdi(url.searchParams.get('ad') || decodeURIComponent(hedef.pathname.split('/').pop() || 'tarama.zip'));
        let r;
        try { r = await fetch(hedef.href); } catch (e) { r = null; }
        if (!r || !r.ok || !r.body) {
          res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Dosya indirilemedi' + (r ? ` (HTTP ${r.status}) — bağlantının süresi dolmuş olabilir` : ' — internet bağlantısını kontrol edin'));
          return;
        }
        const basliklar = {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': indirmeBasligi(ad),
          'Cache-Control': 'no-store',
        };
        if (r.headers.get('content-length')) basliklar['Content-Length'] = r.headers.get('content-length');
        res.writeHead(200, basliklar);
        const { Readable } = require('stream');
        Readable.fromWeb(r.body).on('error', () => res.destroy()).pipe(res);
        return;
      }

      // ── Otomatik yazdırma ayarları (sadece yönetici) ────
      if (yol === '/api/yazdirma' || yol.startsWith('/api/yazdirma/')) {
        if (!oturum || oturum.rol !== 'yonetici') return json(res, 401, { hata: 'Yönetici girişi gerekiyor' });
        if (yol === '/api/yazdirma' && req.method === 'GET') {
          const y = yazdirmaAyari();
          let liste = [], listeHatasi = null;
          if (yazdirma.destekleniyor()) {
            try { liste = await yazdirma.yazicilar(url.searchParams.get('yenile') === '1'); } catch (e) { listeHatasi = e.message; }
          } else listeHatasi = 'Otomatik yazdırma yalnızca Windows bilgisayarda çalışır';
          return json(res, 200, { ...y, yazicilar: liste, listeHatasi, gecmis: yazdirma.gecmis });
        }
        if (yol === '/api/yazdirma' && req.method === 'POST') {
          const g = await jsonOku(req);
          ayarlar = ayarlariOku();
          ayarlar.yazdirma = {
            otomatik: !!g.otomatik,
            yazici: typeof g.yazici === 'string' ? g.yazici.slice(0, 200) : '',
            kopya: Math.max(1, Math.min(5, Number(g.kopya) || 1)),
            kagit: g.kagit === 'A4' ? 'A4' : 'A5',
          };
          ayarlariYaz(ayarlar);
          console.log(`[yazdırma] Otomatik yazdırma ${ayarlar.yazdirma.otomatik ? 'AÇIK' : 'kapalı'} — yazıcı: ${ayarlar.yazdirma.yazici || '(varsayılan)'}, kağıt: ${ayarlar.yazdirma.kagit}`);
          return json(res, 200, { tamam: true, ...ayarlar.yazdirma });
        }
        if (yol === '/api/yazdirma/test' && req.method === 'POST') {
          const y = yazdirmaAyari();
          await yazdirma.talebiYazdir(yazdirma.ornekIs(), { ...y, kopya: 1 }, true);
          return json(res, 200, { tamam: true });
        }
        if (yol === '/api/yazdirma/tekrar' && req.method === 'POST') {
          const g = await jsonOku(req);
          const k = depo.oku(['db', yetki.CALISMA_ALANI, 'doctorSubmissions', String(g.id || '')]);
          if (!k) return json(res, 404, { hata: 'İş bulunamadı' });
          const y = yazdirmaAyari();
          await yazdirma.talebiYazdir(k, y);
          return json(res, 200, { tamam: true });
        }
        return json(res, 404, { hata: 'Bilinmeyen adres' });
      }

      // ── Veri aktarımı (sadece yönetici) ─────────────────
      if (yol.startsWith('/api/aktarim/') || yol === '/api/yedek-indir') {
        if (!oturum || oturum.rol !== 'yonetici') return json(res, 401, { hata: 'Yönetici girişi gerekiyor' });

        if (yol === '/api/yedek-indir' && req.method === 'GET') {
          depo.kaydet();
          const tarih = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Disposition': `attachment; filename="DIGICAD-tam-yedek-${tarih}.json"`,
            'Cache-Control': 'no-store',
          });
          fs.createReadStream(depo.dosya).pipe(res);
          return;
        }

        if (yol === '/api/aktarim/hazirla' && req.method === 'POST') {
          if (aktarimDurumu.calisiyor) return json(res, 409, { hata: 'Bir aktarım zaten sürüyor' });
          const kaynak = url.searchParams.get('kaynak');
          const hedef = url.searchParams.get('hedef') || null;
          let ham, kaynakAdi;
          let yerelDosyalar = null;
          if (kaynak === 'firebase') { ham = await aktarim.firebaseIndir(); kaynakAdi = 'Firebase (eski sistem, canlı)'; }
          else if (kaynak === 'yedek') {
            const y = firebaseYedek.yedegiOku(FIREBASE_YEDEKLERI, url.searchParams.get('klasor'));
            ham = y.veri; yerelDosyalar = y.yerelDosyalar;
            yerelDosyalar.sadeceYerel = true; // yedekten yüklerken Firebase'e hiç bağlanılmaz
            kaynakAdi = `Firebase yedeği — ${new Date(y.bilgi.tarih).toLocaleString('tr-TR')} (bütünlük kontrolü geçti)`;
          }
          else { ham = await jsonOku(req); kaynakAdi = url.searchParams.get('ad') || 'Yedek dosyası'; }
          const gelen = aktarim.bicimlendir(ham, hedef);
          ham = null;
          aktarimHazirlik = { id: crypto.randomBytes(8).toString('hex'), gelen, kaynakAdi, yerelDosyalar, zaman: Date.now() };
          return json(res, 200, { id: aktarimHazirlik.id, kaynakAdi, ozet: aktarim.ozetle(depo.kok, gelen) });
        }

        if (yol === '/api/aktarim/uygula' && req.method === 'POST') {
          const g = await jsonOku(req);
          if (aktarimDurumu.calisiyor) return json(res, 409, { hata: 'Bir aktarım zaten sürüyor' });
          if (!aktarimHazirlik || aktarimHazirlik.id !== g.id) return json(res, 400, { hata: 'Önizleme bulunamadı, tekrar hazırlayın' });
          if (!['birlestir', 'degistir'].includes(g.mod)) return json(res, 400, { hata: 'Geçersiz mod' });
          aktarimBaslat(aktarimHazirlik, g.mod);
          aktarimHazirlik = null;
          return json(res, 200, { tamam: true });
        }

        if (yol === '/api/aktarim/durum' && req.method === 'GET') return json(res, 200, aktarimDurumu);

        // ── Firebase tam yedeği (salt-okunur) ──
        if (yol === '/api/aktarim/firebase-yedekleri' && req.method === 'GET') {
          return json(res, 200, { yedekler: firebaseYedek.yedekleriListele(FIREBASE_YEDEKLERI), klasor: FIREBASE_YEDEKLERI });
        }
        if (yol === '/api/aktarim/firebase-yedekle' && req.method === 'POST') {
          if (yedekIsi.calisiyor) return json(res, 409, { hata: 'Yedek alma zaten sürüyor' });
          yedekIsi = { calisiyor: true, asama: 'Başlatılıyor…' };
          firebaseYedek.yedekAl({ kokKlasor: FIREBASE_YEDEKLERI, ilerleme: d => { yedekIsi = { ...yedekIsi, ...d }; } })
            .then(s => { yedekIsi = { calisiyor: false, bitti: true, sonuc: { ...s, hatali: s.hatali.map(h => ({ depoYolu: h.depoYolu, hata: h.hata })) } }; console.log('[firebase yedeği] ' + s.klasor); })
            .catch(e => { yedekIsi = { calisiyor: false, bitti: true, hata: e.message }; console.error('[firebase yedeği] HATA:', e.message); });
          return json(res, 200, { tamam: true });
        }
        if (yol === '/api/aktarim/yedek-durum' && req.method === 'GET') return json(res, 200, yedekIsi);
        return json(res, 404, { hata: 'Bilinmeyen adres' });
      }

      // ── Dosya yükleme ───────────────────────────────────
      if (yol === '/api/yukle' && req.method === 'POST') {
        if (!oturum) return json(res, 401, { hata: 'Dosya yüklemek için giriş yapın' });
        const depoYolu = String(url.searchParams.get('yol') || '');
        const ad = guvenliDosyaAdi(url.searchParams.get('ad') || depoYolu.split('/').pop());
        const sinir = (ayarlar.maksDosyaMB || 500) * 1024 * 1024;
        if (Number(req.headers['content-length'] || 0) > sinir) return json(res, 413, { hata: `Dosya çok büyük (en fazla ${ayarlar.maksDosyaMB} MB)` });
        const belirtec = crypto.randomBytes(24).toString('base64url');
        const klasor = path.join(DOSYALAR, belirtec);
        fs.mkdirSync(klasor);
        const hedef = path.join(klasor, ad);
        const yazici = fs.createWriteStream(hedef);
        let boyut = 0, asildi = false;
        req.on('data', p => {
          boyut += p.length;
          if (boyut > sinir && !asildi) { asildi = true; req.unpipe(yazici); yazici.destroy(); req.destroy(); }
        });
        req.pipe(yazici);
        yazici.on('finish', () => {
          if (asildi) return;
          const adres = `/dosya/${belirtec}/${encodeURIComponent(ad)}`;
          if (depoYolu) {
            dosyaDizini[depoYolu] = { adres, boyut, tarih: new Date().toISOString(), yukleyen: `${oturum.rol}:${oturum.id}` };
            dosyaDiziniKaydet();
          }
          json(res, 200, { url: adres, boyut });
        });
        yazici.on('error', e => { if (!res.headersSent) json(res, 500, { hata: e.message }); });
        req.on('close', () => { if (asildi) fs.rm(klasor, { recursive: true, force: true }, () => {}); });
        return;
      }

      if (yol === '/api/dosya-adresi' && req.method === 'GET') {
        if (!oturum) return json(res, 401, { hata: 'Giriş yapın' });
        const k = dosyaDizini[String(url.searchParams.get('yol') || '')];
        if (!k) return json(res, 404, { hata: 'Dosya bulunamadı' });
        return json(res, 200, { url: k.adres });
      }

      return json(res, 404, { hata: 'Bilinmeyen adres' });
    } catch (e) {
      const durum = e.durum || (e instanceof SyntaxError ? 400 : 500);
      if (durum >= 500) console.error('[hata]', e);
      if (!res.headersSent) json(res, durum, { hata: e.message || 'Sunucu hatası' });
    }
  };
}

// ── OTOMATİK YAZDIRMA ───────────────────────────────────────────────
const YAZDIRILANLAR = path.join(VERI, 'yazdirilanlar.json');
function yazdirmaAyari() { return { otomatik: false, yazici: '', kopya: 1, kagit: 'A5', ...(ayarlar.yazdirma || {}) }; }
function otomatikYazdir(id) {
  const y = yazdirmaAyari();
  if (!y.otomatik) return;
  let basilan = [];
  try { basilan = JSON.parse(fs.readFileSync(YAZDIRILANLAR, 'utf8')); } catch (e) { basilan = []; }
  if (basilan.includes(String(id))) return; // aynı iş iki kez basılmasın
  const kayit = depo.oku(['db', yetki.CALISMA_ALANI, 'doctorSubmissions', id]);
  if (!kayit) return;
  basilan.push(String(id));
  fs.writeFileSync(YAZDIRILANLAR, JSON.stringify(basilan.slice(-1000)));
  yazdirma.talebiYazdir(kayit, y)
    .then(() => console.log(`[yazdırma] ${kayit.patient || id} — ${y.yazici || 'varsayılan yazıcı'}`))
    .catch(e => console.error(`[yazdırma] HATA (${kayit.patient || id}): ${e.message}`));
}

// ── VERİ AKTARIMI İŞİ ───────────────────────────────────────────────
let aktarimHazirlik = null;
let aktarimDurumu = { calisiyor: false };
let yedekIsi = { calisiyor: false };
async function aktarimBaslat(hazirlik, mod) {
  aktarimDurumu = { calisiyor: true, asama: 'Mevcut veriler yedekleniyor…', baslangic: Date.now() };
  try {
    // 1) Önce mevcut verinin yedeği
    depo.kaydet();
    let yedekDosyasi = null;
    if (fs.existsSync(depo.dosya)) {
      yedekDosyasi = path.join(depo.yedekKlasoru, `veritabani-aktarim-oncesi-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      fs.copyFileSync(depo.dosya, yedekDosyasi);
    }
    // 2) Gelen veride ve yerelde kalan Firebase dosya bağlantılarını indir
    const alanlar = Object.keys(hazirlik.gelen.calismaAlanlari);
    const taranacak = { gelen: hazirlik.gelen.calismaAlanlari, yerel: alanlar.map(ws => depo.oku(['db', ws])) };
    aktarimDurumu.asama = hazirlik.yerelDosyalar ? 'Dosyalar yedekten kopyalanıyor…' : 'Dosyalar indiriliyor…';
    const dosyaSonucu = await aktarim.dosyalariTasi(taranacak, dosyaDizini, DOSYALAR, (b, t) => { aktarimDurumu.dosya = { biten: b, toplam: t }; }, hazirlik.yerelDosyalar);
    dosyaDiziniKaydet();
    // 3) Birleştirme — bu kısım eşzamanlı çalışır, araya başka yazım giremez
    aktarimDurumu.asama = 'Veriler birleştiriliyor…';
    const gelen = { ...hazirlik.gelen, calismaAlanlari: aktarim.adresleriDegistir(hazirlik.gelen.calismaAlanlari, dosyaSonucu.eslesme) };
    const yerelKok = aktarim.adresleriDegistir(depo.kok, dosyaSonucu.eslesme);
    const once = aktarim.ozetle(depo.kok, hazirlik.gelen);
    const yeni = aktarim.birlestir(yerelKok, gelen, mod);
    depo.uygula(Object.entries(yeni).map(([ws, deger]) => ({ parcalar: ['db', ws], deger })));
    if (!depo.oku(['meta', 'migratedToWorkspaces'])) depo.uygula([{ parcalar: ['meta', 'migratedToWorkspaces'], deger: true }]);
    depo.kaydet();
    aktarimDurumu = {
      calisiyor: false, bitti: true, mod, kaynakAdi: hazirlik.kaynakAdi, yedekDosyasi,
      ozet: once,
      dosya: { toplam: dosyaSonucu.toplam, indirilen: dosyaSonucu.indirilen, basarisiz: dosyaSonucu.basarisiz },
    };
    console.log(`[aktarım] ${hazirlik.kaynakAdi} — ${mod === 'degistir' ? 'tamamen değiştirildi' : 'eksik kayıtlar eklendi'} (yedek: ${yedekDosyasi})`);
  } catch (e) {
    console.error('[aktarım] HATA:', e);
    aktarimDurumu = { calisiyor: false, bitti: true, hata: e.message };
  }
}

// ── YEDEKLEME ───────────────────────────────────────────────────────
function klasorKopyala(kaynak, hedef) {
  fs.mkdirSync(hedef, { recursive: true });
  for (const g of fs.readdirSync(kaynak, { withFileTypes: true })) {
    const k = path.join(kaynak, g.name), h = path.join(hedef, g.name);
    if (g.isDirectory()) klasorKopyala(k, h);
    else if (!fs.existsSync(h) || fs.statSync(h).size !== fs.statSync(k).size) fs.copyFileSync(k, h);
  }
}
function yedekAl() {
  try {
    const dosya = depo.gunlukYedek();
    if (ayarlar.yedekKlasoru && dosya) {
      fs.mkdirSync(ayarlar.yedekKlasoru, { recursive: true });
      fs.copyFileSync(dosya, path.join(ayarlar.yedekKlasoru, path.basename(dosya)));
      klasorKopyala(DOSYALAR, path.join(ayarlar.yedekKlasoru, 'dosyalar'));
    }
    console.log(`[yedek] ${new Date().toLocaleString('tr-TR')} — yedek alındı${ayarlar.yedekKlasoru ? ' (+ ' + ayarlar.yedekKlasoru + ')' : ''}`);
  } catch (e) { console.error('[yedek] HATA:', e.message); }
}

// ── PIN BELİRLEME ───────────────────────────────────────────────────
function soru(metin) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(coz => rl.question(metin, c => { rl.close(); coz(c.trim()); }));
}
async function pinBelirle() {
  for (;;) {
    const p1 = await soru('Yönetim paneli için 4 haneli yeni PIN girin: ');
    if (!pinGecerliMi(p1)) { console.log('PIN 4 haneli rakam olmalı.'); continue; }
    if (p1 === '0000' || p1 === '1234') { console.log('Bu PIN çok kolay tahmin edilir, başka bir PIN seçin.'); continue; }
    const p2 = await soru('PIN\'i tekrar girin: ');
    if (p1 !== p2) { console.log('PIN\'ler eşleşmiyor.'); continue; }
    ayarlar = ayarlariOku();
    ayarlar.pin = pinOzetle(p1);
    ayarlariYaz(ayarlar);
    console.log('PIN kaydedildi.');
    return;
  }
}

// ── BAŞLAT ──────────────────────────────────────────────────────────
async function baslat() {
  if (process.argv.includes('--pin-degistir') || !ayarlar.pin) {
    if (!ayarlar.pin) console.log('\nYönetim paneli PIN\'i henüz belirlenmemiş.');
    await pinBelirle();
    if (process.argv.includes('--pin-degistir')) process.exit(0);
  }
  if (!fs.existsSync(AYAR_DOSYASI)) ayarlariYaz(ayarlar);

  const ic = http.createServer(isleyiciOlustur('ic'));
  const dis = http.createServer(isleyiciOlustur('dis'));
  for (const s of [ic, dis]) { s.requestTimeout = 0; s.headersTimeout = 60e3; }
  ic.listen(ayarlar.icPort, ayarlar.icAdres, () => {
    console.log('\n══════════════════════════════════════════════════════');
    console.log('  DIGICAD Dental — Yerel Sunucu çalışıyor');
    console.log('══════════════════════════════════════════════════════');
    console.log(`  Yönetim paneli : http://localhost:${ayarlar.icPort}/PrimerLab.html`);
    console.log(`  Gelen İşler    : http://localhost:${ayarlar.icPort}/GelenIslerPaneli.html`);
    console.log(`  Ana sayfa      : http://localhost:${ayarlar.icPort}/`);
    console.log(`  İnternet tüneli bu adrese bağlanmalı: http://127.0.0.1:${ayarlar.disPort}`);
    console.log(`  Veri klasörü   : ${VERI}`);
    console.log('  Bu pencereyi KAPATMAYIN — kapatırsanız sistem durur.');
    console.log('══════════════════════════════════════════════════════\n');
  });
  dis.listen(ayarlar.disPort, ayarlar.disAdres);

  yedekAl();
  setInterval(yedekAl, 24 * 3600e3).unref();

  const kapat = () => {
    console.log('\nKapatılıyor, veriler kaydediliyor…');
    try { depo.kaydet(); } catch (e) { console.error(e); }
    try { oturumlariHemenKaydet(); } catch (e) { console.error(e); }
    process.exit(0);
  };
  process.on('SIGINT', kapat);
  process.on('SIGTERM', kapat);
  process.on('SIGHUP', kapat);
}

if (require.main === module) baslat();
module.exports = { isleyiciOlustur, depo, pinOzetle };
