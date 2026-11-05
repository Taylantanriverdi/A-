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

const BETIK = path.join(__dirname, '..', 'araclar', 'yazdir.ps1');

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
function yazdir(form, yazici, kopya = 1) {
  const is = kuyruk.then(async () => {
    const dosya = path.join(os.tmpdir(), `digicad-yazdir-${crypto.randomBytes(6).toString('hex')}.json`);
    fs.writeFileSync(dosya, JSON.stringify(form), 'utf8');
    try {
      const arg = ['-Veri', dosya, '-Kopya', String(Math.max(1, Math.min(5, Number(kopya) || 1)))];
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

module.exports = { destekleniyor, yazicilar, formatla, ornekIs, yazdir, gecmis };
