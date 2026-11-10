#!/usr/bin/env node
'use strict';
// ═══════════════════════════════════════════════════════════════════
//  SAYFA DÖNÜŞTÜRÜCÜ
//  GitHub'daki (Firebase kullanan) orijinal HTML dosyalarını alır, yerel
//  sunucuyla çalışacak hâle getirip public/ klasörüne yazar.
//
//  Kullanım:
//    node araclar/sayfalari-donustur.js <orijinal-dosyalarin-klasoru> [başka klasör ...]
//
//  Orijinal sayfalarda ileride değişiklik yaparsanız bu betiği yeniden
//  çalıştırmanız yeterlidir. Beklenen kod parçası bulunamazsa betik durur
//  ve hangi parçanın bulunamadığını söyler (sessizce bozuk sayfa üretmez).
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

const HEDEF = path.join(__dirname, '..', 'public');

function degistir(html, eski, yeni, aciklama) {
  const i = html.indexOf(eski);
  if (i < 0) throw new Error(`Bulunamadı: ${aciklama}`);
  if (html.indexOf(eski, i + eski.length) >= 0) throw new Error(`Birden fazla bulundu: ${aciklama}`);
  return html.slice(0, i) + yeni + html.slice(i + eski.length);
}

// "function ad(...) { ... }" bloğunu (satır başında biten "}" ile) tamamen değiştirir
function fonksiyonDegistir(html, ad, yeniKod) {
  const desen = new RegExp(`\\n(async )?function ${ad}\\(`, 'g');
  const eslesmeler = [...html.matchAll(desen)];
  if (eslesmeler.length !== 1) throw new Error(`function ${ad} ${eslesmeler.length} kez bulundu (1 bekleniyordu)`);
  const bas = eslesmeler[0].index + 1;
  const son = html.indexOf('\n}\n', bas);
  if (son < 0) throw new Error(`function ${ad} sonu bulunamadı`);
  return html.slice(0, bas) + yeniKod.trim() + html.slice(son + 2);
}

function ortakDonusum(html, panel) {
  // 1) Firebase SDK betiklerini kaldır, yerel kütüphaneyi ekle
  const sdk = /[ \t]*<script src="https:\/\/www\.gstatic\.com\/firebasejs\/[^"]+"><\/script>\r?\n?/g;
  const ilk = html.search(sdk);
  if (ilk < 0) throw new Error('Firebase SDK betikleri bulunamadı');
  html = html.replace(sdk, '');
  html = html.slice(0, ilk) +
    `<script>window.DL_PANEL='${panel}';</script>\n<script src="firebase-yerel.js"></script>\n` + html.slice(ilk);
  // 2) JSZip artık yerelden yüklenir
  html = html.replace('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js', 'jszip.min.js');
  // 3) Firebase proje bilgileri (API anahtarı vb.) sayfadan silinir
  const cfg = /const firebaseConfig = \{[\s\S]*?\n\};/;
  if (!cfg.test(html)) throw new Error('firebaseConfig bulunamadı');
  html = html.replace(cfg, 'const firebaseConfig = {}; // Yerel sunucu kullanılıyor — Firebase bağlantısı yok');
  return html;
}

