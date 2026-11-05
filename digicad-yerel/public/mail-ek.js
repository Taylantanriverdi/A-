/* ═══════════════════════════════════════════════════════════════════
   DIGICAD Dental — Mail Kutusu ekleri
   - Mail metninden dosya adlarını okur (bağlantının bir üst satırı)
   - İndirilen dosyaları, seçtiğiniz ana klasörün içinde
     "HEKİM - HASTA - RENK" adlı klasöre kaydeder (bilgiler mailden tahmin
     edilir, kaydetmeden önce düzeltilebilir)
   - Seçilen ana klasör kalıcıdır (panel kapanıp açılsa da hatırlanır)
   - "Tümünü İndir": maildeki tüm dosyaları birlikte kaydeder
   - Google Drive dosyası herkese açık değilse Drive için salt-okunur izin
     isteyip tekrar dener
   ═══════════════════════════════════════════════════════════════════ */

// ── Yardımcılar ──────────────────────────────────────────────────────
const _buyuk = x => String(x || '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('tr-TR');
const _dosyaAdiTemizle = x => String(x || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim();

// Bağlantı → dosya adı (mailde bağlantının hemen üstündeki satır dosya adıysa)
function _mailDosyaAdlari(metin) {
  const adlar = new Map();
  let onceki = '';
  String(metin || '').split(/\r?\n/).forEach(satir => {
    const urller = satir.match(/https?:\/\/[^\s<>"']+/g) || [];
    if (urller.length) {
      urller.forEach(u => {
        u = u.replace(/[.,;:!?)\]]+$/, '');
        if (!adlar.has(u) && /\.[a-z0-9]{2,5}$/i.test(onceki)) adlar.set(u, onceki);
      });
      onceki = '';
    } else if (satir.trim()) {
      onceki = satir.trim().replace(/^[-•*]\s*/, '');
    }
  });
  return adlar;
}

function _driveId(u) {
  try {
    const a = new URL(u);
    if (!/^(drive|docs)\.google\.com$/i.test(a.hostname)) return null;
    return (/\/file\/d\/([\w-]{10,})/.exec(a.pathname) || [])[1] || a.searchParams.get('id');
  } catch (e) { return null; }
}

function _mailKonu(m) { return _utfOnar(m.subject || '').replace(/^\s*((fwd?|fw|ynt|re|ilt|i̇lt)\s*:\s*)+/i, '').trim(); }
function _mailGonderenAdi(m) {
  const from = _utfOnar(m.from || '');
  return (/^\s*"?([^"<]+?)"?\s*</.exec(from) || [])[1] || (m.from_email || from).split('@')[0];
}

// ZIP adı (klasöre kaydetme yoksa): "GÖNDEREN - KONU"
function _mailPaketAdi(m) {
  return _dosyaAdiTemizle([_buyuk(_mailGonderenAdi(m)), _buyuk(_mailKonu(m))].filter(Boolean).join(' - ')).slice(0, 120) || 'mail-dosyalari';
}

// Mailden Hekim / Hasta / Renk tahmini
function _mailBilgiTahmin(m) {
  const metin = _utfOnar(m.body || m.preview || ''), konu = _utfOnar(m.subject || '');
  const r = _runyesCoz(konu, metin);
  let p = {};
  try { p = parseJobFromMail({ ...m, body: metin, subject: konu }) || {}; } catch (e) { p = {}; }
  // Hekim: kayıtlı hekimin mail adresi eşleşirse onun adı
  const gonderen = String(m.from_email || m.from || '').toLowerCase().replace(/.*<([^>]+)>.*/, '$1').trim();
  let hekim = '';
  try {
    const dr = drArr().find(d => d.email && (gonderen === d.email.toLowerCase() || gonderen.includes(d.email.toLowerCase())));
    if (dr) hekim = dr.name;
  } catch (e) { /* yoksay */ }
  if (!hekim) hekim = r ? r.klinik : _mailGonderenAdi(m);
  // Hasta: Runyes → metindeki ad; aksi halde kısa konu satırı; o da yoksa metinden tahmin
  let hasta = r ? r.hasta : '';
  const k = _mailKonu(m);
  if (!hasta && k && k.length <= 50 && !/order|sipariş|siparis|new|yeni iş/i.test(k)) hasta = k.replace(/\s+\d+$/, '');
  if (!hasta && p.patient) hasta = p.patient;
  // Renk: VITA renk kodu (A1…D4, BL1…)
  let renk = p.toothColor || '';
  if (!renk) {
    const rm = (metin + ' ' + konu).match(/\b(BL[1-4]|[A-D][1-4](?:[.,]5)?|0M[1-3]|[1-5]M[1-3])\b/i);
    if (rm) renk = rm[1].replace(',', '.');
  }
  return { hekim: _buyuk(hekim), hasta: _buyuk(hasta), renk: _buyuk(renk) };
}

function _cdAd(cd) {
  cd = cd || '';
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="([^"]+)"/i.exec(cd);
  try { return m ? decodeURIComponent(m[1]) : ''; } catch (e) { return m ? m[1] : ''; }
}

