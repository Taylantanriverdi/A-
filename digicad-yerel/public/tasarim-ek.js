/* ═══════════════════════════════════════════════════════════════════
   DIGICAD Dental — tasarim-ek.js  ·  TASARIM ONAYI
   Hekim, teknisyen ve yönetim panellerinin hepsinde aynı pencere:
     teknisyen önizleme yükler → hekim 3 boyutlu inceler, onaylar ya da
     revizyon ister → onaydan sonra nihai dosya yüklenir.
   Kurallar sunucuda denetlenir (lib/tasarim.js); bu dosya yalnızca ekrandır.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__tasarimEk) return; window.__tasarimEk = true;
  const PANEL = window.DL_PANEL || 'yonetici';
  const KOK = 'db/digicad';

  let isler = {}, kayitlar = {}, girisli = false, ilkKayit = true;
  let gorunum = 'liste', seciliIs = null, suzgec = 'bekleyen', sistem = null, hekimler = null;
  let izleyici = null;

  // ── yardımcılar ──────────────────────────────────────────────────
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const tarih = s => { try { return new Date(s).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return ''; } };
  const gunFarki = s => Math.max(0, Math.floor((Date.now() - new Date(s).getTime()) / 864e5));
  const boyut = n => !n ? '' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  const uzanti = ad => (String(ad || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
  const resimMi = f => ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(uzanti(f.name));
  const stlMi = f => uzanti(f.name) === 'stl';
  const bildir = (m, t) => { if (typeof window.toast === 'function') window.toast(m, t || 'success'); };
  function api(adres, govde, yontem) {
    return fetch(adres, {
      method: yontem || 'POST', credentials: 'same-origin',
      headers: Object.assign({ 'X-DL-Panel': PANEL }, govde ? { 'Content-Type': 'application/json' } : {}),
      body: govde ? JSON.stringify(govde) : undefined,
    }).then(r => r.json().catch(() => ({})).then(j => { if (!r.ok) throw new Error(j.hata || 'Sunucu hatası (' + r.status + ')'); return j; }));
  }
  const isAl = id => Object.values(isler).find(j => j && String(j.id) === String(id)) || null;

  // ── bir işin tasarım durumu ──────────────────────────────────────
  const DURUMLAR = {
    gerekmez: { ad: 'Onay gerekmiyor', renk: '#64748b', zemin: '#f1f5f9' },
    'onizleme-bekleniyor': { ad: 'Önizleme bekleniyor', renk: '#b45309', zemin: '#fef3c7' },
    'hekim-onayi-bekliyor': { ad: 'Hekim onayı bekleniyor', renk: '#1d4ed8', zemin: '#dbeafe' },
    'revizyon-istendi': { ad: 'Revizyon istendi', renk: '#c2410c', zemin: '#ffedd5' },
    onaylandi: { ad: 'Onaylandı — nihai dosya bekleniyor', renk: '#047857', zemin: '#d1fae5' },
    'nihai-hazir': { ad: 'Nihai dosya hazır', renk: '#065f46', zemin: '#a7f3d0' },
  };
  function durum(j) {
    const k = kayitlar[String(j.id)] || null;
    const onizlemeler = k && k.previews ? Object.values(k.previews).filter(Boolean).sort((a, b) => a.no - b.no) : [];
    const nihai = (Array.isArray(j.designFiles) ? j.designFiles : []).filter(Boolean);
    const gerekli = !(k && k.muaf) && (onizlemeler.length > 0 || (!!j.sourceDoctorSubmissionId && j.designSource !== 'doctor'));
    let kod = 'gerekmez';
    if (gerekli) {
      if (!onizlemeler.length) kod = 'onizleme-bekleniyor';
      else if (k.state === 'onaylandi') kod = nihai.length ? 'nihai-hazir' : 'onaylandi';
      else kod = k.state === 'revizyon-istendi' ? 'revizyon-istendi' : 'hekim-onayi-bekliyor';
    }
    const son = onizlemeler[onizlemeler.length - 1] || null;
    return { kod, kayit: k, onizlemeler, son, nihai, gerekli, muaf: !!(k && k.muaf), bilgi: DURUMLAR[kod] };
  }
  // Sıra bende mi?
  function siraBende(d, j) {
    if (j.status === 'Tamamlandı') return false;
    if (PANEL === 'hekim') return d.kod === 'hekim-onayi-bekliyor';
    if (PANEL === 'teknisyen') return ['onizleme-bekleniyor', 'revizyon-istendi', 'onaylandi'].includes(d.kod);
    return false;
  }
  function listelenecekler() {
    return Object.values(isler).filter(j => j && !j.deleted).map(j => ({ j, d: durum(j) }))
      .filter(x => x.d.gerekli || x.d.muaf || (PANEL !== 'hekim' && x.j.status !== 'Tamamlandı') || (PANEL === 'hekim' && x.d.nihai.length))
      .sort((a, b) => (siraBende(b.d, b.j) - siraBende(a.d, a.j)) ||
        String((b.d.kayit && b.d.kayit.updatedAt) || b.j.date || '').localeCompare(String((a.d.kayit && a.d.kayit.updatedAt) || a.j.date || '')));
  }
  const bekleyenSayisi = () => {
    const l = listelenecekler();
    return PANEL === 'yonetici' ? l.filter(x => x.d.kod === 'hekim-onayi-bekliyor' && x.j.status !== 'Tamamlandı').length : l.filter(x => siraBende(x.d, x.j)).length;
  };

  // ── stil ─────────────────────────────────────────────────────────
  const stil = document.createElement('style');
  stil.textContent = `
#to-dugme{position:fixed;right:18px;bottom:18px;z-index:9000;display:none;align-items:center;gap:8px;padding:11px 16px;border:0;border-radius:999px;background:#0f766e;color:#fff;font:700 14px/1 system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;box-shadow:0 6px 20px rgba(15,118,110,.4)}
#to-dugme b{background:#dc2626;color:#fff;border-radius:999px;min-width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;padding:0 5px}
#to-dugme b.gri{background:rgba(255,255,255,.28)}
#to-ortu{position:fixed;inset:0;z-index:9500;background:rgba(15,23,42,.55);display:none;align-items:center;justify-content:center;padding:12px;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a}
#to-ortu.acik{display:flex}
#to-kart{background:#fff;border-radius:16px;width:100%;max-width:920px;max-height:94vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,.3);overflow:hidden}
#to-bas{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid #e2e8f0;background:#f8fafc}
#to-bas h2{margin:0;font-size:17px;font-weight:800;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#to-govde{padding:16px 18px;overflow:auto;flex:1}
.to-d{border:0;border-radius:9px;padding:9px 14px;font:inherit;font-weight:700;cursor:pointer;background:#e2e8f0;color:#0f172a}
.to-d:disabled{opacity:.55;cursor:default}
.to-d.ana{background:#0f766e;color:#fff}.to-d.onay{background:#059669;color:#fff}.to-d.rev{background:#ea580c;color:#fff}.to-d.cizgi{background:#fff;border:1.5px solid #cbd5e1}
.to-d.kucuk{padding:6px 10px;font-size:12.5px}
.to-rozet{display:inline-block;padding:3px 9px;border-radius:999px;font-size:12px;font-weight:800;white-space:nowrap}
.to-satir{display:flex;align-items:center;gap:12px;padding:12px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:8px;cursor:pointer;background:#fff}
.to-satir:hover{border-color:#0f766e;background:#f0fdfa}
.to-satir.bende{border-left:5px solid #dc2626}
.to-satir .ad{font-weight:800}.to-satir .alt{font-size:12.5px;color:#64748b}
.to-kutu{border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:12px}
.to-kutu h3{margin:0 0 8px;font-size:14.5px;font-weight:800}
.to-bilgi{border-radius:12px;padding:12px 14px;margin-bottom:12px;font-weight:600}
.to-dosya{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px dashed #e2e8f0;flex-wrap:wrap}
.to-dosya:first-of-type{border-top:0}
.to-dosya .dad{flex:1;min-width:140px;word-break:break-all;font-weight:600}
.to-dosya img{width:86px;height:64px;object-fit:cover;border-radius:8px;border:1px solid #cbd5e1;cursor:zoom-in}
.to-not{background:#f8fafc;border-radius:9px;padding:8px 10px;margin:8px 0;white-space:pre-wrap;overflow-wrap:anywhere}
.to-karar{border-radius:9px;padding:8px 10px;margin-top:8px;font-weight:600;white-space:pre-wrap;overflow-wrap:anywhere}
.to-alan{width:100%;box-sizing:border-box;padding:9px 11px;border:1.5px solid #cbd5e1;border-radius:9px;font:inherit}
.to-etiket{display:block;font-size:12px;font-weight:800;color:#475569;margin:10px 0 4px}
.to-3b{position:relative;margin-top:10px;border-radius:12px;overflow:hidden;background:linear-gradient(#1e293b,#0f172a);touch-action:none}
.to-3b canvas{display:block;width:100%;height:420px;cursor:grab}
.to-3b .ipucu{position:absolute;left:10px;bottom:8px;color:#cbd5e1;font-size:12px;pointer-events:none}
.to-3b .kapat{position:absolute;right:8px;top:8px}
#to-buyuk{position:fixed;inset:0;z-index:9800;background:rgba(0,0,0,.88);display:none;align-items:center;justify-content:center;cursor:zoom-out}
#to-buyuk img{max-width:96vw;max-height:94vh;border-radius:8px}
.to-sekme{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}
@media(max-width:640px){#to-dugme{right:12px;bottom:74px;padding:10px 13px}.to-3b canvas{height:320px}#to-govde{padding:12px}}
`;
  document.head.appendChild(stil);

  // ── iskelet ──────────────────────────────────────────────────────
  const dugme = document.createElement('button');
  dugme.id = 'to-dugme'; dugme.type = 'button';
  const ortu = document.createElement('div');
  ortu.id = 'to-ortu';
  ortu.innerHTML = '<div id="to-kart"><div id="to-bas"><button type="button" class="to-d kucuk cizgi" id="to-geri" style="display:none">← Liste</button><h2 id="to-baslik">🦷 Tasarım Onayı</h2><button type="button" class="to-d kucuk" id="to-kapat">✕ Kapat</button></div><div id="to-govde"></div></div>';
  const buyuk = document.createElement('div');
  buyuk.id = 'to-buyuk'; buyuk.innerHTML = '<img alt="">';
  function yerlestir() {
    document.body.appendChild(dugme); document.body.appendChild(ortu); document.body.appendChild(buyuk);
    dugme.onclick = () => { gorunum = 'liste'; seciliIs = null; ac(); };
    document.getElementById('to-kapat').onclick = kapat;
    document.getElementById('to-geri').onclick = () => { gorunum = 'liste'; seciliIs = null; ciz(); };
    // Pencere yalnızca "Kapat" ile kapanır: yanlışlıkla dışarı tıklamak yazılan notu silmesin
    buyuk.onclick = () => { buyuk.style.display = 'none'; };
  }
  if (document.body) yerlestir(); else document.addEventListener('DOMContentLoaded', yerlestir);
  function ac() { ortu.classList.add('acik'); ciz(); }
  function kapat() { izleyiciKapat(); ortu.classList.remove('acik'); }
  function dugmeGuncelle() {
    if (!dugme.parentNode) return;
    dugme.style.display = girisli ? 'inline-flex' : 'none';
    const n = girisli ? bekleyenSayisi() : 0;
    dugme.innerHTML = '🦷 Tasarım Onayı' + (n ? ' <b' + (PANEL === 'yonetici' ? ' class="gri"' : '') + '>' + n + '</b>' : '');
    dugme.title = PANEL === 'yonetici' ? (n ? n + ' iş hekim onayı bekliyor' : 'Tasarım önizlemeleri ve onayları') : (n ? n + ' iş sizden işlem bekliyor' : 'Tasarım önizlemeleri ve onayları');
  }

  // ── çizim ────────────────────────────────────────────────────────
  function ciz() {
    if (!ortu.classList.contains('acik')) return;
    const govde = document.getElementById('to-govde');
    const koru = govde.querySelector('[data-koru]'); // yükleme sürerken ya da not yazılırken ekranı yeniden çizme
    if (koru && gorunum === 'ayrinti') return;
    izleyiciKapat();
    document.getElementById('to-geri').style.display = gorunum === 'liste' ? 'none' : '';
    if (gorunum === 'ayar') return ayarCiz(govde);
    if (gorunum === 'ayrinti') { const j = isAl(seciliIs); if (j) return ayrintiCiz(govde, j); gorunum = 'liste'; }
    listeCiz(govde);
  }

  function rozet(d) { return '<span class="to-rozet" style="color:' + d.bilgi.renk + ';background:' + d.bilgi.zemin + '">' + esc(d.bilgi.ad) + '</span>'; }

  function listeCiz(govde) {
    document.getElementById('to-baslik').textContent = '🦷 Tasarım Onayı';
    const hepsi = listelenecekler();
    const bekleyen = PANEL === 'yonetici'
      ? hepsi.filter(x => x.d.gerekli && !['nihai-hazir', 'gerekmez'].includes(x.d.kod) && x.j.status !== 'Tamamlandı')
      : hepsi.filter(x => siraBende(x.d, x.j));
    const liste = suzgec === 'bekleyen' ? bekleyen : hepsi;
    let h = '<div class="to-sekme">' +
      '<button type="button" class="to-d kucuk ' + (suzgec === 'bekleyen' ? 'ana' : 'cizgi') + '" data-suzgec="bekleyen">' + (PANEL === 'yonetici' ? 'Süren onaylar' : 'Sizden işlem bekleyenler') + ' (' + bekleyen.length + ')</button>' +
      '<button type="button" class="to-d kucuk ' + (suzgec === 'tumu' ? 'ana' : 'cizgi') + '" data-suzgec="tumu">Tümü (' + hepsi.length + ')</button>' +
      (PANEL === 'yonetici' ? '<span style="flex:1"></span><button type="button" class="to-d kucuk cizgi" id="to-ayar">⚙️ E-posta ve yedek ayarları</button>' : '') + '</div>';
    if (!liste.length) {
      h += '<div class="to-bilgi" style="background:#f1f5f9;color:#475569">' + (suzgec === 'bekleyen'
        ? (PANEL === 'hekim' ? 'Onayınızı bekleyen bir önizleme yok. Teknisyen önizleme yüklediğinde burada görünür.' : PANEL === 'teknisyen' ? 'Şu an sizden işlem bekleyen bir iş yok.' : 'Süren bir onay yok.')
        : 'Henüz kayıt yok.') + '</div>';
    }
    for (const { j, d } of liste) {
      const bende = siraBende(d, j);
      const bekleme = d.kod === 'hekim-onayi-bekliyor' && d.son ? gunFarki(d.son.createdAt) : 0;
      h += '<div class="to-satir' + (bende ? ' bende' : '') + '" data-is="' + esc(j.id) + '"><div style="flex:1;min-width:0">' +
        '<div class="ad">' + esc(j.patient || 'Hasta') + (j.type ? ' <span style="font-weight:600;color:#475569">— ' + esc(j.type) + '</span>' : '') + '</div>' +
        '<div class="alt">' + (PANEL !== 'hekim' ? '👨‍⚕️ ' + esc(j.drName || '-') + ' · ' : '') + (PANEL !== 'teknisyen' ? '🔧 ' + esc(j.techName || 'atanmadı') + ' · ' : '') +
        (d.onizlemeler.length ? d.onizlemeler.length + ' önizleme' : 'önizleme yok') + (bekleme >= 1 ? ' · <b style="color:#b91c1c">' + bekleme + ' gündür bekliyor</b>' : '') + '</div></div>' +
        rozet(d) + '</div>';
    }
    govde.innerHTML = h;
    govde.querySelectorAll('[data-suzgec]').forEach(b => { b.onclick = () => { suzgec = b.dataset.suzgec; ciz(); }; });
    govde.querySelectorAll('[data-is]').forEach(s => { s.onclick = () => { seciliIs = s.dataset.is; gorunum = 'ayrinti'; ciz(); }; });
    const ayar = document.getElementById('to-ayar');
    if (ayar) ayar.onclick = () => { gorunum = 'ayar'; sistem = null; ciz(); };
  }

  function dosyaSatiri(f, i, grup) {
    return '<div class="to-dosya">' +
      (resimMi(f) ? '<img src="' + esc(f.url) + '" alt="" data-buyut="' + esc(f.url) + '" loading="lazy">' : '<span style="font-size:22px">' + (stlMi(f) ? '🧊' : '📄') + '</span>') +
      '<span class="dad">' + esc(f.name) + ' <span style="font-weight:500;color:#64748b">' + boyut(f.size) + '</span></span>' +
      (stlMi(f) ? '<button type="button" class="to-d kucuk ana" data-3b="' + esc(f.url) + '" data-hedef="' + grup + '">🧊 3B Göster</button>' : '') +
      '<a class="to-d kucuk cizgi" style="text-decoration:none" href="' + esc(f.url) + '" download="' + esc(f.name) + '">⬇️ İndir</a></div>';
  }

  function ayrintiCiz(govde, j) {
    const d = durum(j);
    document.getElementById('to-baslik').textContent = (j.patient || 'Hasta') + (j.type ? ' — ' + j.type : '');
    const tamam = j.status === 'Tamamlandı';
    const yukleyebilir = (PANEL === 'teknisyen' || PANEL === 'yonetici') && !tamam;
    let h = '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px">' + rozet(d) +
      '<span style="color:#64748b;font-size:13px">' + (PANEL !== 'hekim' ? '👨‍⚕️ ' + esc(j.drName || '-') + ' · ' : '') + '🔧 ' + esc(j.techName || 'atanmadı') +
      (j.toothColor ? ' · Renk ' + esc(j.toothColor) : '') + (j.dateout ? ' · Teslim ' + esc(String(j.dateout).split('-').reverse().join('.')) : '') + '</span>' +
      '<span style="flex:1"></span><button type="button" class="to-d kucuk cizgi" id="to-sohbet">💬 Bu işin sohbeti</button></div>';

    // Ne yapılması gerektiğini söyleyen şerit
    const serit = (m, renk, zemin) => '<div class="to-bilgi" style="color:' + renk + ';background:' + zemin + '">' + m + '</div>';
    if (d.kod === 'onizleme-bekleniyor') h += serit(PANEL === 'hekim' ? 'Teknisyen tasarımı hazırlıyor. Önizleme yüklenince burada görünecek ve size e-posta gelecek.' : 'Bu iş hekim onayı gerektiriyor. Tasarımın önizlemesini (STL ve/veya ekran görüntüsü) yükleyin; hekim onayladıktan sonra nihai dosyayı yükleyebilirsiniz.', '#92400e', '#fef3c7');
    if (d.kod === 'hekim-onayi-bekliyor') h += serit(PANEL === 'hekim' ? 'Önizleme ' + d.son.no + ' onayınızı bekliyor. İnceleyip aşağıdan <b>Onaylıyorum</b> ya da <b>Revizyon istiyorum</b> deyin.' : 'Önizleme ' + d.son.no + ' hekime gönderildi, kararı bekleniyor' + (gunFarki(d.son.createdAt) >= 1 ? ' (<b>' + gunFarki(d.son.createdAt) + ' gündür</b>)' : '') + '.', '#1e40af', '#dbeafe');
    if (d.kod === 'revizyon-istendi') h += serit(PANEL === 'hekim' ? 'Revizyon isteğiniz teknisyene iletildi. Yeni önizleme yüklenince haber verilecek.' : 'Hekim revizyon istedi. İsteği aşağıda okuyup yeni önizleme yükleyin.', '#9a3412', '#ffedd5');
    if (d.kod === 'onaylandi') h += serit(PANEL === 'hekim' ? 'Tasarımı onayladınız. Nihai dosya hazırlanınca buradan indirebilirsiniz.' : 'Hekim tasarımı onayladı. Şimdi <b>nihai dosyayı</b> yükleyin.', '#065f46', '#d1fae5');
    if (d.kod === 'nihai-hazir') h += serit('Tasarım onaylandı ve nihai dosya yüklendi.', '#065f46', '#a7f3d0');
    if (d.kod === 'gerekmez') h += serit(d.muaf ? 'Laboratuvar bu iş için hekim onayı aranmayacağını belirtti.' : (j.designSource === 'doctor' ? 'Hekim kendi tasarımını gönderdi; onay adımı yok.' : 'Bu iş hekim portalından gelmediği için onay zorunlu değil. Önizleme yüklerseniz hekim onayı aranır.'), '#475569', '#f1f5f9');

    // Hekimin kararı
    if (d.kod === 'hekim-onayi-bekliyor' && (PANEL === 'hekim' || PANEL === 'yonetici') && !tamam) {
      h += '<div class="to-kutu" style="border-color:#93c5fd"><h3>' + (PANEL === 'hekim' ? 'Kararınız — Önizleme ' + d.son.no : 'Hekim adına karar ver — Önizleme ' + d.son.no) + '</h3>' +
        '<textarea class="to-alan" id="to-karar-not" rows="3" placeholder="' + (PANEL === 'hekim' ? 'Revizyon istiyorsanız neyin değişmesini istediğinizi yazın (onay için not isteğe bağlı)' : 'Açıklama zorunlu — ör. “Hekimle telefonda görüşüldü, onay verdi”') + '"></textarea>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button type="button" class="to-d onay" data-karar="onay">✅ ' + (PANEL === 'hekim' ? 'Onaylıyorum' : 'Hekim adına onayla') + '</button>' +
        '<button type="button" class="to-d rev" data-karar="revizyon">✏️ ' + (PANEL === 'hekim' ? 'Revizyon istiyorum' : 'Hekim adına revizyon iste') + '</button></div></div>';
    }

    // Nihai dosyalar
    if (d.nihai.length || (yukleyebilir && (d.kod === 'onaylandi' || d.kod === 'nihai-hazir' || d.kod === 'gerekmez' || PANEL === 'yonetici'))) {
      h += '<div class="to-kutu" style="border-color:#6ee7b7"><h3>📦 Nihai tasarım dosyası</h3>' +
        (d.nihai.length ? d.nihai.map((f, i) => dosyaSatiri(f, i, 'nihai')).join('') : '<div style="color:#64748b">Henüz yüklenmedi.</div>') + '<div data-3b-yer="nihai"></div>';
      if (yukleyebilir) {
        const kilitli = d.gerekli && !['onaylandi', 'nihai-hazir'].includes(d.kod);
        h += '<div style="margin-top:10px">' + (kilitli && PANEL === 'teknisyen'
          ? '<span style="color:#b45309;font-weight:600">🔒 Nihai dosya, hekim önizlemeyi onayladıktan sonra yüklenebilir.</span>'
          : '<input type="file" id="to-nihai-dosya" multiple style="display:none"><button type="button" class="to-d ana" id="to-nihai-sec">⬆️ Nihai dosya yükle</button>' +
            (kilitli ? ' <span style="color:#b45309;font-size:12.5px">Hekim henüz onaylamadı; yalnızca laboratuvar bu adımı atlayabilir.</span>' : '')) + '</div>';
      }
      h += '</div>';
    }

    // Yeni önizleme yükleme
    if (yukleyebilir && d.kod !== 'nihai-hazir') {
      // Hekim onayladıktan sonra yeni önizleme yüklemek onayı sıfırlar; yanlışlıkla yapılmasın diye kapalı durur
      const onayli = d.kod === 'onaylandi';
      h += (onayli ? '<details class="to-kutu"><summary style="cursor:pointer;font-weight:700;color:#475569">Onaydan sonra tasarım değişti mi? Yeni önizleme yükle (hekimin yeniden onaylaması gerekir)</summary><div style="margin-top:10px">' : '<div class="to-kutu">') +
        '<h3>⬆️ ' + (d.onizlemeler.length ? 'Yeni önizleme yükle (Önizleme ' + (d.onizlemeler[d.onizlemeler.length - 1].no + 1) + ')' : 'Önizleme yükle') + '</h3>' +
        '<div style="color:#64748b;font-size:13px;margin-bottom:8px">STL dosyası hekimin ekranında 3 boyutlu açılır; ekran görüntüleri (PNG/JPG) doğrudan görünür. İkisini birlikte yükleyebilirsiniz.</div>' +
        '<input type="file" id="to-on-dosya" multiple accept=".stl,.png,.jpg,.jpeg,.webp,.gif,.pdf,.ply,.zip" class="to-alan">' +
        '<label class="to-etiket">HEKİME NOT (isteğe bağlı)</label><textarea class="to-alan" id="to-on-not" rows="2" placeholder="Ör. 11 numarada kesici kenarı 0,5 mm kısalttım"></textarea>' +
        '<div style="margin-top:10px"><button type="button" class="to-d ana" id="to-on-yukle">Önizlemeyi hekime gönder</button> <span id="to-on-durum" style="color:#475569;font-size:13px"></span></div>' + (onayli ? '</div></details>' : '</div>');
    }

    // Önizlemeler (yeniden eskiye)
    for (const p of d.onizlemeler.slice().reverse()) {
      const yukleyen = p.by && p.by.name ? p.by.name : (p.by && p.by.rol === 'yonetici' ? 'Laboratuvar' : 'Teknisyen');
      h += '<div class="to-kutu"><h3>Önizleme ' + p.no + ' <span style="font-weight:500;color:#64748b;font-size:12.5px">· ' + tarih(p.createdAt) + ' · ' + esc(yukleyen) + '</span></h3>' +
        (p.note ? '<div class="to-not">📝 ' + esc(p.note) + '</div>' : '') +
        (p.files || []).filter(Boolean).map((f, i) => dosyaSatiri(f, i, p.id)).join('') + '<div data-3b-yer="' + esc(p.id) + '"></div>';
      if (p.karar === 'onay') h += '<div class="to-karar" style="background:#d1fae5;color:#065f46">✅ Onaylandı · ' + tarih(p.kararZamani) + ' · ' + (p.kararVeren === 'hekim' ? 'Hekim' : 'Laboratuvar (hekim adına)') + (p.kararNotu ? '\n' + esc(p.kararNotu) : '') + '</div>';
      else if (p.karar === 'revizyon') h += '<div class="to-karar" style="background:#ffedd5;color:#9a3412">✏️ Revizyon istendi · ' + tarih(p.kararZamani) + ' · ' + (p.kararVeren === 'hekim' ? 'Hekim' : 'Laboratuvar (hekim adına)') + '\n' + esc(p.kararNotu || '') + '</div>';
      else if (yukleyebilir && d.son && p.id === d.son.id) h += '<div style="margin-top:8px"><button type="button" class="to-d kucuk cizgi" data-sil="' + esc(p.id) + '">🗑️ Bu önizlemeyi geri çek</button></div>';
      h += '</div>';
    }

    if (PANEL === 'yonetici' && !tamam && (d.gerekli || d.muaf) && d.kod !== 'nihai-hazir') {
      h += '<div style="margin-top:4px"><button type="button" class="to-d kucuk cizgi" id="to-muaf">' + (d.muaf ? '↩️ Bu iş için yeniden hekim onayı ara' : '⏭️ Bu iş için hekim onayı arama') + '</button></div>';
    }
    govde.innerHTML = h;

    // olaylar
    const calis = (dgm, is) => {
      dgm.disabled = true;
      is().then(() => { govde.querySelectorAll('[data-koru]').forEach(x => x.removeAttribute('data-koru')); dgm.disabled = false; ciz(); },
        e => { dgm.disabled = false; bildir(e.message, 'error'); });
    };
    document.getElementById('to-sohbet').onclick = () => sohbetAc(j);
    govde.querySelectorAll('[data-buyut]').forEach(r => { r.onclick = () => { buyuk.querySelector('img').src = r.dataset.buyut; buyuk.style.display = 'flex'; }; });
    govde.querySelectorAll('[data-3b]').forEach(b => { b.onclick = () => ucBoyutAc(govde.querySelector('[data-3b-yer="' + b.dataset.hedef + '"]'), b.dataset['3b']); });
    govde.querySelectorAll('[data-karar]').forEach(b => {
      b.onclick = () => {
        const notu = document.getElementById('to-karar-not').value.trim();
        if (b.dataset.karar === 'revizyon' && !notu) { bildir('Neyin değişmesini istediğinizi yazın', 'error'); document.getElementById('to-karar-not').focus(); return; }
        if (PANEL === 'yonetici' && !notu) { bildir('Hekim adına karar verirken açıklama yazın', 'error'); document.getElementById('to-karar-not').focus(); return; }
        if (b.dataset.karar === 'onay' && !confirm('Önizleme ' + d.son.no + ' onaylanacak ve nihai dosya bu tasarıma göre hazırlanacak. Emin misiniz?')) return;
        calis(b, () => api('/api/tasarim/karar', { isId: j.id, onizlemeId: d.son.id, karar: b.dataset.karar, not: notu })
          .then(() => bildir(b.dataset.karar === 'onay' ? '✅ Tasarım onaylandı' : '✏️ Revizyon isteği iletildi')));
      };
    });
    govde.querySelectorAll('[data-sil]').forEach(b => {
      b.onclick = () => { if (confirm('Bu önizleme geri çekilecek. Emin misiniz?')) calis(b, () => api('/api/tasarim/onizleme-sil', { isId: j.id, onizlemeId: b.dataset.sil }).then(() => bildir('Önizleme geri çekildi', 'info'))); };
    });
    const muaf = document.getElementById('to-muaf');
    if (muaf) muaf.onclick = () => calis(muaf, () => api('/api/tasarim/muaf', { isId: j.id, muaf: !d.muaf }));
    const onYukle = document.getElementById('to-on-yukle');
    if (onYukle) {
      const alan = document.getElementById('to-on-dosya'), notAlani = document.getElementById('to-on-not');
      const isaretle = () => { const dolu = alan.files.length || notAlani.value.trim(); if (dolu) onYukle.setAttribute('data-koru', '1'); else onYukle.removeAttribute('data-koru'); };
      alan.onchange = isaretle; notAlani.oninput = isaretle;
      onYukle.onclick = () => {
        if (!alan.files.length) { bildir('Önce dosya seçin', 'error'); return; }
        calis(onYukle, () => dosyalariYukle(j, alan.files, 'design-previews', document.getElementById('to-on-durum'))
          .then(dosyalar => api('/api/tasarim/onizleme', { isId: j.id, dosyalar, not: notAlani.value }))
          .then(() => { onYukle.removeAttribute('data-koru'); bildir('✅ Önizleme hekime gönderildi'); ciz(); }));
      };
    }
    const kararNot = document.getElementById('to-karar-not');
    if (kararNot) kararNot.oninput = () => { if (kararNot.value.trim()) kararNot.setAttribute('data-koru', '1'); else kararNot.removeAttribute('data-koru'); };
    const nihaiSec = document.getElementById('to-nihai-sec');
    if (nihaiSec) {
      const alan = document.getElementById('to-nihai-dosya');
      nihaiSec.onclick = () => alan.click();
      alan.onchange = () => {
        if (!alan.files.length) return;
        nihaiSec.setAttribute('data-koru', '1');
        calis(nihaiSec, () => dosyalariYukle(j, alan.files, 'design-final', nihaiSec)
          .then(dosyalar => api('/api/tasarim/nihai', { isId: j.id, dosyalar }))
          .then(() => bildir('📦 Nihai dosya yüklendi'))
          .then(() => { nihaiSec.removeAttribute('data-koru'); nihaiSec.textContent = '⬆️ Nihai dosya yükle'; ciz(); }, e => { nihaiSec.removeAttribute('data-koru'); nihaiSec.textContent = '⬆️ Nihai dosya yükle'; throw e; }));
      };
    }
  }

  // Dosyaları sunucuya yükler; [{name,url,size}] döner
  async function dosyalariYukle(j, dosyaListesi, klasor, durumEl) {
    const sonuc = [], liste = Array.from(dosyaListesi);
    for (let i = 0; i < liste.length; i++) {
      const f = liste[i];
      const ref = firebase.storage().ref(klasor + '/' + j.id + '/' + Date.now() + '_' + i + '_' + f.name);
      const gorev = ref.put(f);
      gorev.on('state_changed', s => { if (durumEl) durumEl.textContent = '⏳ ' + (i + 1) + '/' + liste.length + ' yükleniyor… %' + (s.totalBytes ? Math.round(s.bytesTransferred / s.totalBytes * 100) : 0); });
      await gorev;
      sonuc.push({ name: f.name, url: await ref.getDownloadURL(), size: f.size });
    }
    if (durumEl && durumEl.id === 'to-on-durum') durumEl.textContent = '';
    return sonuc;
  }

  function sohbetAc(j) {
    const baslik = (j.patient || 'Hasta') + (j.type ? ' — ' + j.type : '');
    if (typeof window.openJobChatModal === 'function') { kapat(); window.openJobChatModal(j.id, baslik); }
    else if (typeof window.goToJobChat === 'function') { kapat(); window.goToJobChat(j.id); }
    else bildir('Sohbet bu ekrandan açılamıyor; işin satırındaki 💬 düğmesini kullanın', 'info');
  }

  // ── yönetici: e-posta ve yedek ayarları ──────────────────────────
  function ayarCiz(govde) {
    document.getElementById('to-baslik').textContent = '⚙️ E-posta ve yedek ayarları';
    if (!sistem) {
      govde.innerHTML = '<div style="color:#64748b">Yükleniyor…</div>';
      Promise.all([api('/api/sistem', null, 'GET'), firebase.database().ref(KOK + '/doctors').once('value')])
        .then(([s, d]) => { sistem = s; hekimler = Object.values(d.val() || {}).filter(Boolean); if (gorunum === 'ayar') ciz(); })
        .catch(e => { govde.innerHTML = '<div style="color:#b91c1c">' + esc(e.message) + '</div>'; });
      return;
    }
    const e = sistem.eposta, adressiz = (hekimler || []).filter(h => h.username && !String(h.email || '').trim());
    const disk = sistem.disk;
    govde.innerHTML =
      '<div class="to-kutu"><h3>✉️ Hekime otomatik e-posta</h3>' +
      '<div style="color:#64748b;font-size:13px;margin-bottom:6px">Önizleme ya da nihai dosya yüklendiğinde hekimin kayıtlı adresine laboratuvarın Gmail hesabından bildirim gider. Gmail şifreniz değil, bu iş için oluşturulan 16 haneli <b>uygulama şifresi</b> kullanılır: <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">myaccount.google.com/apppasswords</a> (Google hesabında 2 adımlı doğrulama açık olmalı).</div>' +
      '<label style="display:flex;gap:8px;align-items:center;font-weight:700;margin:8px 0"><input type="checkbox" id="to-e-acik"' + (e.acik ? ' checked' : '') + '> E-posta bildirimi açık</label>' +
      '<label class="to-etiket">GÖNDEREN GMAIL ADRESİ</label><input class="to-alan" id="to-e-kul" type="email" value="' + esc(e.kullanici) + '" placeholder="digicaddentalstudio@gmail.com">' +
      '<label class="to-etiket">UYGULAMA ŞİFRESİ</label><input class="to-alan" id="to-e-sifre" type="password" autocomplete="new-password" placeholder="' + (e.sifreVar ? 'Kayıtlı — değiştirmek için yenisini yazın' : '16 haneli uygulama şifresi') + '">' +
      '<label class="to-etiket">GÖNDEREN ADI</label><input class="to-alan" id="to-e-ad" value="' + esc(e.gonderenAd || 'DIGICAD Dental Studio') + '">' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button type="button" class="to-d ana" id="to-e-kaydet">Kaydet</button><button type="button" class="to-d cizgi" id="to-e-dene">Deneme iletisi gönder</button></div>' +
      (adressiz.length ? '<div class="to-karar" style="background:#fef3c7;color:#92400e">⚠️ Portal kullanan ' + adressiz.length + ' hekimin e-posta adresi kayıtlı değil; onlara bildirim gidemez: ' + esc(adressiz.map(h => h.name).join(', ')) + '. Hekim kartından adres ekleyin.</div>' : '') +
      (sistem.genelAdres ? '' : '<div class="to-karar" style="background:#fef3c7;color:#92400e">ℹ️ Hekim portalının internet adresi henüz bilinmiyor; e-postalarda bağlantı yer almaz. Portala internet adresinden bir kez giriş yapılınca öğrenilir.</div>') +
      (sistem.epostaGecmisi.length ? '<div style="margin-top:10px;font-size:12.5px;color:#475569"><b>Son gönderimler</b><br>' + sistem.epostaGecmisi.slice(0, 8).map(g => tarih(g.zaman) + ' · ' + esc(g.alici) + ' · ' + esc(g.durum)).join('<br>') + '</div>' : '') +
      '</div>' +
      eskiPortalKutusu(sistem.eskiPortal) +
      '<div class="to-kutu"><h3>💾 Yedekleme ve disk</h3>' +
      '<div style="color:#64748b;font-size:13px;margin-bottom:6px">Veritabanı her gün bu bilgisayarda yedeklenir. Bilgisayar bozulursa veriler kaybolmasın diye <b>harici disk ya da ikinci bir sürücüde</b> bir klasör yazın; veritabanı ve tüm dosyalar her gün oraya da kopyalanır.</div>' +
      '<label class="to-etiket">İKİNCİ YEDEK KLASÖRÜ</label><input class="to-alan" id="to-y-klasor" value="' + esc(sistem.yedekKlasoru) + '" placeholder="Ör. E:\\DIGICAD-Yedek">' +
      '<div style="margin-top:10px"><button type="button" class="to-d ana" id="to-y-kaydet">Kaydet ve şimdi yedekle</button></div>' +
      '<div style="margin-top:10px;font-size:13px;color:#475569">' +
      (sistem.sonYedek ? 'Son yedek: ' + tarih(sistem.sonYedek.zaman) + (sistem.sonYedek.hata ? ' — <b style="color:#b91c1c">HATA: ' + esc(sistem.sonYedek.hata) + '</b>' : ' — başarılı') + '<br>' : '') +
      (sistem.yedekKlasoru ? '' : '<b style="color:#b45309">⚠️ İkinci yedek klasörü ayarlı değil.</b><br>') +
      (disk ? 'Disk: ' + disk.bosGB + ' GB boş / ' + disk.toplamGB + ' GB' + (disk.bosGB < 10 ? ' — <b style="color:#b91c1c">yer azalıyor!</b>' : '') : '') + '</div></div>';
    const epostaVerisi = () => ({ acik: document.getElementById('to-e-acik').checked, kullanici: document.getElementById('to-e-kul').value, sifre: document.getElementById('to-e-sifre').value, gonderenAd: document.getElementById('to-e-ad').value });
    const kaydet = (govdeVerisi, mesaj) => api('/api/sistem', govdeVerisi).then(() => { bildir(mesaj); sistem = null; ciz(); });
    document.getElementById('to-e-kaydet').onclick = () => kaydet({ eposta: epostaVerisi() }, 'E-posta ayarları kaydedildi').catch(x => bildir(x.message, 'error'));
    document.getElementById('to-e-dene').onclick = function () {
      const alici = prompt('Deneme iletisi hangi adrese gönderilsin?', document.getElementById('to-e-kul').value);
      if (!alici) return;
      this.disabled = true;
      api('/api/sistem', { eposta: epostaVerisi() }).then(() => api('/api/sistem/eposta-test', { alici }))
        .then(() => bildir('✅ Deneme iletisi gönderildi: ' + alici), x => bildir('Gönderilemedi: ' + x.message, 'error')).then(() => { this.disabled = false; });
    };
    document.getElementById('to-y-kaydet').onclick = () => kaydet({ yedekKlasoru: document.getElementById('to-y-klasor').value }, 'Yedek klasörü kaydedildi').catch(x => bildir(x.message, 'error'));
    document.getElementById('to-k-oto').onchange = function () { kaydet({ eskiPortal: { otomatik: this.checked } }, this.checked ? 'Eski portal köprüsü açıldı' : 'Eski portal köprüsü kapatıldı').catch(x => bildir(x.message, 'error')); };
    document.getElementById('to-k-liste').onclick = () => eskiListeyiGetir();
  }

  // Eski (Firebase) hekim portalına gönderilmiş işler
  function eskiPortalKutusu(k) {
    k = k || {};
    return '<div class="to-kutu" id="to-kopru"><h3>🔁 Eski hekim portalından gelen işler</h3>' +
      '<div style="color:#64748b;font-size:13px;margin-bottom:6px">Eski adresi (github.io) kullanmaya devam eden hekimlerin işleri eski sisteme (Firebase) gider. Sunucu Firebase\'i 2 dakikada bir <b>yalnızca okur</b> ve bu işleri tarama dosyalarıyla birlikte “Hekimden Gelenler” listesine ekler. Firebase\'de hiçbir şey değiştirilmez.</div>' +
      '<label style="display:flex;gap:8px;align-items:center;font-weight:700;margin:8px 0"><input type="checkbox" id="to-k-oto"' + (k.otomatik !== false ? ' checked' : '') + '> Eski portala gönderilen işleri otomatik al</label>' +
      '<div style="font-size:13px;color:#475569">' +
      (k.sonKontrol ? 'Son kontrol: ' + tarih(k.sonKontrol) + (k.sonHata ? ' — <b style="color:#b91c1c">Firebase okunamadı: ' + esc(k.sonHata) + '</b>' : ' — başarılı') + '<br>' : 'Henüz kontrol edilmedi (sunucu açıldıktan 20 sn sonra başlar).<br>') +
      (k.toplamAlinan ? '<b style="color:#047857">Sunucu açıldığından beri ' + k.toplamAlinan + ' iş eski portaldan alındı.</b> Bu hekimlere yeni adresi gönderin.<br>' : '') +
      (k.bekleyen ? '<b style="color:#b45309">' + k.bekleyen + ' eski tarihli iş otomatik alınmadı; aşağıdan inceleyin.</b>' : '') + '</div>' +
      '<div style="margin-top:10px"><button type="button" class="to-d cizgi" id="to-k-liste">Firebase\'de olup yeni sistemde olmayan işleri listele</button></div><div id="to-k-sonuc"></div></div>';
  }
  function eskiListeyiGetir() {
    const yer = document.getElementById('to-k-sonuc');
    yer.innerHTML = '<div style="color:#64748b;margin-top:8px">Firebase okunuyor…</div>';
    api('/api/sistem/eski-portal', null, 'GET').then(r => {
      if (!r.liste.length) { yer.innerHTML = '<div class="to-karar" style="background:#d1fae5;color:#065f46">✅ Eksik iş yok: eski portala gönderilen tüm işler yeni sistemde.</div>'; return; }
      yer.innerHTML = '<div style="margin-top:10px;font-size:13px">' + r.liste.map(x =>
        '<label style="display:flex;gap:8px;align-items:center;padding:6px 0;border-top:1px dashed #e2e8f0"><input type="checkbox" value="' + esc(x.id) + '" checked>' +
        '<span style="flex:1"><b>' + esc(x.hasta || '(hasta adı yok)') + '</b> — ' + esc(x.hekim) + (x.tur ? ' · ' + esc(x.tur) : '') + ' · ' + (x.tarih ? tarih(x.tarih) : 'tarih yok') + ' · ' + x.dosya + ' dosya</span></label>').join('') +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button type="button" class="to-d ana" id="to-k-al">Seçilenleri yeni sisteme al</button><button type="button" class="to-d cizgi" id="to-k-gizle">Seçilenleri bir daha gösterme</button></div></div>';
      const secili = () => [...yer.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value);
      document.getElementById('to-k-al').onclick = function () {
        const idler = secili(); if (!idler.length) return;
        this.disabled = true; this.textContent = '⏳ Alınıyor (dosyalar indiriliyor)…';
        api('/api/sistem/eski-portal/al', { idler }).then(x => { bildir('✅ ' + x.alinan + ' iş “Hekimden Gelenler” listesine eklendi' + (x.indirilemeyen ? ' (' + x.indirilemeyen + ' dosya indirilemedi)' : '')); eskiListeyiGetir(); },
          e => { bildir(e.message, 'error'); this.disabled = false; this.textContent = 'Seçilenleri yeni sisteme al'; });
      };
      document.getElementById('to-k-gizle').onclick = () => { const idler = secili(); if (idler.length && confirm(idler.length + ' iş bu listede bir daha gösterilmeyecek. Emin misiniz?')) api('/api/sistem/eski-portal/gizle', { idler }).then(eskiListeyiGetir, e => bildir(e.message, 'error')); };
    }, e => { yer.innerHTML = '<div class="to-karar" style="background:#fee2e2;color:#991b1b">Firebase okunamadı: ' + esc(e.message) + '</div>'; });
  }

  // ── 3 BOYUTLU STL GÖRÜNTÜLEYİCİ (ek kütüphane gerektirmez) ────────
  function stlCoz(tampon) {
    const dv = new DataView(tampon);
    const n = tampon.byteLength >= 84 ? dv.getUint32(80, true) : 0;
    let konum;
    if (n > 0 && 84 + n * 50 === tampon.byteLength) { // ikili STL
      konum = new Float32Array(n * 9);
      for (let i = 0, o = 84; i < n; i++, o += 50) for (let k = 0; k < 9; k++) konum[i * 9 + k] = dv.getFloat32(o + 12 + k * 4, true);
    } else { // metin STL
      const metin = new TextDecoder().decode(tampon), sayilar = [];
      const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
      let m; while ((m = re.exec(metin))) sayilar.push(+m[1], +m[2], +m[3]);
      konum = new Float32Array(sayilar.length - sayilar.length % 9);
      konum.set(sayilar.slice(0, konum.length));
    }
    if (!konum.length) throw new Error('STL dosyası okunamadı');
    const normal = new Float32Array(konum.length);
    const en = [Infinity, Infinity, Infinity], cok = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < konum.length; i += 9) {
      const ax = konum[i + 3] - konum[i], ay = konum[i + 4] - konum[i + 1], az = konum[i + 5] - konum[i + 2];
      const bx = konum[i + 6] - konum[i], by = konum[i + 7] - konum[i + 1], bz = konum[i + 8] - konum[i + 2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const u = Math.hypot(nx, ny, nz) || 1; nx /= u; ny /= u; nz /= u;
      for (let k = 0; k < 9; k += 3) {
        normal[i + k] = nx; normal[i + k + 1] = ny; normal[i + k + 2] = nz;
        for (let e = 0; e < 3; e++) { const v = konum[i + k + e]; if (v < en[e]) en[e] = v; if (v > cok[e]) cok[e] = v; }
      }
    }
    const merkez = [(en[0] + cok[0]) / 2, (en[1] + cok[1]) / 2, (en[2] + cok[2]) / 2];
    const yaricap = Math.hypot(cok[0] - en[0], cok[1] - en[1], cok[2] - en[2]) / 2 || 1;
    return { konum, normal, merkez, yaricap, ucgen: konum.length / 9 };
  }
  function izleyiciKapat() { if (izleyici) { try { izleyici(); } catch (e) { /* yoksay */ } izleyici = null; } }
  function ucBoyutAc(yer, adres) {
    if (!yer) return;
    izleyiciKapat();
    yer.innerHTML = '<div class="to-3b"><canvas></canvas><div class="ipucu">Yükleniyor…</div><button type="button" class="to-d kucuk kapat">✕ 3B’yi kapat</button></div>';
    const kutu = yer.firstChild, tuval = kutu.querySelector('canvas'), ipucu = kutu.querySelector('.ipucu');
    let kapandi = false, gl = null, cizimIstegi = 0;
    const temizle = () => { kapandi = true; cancelAnimationFrame(cizimIstegi); window.removeEventListener('resize', boyutla); try { const e = gl && gl.getExtension('WEBGL_lose_context'); if (e) e.loseContext(); } catch (x) { /* yoksay */ } yer.innerHTML = ''; };
    izleyici = temizle;
    kutu.querySelector('.kapat').onclick = izleyiciKapat;
    let boyutla = () => {};
    fetch(adres, { credentials: 'same-origin' }).then(r => { if (!r.ok) throw new Error('Dosya alınamadı (' + r.status + ')'); return r.arrayBuffer(); }).then(tampon => {
      if (kapandi) return;
      const model = stlCoz(tampon);
      gl = tuval.getContext('webgl', { antialias: true }) || tuval.getContext('experimental-webgl');
      if (!gl) throw new Error('Bu tarayıcı 3B gösterimi desteklemiyor; dosyayı indirip açın');
      const derle = (tur, kaynak) => { const s = gl.createShader(tur); gl.shaderSource(s, kaynak); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const prog = gl.createProgram();
      gl.attachShader(prog, derle(gl.VERTEX_SHADER,
        'attribute vec3 aK; attribute vec3 aN; uniform mat3 uR; uniform vec3 uM; uniform float uO, uU, uE, uG; varying vec3 vN;' +
        'void main(){ vec3 p = uR * ((aK - uM) * uO); p.z -= uU; vN = uR * aN;' +
        ' gl_Position = vec4(p.x * uG / uE, p.y * uG, (p.z * 100.1 + 20.0) / -99.9, -p.z); }'));
      gl.attachShader(prog, derle(gl.FRAGMENT_SHADER,
        'precision mediump float; varying vec3 vN; void main(){ vec3 n = normalize(vN); float isik = abs(dot(n, normalize(vec3(0.3, 0.45, 1.0))));' +
        ' float parlak = pow(isik, 24.0) * 0.25; gl_FragColor = vec4(vec3(0.93, 0.90, 0.82) * (0.22 + 0.78 * isik) + parlak, 1.0); }'));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('3B gösterim başlatılamadı');
      gl.useProgram(prog);
      const baglama = (ad, veri) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, veri, gl.STATIC_DRAW); const k = gl.getAttribLocation(prog, ad); gl.enableVertexAttribArray(k); gl.vertexAttribPointer(k, 3, gl.FLOAT, false, 0, 0); };
      baglama('aK', model.konum); baglama('aN', model.normal);
      gl.enable(gl.DEPTH_TEST); gl.clearColor(0, 0, 0, 0);
      const U = ad => gl.getUniformLocation(prog, ad);
      let yatay = -0.5, dikey = -1.1, uzaklik = 3.2;
      const ciz3b = () => {
        cizimIstegi = 0;
        if (kapandi) return;
        const cy = Math.cos(yatay), sy = Math.sin(yatay), cx = Math.cos(dikey), sx = Math.sin(dikey);
        // R = Rx(dikey) * Rz(yatay)  (sütun öncelikli)
        gl.uniformMatrix3fv(U('uR'), false, [cy, cx * sy, sx * sy, -sy, cx * cy, sx * cy, 0, -sx, cx]);
        gl.uniform3fv(U('uM'), model.merkez); gl.uniform1f(U('uO'), 1 / model.yaricap);
        gl.uniform1f(U('uU'), uzaklik); gl.uniform1f(U('uE'), tuval.width / tuval.height); gl.uniform1f(U('uG'), 2.4);
        gl.viewport(0, 0, tuval.width, tuval.height);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, model.konum.length / 3);
      };
      const iste = () => { if (!cizimIstegi) cizimIstegi = requestAnimationFrame(ciz3b); };
      boyutla = () => { const o = Math.min(2, window.devicePixelRatio || 1); tuval.width = Math.max(2, Math.round(tuval.clientWidth * o)); tuval.height = Math.max(2, Math.round(tuval.clientHeight * o)); iste(); };
      window.addEventListener('resize', boyutla);
      // fare / dokunma: sürükle = döndür, tekerlek ya da iki parmak = yakınlaştır
      const parmak = new Map(); let sonAralik = 0;
      tuval.addEventListener('pointerdown', e => { tuval.setPointerCapture(e.pointerId); parmak.set(e.pointerId, [e.clientX, e.clientY]); tuval.style.cursor = 'grabbing'; });
      const birak = e => { parmak.delete(e.pointerId); sonAralik = 0; tuval.style.cursor = 'grab'; };
      tuval.addEventListener('pointerup', birak); tuval.addEventListener('pointercancel', birak);
      tuval.addEventListener('pointermove', e => {
        const onceki = parmak.get(e.pointerId); if (!onceki) return;
        parmak.set(e.pointerId, [e.clientX, e.clientY]);
        if (parmak.size === 1) { yatay += (e.clientX - onceki[0]) * 0.01; dikey = Math.max(-3.1, Math.min(0.1, dikey + (e.clientY - onceki[1]) * 0.01)); }
        else if (parmak.size === 2) {
          const [a, b] = [...parmak.values()], aralik = Math.hypot(a[0] - b[0], a[1] - b[1]);
          if (sonAralik) uzaklik = Math.max(1.3, Math.min(9, uzaklik * sonAralik / aralik));
          sonAralik = aralik;
        }
        iste();
      });
      tuval.addEventListener('wheel', e => { e.preventDefault(); uzaklik = Math.max(1.3, Math.min(9, uzaklik * (e.deltaY > 0 ? 1.1 : 0.9))); iste(); }, { passive: false });
      tuval.addEventListener('dblclick', () => { yatay = -0.5; dikey = -1.1; uzaklik = 3.2; iste(); });
      ipucu.textContent = 'Sürükle: döndür · Tekerlek / iki parmak: yakınlaştır · Çift tık: sıfırla · ' + model.ucgen.toLocaleString('tr-TR') + ' üçgen';
      tuval.dataset.hazir = '1';
      boyutla();
    }).catch(e => { if (!kapandi) { ipucu.textContent = '⚠️ ' + e.message; ipucu.style.color = '#fca5a5'; } });
  }

  // ── canlı veri ve bildirimler ────────────────────────────────────
  function olayBildir(baslik, metin) {
    bildir(baslik + (metin ? ' — ' + metin : ''), 'info');
    try { if (typeof window.playNotificationSound === 'function') window.playNotificationSound(); } catch (e) { /* yoksay */ }
    try { if (typeof window.fireNativeAlert === 'function') window.fireNativeAlert(baslik, metin || '', 'tasarim'); } catch (e) { /* yoksay */ }
  }
  function degisiklikleriBildir(eski, yeni) {
    for (const [id, k] of Object.entries(yeni)) {
      const once = eski[id] || {};
      if (!k || k.updatedAt === once.updatedAt || k.state === once.state && Object.keys(k.previews || {}).length === Object.keys(once.previews || {}).length) continue;
      const j = isAl(id); if (!j) continue;
      const ad = (j.patient || 'Hasta');
      if (k.state === 'hekim-onayi-bekliyor' && PANEL !== 'teknisyen') olayBildir(PANEL === 'hekim' ? '🦷 Yeni tasarım önizlemesi onayınızı bekliyor' : '🦷 Yeni önizleme yüklendi', ad);
      if (k.state === 'revizyon-istendi' && PANEL !== 'hekim') olayBildir('✏️ Hekim revizyon istedi', ad);
      if (k.state === 'onaylandi' && once.state !== 'onaylandi' && PANEL !== 'hekim') olayBildir('✅ Hekim tasarımı onayladı', ad + (PANEL === 'teknisyen' ? ' — nihai dosyayı yükleyebilirsiniz' : ''));
    }
  }
  function baslat() {
    if (!(window.firebase && firebase.database)) return;
    firebase.database().ref(KOK + '/jobs').on('value', s => {
      const v = s.val();
      girisli = v !== null || girisli;
      isler = v || {};
      if (v === null && window.DL) window.DL.ben().then(r => { girisli = !!(r && r.kullanici); dugmeGuncelle(); if (!girisli) kapat(); }).catch(() => {});
      dugmeGuncelle(); ciz();
    }, () => {});
    firebase.database().ref(KOK + '/designReviews').on('value', s => {
      const yeni = s.val() || {};
      if (!ilkKayit) degisiklikleriBildir(kayitlar, yeni);
      if (s.val() !== null || Object.keys(isler).length) ilkKayit = false;
      kayitlar = yeni;
      dugmeGuncelle(); ciz();
    }, () => {});
  }
  baslat();

  // Yönetim paneli: eski portaldan iş alındıysa / Firebase okunamıyorsa üstte uyarı
  if (PANEL === 'yonetici') {
    let gorulen = 0;
    const kontrol = () => {
      if (!girisli) return;
      api('/api/sistem', null, 'GET').then(r => {
        const k = r.eskiPortal || {};
        let serit = document.getElementById('to-kopru-serit');
        const mesaj = k.toplamAlinan > gorulen
          ? '🔁 Eski hekim portalına gönderilmiş ' + (k.toplamAlinan - gorulen) + ' iş Firebase\'den alındı ve “Hekimden Gelenler”e eklendi. Bu hekimler eski adresi kullanıyor; yeni adresi gönderin.'
          : (k.bekleyen ? '🔁 Firebase\'de, yeni sistemde olmayan ' + k.bekleyen + ' eski hekim işi var.' : '');
        if (!mesaj) { if (serit) serit.remove(); return; }
        if (!serit) {
          serit = document.createElement('div'); serit.id = 'to-kopru-serit';
          serit.style.cssText = 'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:9400;max-width:min(760px,94vw);background:#fff7ed;border:1.5px solid #fdba74;color:#9a3412;border-radius:12px;padding:10px 14px;font:600 13.5px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.15);display:flex;gap:10px;align-items:center';
          document.body.appendChild(serit);
        }
        serit.innerHTML = '<span style="flex:1"></span>';
        serit.firstChild.textContent = mesaj;
        const incele = document.createElement('button'); incele.className = 'to-d kucuk ana'; incele.textContent = 'İncele';
        incele.onclick = () => { gorulen = k.toplamAlinan; serit.remove(); gorunum = 'ayar'; sistem = null; ac(); };
        const kapatD = document.createElement('button'); kapatD.className = 'to-d kucuk cizgi'; kapatD.textContent = '✕';
        kapatD.onclick = () => { gorulen = k.toplamAlinan; serit.remove(); };
        serit.appendChild(incele); serit.appendChild(kapatD);
      }).catch(() => {});
    };
    setTimeout(kontrol, 3000); setInterval(kontrol, 120e3);
  }
  // Hata ayıklama / testler için
  window.TasarimOnayi = { ac: (isId) => { if (isId) { seciliIs = String(isId); gorunum = 'ayrinti'; } else gorunum = 'liste'; ac(); }, kapat, durum: id => { const j = isAl(id); return j ? durum(j).kod : null; } };
})();