// ── YÖNETİM PANELİ ──────────────────────────────────────────────────
function yonetimPaneli(html) {
  html = ortakDonusum(html, 'yonetici');

  // Primer Teknoloji çalışma alanı da artık sunucuda saklanır
  // (eskiden sadece tarayıcı belleğindeydi — tarayıcı temizlenince kaybolurdu)
  html = fonksiyonDegistir(html, 'isOfflineWorkspace', `
function isOfflineWorkspace() {
  return false; // Yerel sunucu: her iki çalışma alanı da sunucuda saklanır
}`);

  // Açılışta şifreyi veritabanından/tarayıcıdan okuma kaldırıldı
  const bas = html.indexOf('  // Şifreyi her iki workspace için de ortak yerden çek');
  const sonIfade = "  try { localStorage.setItem('primer_dental_app_pass', pass); } catch(e) {}\n";
  const son = html.indexOf(sonIfade, bas);
  if (bas < 0 || son < 0) throw new Error('Açılış şifre bloğu bulunamadı');
  html = html.slice(0, bas) +
    "  // Şifre artık SUNUCUDA doğrulanır; tarayıcıda şifre tutulmaz\n" +
    "  DB.pass = '';\n  try { localStorage.removeItem('primer_dental_app_pass'); } catch(e) {}\n" +
    html.slice(son + sonIfade.length);

  html = fonksiyonDegistir(html, 'numPress', `
function numPress(n) {
  if (lockInput.length >= 4) return;
  lockInput += n;
  updateDots();
  if (lockInput.length === 4) {
    const denenen = lockInput;
    // PIN sunucuda kontrol edilir (5 hatalı denemede 15 dk kilit)
    DL.giris({ pin: denenen }).then(() => {
      _appUnlocked = true;
      document.getElementById('lock-screen').style.display = 'none';
      lockInput = '';
      DL.yenidenBaglan();
      showWorkspaceScreen();
    }).catch(e => {
      document.getElementById('lock-msg').innerText = '❌ ' + (e.message || 'Hatalı şifre!');
      lockInput = '';
      updateDots();
    });
  }
}`);

  html = degistir(html, "el.innerHTML = '🟢 Firebase bağlı';", "el.innerHTML = '🟢 Yerel sunucuya bağlı';", 'bağlantı etiketi');
  html = degistir(html, "Firebase'e bağlanıyor...", 'Sunucuya bağlanıyor...', 'yükleniyor yazısı');
  html = degistir(html, "toast('Firebase bağlantı hatası — çevrimdışı mod', 'error');", "toast('Sunucu bağlantı hatası', 'error');", 'bağlantı hatası');

  html = yazdirmaKarti(html);
  html = mailDuzeltmeleri(html);
  {
    const son = html.lastIndexOf('</body>');
    html = html.slice(0, son) + '<script src="mail-ek.js"></script>\n' + html.slice(son);
  }

  // Gmail giriş penceresi kapanır ya da hata verirse sebebi ekranda görünsün
  html = degistir(html, "    scope: GMAIL_SCOPES,\n    callback: (resp) => {",
    "    scope: GMAIL_SCOPES,\n    error_callback: (err) => toast('Gmail girişi tamamlanamadı: ' + ((err && (err.message || err.type)) || 'pencere kapandı'), 'error'),\n    callback: (resp) => {",
    'Gmail giriş hata bildirimi');

  // Ayarlar sayfasına "Veri Aktarımı" düğmesi
  html = degistir(html, '<button class="btn btn-outline" onclick="exportDB()">⬇️ Yedek İndir (.json)</button>',
    '<button class="btn btn-outline" onclick="exportDB()">⬇️ Yedek İndir (.json)</button>\n            ' +
    '<a class="btn btn-outline" href="VeriAktarimi.html" target="_blank" style="text-decoration:none">🔄 Eski Sistemden Veri Aktar / Tam Yedek</a>',
    'Yedek İndir düğmesi');

  html = fonksiyonDegistir(html, 'changePass', `
function changePass() {
  const old = document.getElementById('pass-old').value;
  const nw  = document.getElementById('pass-new').value;
  const cf  = document.getElementById('pass-confirm').value;
  if (nw.length !== 4 || !/^\\d{4}$/.test(nw)) { toast('Yeni şifre 4 haneli rakam olmalı!','error'); return; }
  if (nw !== cf) { toast('Şifreler eşleşmiyor!','error'); return; }
  DL.pinDegistir(old, nw).then(() => {
    ['pass-old','pass-new','pass-confirm'].forEach(id => document.getElementById(id).value='');
    toast('🔑 Şifre değiştirildi!');
  }).catch(e => toast(e.message || 'Şifre değiştirilemedi', 'error'));
}`);
  return html;
}

// ── GELEN İŞLER PANELİ ──────────────────────────────────────────────
function gelenIsler(html) {
  html = ortakDonusum(html, 'yonetici');
  html = degistir(html,
    "rtdb.ref(dbRoot + '/pass').once('value').then(snap => {\n  dbPass = snap.val() || '0000';\n}).catch(() => {});",
    '// Şifre artık sunucuda doğrulanır (veritabanından okunmaz)',
    'Gelen İşler şifre okuma');
  html = fonksiyonDegistir(html, 'numPress', `
function numPress(n) {
  if (lockInput.length >= 4) return;
  lockInput += n;
  updateDots();
  if (lockInput.length === 4) {
    const denenen = lockInput;
    DL.giris({ pin: denenen }).then(() => {
      _unlocked = true;
      document.getElementById('lock-screen').style.display = 'none';
      DL.yenidenBaglan();
      startApp();
    }).catch(e => {
      document.getElementById('lock-msg').innerText = '❌ ' + (e.message || 'Hatalı şifre!');
      lockInput = '';
      updateDots();
    });
  }
}`);
  return html;
}

// ── HEKİM PORTALI ───────────────────────────────────────────────────
function hekimPortali(html) {
  html = ortakDonusum(html, 'hekim');
  html = fonksiyonDegistir(html, 'restoreSession', `
function restoreSession() {
  // Oturum artık sunucuda tutulur (güvenli çerez). Tarayıcıdaki eski kayıt silinir.
  try { localStorage.removeItem(SESSION_KEY); } catch(e) {}
  DL.ben().then(r => {
    if (r && r.kullanici) enterSession(r.kullanici); else showLoginScreen();
  }).catch(() => showLoginScreen());
}`);
  html = fonksiyonDegistir(html, 'doctorLogin', `
function doctorLogin() {
  const u = document.getElementById('login-username').value.trim().toLowerCase();
  const p = document.getElementById('login-password').value;
  document.getElementById('login-error').style.display = 'none';
  if (!u || !p) { showLoginError('Kullanıcı adı ve şifre zorunludur.'); return; }
  const btn = document.getElementById('login-btn');
  btn.disabled = true; btn.innerHTML = '⏳ Giriş yapılıyor…';
  // Şifre SUNUCUDA kontrol edilir — hekim listesi/şifreler tarayıcıya hiç gelmez
  DL.giris({ kullaniciAdi: u, sifre: p }).then(r => {
    DL.yenidenBaglan();
    enterSession(r.kullanici);
  }).catch(e => {
    showLoginError(e.message || 'Kullanıcı adı veya şifre hatalı.');
    btn.disabled = false; btn.innerHTML = 'Giriş Yap';
  });
}`);
  html = baglantiDestegi(html);
  html = degistir(html, 'try { localStorage.removeItem(SESSION_KEY); } catch(e) {}\n  stopMySubmissionsListener();',
    'try { localStorage.removeItem(SESSION_KEY); } catch(e) {}\n  DL.cikis().catch(() => {}).then(() => DL.yenidenBaglan());\n  stopMySubmissionsListener();',
    'Hekim çıkış');
  return html;
}