// ── Kalıcı ana klasör (IndexedDB'de saklanır) ────────────────────────
function _idb() {
  return new Promise((coz, reddet) => {
    const r = indexedDB.open('digicad-mail', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('ayar');
    r.onsuccess = () => coz(r.result);
    r.onerror = () => reddet(r.error);
  });
}
async function _klasorSakla(h) {
  try { const db = await _idb(); db.transaction('ayar', 'readwrite').objectStore('ayar').put(h, 'anaKlasor'); } catch (e) { /* yoksay */ }
}
async function _klasorGetir() {
  try {
    const db = await _idb();
    return await new Promise(coz => { const q = db.transaction('ayar').objectStore('ayar').get('anaKlasor'); q.onsuccess = () => coz(q.result || null); q.onerror = () => coz(null); });
  } catch (e) { return null; }
}
async function _klasorIzni(h) {
  if (!h) return false;
  if (!h.queryPermission) return true;
  if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
}
function _klasorGoster() {
  const el = document.getElementById('dl-folder-display');
  if (el && mailDownloadFolder) el.innerText = mailDownloadFolder.name;
}
// Kayıtlı klasörü geri yükle — sayfa açılışında değil, yalnızca kaydetmeye basınca.
// Bir tarayıcıda okuma sekmeyi çökertirse işaret kalır ve bir daha denenmez.
async function _isaretYaz(deger) {
  const db = await _idb();
  await new Promise((coz, reddet) => { const t = db.transaction('ayar', 'readwrite', { durability: 'strict' }); t.objectStore('ayar').put(deger, 'okuma'); t.oncomplete = coz; t.onerror = () => reddet(t.error); });
}
async function _isaretOku() {
  const db = await _idb();
  return await new Promise(coz => { const q = db.transaction('ayar').objectStore('ayar').get('okuma'); q.onsuccess = () => coz(q.result || ''); q.onerror = () => coz(''); });
}
async function _kayitliKlasoruYukle() {
  if (mailDownloadFolder) return mailDownloadFolder;
  try {
    if ((await _isaretOku()) === 'basladi') return null; // önceki deneme yarıda kaldı: bir daha deneme
    await _isaretYaz('basladi');
    const h = await _klasorGetir();
    await _isaretYaz('tamam');
    if (h && !mailDownloadFolder) { mailDownloadFolder = h; _klasorGoster(); }
  } catch (e) { /* yoksay */ }
  return mailDownloadFolder;
}
// Panelin kendi "Klasör seç" düğmesi de kalıcı olsun
if (typeof selectDownloadFolder === 'function') {
  const _eskiKlasorSec = selectDownloadFolder;
  selectDownloadFolder = async function () { await _eskiKlasorSec(); if (mailDownloadFolder) _klasorSakla(mailDownloadFolder); };
}
async function _klasorSec() {
  if (!window.showDirectoryPicker) throw new Error('Klasöre kaydetmek için Chrome veya Edge gerekir');
  const h = await window.showDirectoryPicker({ id: 'digicad-hastalar', mode: 'readwrite' });
  mailDownloadFolder = h;
  _klasorSakla(h);
  _klasorGoster();
  try { saveMailSettings(); } catch (e) { /* yoksay */ }
  return h;
}

// ── Kaydetme penceresi ───────────────────────────────────────────────
const _mailBilgi = {}; // mailId → onaylanan {hekim, hasta, renk}
function _klasorAdi(b) { return _dosyaAdiTemizle([b.hekim, b.hasta, b.renk].map(_buyuk).filter(Boolean).join(' - ')).slice(0, 150) || 'MAIL DOSYALARI'; }

function _kaydetPenceresi(m, dosyaSayisi, devam) {
  const b = _mailBilgi[m.id] || _mailBilgiTahmin(m);
  document.getElementById('mail-kaydet-pencere')?.remove();
  const p = document.createElement('div');
  p.id = 'mail-kaydet-pencere';
  p.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
  const alan = (id, etiket, deger, ipucu) => '<label style="display:block;margin-bottom:10px"><span style="display:block;font-size:11px;font-weight:800;letter-spacing:.04em;color:#475569;margin-bottom:4px">' + etiket + '</span>' +
    '<input id="' + id + '" value="' + escHtml(deger) + '" placeholder="' + escHtml(ipucu) + '" style="width:100%;box-sizing:border-box;padding:9px 11px;border:1.5px solid #cbd5e1;border-radius:9px;font:inherit;font-size:14px;font-weight:700;text-transform:uppercase"></label>';
  p.innerHTML = '<div style="background:#fff;border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,.25);width:100%;max-width:440px;padding:20px 22px;color:#0f172a">' +
    '<div style="font-size:16px;font-weight:800;margin-bottom:4px">💾 Dosyaları klasöre kaydet</div>' +
    '<div style="font-size:12.5px;color:#64748b;margin-bottom:14px">' + dosyaSayisi + ' dosya, aşağıdaki bilgilerle adlandırılan klasöre kaydedilecek. Bilgiler mailden okundu; gerekirse düzeltin.</div>' +
    alan('mk-hekim', 'HEKİM / KLİNİK', b.hekim, 'Hekim adı') + alan('mk-hasta', 'HASTA', b.hasta, 'Hasta adı soyadı') + alan('mk-renk', 'DİŞ RENGİ', b.renk, 'Örn. A2 (boş bırakılabilir)') +
    '<div style="background:#f1f5f9;border-radius:9px;padding:9px 11px;font-size:12.5px;margin:4px 0 14px">📁 Kayıt yeri:<br><b id="mk-yol" style="word-break:break-all"></b>' +
    '<div><button type="button" id="mk-klasor" style="margin-top:7px;padding:5px 10px;border:1.5px solid #1565c0;background:#fff;color:#1565c0;border-radius:7px;font:inherit;font-size:12px;font-weight:700;cursor:pointer">📁 Ana klasörü değiştir</button></div></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" id="mk-vazgec" style="padding:9px 14px;border:1.5px solid #cbd5e1;background:#fff;border-radius:9px;font:inherit;font-weight:700;cursor:pointer">Vazgeç</button>' +
    '<button type="button" id="mk-kaydet" style="padding:9px 16px;border:0;background:#059669;color:#fff;border-radius:9px;font:inherit;font-weight:800;cursor:pointer">💾 Kaydet</button></div></div>';
  document.body.appendChild(p);
  const oku = () => ({ hekim: document.getElementById('mk-hekim').value, hasta: document.getElementById('mk-hasta').value, renk: document.getElementById('mk-renk').value });
  const yolGuncelle = () => { document.getElementById('mk-yol').textContent = (mailDownloadFolder ? mailDownloadFolder.name : '(henüz seçilmedi — Kaydet’e basınca sorulacak)') + ' \\ ' + _klasorAdi(oku()); };
  yolGuncelle();
  ['mk-hekim', 'mk-hasta', 'mk-renk'].forEach(i => document.getElementById(i).addEventListener('input', yolGuncelle));
  document.getElementById('mk-klasor').onclick = async () => { try { await _klasorSec(); yolGuncelle(); } catch (e) { if (e.name !== 'AbortError') toast(e.message, 'error'); } };
  document.getElementById('mk-vazgec').onclick = () => p.remove();
  document.getElementById('mk-kaydet').onclick = async () => {
    const bilgi = oku();
    if (!_buyuk(bilgi.hasta)) { toast('Hasta adını yazın', 'error'); document.getElementById('mk-hasta').focus(); return; }
    try {
      // Bu tıklama içinde klasörü seç / izni al (tarayıcı bunu yalnızca tıklamayla izin verir)
      let ana = mailDownloadFolder;
      if (!ana) ana = await _klasorSec();
      if (!(await _klasorIzni(ana))) { toast('Klasöre yazma izni verilmedi', 'error'); return; }
      _mailBilgi[m.id] = bilgi;
      p.remove();
      devam(bilgi, ana);
    } catch (e) { if (e.name !== 'AbortError') toast('Klasör seçilemedi: ' + e.message, 'error'); }
  };
  document.getElementById('mk-hasta').focus();
}

async function _klasoreYaz(ana, bilgi, dosyalar, m) {
  const ad = _klasorAdi(bilgi);
  const dir = await ana.getDirectoryHandle(ad, { create: true });
  for (const d of dosyalar) {
    const fh = await dir.getFileHandle(d.ad, { create: true });
    const w = await fh.createWritable(); await w.write(d.blob); await w.close();
  }
  try {
    const fh = await dir.getFileHandle('MAIL.txt', { create: true });
    const w = await fh.createWritable();
    await w.write('Kimden: ' + _utfOnar(m.from || '') + '\r\nKonu: ' + _utfOnar(m.subject || '') + '\r\nTarih: ' + (m.date ? new Date(m.date).toLocaleString('tr-TR') : '') + '\r\n' + '-'.repeat(50) + '\r\n' + _utfOnar(m.body || m.preview || ''));
    await w.close();
  } catch (e) { /* yoksay */ }
  return ana.name + ' \\ ' + ad;
}

// ── Dosyayı getirme (yerel sunucu → gerekirse Drive API) ─────────────
let _driveToken = null, _driveIstemci = null, _driveSonra = null;

async function _mailDosyaGetir(u) {
  const r = await fetch('/api/mail-indir?panel=yonetici&u=' + encodeURIComponent(u), { credentials: 'same-origin' });
  if (r.ok) return { blob: await r.blob(), sunucuAdi: _cdAd(r.headers.get('content-disposition')) };
  const mesaj = await r.text().catch(() => 'Hata ' + r.status);
  const id = _driveId(u);
  if (id && _driveToken) {
    const d = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?alt=media&supportsAllDrives=true', { headers: { Authorization: 'Bearer ' + _driveToken } });
    if (d.ok) {
      let ad = '';
      try {
        const meta = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(id) + '?fields=name&supportsAllDrives=true', { headers: { Authorization: 'Bearer ' + _driveToken } });
        if (meta.ok) ad = (await meta.json()).name || '';
      } catch (e) { /* yoksay */ }
      return { blob: await d.blob(), sunucuAdi: ad };
    }
    if (d.status === 401) _driveToken = null;
    let neden = 'erişim yok';
    try { const j = await d.json(); neden = (j.error && j.error.message) || neden; } catch (e) { /* yoksay */ }
    const e = new Error('Google Drive: ' + neden); e.drive = true; e.driveApi = /has not been used|disabled/i.test(neden); throw e;
  }
  const e = new Error(mesaj); e.drive = !!id && r.status === 403; throw e;
}

