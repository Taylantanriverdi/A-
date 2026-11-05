/* ═══════════════════════════════════════════════════════════════════
   DIGICAD Dental — Mail Kutusu ekleri
   - Mail metninden dosya adlarını okur (bağlantının bir üst satırı)
   - "Tümünü İndir": maildeki tüm indirme bağlantılarını asıl adlarıyla
     TEK bir ZIP olarak indirir (dosyalar yerel sunucu üzerinden çekilir)
   - Google Drive dosyası herkese açık değilse Drive için salt-okunur izin
     isteyip tekrar dener
   ═══════════════════════════════════════════════════════════════════ */

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

// ZIP adı: "GÖNDEREN - KONU" (Fwd:/Ynt: önekleri atılır)
function _mailPaketAdi(m) {
  const buyuk = x => String(x || '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('tr-TR');
  const from = _utfOnar(m.from || '');
  const gonderen = (/^\s*"?([^"<]+?)"?\s*</.exec(from) || [])[1] || (m.from_email || from).split('@')[0];
  const konu = _utfOnar(m.subject || '').replace(/^\s*((fwd?|fw|ynt|re|ilt|i̇lt)\s*:\s*)+/i, '');
  return [buyuk(gonderen), buyuk(konu)].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || 'mail-dosyalari';
}

function _mailTumuDugmesi(id, adet) {
  return '<div style="margin-bottom:10px"><button type="button" id="mail-tumu-btn" onclick="mailTumunuIndir(\'' + escHtml(id) + '\', this)" ' +
    'style="display:inline-flex;align-items:center;gap:8px;padding:11px 18px;border:0;border-radius:10px;cursor:pointer;font:inherit;font-size:14px;font-weight:800;' +
    'background:#1565c0;color:#fff;box-shadow:0 2px 10px rgba(21,101,192,.35)">📦 Tümünü İndir (' + adet + ' dosya — tek ZIP)</button>' +
    '<div id="mail-drive-izin"></div></div>';
}

function _cdAd(cd) {
  cd = cd || '';
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="([^"]+)"/i.exec(cd);
  try { return m ? decodeURIComponent(m[1]) : ''; } catch (e) { return m ? m[1] : ''; }
}

let _driveToken = null, _driveIstemci = null, _sonTumuMail = null;

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