// ── TEKNİSYEN PORTALI ───────────────────────────────────────────────
function teknisyenPaneli(html) {
  html = ortakDonusum(html, 'teknisyen');
  html = fonksiyonDegistir(html, 'restoreSession', `
function restoreSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch(e) {}
  DL.ben().then(r => {
    if (r && r.kullanici) enterSession(r.kullanici); else showLoginScreen();
  }).catch(() => showLoginScreen());
}`);
  html = fonksiyonDegistir(html, 'techLogin', `
function techLogin() {
  const u = document.getElementById('login-username').value.trim().toLowerCase();
  const p = document.getElementById('login-password').value;
  document.getElementById('login-error').style.display = 'none';
  if (!u || !p) { showLoginError('Kullanıcı adı ve şifre zorunludur.'); return; }
  const btn = document.getElementById('login-btn');
  btn.disabled = true; btn.innerHTML = '⏳ Giriş yapılıyor…';
  DL.giris({ kullaniciAdi: u, sifre: p }).then(r => {
    DL.yenidenBaglan();
    enterSession(r.kullanici);
  }).catch(e => {
    showLoginError(e.message || 'Kullanıcı adı veya şifre hatalı.');
    btn.disabled = false; btn.innerHTML = 'Giriş Yap';
  });
}`);
  html = degistir(html, 'try { localStorage.removeItem(SESSION_KEY); } catch(e) {}\n  currentTech = null;',
    'try { localStorage.removeItem(SESSION_KEY); } catch(e) {}\n  DL.cikis().catch(() => {}).then(() => DL.yenidenBaglan());\n  currentTech = null;',
    'Teknisyen çıkış');
  // Simge ve "bu bilgisayara kur" bağlantısı
  html = degistir(html, "<script>window.DL_PANEL='teknisyen';</script>",
    `<link rel="icon" href="favicon.ico"><link rel="apple-touch-icon" href="simge-192.png"><meta name="theme-color" content="#1565c0">
<script>window.DL_PANEL='teknisyen';</script>`, 'teknisyen başlık');
  const ipucu = html.match(/<div class="login-hint">[\s\S]*?<\/div>/);
  if (!ipucu) throw new Error('teknisyen login-hint bulunamadı');
  html = html.replace(ipucu[0], ipucu[0] + `
    <div class="login-hint" style="margin-top:10px">💻 <a href="TeknisyenPaneliKurulum.bat" style="color:var(--primary);font-weight:600">Bu bilgisayara kur</a> (masaüstüne simge ekler) · 📱 Telefonda tarayıcı menüsünden <b>“Ana ekrana ekle”</b></div>`);
  return html;
}