// ── İndir ve kaydet ──────────────────────────────────────────────────
function _mailTumuDugmesi(id, adet) {
  return '<div style="margin-bottom:10px"><button type="button" id="mail-tumu-btn" onclick="mailTumunuIndir(\'' + escHtml(id) + '\', this)" ' +
    'style="display:inline-flex;align-items:center;gap:8px;padding:11px 18px;border:0;border-radius:10px;cursor:pointer;font:inherit;font-size:14px;font-weight:800;' +
    'background:#1565c0;color:#fff;box-shadow:0 2px 10px rgba(21,101,192,.35)">📦 Tümünü İndir (' + adet + ' dosya)</button>' +
    '<div id="mail-drive-izin"></div></div>';
}

// Tümünü İndir: önce bilgi penceresi, sonra hepsini klasöre kaydet
function mailTumunuIndir(id) {
  const m = mailDB.mails.find(x => x.id === id);
  if (!m) return;
  const linkler = _mailBaglantilari(_utfOnar(m.body || m.preview || '')).filter(_mailIndirmeMi);
  if (!linkler.length) { toast('Bu mailde indirilecek bağlantı yok', 'info'); return; }
  _baslat(m, linkler);
}
// Tek dosya: aynı pencere, tek bağlantı
function mailDosyaKaydet(id, url) {
  const m = mailDB.mails.find(x => x.id === id);
  if (!m) return;
  _baslat(m, [url]);
}
async function _baslat(m, linkler) {
  if (!window.showDirectoryPicker) { _zipIleIndir(m, linkler); return; } // klasöre yazamayan tarayıcı: ZIP
  await _kayitliKlasoruYukle();
  _kaydetPenceresi(m, linkler.length, (bilgi, ana) => _indirVeKaydet(m, linkler, bilgi, ana));
}

