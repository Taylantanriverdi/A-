'use strict';
// ═══════════════════════════════════════════════════════════════════
//  OTOMATİK YAZDIRMA — hekim portalından gelen işleri sessizce yazdırır
//  Asıl yazdırmayı araclar/yazdir.ps1 (Windows System.Drawing) yapar.
//  Testlerde DIGICAD_YAZDIR_KOMUTU ile sahte bir yazıcı betiği verilebilir.
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const { pathToFileURL } = require('url');
const siparisFormu = require('./siparis-formu');

const BETIK = path.join(__dirname, '..', 'araclar', 'yazdir.ps1');

// ── Sipariş Takip Formu'nu resme çevirme (Edge / Chrome, ekran açmadan) ──
function tarayiciBul() {
  const adaylar = [
    process.env.DIGICAD_TARAYICI,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean);
  return adaylar.find(a => { try { return fs.statSync(a).isFile(); } catch (e) { return false; } }) || null;
}
// HTML formu A4 oranında (794x1123 CSS piksel), 2 kat çözünürlükle PNG'ye çevirir.
// Tarayıcı ekran açmadan (headless) başlatılır ve DevTools protokolüyle yönetilir
// (Playwright/Puppeteer'ın kullandığı yöntem). Her çalıştırma ayrı bir geçici
// profil kullanır; iş bitince tarayıcı kapatılır ve geçici dosyalar silinir.
async function formuResmeCevir(htmlMetni) {
  const tarayici = tarayiciBul();
  if (!tarayici) throw new Error('Edge/Chrome bulunamadı');
  if (typeof WebSocket === 'undefined') throw new Error('Node.js sürümü eski (WebSocket yok)');
  const { spawn } = require('child_process');
  const ad = crypto.randomBytes(6).toString('hex');
  const htmlDosya = path.join(os.tmpdir(), `digicad-form-${ad}.html`);
  const profil = path.join(os.tmpdir(), `digicad-tarayici-${ad}`);
  fs.writeFileSync(htmlDosya, htmlMetni, 'utf8');
  fs.mkdirSync(profil, { recursive: true });
  const surec = spawn(tarayici, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars', '--mute-audio', '--disable-background-networking', '--disable-component-update',
    '--disable-sync', '--remote-debugging-port=0', `--user-data-dir=${profil}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let ws = null;
  const temizle = () => {
    try { if (ws) ws.close(); } catch (e) { /* yoksay */ }
    try { surec.kill(); } catch (e) { /* yoksay */ }
    try { fs.unlinkSync(htmlDosya); } catch (e) { /* yoksay */ }
    setTimeout(() => { try { fs.rmSync(profil, { recursive: true, force: true }); } catch (e) { /* yoksay */ } }, 3000);
  };
  const bekle = ms => new Promise(c => setTimeout(c, ms));
  try {
    // 1) Tarayıcının açtığı hata ayıklama adresini bekle
    let portBilgisi = null;
    for (let i = 0; i < 100 && !portBilgisi; i++) {
      if (surec.exitCode !== null) throw new Error('Tarayıcı açılamadı');
      try { const m = fs.readFileSync(path.join(profil, 'DevToolsActivePort'), 'utf8').split(/\r?\n/); if (m[0] && m[1]) portBilgisi = m; } catch (e) { /* henüz yok */ }
      if (!portBilgisi) await bekle(200);
    }
    if (!portBilgisi) throw new Error('Tarayıcı yanıt vermedi');
    // 2) DevTools bağlantısı
    ws = new WebSocket(`ws://127.0.0.1:${portBilgisi[0].trim()}${portBilgisi[1].trim()}`);
    await new Promise((coz, reddet) => { ws.onopen = coz; ws.onerror = () => reddet(new Error('Tarayıcıya bağlanılamadı')); });
    let sira = 0; const bekleyen = new Map(); const olaylar = [];
    ws.onmessage = m => {
      const v = JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString());
      if (v.id && bekleyen.has(v.id)) { const b = bekleyen.get(v.id); bekleyen.delete(v.id); v.error ? b.reddet(new Error(v.error.message)) : b.coz(v.result); }
      else if (v.method) olaylar.push(v);
    };
    const gonder = (method, params = {}, sessionId) => new Promise((coz, reddet) => {
      const id = ++sira; bekleyen.set(id, { coz, reddet });
      ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
    const { targetId } = await gonder('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await gonder('Target.attachToTarget', { targetId, flatten: true });
    await gonder('Emulation.setDeviceMetricsOverride', { width: 794, height: 1123, deviceScaleFactor: 2, mobile: false }, sessionId);
    await gonder('Page.enable', {}, sessionId);
    await gonder('Page.navigate', { url: pathToFileURL(htmlDosya).href }, sessionId);
    for (let i = 0; i < 100 && !olaylar.some(o => o.method === 'Page.loadEventFired' && o.sessionId === sessionId); i++) await bekle(100);
    await bekle(150); // yazı tipleri otursun
    const { data } = await gonder('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 794, height: 1123, scale: 1 } }, sessionId);
    const png = path.join(os.tmpdir(), `digicad-form-${ad}.png`);
    fs.writeFileSync(png, Buffer.from(data, 'base64'));
    try { await Promise.race([gonder('Browser.close'), bekle(1500)]); } catch (e) { /* yoksay */ }
    return png;
  } finally {
    temizle();
  }
}

function destekleniyor() { return process.platform === 'win32' || !!process.env.DIGICAD_YAZDIR_KOMUTU; }

function calistir(argumanlar) {
  return new Promise((coz, reddet) => {
    if (!destekleniyor()) return reddet(new Error('Otomatik yazdırma yalnızca Windows bilgisayarda çalışır'));
    const sahte = process.env.DIGICAD_YAZDIR_KOMUTU;
    const komut = sahte ? process.execPath : 'powershell.exe';
    const arg = sahte ? [sahte, ...argumanlar] : ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', BETIK, ...argumanlar];
    execFile(komut, arg, { windowsHide: true, timeout: 90e3, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (hata, cikti, hataCikti) => {
      if (hata) {
        const mesaj = String(hataCikti || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).find(s => !/^(At |\+|CategoryInfo|FullyQualifiedErrorId|~)/.test(s)) || hata.message;
        return reddet(new Error(mesaj.replace(/^.*?:\s*(?=Yazıcı)/, '')));
      }
      coz(String(cikti || '').trim());
    });
  });
}

let _liste = null, _listeZamani = 0;
async function yazicilar(yenile) {
  if (!yenile && _liste && Date.now() - _listeZamani < 30e3) return _liste;
  const cikti = await calistir(['-Liste']);
  const satir = cikti.split(/\r?\n/).filter(s => s.trim().startsWith('[') || s.trim().startsWith('{')).pop() || '[]';
  let l = JSON.parse(satir);
  if (!Array.isArray(l)) l = [l];
  _liste = l; _listeZamani = Date.now();
  return l;
}

const tarihYaz = s => { try { return new Date(s).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return ''; } };
const gunYaz = s => { if (!s) return ''; const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m ? `${m[3]}.${m[2]}.${m[1]}` : String(s); };

// Hekim gönderimini yazdırma formuna çevirir
function formatla(k, test) {
  const disler = (Array.isArray(k.teeth) ? k.teeth : []).map(Number).filter(Boolean).sort((a, b) => a - b);
  const cene = { upper: 'Üst çene', lower: 'Alt çene', both: 'Alt + Üst çene', ust: 'Üst çene', alt: 'Alt çene' }[k.jaw] || (k.jaw ? String(k.jaw) : '');
  const dosyalar = (Array.isArray(k.files) ? k.files : []).filter(Boolean).map(f => ({
    ad: String(f.name || 'dosya').replace(/\.url$/, ''),
    baglanti: f.link ? String(f.linkUrl || '') : '',
  }));
  return {
    test: !!test,
    baslik: 'Hekim Portalı — Yeni İş Talebi',
    no: String(k.id || ''),
    tarih: tarihYaz(k.createdAt || new Date().toISOString()),
    hekim: String(k.doctorName || k.drName || ''),
    hasta: String(k.patient || ''),
    isTuru: String(k.jobType || ''),
    renk: String(k.color || ''),
    cene,
    teslim: gunYaz(k.dateout),
    tasarim: k.designSource === 'doctor' ? 'Hekim kendi tasarımını gönderdi (doğrudan üretim)' : 'Tasarımı laboratuvar yapacak',
    implant: String(k.implantBrand || ''),
    notlar: String(k.notes || ''),
    disler,
    dislerMetin: disler.length ? disler.join(', ') + `  (${disler.length} diş)` : '',
    dosyalar,
  };
}

function ornekIs() {
  return {
    id: 'TEST', createdAt: new Date().toISOString(), doctorName: 'DR. ÖRNEK HEKİM', patient: 'ÖRNEK HASTA', jobType: 'Zirkonya Kron',
    color: 'A2', jaw: 'upper', dateout: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10), teeth: [11, 12, 21],
    designSource: 'lab', notes: 'Bu bir test sayfasıdır. Yazıcı ayarlarının doğru olduğunu kontrol etmek için basıldı.',
    files: [{ name: 'ust_cene.stl' }, { name: 'Tarama bağlantısı - WeTransfer.url', link: true, linkUrl: 'https://we.tl/t-ornek' }],
  };
}

// Sıralı yazdırma kuyruğu (aynı anda tek iş)
let kuyruk = Promise.resolve();
const gecmis = []; // son 20 yazdırma
function yazdir(form, yazici, kopya = 1, kagit = 'A5') {
  const is = kuyruk.then(async () => {
    const dosya = path.join(os.tmpdir(), `digicad-yazdir-${crypto.randomBytes(6).toString('hex')}.json`);
    fs.writeFileSync(dosya, JSON.stringify(form), 'utf8');
    try {
      const arg = ['-Veri', dosya, '-Kopya', String(Math.max(1, Math.min(5, Number(kopya) || 1))), '-Kagit', kagit === 'A4' ? 'A4' : 'A5'];
      if (yazici) arg.push('-Yazici', yazici);
      await calistir(arg);
      gecmis.unshift({ zaman: new Date().toISOString(), hasta: form.hasta, hekim: form.hekim, test: form.test, durum: 'yazdırıldı', yazici });
    } catch (e) {
      gecmis.unshift({ zaman: new Date().toISOString(), hasta: form.hasta, hekim: form.hekim, test: form.test, durum: 'HATA: ' + e.message, yazici });
      throw e;
    } finally {
      gecmis.length = Math.min(gecmis.length, 20);
      try { fs.unlinkSync(dosya); } catch (e) { /* yoksay */ }
    }
  });
  kuyruk = is.catch(() => {});
  return is;
}

// Hekim talebini yönetim panelindeki "Sipariş Takip Formu" görünümüyle basar.
// Form resme çevrilemezse (Edge yoksa vb.) yedek olarak çizimli form basılır.
function talebiYazdir(kayit, ayar, test) {
  const is = kuyruk.then(async () => {
    const form = formatla(kayit, test);
    const ozet = { zaman: new Date().toISOString(), hasta: form.hasta, hekim: form.hekim, test: !!test, yazici: ayar.yazici };
    let png = null;
    try {
      const alanlar = siparisFormu.talepten(kayit);
      if (test) alanlar.notes = '*** TEST SAYFASI — GERÇEK BİR İŞ DEĞİLDİR ***\n' + alanlar.notes;
      png = await formuResmeCevir(siparisFormu.html(alanlar));
      const arg = ['-Resim', png, '-Baslik', 'DIGICAD Sipariş Formu - ' + form.hasta,
        '-Kopya', String(Math.max(1, Math.min(5, Number(ayar.kopya) || 1))), '-Kagit', ayar.kagit === 'A4' ? 'A4' : 'A5'];
      if (ayar.yazici) arg.push('-Yazici', ayar.yazici);
      await calistir(arg);
      gecmis.unshift({ ...ozet, durum: 'yazdırıldı' });
    } catch (e) {
      if (png === null) {
        // Sipariş formu resmi üretilemedi → çizimli yedek formla bas
        console.warn('[yazdırma] Sipariş formu resmi üretilemedi (' + e.message + '), yedek form basılıyor');
        const dosya = path.join(os.tmpdir(), `digicad-yazdir-${crypto.randomBytes(6).toString('hex')}.json`);
        fs.writeFileSync(dosya, JSON.stringify(form), 'utf8');
        try {
          const arg = ['-Veri', dosya, '-Kopya', String(Math.max(1, Math.min(5, Number(ayar.kopya) || 1))), '-Kagit', ayar.kagit === 'A4' ? 'A4' : 'A5'];
          if (ayar.yazici) arg.push('-Yazici', ayar.yazici);
          await calistir(arg);
          gecmis.unshift({ ...ozet, durum: 'yazdırıldı (basit form)' });
        } catch (e2) {
          gecmis.unshift({ ...ozet, durum: 'HATA: ' + e2.message });
          throw e2;
        } finally { try { fs.unlinkSync(dosya); } catch (x) { /* yoksay */ } }
      } else {
        gecmis.unshift({ ...ozet, durum: 'HATA: ' + e.message });
        throw e;
      }
    } finally {
      gecmis.length = Math.min(gecmis.length, 20);
      if (png) { try { fs.unlinkSync(png); } catch (x) { /* yoksay */ } }
    }
  });
  kuyruk = is.catch(() => {});
  return is;
}

module.exports = { destekleniyor, yazicilar, formatla, ornekIs, yazdir, talebiYazdir, formuResmeCevir, gecmis };