// ── HEKİM PORTALI: tarama dosyası yerine BAĞLANTI (link) gönderebilme ───
// Hekim STL/PLY yükleyemediğinde WeTransfer / Drive / Medit Link vb. paylaşım
// bağlantısını yapıştırabilir. Bağlantılar, laboratuvar tarafının hiçbir
// değişiklik gerektirmeden gösterebilmesi için "files" listesine
// `/baglanti?u=...` adresiyle eklenir: tıklanınca sunucu bağlantıya
// yönlendirir, "ZIP olarak indir"de ise ZIP'e çift tıklanabilir .url
// kısayolu olarak girer.
function baglantiDestegi(html) {
  const css = `
/* ── Tarama bağlantısı (link) ── */
.hp-link-box{margin-top:14px;border:1.5px dashed var(--border,#c3d0e0);border-radius:12px;padding:14px;background:var(--primary-light,#e8f0fe)}
.hp-link-title{font-weight:700;font-size:14px;color:var(--text,#101d33)}
.hp-link-sub{font-size:12.5px;color:var(--text-soft,#4c5f78);margin:3px 0 10px}
.hp-link-row{display:flex;gap:8px}
.hp-link-row .inp{flex:1;min-width:0}
.hp-link-add{border:0;border-radius:10px;background:var(--primary,#1565c0);color:#fff;font-weight:700;padding:0 18px;cursor:pointer;font-family:inherit}
.hp-link-item{display:flex;align-items:center;gap:8px;background:var(--surface,#fff);border:1px solid var(--border,#c3d0e0);border-radius:10px;padding:8px 10px;margin-top:8px;font-size:13px}
.hp-link-item a{font-weight:600;color:var(--primary,#1565c0);text-decoration:none;white-space:nowrap}
.hp-link-item small{color:var(--text-soft,#4c5f78);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.hp-link-item button{border:0;background:none;color:var(--danger,#e53935);font-size:16px;cursor:pointer;padding:0 4px}
`;
  const ilkStil = html.indexOf('</style>');
  if (ilkStil < 0) throw new Error('</style> bulunamadı');
  html = html.slice(0, ilkStil) + css + html.slice(ilkStil);

  html = degistir(html, '<div class="conn-note" id="upload-conn-note">⏳ Dosya yükleme bağlantısı hazırlanıyor…</div>',
    `<div class="conn-note" id="upload-conn-note">⏳ Dosya yükleme bağlantısı hazırlanıyor…</div>
            <div class="hp-link-box" id="hp-link-box">
              <div class="hp-link-title">🔗 Dosya yükleyemiyor musunuz? Bağlantı (link) olarak gönderin</div>
              <div class="hp-link-sub">WeTransfer, Google Drive, Dropbox, OneDrive, Medit Link, 3Shape Communicate, iTero vb. paylaşım bağlantısını yapıştırıp <b>Ekle</b>'ye basın. Dosya yerine bağlantı eklemeniz yeterlidir.</div>
              <div class="hp-link-row">
                <input type="url" id="hp-link-input" class="inp" placeholder="https://…" autocomplete="off" onkeydown="if(event.key==='Enter'){event.preventDefault();addScanLink();}">
                <button type="button" class="hp-link-add" onclick="addScanLink()">Ekle</button>
              </div>
              <div id="hp-link-list"></div>
            </div>`, 'bağlantı kutusu yeri');

  html = degistir(html, 'let uploadedFiles = [];     // {name, size, url, uploading, error}',
    `let uploadedFiles = [];     // {name, size, url, uploading, error}
let scanLinks = [];         // {url, name} — dosya yerine gönderilen paylaşım bağlantıları
function _linkSaglayici(u) {
  const bilinen = { 'wetransfer.com':'WeTransfer', 'we.tl':'WeTransfer', 'drive.google.com':'Google Drive', 'docs.google.com':'Google Drive',
    'dropbox.com':'Dropbox', 'onedrive.live.com':'OneDrive', '1drv.ms':'OneDrive', 'sharepoint.com':'OneDrive', 'meditlink.com':'Medit Link',
    '3shapecommunicate.com':'3Shape Communicate', 'icloud.com':'iCloud', 'mega.nz':'MEGA', 'itero.com':'iTero', 'yandex.com':'Yandex Disk', 'disk.yandex.com.tr':'Yandex Disk' };
  try { const h = new URL(u).hostname.replace(/^www\\./, ''); for (const k in bilinen) if (h === k || h.endsWith('.' + k)) return bilinen[k]; return h; }
  catch (e) { return 'Bağlantı'; }
}
function addScanLink() {
  const inp = document.getElementById('hp-link-input');
  let v = (inp.value || '').trim();
  if (!v) { toast('Önce bağlantıyı yapıştırın', 'info'); return; }
  if (!/^https?:\\/\\//i.test(v)) v = 'https://' + v;
  let u;
  try { u = new URL(v); } catch (e) { toast('Geçerli bir bağlantı girin (https://… ile başlayan)', 'error'); return; }
  if (!/^https?:$/.test(u.protocol) || u.hostname.indexOf('.') < 0) { toast('Geçerli bir bağlantı girin', 'error'); return; }
  if (!scanLinks.some(l => l.url === u.href)) scanLinks.push({ url: u.href, name: 'Tarama bağlantısı - ' + _linkSaglayici(u.href) });
  inp.value = '';
  renderScanLinks();
  updateSummary();
  toast('🔗 Bağlantı eklendi', 'success');
}
function removeScanLink(i) { scanLinks.splice(i, 1); renderScanLinks(); updateSummary(); }
function renderScanLinks() {
  const el = document.getElementById('hp-link-list');
  if (!el) return;
  el.innerHTML = scanLinks.map((l, i) => '<div class="hp-link-item"><span>🔗</span>' +
    '<a href="' + escHtml(l.url) + '" target="_blank" rel="noopener">' + escHtml(l.name.replace('Tarama bağlantısı - ', '')) + '</a>' +
    '<small>' + escHtml(l.url) + '</small>' +
    '<button type="button" title="Kaldır" onclick="removeScanLink(' + i + ')">✕</button></div>').join('');
}`, 'uploadedFiles tanımı');

  html = fonksiyonDegistir(html, 'getUploadedFileRecords', `
function getUploadedFileRecords() {
  const dosyalar = uploadedFiles.filter(f => f.url).map(f => ({ name: f.name, url: f.url, size: f.size }));
  // Bağlantılar da laboratuvara "dosya" gibi gider: tıklanınca bağlantı açılır,
  // ZIP indirmede çift tıklanabilir internet kısayolu (.url) olur
  const baglantilar = scanLinks.map(l => ({ name: l.name + '.url', url: '/baglanti?u=' + encodeURIComponent(l.url), size: 0, link: true, linkUrl: l.url }));
  return dosyalar.concat(baglantilar);
}`);

  html = degistir(html, "{ key:'files', label:'Tarama Dosyası', value: fileCount ? `${fileCount} dosya yüklendi` : '', stepId:'step-files' },",
    "{ key:'files', label:'Tarama Dosyası / Bağlantı', value: fileCount ? `${fileCount} dosya / bağlantı eklendi` : '', stepId:'step-files' },",
    'özet satırı');
  html = degistir(html, "if (!files.length) missing.push('Tarama Dosyası');", "if (!files.length) missing.push('Tarama Dosyası veya Bağlantı');", 'eksik alan');
  html = degistir(html, '\n  uploadedFiles = [];', '\n  uploadedFiles = [];\n  scanLinks = []; renderScanLinks();', 'form sıfırlama');

  // Simge, ana ekrana ekleme ve "bu bilgisayara kur" bağlantısı
  html = degistir(html, "<script>window.DL_PANEL='hekim';</script>",
    `<link rel="icon" href="favicon.ico"><link rel="apple-touch-icon" href="simge-192.png"><link rel="manifest" href="hekim.webmanifest"><meta name="theme-color" content="#1565c0">
<script>window.DL_PANEL='hekim';</script>`, 'hekim başlık');
  const ipucu = html.match(/<div class="login-hint">[\s\S]*?<\/div>/);
  if (!ipucu) throw new Error('login-hint bulunamadı');
  html = html.replace(ipucu[0], ipucu[0] + `
    <div class="login-hint" style="margin-top:10px">💻 <a href="HekimPortaliKurulum.bat" style="color:var(--primary);font-weight:600">Bu bilgisayara kur</a> (masaüstüne simge ekler) · 📱 Telefonda tarayıcı menüsünden <b>“Ana ekrana ekle”</b></div>`);
  return html;
}