async function _dosyalariGetir(m, linkler, ilerleme) {
  const metin = _utfOnar(m.body || m.preview || ''), konu = _utfOnar(m.subject || '');
  const adlar = _mailDosyaAdlari(metin);
  const r = _runyesCoz(konu, metin);
  const kullanilan = new Set(), dosyalar = [], hatali = [];
  for (let i = 0; i < linkler.length; i++) {
    const u = linkler[i];
    if (ilerleme) ilerleme(i + 1, linkler.length);
    let ad = adlar.get(u) || (r && r.url === u ? r.dosyaAdi : '');
    try {
      const g = await _mailDosyaGetir(u);
      ad = _dosyaAdiTemizle(ad || g.sunucuAdi || _mailBaglantiAdi(u) || ('dosya-' + (i + 1)));
      let aday = ad, n = 2;
      while (kullanilan.has(aday.toLowerCase())) aday = ad.replace(/(\.[a-z0-9]{2,5})?$/i, ' (' + (n++) + ')$1');
      kullanilan.add(aday.toLowerCase());
      dosyalar.push({ ad: aday, blob: g.blob });
    } catch (e) {
      hatali.push({ u, ad: ad || _mailBaglantiAdi(u), hata: e.message, drive: !!e.drive, driveApi: !!e.driveApi });
    }
  }
  return { dosyalar, hatali };
}

