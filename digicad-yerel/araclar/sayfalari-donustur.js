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
      const html = donustur(fs.readFileSync(kaynak, 'utf8').replace(/\r\n/g, '\n'));
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