// ── YÖNETİM PANELİ: "Hekimden gelen işleri otomatik yazdır" ayarı ───────
function yazdirmaKarti(html) {
  const kart = `<div class="card" style="border-color:#0ea5e9" id="yazdirma-karti">
          <div class="card-title">🖨️ Hekimden Gelen İşleri Otomatik Yazdır</div>
          <p style="font-size:12px;color:var(--text-soft);margin-bottom:14px">
            Açıkken, <b>Hekim Portalı'ndan gönderilen her iş</b> hiçbir şey sormadan seçtiğiniz yazıcıdan <b>iş formu</b> olarak çıkar (hekim, hasta, iş türü, diş şeması, renk, teslim tarihi, notlar, dosya/bağlantı listesi). Yazdırmayı sunucu yaptığı için bu panel kapalıyken de çalışır.
          </p>
          <label style="display:flex;align-items:center;gap:12px;cursor:pointer;background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:12px;padding:12px 16px;margin-bottom:12px">
            <input type="checkbox" id="yazdirma-toggle" onchange="yazdirmaKaydet()" style="width:20px;height:20px;flex-shrink:0">
            <span style="font-size:13px;font-weight:700"><span id="yazdirma-toggle-label">Otomatik Yazdırma: Kapalı</span>
              <div style="font-size:11px;color:var(--text-soft);font-weight:400;margin-top:2px">Ayar anında geçerli olur.</div></span>
          </label>
          <div class="form-group">
            <label>Yazıcı</label>
            <div style="display:flex;gap:8px">
              <select id="yazdirma-yazici" class="inp inp-w100" style="flex:1" onchange="yazdirmaKaydet()"><option value="">Yükleniyor…</option></select>
              <button class="btn btn-outline btn-sm" type="button" title="Yazıcı listesini yenile" onclick="yazdirmaYukle(true)">🔄</button>
            </div>
          </div>
          <div class="form-group">
            <label>Kağıt boyutu</label>
            <select id="yazdirma-kagit" class="inp inp-w100" onchange="yazdirmaKaydet()"><option value="A5">A5 (148 × 210 mm)</option><option value="A4">A4 (210 × 297 mm)</option></select>
          </div>
          <div class="form-group">
            <label>Kopya sayısı</label>
            <select id="yazdirma-kopya" class="inp inp-w100" onchange="yazdirmaKaydet()"><option value="1">1 kopya</option><option value="2">2 kopya</option><option value="3">3 kopya</option></select>
          </div>
          <button class="btn btn-outline btn-sm" type="button" onclick="yazdirmaTest()">🧾 Test sayfası yazdır</button>
          <div id="yazdirma-durum" style="font-size:11px;color:var(--text-soft);margin-top:10px"></div>
        </div>

        `;
  html = degistir(html, '<div class="card" style="border-color:#7c3aed">\n          <div class="card-title">🤖 AI Destekli Mail Analizi</div>',
    kart + '<div class="card" style="border-color:#7c3aed">\n          <div class="card-title">🤖 AI Destekli Mail Analizi</div>', 'ayarlar kartı yeri');
  html = degistir(html, 'function renderSettingsPage() {\n  renderMailFilterList();',
    'function renderSettingsPage() {\n  try { yazdirmaYukle(false); } catch (e) {}\n  renderMailFilterList();', 'ayarlar sayfası açılışı');

  const betik = `<script>
// ── Otomatik yazdırma ayarları (yerel sunucu) ──
function _yzIstek(yontem, adres, govde) {
  return fetch(adres, { method: yontem, credentials: 'same-origin', headers: Object.assign({ 'X-DL-Panel': 'yonetici' }, govde ? { 'Content-Type': 'application/json' } : {}), body: govde ? JSON.stringify(govde) : undefined })
    .then(r => r.json().catch(() => ({})).then(j => { if (!r.ok) throw new Error(j.hata || ('Hata ' + r.status)); return j; }));
}
let _yzYukleniyor = false;
function _yzEtiket() {
  const acik = document.getElementById('yazdirma-toggle').checked;
  const l = document.getElementById('yazdirma-toggle-label');
  l.textContent = 'Otomatik Yazdırma: ' + (acik ? 'Açık' : 'Kapalı');
  l.style.color = acik ? '#0369a1' : '';
}
function yazdirmaYukle(yenile) {
  const durum = document.getElementById('yazdirma-durum');
  if (!durum) return;
  _yzYukleniyor = true;
  _yzIstek('GET', '/api/yazdirma' + (yenile ? '?yenile=1' : '')).then(a => {
    document.getElementById('yazdirma-toggle').checked = !!a.otomatik;
    document.getElementById('yazdirma-kopya').value = String(a.kopya || 1);
    document.getElementById('yazdirma-kagit').value = a.kagit === 'A4' ? 'A4' : 'A5';
    const sel = document.getElementById('yazdirma-yazici');
    const liste = a.yazicilar || [];
    const varsayilan = liste.find(y => y.varsayilan);
    sel.innerHTML = '<option value="">Varsayılan yazıcı' + (varsayilan ? ' (' + escHtml(varsayilan.ad) + ')' : '') + '</option>' +
      liste.map(y => '<option value="' + escHtml(y.ad) + '">' + escHtml(y.ad) + (y.cevrimdisi ? ' — çevrimdışı' : '') + '</option>').join('') +
      (a.yazici && !liste.some(y => y.ad === a.yazici) ? '<option value="' + escHtml(a.yazici) + '">' + escHtml(a.yazici) + ' (bulunamadı)</option>' : '');
    sel.value = a.yazici || '';
    _yzEtiket();
    let h = a.listeHatasi ? '<span style="color:var(--danger)">⚠️ ' + escHtml(a.listeHatasi) + '</span><br>' : '';
    if (a.gecmis && a.gecmis.length) {
      h += '<b>Son yazdırılanlar:</b><br>' + a.gecmis.slice(0, 5).map(g => escHtml(new Date(g.zaman).toLocaleString('tr-TR')) + ' — ' + escHtml(g.test ? 'Test sayfası' : (g.hasta || '')) + ' — ' + (/^HATA/.test(g.durum) ? '<span style="color:var(--danger)">' + escHtml(g.durum) + '</span>' : '✅ ' + escHtml(g.durum))).join('<br>');
    }
    durum.innerHTML = h;
  }).catch(e => { durum.innerHTML = '<span style="color:var(--danger)">⚠️ ' + escHtml(e.message) + '</span>'; })
    .finally(() => { _yzYukleniyor = false; });
}
function yazdirmaKaydet() {
  if (_yzYukleniyor) return;
  _yzEtiket();
  _yzIstek('POST', '/api/yazdirma', {
    otomatik: document.getElementById('yazdirma-toggle').checked,
    yazici: document.getElementById('yazdirma-yazici').value,
    kopya: Number(document.getElementById('yazdirma-kopya').value) || 1,
    kagit: document.getElementById('yazdirma-kagit').value,
  }).then(a => toast(a.otomatik ? '🖨️ Otomatik yazdırma açıldı' : 'Otomatik yazdırma kapatıldı', a.otomatik ? 'success' : 'info'))
    .catch(e => { toast('Kaydedilemedi: ' + e.message, 'error'); yazdirmaYukle(false); });
}
function yazdirmaTest() {
  toast('🧾 Test sayfası yazıcıya gönderiliyor…', 'info');
  _yzIstek('POST', '/api/yazdirma/test', {}).then(() => { toast('✅ Test sayfası yazdırıldı', 'success'); yazdirmaYukle(false); })
    .catch(e => { toast('Yazdırılamadı: ' + e.message, 'error'); yazdirmaYukle(false); });
}
</script>
`;
  const son = html.lastIndexOf('</body>');
  if (son < 0) throw new Error('</body> bulunamadı');
  return html.slice(0, son) + betik + html.slice(son);
}