async function _indirVeKaydet(m, linkler, bilgi, ana) {
  const btn = document.getElementById('mail-tumu-btn');
  const eski = btn ? btn.innerHTML : '';
  if (btn) btn.disabled = true;
  const izinKutusu = document.getElementById('mail-drive-izin');
  if (izinKutusu) izinKutusu.innerHTML = '';
  toast('⏳ ' + linkler.length + ' dosya indiriliyor…', 'info');
  try {
    const { dosyalar, hatali } = await _dosyalariGetir(m, linkler, (i, n) => { if (btn) btn.innerHTML = '⏳ ' + i + ' / ' + n + ' indiriliyor…'; });
    if (dosyalar.length) {
      const yol = await _klasoreYaz(ana, bilgi, dosyalar, m);
      toast((hatali.length ? '⚠️ ' + dosyalar.length + '/' + linkler.length : '✅ ' + dosyalar.length) + ' dosya kaydedildi: ' + yol, hatali.length ? 'error' : 'success');
    } else {
      toast('Dosyalar indirilemedi: ' + (hatali[0] ? hatali[0].hata : ''), 'error');
    }
    if (hatali.length) _hataKutusu(m, linkler, hatali, () => _indirVeKaydet(m, hatali.map(h => h.u), bilgi, ana));
  } catch (e) {
    toast('Kaydedilemedi: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = eski; }
  }
}

// Klasöre yazamayan tarayıcılar için: tek ZIP
async function _zipIleIndir(m, linkler) {
  if (typeof JSZip === 'undefined') { toast('ZIP kütüphanesi yüklenemedi', 'error'); return; }
  const { dosyalar, hatali } = await _dosyalariGetir(m, linkler);
  if (!dosyalar.length) { toast('Dosyalar indirilemedi', 'error'); return; }
  const zip = new JSZip();
  dosyalar.forEach(d => zip.file(d.ad, d.blob));
  const blob = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = _mailPaketAdi(m) + '.zip';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  if (hatali.length) _hataKutusu(m, linkler, hatali, null);
}

// İndirilemeyen dosyalar: nedenleri + çözüm yolları
function _hataKutusu(m, linkler, hatali, tekrarDene) {
  let kutu = document.getElementById('mail-drive-izin');
  if (!kutu) {
    const panel = document.querySelector('#mail-detail-panel .mail-detail-body');
    if (!panel) return;
    kutu = document.createElement('div'); kutu.id = 'mail-drive-izin'; kutu.style.margin = '0 20px';
    panel.parentNode.insertBefore(kutu, panel);
  }
  const apiKapali = hatali.some(h => h.driveApi);
  const driveVar = hatali.some(h => h.drive);
  _driveSonra = tekrarDene;
  const dugmeStil = 'margin:8px 8px 0 0;padding:8px 14px;border:0;border-radius:8px;cursor:pointer;font:inherit;font-weight:800;color:#fff;';
  kutu.innerHTML = '<div style="margin-top:10px;padding:10px 12px;border-radius:10px;background:#fff7ed;border:1.5px solid #fdba74;font-size:12.5px;color:#9a3412">' +
    '<b>' + hatali.length + ' dosya indirilemedi:</b>' +
    '<ul style="margin:6px 0 0 18px;padding:0">' + hatali.map(h => '<li>' + escHtml(h.ad) + ' — <i>' + escHtml(h.hata) + '</i></li>').join('') + '</ul>' +
    (apiKapali ? '<div style="margin-top:6px">⚠️ Google Drive API kapalı: <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com?project=primer-dental" target="_blank" rel="noopener" style="font-weight:700;color:#9a3412">buradan “Etkinleştir”e basın</a>, birkaç dakika sonra tekrar deneyin.</div>' : '') +
    (driveVar && !apiKapali && tekrarDene ? '<button type="button" onclick="mailDriveIzni()" style="' + dugmeStil + 'background:#ea580c">🔑 Google Drive izni ver ve tekrar dene</button>' : '') +
    '<button type="button" onclick="mailTarayicidaIndir(\'' + escHtml(m.id) + '\')" style="' + dugmeStil + 'background:#0f766e">⬇️ Tarayıcıyla indir (İndirilenler klasörüne)</button>' +
    '</div>';
}

function mailDriveIzni() {
  if (!(window.google && google.accounts && google.accounts.oauth2)) { toast('Google girişi yüklenemedi, sayfayı yenileyin', 'error'); return; }
  if (!_driveIstemci) {
    _driveIstemci = google.accounts.oauth2.initTokenClient({
      client_id: GMAIL_CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      callback: resp => {
        if (resp.error) { toast('Drive izni alınamadı: ' + resp.error, 'error'); return; }
        const kapsam = 'https://www.googleapis.com/auth/drive.readonly';
        if (google.accounts.oauth2.hasGrantedAllScopes && !google.accounts.oauth2.hasGrantedAllScopes(resp, kapsam)) {
          toast('Drive izni verilmedi: izin penceresinde “Google Drive dosyalarınızı görme ve indirme” kutucuğunu İŞARETLEYİP devam edin', 'error');
          return;
        }
        _driveToken = resp.access_token;
        toast('✅ Drive izni verildi, dosyalar indiriliyor…', 'success');
        if (_driveSonra) _driveSonra();
      },
      error_callback: err => toast('Drive izni tamamlanamadı: ' + ((err && (err.message || err.type)) || 'pencere kapandı'), 'error'),
    });
  }
  _driveIstemci.requestAccessToken();
}

// Son çare: dosyaları tarayıcının kendi Google oturumuyla İndirilenler klasörüne indirir
async function mailTarayicidaIndir(id) {
  const m = mailDB.mails.find(x => x.id === id);
  if (!m) return;
  const linkler = _mailBaglantilari(_utfOnar(m.body || m.preview || '')).filter(_mailIndirmeMi);
  if (!linkler.length) return;
  toast('⬇️ ' + linkler.length + ' dosya tarayıcıyla İndirilenler klasörüne indiriliyor. Chrome “birden fazla dosya indirilsin mi?” diye sorarsa İzin ver’e basın.', 'info');
  for (let i = 0; i < linkler.length; i++) {
    const did = _driveId(linkler[i]);
    const adres = did ? 'https://drive.usercontent.google.com/download?id=' + encodeURIComponent(did) + '&export=download&confirm=t' : linkler[i];
    const f = document.createElement('iframe');
    f.style.display = 'none'; f.src = adres;
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 120000);
    await new Promise(c => setTimeout(c, 1500));
  }
}

// ── Mail ekranındaki ⬇️ bağlantılarına tıklanınca klasöre kaydet ──────
let _acikMailId = null;
if (typeof openMail === 'function') {
  const _eskiOpenMail = openMail;
  openMail = function (id) { _acikMailId = id; return _eskiOpenMail.apply(this, arguments); };
}
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('#mail-detail-panel a');
  if (!a || !_acikMailId || !/^\s*⬇️/.test(a.textContent || '')) return;
  if (!window.showDirectoryPicker) return; // klasöre yazamayan tarayıcı: normal indirme
  let u = a.getAttribute('href') || '';
  if (u.startsWith('/api/mail-indir')) { try { u = new URL(u, location.origin).searchParams.get('u') || ''; } catch (x) { return; } }
  if (!/^https?:\/\//i.test(u)) return;
  e.preventDefault();
  mailDosyaKaydet(_acikMailId, u);
});
