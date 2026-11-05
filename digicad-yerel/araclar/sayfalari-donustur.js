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