// ── MAİL KUTUSU: Türkçe karakterler ve tıklanabilir indirme bağlantıları ──
function mailDuzeltmeleri(html) {
  // 1) Gmail gövdesini mailin kendi karakter kodlamasıyla çöz (atob UTF-8 bilmez → "Ã§")
  html = degistir(html, "function parseGmailMessage(m) {", `// Gmail'in base64url gövdesini doğru karakter kodlamasıyla çözer
function _b64Metin(veri, charset) {
  const bin = atob(String(veri).replace(/-/g, '+').replace(/_/g, '/'));
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  const adaylar = [];
  if (charset) adaylar.push(charset.toLowerCase());
  adaylar.push('utf-8', 'windows-1254');
  for (const c of adaylar) {
    try { return new TextDecoder(c, { fatal: c === 'utf-8' }).decode(b); } catch (e) { /* sıradaki */ }
  }
  return bin;
}
function _partCharset(part) {
  const h = (part.headers || []).find(x => (x.name || '').toLowerCase() === 'content-type');
  const m = h && /charset="?([^";\\s]+)/i.exec(h.value || '');
  return m ? m[1] : '';
}
// Önceden yanlış çözülmüş (UTF-8'in Latin-1 sanılması) metinleri onarır
// (hem Latin-1 hem Windows-1252 biçimindeki bozulmaları — "Ã§", "Ä±", "ÄŸ" — kapsar)
const _CP1252 = { 0x20AC:0x80, 0x201A:0x82, 0x0192:0x83, 0x201E:0x84, 0x2026:0x85, 0x2020:0x86, 0x2021:0x87, 0x02C6:0x88, 0x2030:0x89, 0x0160:0x8A, 0x2039:0x8B, 0x0152:0x8C, 0x017D:0x8E,
  0x2018:0x91, 0x2019:0x92, 0x201C:0x93, 0x201D:0x94, 0x2022:0x95, 0x2013:0x96, 0x2014:0x97, 0x02DC:0x98, 0x2122:0x99, 0x0161:0x9A, 0x203A:0x9B, 0x0153:0x9C, 0x017E:0x9E, 0x0178:0x9F };
function _utfOnar(s) {
  s = String(s || '');
  if (!/[\\u00c2-\\u00c5][\\u0080-\\u00bf\\u0152\\u0153\\u0160\\u0161\\u0178\\u017d\\u017e\\u0192\\u02c6\\u02dc\\u2013-\\u2122]/.test(s)) return s;
  const b = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c < 256) b.push(c); else if (_CP1252[c] !== undefined) b.push(_CP1252[c]); else return s; // gerçek bir Unicode karakter var — dokunma
  }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(b)); } catch (e) { return s; }
}
// Metindeki bağlantıları sırayla döndürür (sondaki noktalama hariç)
function _mailBaglantilari(metin) {
  const sonuc = [];
  (String(metin || '').match(/https?:\\/\\/[^\\s<>"']+/g) || []).forEach(u => {
    u = u.replace(/[.,;:!?)\\]]+$/, '');
    if (!sonuc.includes(u)) sonuc.push(u);
  });
  return sonuc;
}
function _mailIndirmeMi(u) {
  return /\\.(zip|rar|7z|stl|ply|obj|dcm|3oxz|pdf|jpg|jpeg|png)(\\?|$)/i.test(u) ||
    /amazonaws\\.com|wetransfer\\.com|we\\.tl|drive\\.google|dropbox\\.com|meditlink|3shape|1drv\\.ms|onedrive|mega\\.nz/i.test(u);
}
function _mailBaglantiAdi(u) {
  try {
    const a = new URL(u);
    const son = decodeURIComponent(a.pathname.split('/').filter(Boolean).pop() || '');
    if (/\\.[a-z0-9]{2,5}$/i.test(son)) return son;
    return a.hostname.replace(/^www\\./, '');
  } catch (e) { return u.slice(0, 60); }
}
// Mail gövdesi: kaçışlı metin + tıklanabilir bağlantılar
function _mailGovdeHtml(metin) {
  return escHtml(metin).replace(/https?:\\/\\/[^\\s<>"']+/g, u => {
    let son = '';
    while (/[.,;:!?)\\]]$/.test(u)) { son = u.slice(-1) + son; u = u.slice(0, -1); }
    return '<a href="' + u + '" target="_blank" rel="noopener" style="color:var(--primary);font-weight:700;text-decoration:underline;word-break:break-all">' +
      (_mailIndirmeMi(u.replace(/&amp;/g, '&')) ? '⬇️ ' : '🔗 ') + u + '</a>' + son;
  });
}
// Runyes 3DS sipariş maili mi? Konu: "new order from <KLİNİK>"
// Metin: "new order for <HASTA>, This is an auto-generated email by Runyes 3DS Click <BAĞLANTI> to get scanned data. <NOT>"
function _runyesCoz(konu, metin) {
  metin = String(metin || '');
  const h = /new order for\\s+([\\s\\S]+?)\\s*,\\s*This is an auto-generated email/i.exec(metin);
  if (!h) return null;
  const url = _mailBaglantilari(metin).find(u => /amazonaws\\.com/i.test(u)) || _mailBaglantilari(metin)[0] || '';
  let klinik = (/new order from\\s+(.+)$/i.exec(String(konu || '').trim()) || [])[1] || '';
  if (!klinik && url) { try { klinik = (decodeURIComponent(new URL(url).pathname.split('/').pop() || '').match(/^(.+?)_\\d{8}_\\d{6}/) || [])[1] || ''; } catch (e) { /* yoksay */ } }
  const not = ((/to get scanned data\\.?\\s*([\\s\\S]*)$/i.exec(metin) || [])[1] || '').trim();
  const zaman = ((url.match(/_(\\d{8}_\\d{6})\\.[a-z0-9]+(\\?|$)/i) || [])[1]) || '';
  const buyuk = x => String(x || '').trim().replace(/\\s+/g, ' ').toLocaleUpperCase('tr-TR');
  const uzanti = (url.match(/\\.([a-z0-9]{2,5})(\\?|$)/i) || [])[1] || 'zip';
  const temiz = x => x.replace(/[\\\\/:*?"<>|]/g, '_');
  const dosyaAdi = temiz([buyuk(klinik), buyuk(h[1]), zaman].filter(Boolean).join(' - ')) + '.' + uzanti.toLowerCase();
  return { klinik: buyuk(klinik), hasta: buyuk(h[1]), not, url, dosyaAdi };
}

// Mail üstündeki belirgin "indirme bağlantıları" kutusu
function _mailBaglantiCubugu(metin, konu, mailId) {
  const r = _runyesCoz(konu, metin);
  if (r && r.url) {
    const yerel = '/api/mail-indir?panel=yonetici&u=' + encodeURIComponent(r.url) + '&ad=' + encodeURIComponent(r.dosyaAdi);
    const bilgi = (etiket, deger) => deger ? '<div style="display:flex;gap:8px;font-size:13px;margin-bottom:4px"><span style="color:#047857;font-weight:700;min-width:58px">' + etiket + '</span><span style="font-weight:700;color:var(--text)">' + escHtml(deger) + '</span></div>' : '';
    return '<div style="margin:14px 20px 0;padding:12px 14px;background:#ecfdf5;border:1.5px solid #6ee7b7;border-radius:12px">' +
      '<div style="font-size:12px;font-weight:800;color:#047857;margin-bottom:8px">🦷 Runyes 3DS tarama siparişi</div>' +
      bilgi('Klinik', r.klinik) + bilgi('Hasta', r.hasta) + bilgi('Not', r.not) +
      '<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center">' +
      '<a href="' + escHtml(yerel) + '" title="' + escHtml(r.url) + '" style="display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:800;text-decoration:none;background:#059669;color:#fff;box-shadow:0 2px 8px rgba(5,150,105,.3);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">⬇️ İndir: ' + escHtml(r.dosyaAdi) + '</a>' +
      '<a href="' + escHtml(r.url) + '" target="_blank" rel="noopener" style="font-size:12px;color:var(--text-soft);text-decoration:underline">orijinal adıyla indir</a>' +
      '</div></div>';
  }
  const l = _mailBaglantilari(metin);
  if (!l.length) return '';
  const adlar = typeof _mailDosyaAdlari === 'function' ? _mailDosyaAdlari(metin) : new Map();
  const indir = l.filter(_mailIndirmeMi), diger = l.filter(u => !_mailIndirmeMi(u));
  const tumu = indir.length > 1 && mailId && typeof _mailTumuDugmesi === 'function' ? _mailTumuDugmesi(mailId, indir.length) : '';
  const dugme = (u, ana) => '<a href="' + escHtml(u) + '" target="_blank" rel="noopener" title="' + escHtml(u) + '" ' +
    'style="display:inline-flex;align-items:center;gap:6px;margin:0 8px 8px 0;padding:9px 14px;border-radius:10px;font-size:13px;font-weight:700;text-decoration:none;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
    (ana ? 'background:#059669;color:#fff;box-shadow:0 2px 8px rgba(5,150,105,.3)' : 'background:#fff;color:var(--primary);border:1.5px solid var(--primary)') + '">' +
    (ana ? '⬇️ ' : '🔗 ') + escHtml(adlar.get(u) || _mailBaglantiAdi(u)) + '</a>';
  return '<div style="margin:14px 20px 0;padding:12px 14px 4px;background:#ecfdf5;border:1.5px solid #6ee7b7;border-radius:12px">' +
    '<div style="font-size:12px;font-weight:800;color:#047857;margin-bottom:8px">' + (indir.length ? '⬇️ Maildeki indirme bağlantıları' : '🔗 Maildeki bağlantılar') + '</div>' + tumu +
    indir.map(u => dugme(u, true)).join('') + diger.map(u => dugme(u, false)).join('') + '</div>';
}

function parseGmailMessage(m) {`, 'parseGmailMessage');

  html = degistir(html, "        body = atob(part.body.data.replace(/-/g,'+').replace(/_/g,'/'));",
    "        body = _b64Metin(part.body.data, _partCharset(part));", 'düz metin gövdesi');
  html = degistir(html, "        html = atob(part.body.data.replace(/-/g,'+').replace(/_/g,'/'));",
    "        html = _b64Metin(part.body.data, _partCharset(part));", 'html gövdesi');

  // 2) Mail ayrıntısı: bağlantı kutusu + tıklanabilir gövde (eski kayıtlar da onarılır)
  html = degistir(html, "    <div class=\"mail-detail-body\">${escHtml(m.body||m.preview||'(İçerik yok)')}</div>`;",
    "    ${_mailBaglantiCubugu(_utfOnar(m.body||m.preview||''), _utfOnar(m.subject||''), id)}\n    <div class=\"mail-detail-body\">${_mailGovdeHtml(_utfOnar(m.body||m.preview||'(İçerik yok)'))}</div>`;",
    'mail gövdesi');
  html = degistir(html, "<div class=\"mail-preview\">${escHtml((m.preview||'').slice(0,80))}</div>",
    "<div class=\"mail-preview\">${escHtml(_utfOnar(m.preview||'').slice(0,80))}</div>", 'mail listesi önizleme');
  return html;
}