async function mailTumunuIndir(id, btn) {
  const m = mailDB.mails.find(x => x.id === id);
  if (!m) return;
  if (typeof JSZip === 'undefined') { toast('ZIP kütüphanesi yüklenemedi', 'error'); return; }
  const metin = _utfOnar(m.body || m.preview || ''), konu = _utfOnar(m.subject || '');
  const linkler = _mailBaglantilari(metin).filter(_mailIndirmeMi);
  if (!linkler.length) { toast('Bu mailde indirilecek bağlantı yok', 'info'); return; }
  const adlar = _mailDosyaAdlari(metin);
  const r = _runyesCoz(konu, metin);
  const paket = r ? r.dosyaAdi.replace(/\.[a-z0-9]+$/i, '') : _mailPaketAdi(m);
  const eski = btn ? btn.innerHTML : '';
  if (btn) btn.disabled = true;
  const izinKutusu = document.getElementById('mail-drive-izin');
  if (izinKutusu) izinKutusu.innerHTML = '';
  const zip = new JSZip(), kullanilan = new Set(), hatali = [];
  let ok = 0;
  try {
    for (let i = 0; i < linkler.length; i++) {
      const u = linkler[i];
      if (btn) btn.innerHTML = '⏳ ' + (i + 1) + ' / ' + linkler.length + ' indiriliyor…';
      let ad = adlar.get(u) || (r && linkler.length === 1 ? r.dosyaAdi : '');
      try {
        const g = await _mailDosyaGetir(u);
        ad = (ad || g.sunucuAdi || _mailBaglantiAdi(u) || ('dosya-' + (i + 1))).replace(/[\\/:*?"<>|]/g, '_');
        let aday = ad, n = 2;
        while (kullanilan.has(aday.toLowerCase())) aday = ad.replace(/(\.[a-z0-9]{2,5})?$/i, ' (' + (n++) + ')$1');
        kullanilan.add(aday.toLowerCase());
        zip.file(aday, g.blob);
        ok++;
      } catch (e) {
        hatali.push({ u, ad: ad || _mailBaglantiAdi(u), hata: e.message, drive: !!e.drive, driveApi: !!e.driveApi });
      }
    }
    if (ok) {
      if (hatali.length) zip.file('INDIRILEMEYENLER.txt', hatali.map(h => h.ad + '\r\n' + h.u + '\r\n' + h.hata + '\r\n').join('\r\n'));
      if (btn) btn.innerHTML = '⏳ ZIP hazırlanıyor…';
      const blob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = paket + '.zip';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      toast(hatali.length ? '⚠️ ' + ok + '/' + linkler.length + ' dosya indirildi (' + paket + '.zip)' : '✅ ' + ok + ' dosya indirildi: ' + paket + '.zip', hatali.length ? 'error' : 'success');
    } else {
      toast('Dosyalar indirilemedi: ' + (hatali[0] ? hatali[0].hata : ''), 'error');
    }
    // İndirilemeyen dosyalar: nedenleri + çözüm yolları
    if (izinKutusu && hatali.length) {
      const apiKapali = hatali.some(h => h.driveApi);
      const driveVar = hatali.some(h => h.drive);
      const dugmeStil = 'margin:8px 8px 0 0;padding:8px 14px;border:0;border-radius:8px;cursor:pointer;font:inherit;font-weight:800;color:#fff;';
      izinKutusu.innerHTML = '<div style="margin-top:10px;padding:10px 12px;border-radius:10px;background:#fff7ed;border:1.5px solid #fdba74;font-size:12.5px;color:#9a3412">' +
        '<b>' + hatali.length + ' dosya ZIP\'e eklenemedi:</b>' +
        '<ul style="margin:6px 0 0 18px;padding:0">' + hatali.map(h => '<li>' + escHtml(h.ad) + ' — <i>' + escHtml(h.hata) + '</i></li>').join('') + '</ul>' +
        (apiKapali ? '<div style="margin-top:6px">⚠️ Google Drive API kapalı: <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com?project=primer-dental" target="_blank" rel="noopener" style="font-weight:700;color:#9a3412">buradan “Etkinleştir”e basın</a>, birkaç dakika sonra tekrar deneyin.</div>' : '') +
        (driveVar && !apiKapali ? '<button type="button" onclick="mailDriveIzni(\'' + escHtml(id) + '\')" style="' + dugmeStil + 'background:#ea580c">🔑 Google Drive izni ver ve tekrar dene</button>' : '') +
        '<button type="button" onclick="mailTarayicidaIndir(\'' + escHtml(id) + '\')" style="' + dugmeStil + 'background:#0f766e">⬇️ Hepsini tarayıcıyla indir (ayrı ayrı)</button>' +
        '</div>';
    }
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = eski; }
  }
}

function mailDriveIzni(id) {
  if (!(window.google && google.accounts && google.accounts.oauth2)) { toast('Google girişi yüklenemedi, sayfayı yenileyin', 'error'); return; }
  _sonTumuMail = id;
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
        mailTumunuIndir(_sonTumuMail, document.getElementById('mail-tumu-btn'));
      },
      error_callback: err => toast('Drive izni tamamlanamadı: ' + ((err && (err.message || err.type)) || 'pencere kapandı'), 'error'),
    });
  }
  _driveIstemci.requestAccessToken();
}

// Yedek yol: dosyaları tarayıcının kendi Google oturumuyla (tek tek düğmelerin
// çalıştığı gibi) sırayla indirir. Dosyalar ayrı ayrı iner (ZIP olmaz).
async function mailTarayicidaIndir(id) {
  const m = mailDB.mails.find(x => x.id === id);
  if (!m) return;
  const linkler = _mailBaglantilari(_utfOnar(m.body || m.preview || '')).filter(_mailIndirmeMi);
  if (!linkler.length) return;
  toast('⬇️ ' + linkler.length + ' dosya tarayıcıyla indiriliyor. Chrome “birden fazla dosya indirilsin mi?” diye sorarsa İzin ver’e basın.', 'info');
  for (let i = 0; i < linkler.length; i++) {
    const did = _driveId(linkler[i]);
    const adres = did ? 'https://drive.usercontent.google.com/download?id=' + encodeURIComponent(did) + '&export=download&confirm=t' : linkler[i];
    const f = document.createElement('iframe');
    f.style.display = 'none';
    f.src = adres;
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 120000);
    await new Promise(c => setTimeout(c, 1500));
  }
}