const SAYFALAR = {
  'PrimerLab.html': yonetimPaneli,
  'GelenIslerPaneli.html': gelenIsler,
  'GelenIslerPaneliMobil.html': gelenIsler,
  'HekimPortali.html': hekimPortali,
  'HekimPortaliMobil.html': hekimPortali,
  'TeknisyenPaneli.html': teknisyenPaneli,
  'TeknisyenPaneliMobil.html': teknisyenPaneli,
};

function main() {
  const klasorler = process.argv.slice(2);
  if (!klasorler.length) {
    console.log('Kullanım: node araclar/sayfalari-donustur.js <orijinal-dosyalarin-klasoru> [başka klasör ...]');
    process.exit(1);
  }
  let hata = false;
  for (const [ad, donustur] of Object.entries(SAYFALAR)) {
    const kaynak = klasorler.map(k => path.join(k, ad)).find(f => fs.existsSync(f));
    if (!kaynak) { console.log(`-  ${ad}: bulunamadı, atlandı`); continue; }
    try {
      let html = donustur(fs.readFileSync(kaynak, 'utf8').replace(/\r\n/g, '\n'));
      // Tasarım onayı penceresi (önizleme → hekim onayı → nihai dosya) her panelde ortaktır
      const govdeSonu = html.lastIndexOf('</body>');
      if (govdeSonu < 0) throw new Error('</body> bulunamadı');
      html = html.slice(0, govdeSonu) + '<script src="tasarim-ek.js"></script>\n' + html.slice(govdeSonu);
      if (/gstatic\.com\/firebasejs|firebasedatabase\.app|AIzaSy/.test(html)) throw new Error('Dönüşüm sonrası Firebase izi kaldı');
      fs.writeFileSync(path.join(HEDEF, ad), html);
      console.log(`✓  ${ad}`);
    } catch (e) {
      hata = true;
      console.error(`✗  ${ad}: ${e.message}`);
    }
  }
  if (hata) process.exit(1);
}

main();
