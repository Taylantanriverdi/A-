/* ═══════════════════════════════════════════════════════════════════
   DIGICAD Dental — is-akisi.js  ·  İŞ AKIŞI (aşamalar, PMMA/zirkon prova
   döngüleri, randevu ve teslim tarihleri, gecikme uyarıları)
   Yönetim paneli, teknisyen paneli ve hekim portalında ortak ekran.
   Kurallar: is-akisi-kural.js (sunucu da aynısını kullanır). Kayıtları
   yalnızca sunucu değiştirir (/api/is-akisi/...).
   Kullanıcıdan gelen metinler ekrana textContent ile basılır.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__isAkisi || !window.IsAkisiKural) return; window.__isAkisi = true;
  const K = window.IsAkisiKural;
  const PANEL = window.DL_PANEL || 'yonetici';
  const KOK = 'db/digicad';
  let isler = {}, akislar = {}, seedler = {}, ayar = {}, girisli = false, ilk = true;
  let gorunum = 'liste', secili = null, suzgec = { asama: '', ara: '' };

  // ── küçük yardımcılar (güvenli DOM) ──────────────────────────────
  function el(etiket, ozellik, ...cocuklar) {
    const e = document.createElement(etiket);
    for (const [k, v] of Object.entries(ozellik || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'value') e.value = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of cocuklar.flat(9)) if (c != null && c !== false) e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    return e;
  }
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const tarihTR = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? `${m[3]}.${m[2]}.${m[1]}` : ''; };
  const zamanTR = s => { try { return new Date(s).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return ''; } };
  const bugun = () => K.tarihYaz(K.bugunGun());
  const bildir = (m, t) => { if (typeof window.toast === 'function') window.toast(m, t || 'success'); };
  function api(adres, govde, yontem) {
    return fetch(adres, { method: yontem || 'POST', credentials: 'same-origin',
      headers: Object.assign({ 'X-DL-Panel': PANEL }, govde ? { 'Content-Type': 'application/json' } : {}),
      body: govde ? JSON.stringify(govde) : undefined,
    }).then(r => r.json().catch(() => ({})).then(j => { if (!r.ok) throw new Error(j.hata || 'Sunucu hatası (' + r.status + ')'); return j; }));
  }
  const isBul = id => Object.values(isler).find(j => j && String(j.id) === String(id)) || null;
  function durum(j) {
    const seed = j.sourceDoctorSubmissionId != null ? seedler[String(j.sourceDoctorSubmissionId)] : null;
    const e = K.etkin(j, akislar[String(j.id)], seed);
    const son = K.sonTarih(e, ayar);
    return { j, e, son, aciliyet: e.asama === 'teslim' ? 'normal' : K.aciliyet(son) };
  }
  const RENK = { normal: ['#0f172a', '#f1f5f9'], yakin: ['#92400e', '#fef3c7'], gecikmis: ['#991b1b', '#fee2e2'] };
  const ASAMA_RENK = { uretim: ['#1e3a8a', '#dbeafe'], prova: ['#6b21a8', '#f3e8ff'], revizyon: ['#9a3412', '#ffedd5'], son: ['#065f46', '#d1fae5'] };
  function rozet(d) {
    const [r, z] = ASAMA_RENK[d.e.bilgi.tur];
    return el('span', { class: 'ia-rozet', style: `color:${r};background:${z}` }, d.e.bilgi.simge + ' ' + d.e.bilgi.ad);
  }
  function tarihRozeti(d) {
    if (!d.son) return el('span', { class: 'ia-soluk' }, d.e.asama === 'teslim' ? '' : 'tarih yok');
    const [r, z] = RENK[d.aciliyet];
    const etiket = d.e.bilgi.tur === 'prova' ? 'Prova sonucu' : 'Aşama sonu';
    return el('span', { class: 'ia-rozet', style: `color:${r};background:${z}`, title: 'Hedef (randevu/teslim): ' + tarihTR(d.e.hedefTarih) },
      (d.aciliyet === 'gecikmis' ? '⛔ ' : d.aciliyet === 'yakin' ? '⏰ ' : '') + etiket + ': ' + tarihTR(d.son));
  }
  function revizyonMetni(e) {
    const p = [];
    if (e.pmmaRevizyonSayisi) p.push('PMMA revizyon: ' + e.pmmaRevizyonSayisi);
    if (e.zirkonRevizyonSayisi) p.push('Zirkon düzeltme: ' + e.zirkonRevizyonSayisi);
    if (e.ilaveSayisi) p.push('İlave: ' + e.ilaveSayisi);
    return p.join(' · ');
  }
  // Aktif işler: hedef tarihe göre sıralı
  function liste(tumu) {
    return Object.values(isler).filter(j => j && !j.deleted).map(durum)
      .filter(d => tumu || d.e.asama !== 'teslim')
      .sort((a, b) => String(a.e.hedefTarih || '9999').localeCompare(String(b.e.hedefTarih || '9999')));
  }

  // ── stil ─────────────────────────────────────────────────────────
  document.head.appendChild(el('style', {}, `
#ia-dugme{position:fixed;right:18px;bottom:72px;z-index:9000;display:none;align-items:center;gap:8px;padding:11px 16px;border:0;border-radius:999px;background:#1e40af;color:#fff;font:700 14px/1 system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;box-shadow:0 6px 20px rgba(30,64,175,.4)}
#ia-dugme b{background:#dc2626;color:#fff;border-radius:999px;min-width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:12px;padding:0 5px}
#ia-ortu{position:fixed;inset:0;z-index:9500;background:rgba(15,23,42,.55);display:none;align-items:center;justify-content:center;padding:12px;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a}
#ia-ortu.acik{display:flex}
#ia-kart{background:#fff;border-radius:16px;width:100%;max-width:980px;max-height:94vh;display:flex;flex-direction:column;box-shadow:0 24px 60px rgba(0,0,0,.3);overflow:hidden}
#ia-bas{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid #e2e8f0;background:#f8fafc}
#ia-bas h2{margin:0;font-size:17px;font-weight:800;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ia-govde{padding:16px 18px;overflow:auto;flex:1}
.ia-d{border:0;border-radius:9px;padding:9px 14px;font:inherit;font-weight:700;cursor:pointer;background:#e2e8f0;color:#0f172a}
.ia-d:disabled{opacity:.55;cursor:default}.ia-d.ana{background:#1e40af;color:#fff}.ia-d.yesil{background:#059669;color:#fff}.ia-d.turuncu{background:#ea580c;color:#fff}.ia-d.cizgi{background:#fff;border:1.5px solid #cbd5e1}.ia-d.kucuk{padding:6px 10px;font-size:12.5px}
.ia-d.oneri{box-shadow:0 0 0 2px #1e40af inset}
.ia-rozet{display:inline-block;padding:3px 9px;border-radius:999px;font-size:12px;font-weight:800;white-space:nowrap}
.ia-soluk{color:#64748b;font-size:12.5px}
.ia-satir{display:flex;align-items:center;gap:10px;padding:11px 12px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:8px;cursor:pointer;background:#fff;flex-wrap:wrap}
.ia-satir:hover{border-color:#1e40af;background:#eff6ff}
.ia-satir.gecikmis{border-left:5px solid #dc2626}.ia-satir.yakin{border-left:5px solid #f59e0b}.ia-satir.bende{box-shadow:0 0 0 2px #7c3aed inset}
.ia-kutu{border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:12px}
.ia-kutu h3{margin:0 0 8px;font-size:14.5px;font-weight:800}
.ia-alan{width:100%;box-sizing:border-box;padding:9px 11px;border:1.5px solid #cbd5e1;border-radius:9px;font:inherit;background:#fff}
.ia-etiket{display:block;font-size:12px;font-weight:800;color:#475569;margin:10px 0 4px}
.ia-izgara{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.ia-zaman{border-left:3px solid #cbd5e1;padding:2px 0 10px 12px;margin-left:6px;position:relative}
.ia-zaman:before{content:"";position:absolute;left:-7px;top:5px;width:11px;height:11px;border-radius:50%;background:#94a3b8}
.ia-zaman.ic:before{background:#f59e0b}
.ia-not{background:#f8fafc;border-radius:8px;padding:6px 9px;margin-top:4px;white-space:pre-wrap;overflow-wrap:anywhere}
.ia-pano{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;margin-bottom:18px}
.ia-pano .ia-kutu{background:#fff;margin:0}
.ia-pano-satir{display:flex;gap:8px;align-items:center;padding:7px 0;border-top:1px dashed #e2e8f0;cursor:pointer;flex-wrap:wrap}
.ia-pano-satir:first-of-type{border-top:0}
.ia-adim{border:1.5px solid #c7d2fe;background:#eef2ff;border-radius:12px;padding:12px;margin-top:10px}
.ia-secenek{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
.ia-secenek label{display:flex;gap:6px;align-items:center;border:1.5px solid #cbd5e1;border-radius:9px;padding:8px 11px;cursor:pointer;background:#fff;font-weight:600}
.ia-secenek input:checked+span{color:#1e40af}
@media(max-width:640px){#ia-dugme{right:12px;bottom:128px;padding:10px 13px}#ia-govde{padding:12px}}
`));

  // ── iskelet ──────────────────────────────────────────────────────
  const dugme = el('button', { id: 'ia-dugme', type: 'button' });
  const baslik = el('h2', {}, '🧭 İş Akışı');
  const geri = el('button', { type: 'button', class: 'ia-d kucuk cizgi', style: 'display:none' }, '← Liste');
  const govde = el('div', { id: 'ia-govde' });
  const ortu = el('div', { id: 'ia-ortu' }, el('div', { id: 'ia-kart' },
    el('div', { id: 'ia-bas' }, geri, baslik, el('button', { type: 'button', class: 'ia-d kucuk', onclick: () => kapat() }, '✕ Kapat')), govde));
  geri.onclick = () => { gorunum = 'liste'; secili = null; ciz(true); };
  dugme.onclick = () => { gorunum = 'liste'; secili = null; ac(); };
  function yerlestir() { document.body.appendChild(dugme); document.body.appendChild(ortu); formuHazirla(); }
  if (document.body) yerlestir(); else document.addEventListener('DOMContentLoaded', yerlestir);
  function ac() { ortu.classList.add('acik'); ciz(true); }
  function kapat() { ortu.classList.remove('acik'); }

  function rozetSayisi() {
    const l = liste(false);
    if (PANEL === 'hekim') return l.filter(d => d.e.bilgi.tur === 'prova' && !d.e.provaUygun).length;
    if (PANEL === 'teknisyen') return l.filter(d => d.aciliyet !== 'normal' && d.e.bilgi.tur !== 'prova').length;
    return l.filter(d => d.e.hekimGuncelledi || d.aciliyet === 'gecikmis').length;
  }
  function dugmeGuncelle() {
    if (!dugme.parentNode) return;
    dugme.style.display = girisli ? 'inline-flex' : 'none';
    const n = girisli ? rozetSayisi() : 0;
    dugme.textContent = '🧭 İş Akışı';
    if (n) dugme.appendChild(el('b', {}, String(n)));
    dugme.title = PANEL === 'hekim' ? 'İşlerinizin aşaması, prova sonuçları ve randevular' : 'Aşamalar, provalar, teslim tarihleri';
  }

  // ── çizim ────────────────────────────────────────────────────────
  function ciz(zorla) {
    if (!ortu.classList.contains('acik')) return;
    // Kullanıcı bir şey yazıyorsa ekranı yeniden çizme
    if (!zorla && govde.querySelector('[data-yaziliyor]')) return;
    geri.style.display = gorunum === 'liste' ? 'none' : '';
    govde.textContent = '';
    if (gorunum === 'ayar') return ayarCiz();
    if (gorunum === 'ayrinti') { const j = isBul(secili); if (j) return ayrintiCiz(durum(j)); gorunum = 'liste'; }
    listeCiz();
  }
  function yaziyor(alan) { alan.addEventListener('input', () => { if (alan.value) alan.setAttribute('data-yaziliyor', '1'); else alan.removeAttribute('data-yaziliyor'); }); return alan; }

  function listeCiz() {
    baslik.textContent = PANEL === 'hekim' ? '🧭 İşlerimin Durumu' : '🧭 İş Akışı';
    const asamaSec = el('select', { class: 'ia-alan', style: 'max-width:240px', onchange: e => { suzgec.asama = e.target.value; ciz(true); } },
      el('option', { value: '' }, 'Tüm aşamalar (teslim edilenler hariç)'),
      K.ASAMALAR.map(a => el('option', { value: a.kod, selected: suzgec.asama === a.kod }, a.simge + ' ' + a.ad)));
    const ara = el('input', { class: 'ia-alan', style: 'max-width:240px', placeholder: PANEL === 'hekim' ? 'Hasta ara…' : 'Hekim / hasta ara…', value: suzgec.ara,
      oninput: e => { suzgec.ara = e.target.value; clearTimeout(ara._z); ara._z = setTimeout(() => { ciz(true); const a = govde.querySelector('input'); if (a) { a.focus(); a.setSelectionRange(a.value.length, a.value.length); } }, 250); } });
    govde.appendChild(el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center' }, ara, asamaSec,
      el('span', { style: 'flex:1' }),
      PANEL === 'yonetici' ? el('button', { type: 'button', class: 'ia-d kucuk cizgi', onclick: () => { gorunum = 'ayar'; ciz(true); } }, '⚙️ Süre ayarları') : null));
    const q = suzgec.ara.toLocaleLowerCase('tr-TR');
    let l = liste(suzgec.asama === 'teslim');
    if (suzgec.asama) l = l.filter(d => d.e.asama === suzgec.asama);
    if (q) l = l.filter(d => `${d.j.drName || ''} ${d.j.patient || ''}`.toLocaleLowerCase('tr-TR').includes(q));
    if (PANEL === 'hekim') govde.appendChild(el('div', { class: 'ia-soluk', style: 'margin-bottom:10px' }, 'Prova aşamasındaki işler için provadan sonra sonucu ve bir sonraki randevu tarihini bildirin. Randevunuz değişirse işi açıp güncelleyin.'));
    if (!l.length) { govde.appendChild(el('div', { class: 'ia-kutu ia-soluk' }, 'Bu süzgece uyan iş yok.')); return; }
    govde.appendChild(el('div', { class: 'ia-soluk', style: 'margin-bottom:6px' }, l.length + ' iş · en yakın randevu/teslim tarihi üstte'));
    for (const d of l) govde.appendChild(satir(d));
  }
  function satir(d) {
    const bende = PANEL === 'hekim' ? d.e.bilgi.tur === 'prova' && !d.e.provaUygun : PANEL === 'yonetici' ? d.e.hekimGuncelledi : false;
    return el('div', { class: 'ia-satir ' + (d.aciliyet !== 'normal' ? d.aciliyet : '') + (bende ? ' bende' : ''), onclick: () => { secili = String(d.j.id); gorunum = 'ayrinti'; ciz(true); } },
      el('div', { style: 'flex:1;min-width:200px' },
        el('div', { style: 'font-weight:800' }, (d.j.patient || 'Hasta') + (d.j.type ? ' — ' + d.j.type : '')),
        el('div', { class: 'ia-soluk' }, [PANEL !== 'hekim' ? '👨‍⚕️ ' + (d.j.drName || '-') : null, PANEL !== 'teknisyen' && d.j.techName ? '🔧 ' + d.j.techName : null,
          d.e.hedefTarih ? '📅 ' + (d.e.randevu ? 'Randevu ' : 'Teslim ') + tarihTR(d.e.hedefTarih) : null, revizyonMetni(d.e) || null].filter(Boolean).join(' · ')),
        bende ? el('div', { style: 'color:#6d28d9;font-weight:700;font-size:12.5px;margin-top:2px' }, PANEL === 'hekim' ? '👉 Prova sonucunu ve sonraki randevuyu bildirin' : '🔔 Hekim güncelledi') : null),
      rozet(d), tarihRozeti(d));
  }

  // ── ayrıntı ──────────────────────────────────────────────────────
  function ayrintiCiz(d) {
    const { j, e } = d;
    baslik.textContent = (j.patient || 'Hasta') + (j.type ? ' — ' + j.type : '');
    const bilgi = [PANEL !== 'hekim' ? '👨‍⚕️ ' + (j.drName || '-') : null, j.techName ? '🔧 ' + j.techName : null,
      j.toothColor ? 'Renk ' + j.toothColor : null, Array.isArray(j.teeth) && j.teeth.length ? 'Dişler ' + j.teeth.join(', ') : null,
      'PMMA: ' + (e.pmmaUretici ? K.PMMA_URETICI[e.pmmaUretici] : 'belirtilmedi')].filter(Boolean).join(' · ');
    govde.appendChild(el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px' }, rozet(d), tarihRozeti(d),
      revizyonMetni(e) ? el('span', { class: 'ia-rozet', style: 'background:#ffedd5;color:#9a3412' }, revizyonMetni(e)) : null));
    govde.appendChild(el('div', { class: 'ia-soluk', style: 'margin-bottom:12px' }, bilgi));
    govde.appendChild(el('div', { class: 'ia-izgara', style: 'margin-bottom:12px' },
      el('div', { class: 'ia-kutu', style: 'margin:0' }, el('div', { class: 'ia-soluk' }, 'İstenen teslim tarihi'), el('div', { style: 'font-weight:800;font-size:16px' }, tarihTR(j.dateout) || '—')),
      el('div', { class: 'ia-kutu', style: 'margin:0' }, el('div', { class: 'ia-soluk' }, 'Sonraki randevu / hedef'), el('div', { style: 'font-weight:800;font-size:16px' }, tarihTR(e.hedefTarih) || '—'),
        e.randevu ? el('div', { class: 'ia-soluk' }, 'Güncelleyen: ' + ((e.randevu.by && e.randevu.by.name) || '') + ' · ' + zamanTR(e.randevu.at)) : null),
      d.son ? el('div', { class: 'ia-kutu', style: 'margin:0' }, el('div', { class: 'ia-soluk' }, e.bilgi.tur === 'prova' ? 'Prova sonucu beklenen tarih' : 'Bu aşamanın son tarihi'), el('div', { style: `font-weight:800;font-size:16px;color:${RENK[d.aciliyet][0]}` }, tarihTR(d.son))) : null));

    if (PANEL === 'yonetici' && e.hekimGuncelledi) {
      govde.appendChild(el('div', { class: 'ia-kutu', style: 'background:#f5f3ff;border-color:#c4b5fd;display:flex;gap:10px;align-items:center;flex-wrap:wrap' },
        el('span', { style: 'flex:1;font-weight:700;color:#5b21b6' }, '🔔 Hekim bu işte güncelleme yaptı (prova sonucu ya da randevu). Ayrıntı aşağıdaki geçmişte.'),
        el('button', { type: 'button', class: 'ia-d kucuk ana', onclick: ev => calis(ev.target, () => api('/api/is-akisi/goruldu', { isId: j.id })) }, 'Gördüm')));
    }
    if ((PANEL === 'hekim' || PANEL === 'yonetici') && e.bilgi.tur === 'prova' && !(e.asama === 'zirkon_prova' && e.provaUygun)) govde.appendChild(provaKutusu(d));
    if (e.asama === 'zirkon_prova' && e.provaUygun) govde.appendChild(el('div', { class: 'ia-kutu', style: 'background:#ecfdf5;border-color:#6ee7b7;color:#065f46;font-weight:700' }, '✅ Zirkonyum provası uygun bulundu. ' + (PANEL === 'yonetici' ? 'Teslim edince “Teslim edildi” aşamasına alın.' : 'Teslim için hazırlanıyor.')));
    if (PANEL === 'yonetici' || PANEL === 'teknisyen') govde.appendChild(gecisKutusu(d));
    if ((PANEL === 'hekim' || PANEL === 'yonetici') && e.asama !== 'teslim') govde.appendChild(randevuKutusu(d));
    if (PANEL === 'yonetici') govde.appendChild(pmmaKutusu(d));
    if (e.revizyonlar.length) govde.appendChild(revizyonKutusu(e));
    govde.appendChild(gecmisKutusu(e));
    if (typeof window.openJobChatModal === 'function' || typeof window.goToJobChat === 'function') {
      govde.appendChild(el('button', { type: 'button', class: 'ia-d cizgi', onclick: () => { kapat(); if (typeof window.openJobChatModal === 'function') window.openJobChatModal(j.id, (j.patient || '') + (j.type ? ' — ' + j.type : '')); else window.goToJobChat(j.id); } }, '💬 Bu işin sohbeti'));
    }
  }
  function calis(dgm, is) {
    dgm.disabled = true;
    return is().then(() => { govde.querySelectorAll('[data-yaziliyor]').forEach(x => x.removeAttribute('data-yaziliyor')); dgm.disabled = false; ciz(true); },
      x => { dgm.disabled = false; bildir(x.message, 'error'); });
  }
  function pmmaSecimi(ad, varsayilan) {
    return el('div', { class: 'ia-secenek' }, Object.entries(K.PMMA_URETICI).filter(([k]) => k !== 'yok').map(([k, v]) =>
      el('label', {}, el('input', { type: 'radio', name: ad, value: k, checked: varsayilan === k }), el('span', {}, v))));
  }
  function provaKutusu(d) {
    const { j, e } = d;
    const pmma = e.asama === 'pmma_prova';
    const notAlani = yaziyor(el('textarea', { class: 'ia-alan', rows: 3, placeholder: 'Düzeltme gerekiyorsa neyin değişeceğini yazın (uygunsa not isteğe bağlı)' }));
    const tarih = el('input', { type: 'date', class: 'ia-alan', style: 'max-width:220px', min: bugun(), value: '' });
    const ad = 'ia-sonuc-' + j.id;
    const secim = el('div', { class: 'ia-secenek' },
      el('label', {}, el('input', { type: 'radio', name: ad, value: 'uygun' }), el('span', {}, pmma ? '✅ Uygun — zirkonyuma geçilsin' : '✅ Uygun — teslim edilebilir')),
      el('label', {}, el('input', { type: 'radio', name: ad, value: 'revizyon' }), el('span', {}, pmma ? '✏️ PMMA revizyon gerekli' : '✏️ Düzeltme / ilave gerekli')));
    const pmmaYeri = el('div', { style: 'display:none' }, el('span', { class: 'ia-etiket' }, 'BU REVİZYONDA PMMA\'YI KİM BASACAK?'), pmmaSecimi('ia-rev-pmma-' + j.id, e.pmmaUretici === 'hekim' ? 'hekim' : 'lab'));
    secim.addEventListener('change', () => { secim.setAttribute('data-yaziliyor', '1'); pmmaYeri.style.display = pmma && secilen() === 'revizyon' ? '' : 'none'; });
    const secilen = () => { const r = secim.querySelector('input:checked'); return r ? r.value : ''; };
    const gonder = el('button', { type: 'button', class: 'ia-d ana', onclick: ev => {
      const sonuc = secilen();
      if (!sonuc) { bildir('Prova sonucunu seçin', 'error'); return; }
      if (sonuc === 'revizyon' && !notAlani.value.trim()) { bildir('Neyin düzeltilmesini istediğinizi yazın', 'error'); notAlani.focus(); return; }
      if (!tarih.value) { bildir('Bir sonraki randevu / teslim tarihini seçin', 'error'); tarih.focus(); return; }
      if (PANEL === 'yonetici' && !notAlani.value.trim()) { bildir('Hekim adına girerken açıklama yazın (ör. “telefonla bildirdi”)', 'error'); notAlani.focus(); return; }
      const r = pmmaYeri.querySelector('input:checked');
      calis(ev.target, () => api('/api/is-akisi/prova', { isId: j.id, sonuc, not: notAlani.value, randevu: tarih.value, pmmaUretici: r ? r.value : undefined })
        .then(() => bildir(sonuc === 'uygun' ? '✅ Prova sonucu iletildi' : '✏️ Revizyon talebi iletildi')));
    } }, PANEL === 'hekim' ? 'Prova sonucunu gönder' : 'Hekim adına kaydet');
    return el('div', { class: 'ia-kutu', style: 'border-color:#c4b5fd;background:#faf5ff' },
      el('h3', {}, (pmma ? '🦷 PMMA prova sonucu' : '🦷 Zirkonyum prova sonucu') + (PANEL === 'yonetici' ? ' (hekim adına)' : '')),
      PANEL === 'hekim' ? el('div', { class: 'ia-soluk' }, 'Provadan sonra sonucu ve bir sonraki randevu tarihini bildirin. Tarih girmeden gönderilemez.') : null,
      secim, pmmaYeri,
      el('span', { class: 'ia-etiket' }, 'NOT / DÜZELTME TALEBİ'), notAlani,
      el('span', { class: 'ia-etiket' }, 'SONRAKİ RANDEVU / TESLİM TARİHİ *'), tarih,
      el('div', { style: 'margin-top:12px' }, gonder));
  }
  function gecisKutusu(d) {
    const { j, e } = d;
    const kutu = el('div', { class: 'ia-kutu' }, el('h3', {}, '🧭 Aşamayı değiştir'));
    if (e.asama === 'teslim' && PANEL !== 'yonetici') { kutu.appendChild(el('div', { class: 'ia-soluk' }, 'İş teslim edildi.')); return kutu; }
    const hedefler = K.hedefler(PANEL, e.asama, e.pmmaUretici);
    if (!hedefler.length) {
      kutu.appendChild(el('div', { class: 'ia-soluk' }, e.bilgi.tur === 'prova' ? 'İş hekimde provada. Sonucu hekim portaldan bildirir (ya da laboratuvar hekim adına girer).' : 'Bu aşamadan sizin yapabileceğiniz bir geçiş yok.'));
      return kutu;
    }
    const notAlani = yaziyor(el('textarea', { class: 'ia-alan', rows: 2, placeholder: 'Not (isteğe bağlı; revizyon/düzeltmede zorunlu)' }));
    const ic = el('input', { type: 'checkbox' });
    const tarih = el('input', { type: 'date', class: 'ia-alan', style: 'max-width:220px', min: bugun() });
    const ekYer = el('div', { style: 'display:none' }, el('span', { class: 'ia-etiket' }, 'YENİ PROVA / TESLİM TARİHİ (isteğe bağlı)'), tarih,
      el('span', { class: 'ia-etiket' }, 'PMMA\'YI KİM BASACAK?'), pmmaSecimi('ia-gecis-pmma-' + j.id, e.pmmaUretici === 'hekim' ? 'hekim' : 'lab'));
    const dugmeler = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, hedefler.map(h => el('button', {
      type: 'button', class: 'ia-d kucuk ' + (h.oneri ? 'ana oneri' : h.disiSira ? 'cizgi' : ''), title: h.geri ? 'Geri alma (geçmişe düzeltme olarak yazılır)' : h.disiSira ? 'Kural dışı geçiş — yalnızca laboratuvar (geçmişe düzeltme olarak yazılır)' : h.atlanir ? 'Aradaki aşamalar atlanır' : '',
      onmouseenter: () => { ekYer.style.display = K.ASAMA[h.kod].tur === 'revizyon' ? '' : 'none'; const p = ekYer.querySelector('.ia-secenek'); if (p) p.previousSibling.style.display = p.style.display = h.kod === 'pmma_revizyon' ? '' : 'none'; },
      onclick: ev => {
        const rev = K.ASAMA[h.kod].tur === 'revizyon';
        if (rev && !notAlani.value.trim()) { ekYer.style.display = ''; bildir('Revizyon / düzeltme talebini yazın', 'error'); notAlani.focus(); return; }
        if (h.kod === 'teslim' && !confirm('İş “Teslim edildi” olarak işaretlenecek ve Tamamlandı durumuna geçecek. Emin misiniz?')) return;
        if (h.disiSira && h.kod !== 'teslim' && !confirm(`“${h.ad}” aşamasına ${h.geri ? 'geri alınacak' : 'doğal sıranın dışında geçilecek'}. Emin misiniz?`)) return;
        const p = ekYer.querySelector('input[type=radio]:checked');
        calis(ev.target, () => api('/api/is-akisi/gecis', { isId: j.id, hedef: h.kod, not: notAlani.value, ic: ic.checked, randevu: rev && tarih.value ? tarih.value : undefined, pmmaUretici: h.kod === 'pmma_revizyon' && p ? p.value : undefined })
          .then(() => bildir('🧭 ' + h.ad)));
      } }, (h.oneri ? '➡️ ' : h.geri ? '↩️ ' : h.disiSira ? '⏭️ ' : '') + K.ASAMA[h.kod].simge + ' ' + h.ad + (h.pmmaDisi ? ' (PMMA)' : ''))));
    kutu.appendChild(el('div', { class: 'ia-soluk', style: 'margin-bottom:8px' }, 'Şu an: ' + e.bilgi.ad + (e.asamaBaslangic ? ' (' + zamanTR(e.asamaBaslangic) + ' itibarıyla)' : '') + '. Mavi düğme doğal sıradaki adımdır; gereksiz aşamalar atlanabilir.'));
    kutu.appendChild(dugmeler);
    kutu.appendChild(el('span', { class: 'ia-etiket' }, 'NOT'));
    kutu.appendChild(notAlani);
    kutu.appendChild(el('label', { style: 'display:flex;gap:6px;align-items:center;margin-top:6px;font-size:13px' }, ic, el('span', {}, 'İç not (hekim görmez)')));
    kutu.appendChild(ekYer);
    return kutu;
  }
  function randevuKutusu(d) {
    const { j, e } = d;
    const tarih = el('input', { type: 'date', class: 'ia-alan', style: 'max-width:220px', min: bugun(), value: e.hedefTarih || '' });
    const notAlani = yaziyor(el('input', { class: 'ia-alan', placeholder: 'Açıklama (isteğe bağlı)' }));
    tarih.addEventListener('change', () => tarih.setAttribute('data-yaziliyor', '1'));
    return el('div', { class: 'ia-kutu' }, el('h3', {}, '📅 Randevu / teslim tarihini değiştir'),
      el('div', { class: 'ia-soluk', style: 'margin-bottom:6px' }, PANEL === 'hekim' ? 'Hasta randevusu değişti mi? Yeni tarihi girin; laboratuvara bildirim gider.' : 'Hekimin bildirdiği yeni randevu tarihini girin.'),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, tarih, notAlani,
        el('button', { type: 'button', class: 'ia-d ana kucuk', onclick: ev => {
          if (!tarih.value) { bildir('Tarih seçin', 'error'); return; }
          calis(ev.target, () => api('/api/is-akisi/randevu', { isId: j.id, tarih: tarih.value, not: notAlani.value }).then(() => bildir('📅 Tarih güncellendi')));
        } }, 'Kaydet')));
  }
  function pmmaKutusu(d) {
    const sec = el('select', { class: 'ia-alan', style: 'max-width:260px' }, el('option', { value: '' }, '— Belirtilmedi —'),
      Object.entries(K.PMMA_URETICI).map(([k, v]) => el('option', { value: k, selected: d.e.pmmaUretici === k }, v)));
    return el('div', { class: 'ia-kutu' }, el('h3', {}, '🖨️ PMMA üretim tercihi'),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, sec,
        el('button', { type: 'button', class: 'ia-d kucuk cizgi', onclick: ev => { if (!sec.value) return; calis(ev.target, () => api('/api/is-akisi/pmma', { isId: d.j.id, uretici: sec.value })); } }, 'Kaydet')),
      el('div', { class: 'ia-soluk', style: 'margin-top:6px' }, 'Hekim basacaksa laboratuvar yalnızca PMMA tasarım dosyasını gönderir; “PMMA geçici üretim” aşamasının süresi sıfır sayılır.'));
  }
  const REV_AD = { pmma: 'PMMA Revizyon', zirkon: 'Zirkonyum düzeltme', ilave: 'İlave / düzeltme' };
  function revizyonKutusu(e) {
    return el('div', { class: 'ia-kutu' }, el('h3', {}, '✏️ Revizyonlar'), e.revizyonlar.slice().reverse().map(r =>
      el('div', { style: 'border-top:1px dashed #e2e8f0;padding:8px 0' },
        el('div', { style: 'font-weight:800' }, (REV_AD[r.tur] || 'Revizyon') + ' ' + (r.turNo || r.no) + (r.bitis ? '' : ' — devam ediyor')),
        el('div', { class: 'ia-soluk' }, ['Başlangıç ' + zamanTR(r.baslangic), r.bitis ? 'Bitiş ' + zamanTR(r.bitis) : null, r.teknisyenAd ? 'Teknisyen: ' + r.teknisyenAd : null,
          r.yeniTarih ? 'Yeni prova/teslim: ' + tarihTR(r.yeniTarih) : null, r.pmmaUretici ? 'PMMA: ' + K.PMMA_URETICI[r.pmmaUretici] : null].filter(Boolean).join(' · ')),
        r.talep ? el('div', { class: 'ia-not' }, '📝 ' + r.talep) : null)));
  }
  const GECMIS_TUR = { gecis: 'Aşama değişti', duzeltme: 'Aşama geri alındı / düzeltildi', 'prova-sonucu': 'Prova sonucu', randevu: 'Randevu değişti', pmma: 'PMMA tercihi' };
  function gecmisKutusu(e) {
    const kutu = el('div', { class: 'ia-kutu' }, el('h3', {}, '🕘 Aşama geçmişi'));
    if (!e.gecmis.length) { kutu.appendChild(el('div', { class: 'ia-soluk' }, 'Henüz kayıt yok.' + (e.kayitVar ? '' : ' (Bu iş, iş akışı eklenmeden önce açıldı; aşaması mevcut durumdan hesaplandı.)'))); return kutu; }
    for (const h of e.gecmis.slice().reverse()) {
      let ust = GECMIS_TUR[h.tur] || h.tur;
      if (h.tur === 'gecis' || h.tur === 'duzeltme') ust += ': ' + (K.ASAMA[h.from] ? K.ASAMA[h.from].ad : h.from) + ' → ' + (K.ASAMA[h.to] ? K.ASAMA[h.to].ad : h.to);
      if (h.tur === 'prova-sonucu') ust += ': ' + (h.sonuc === 'uygun' ? 'uygun' : 'düzeltme gerekli') + (h.to && h.to !== h.from ? ' → ' + K.ASAMA[h.to].ad : '') + (h.adina ? ' (laboratuvar, hekim adına)' : '');
      if (h.tur === 'randevu') ust += ': ' + (h.eskiTarih ? tarihTR(h.eskiTarih) + ' → ' : '') + tarihTR(h.randevu);
      if (h.tur === 'prova-sonucu' && h.randevu) ust += ' · sonraki randevu ' + tarihTR(h.randevu);
      kutu.appendChild(el('div', { class: 'ia-zaman' + (h.ic ? ' ic' : '') },
        el('div', { style: 'font-weight:700' }, ust),
        el('div', { class: 'ia-soluk' }, zamanTR(h.at) + (h.by && h.by.name ? ' · ' + h.by.name : '') + (h.atlanan && h.atlanan.length ? ' · atlanan: ' + h.atlanan.map(k => K.ASAMA[k] ? K.ASAMA[k].kisa : k).join(', ') : '') + (h.ic ? ' · iç not' : '')),
        h.not ? el('div', { class: 'ia-not' }, h.not) : null));
    }
    return kutu;
  }

  // ── yönetici: süre ayarları ──────────────────────────────────────
  function ayarCiz() {
    baslik.textContent = '⚙️ İş akışı süreleri';
    const s = K.VARSAYILAN_SURELER, mevcut = Object.assign({}, s, ayar.asamaSureleri || {});
    const alanlar = {};
    const uretim = K.ASAMALAR.filter(a => a.kod in s);
    govde.appendChild(el('div', { class: 'ia-kutu' }, el('h3', {}, 'Aşama süreleri (gün)'),
      el('div', { class: 'ia-soluk', style: 'margin-bottom:8px' }, 'Her aşamanın son tarihi, hedef tarihten (randevu ya da teslim) bu süreler düşülerek hesaplanır. Prova aşamalarının son tarihi doğrudan randevu tarihidir.'),
      el('div', { class: 'ia-izgara' }, uretim.map(a => el('label', {}, el('span', { class: 'ia-etiket' }, a.ad), alanlar[a.kod] = el('input', { type: 'number', min: 0, max: 120, step: 0.5, class: 'ia-alan', value: mevcut[a.kod] }))))));
    const turler = new Set(Object.keys(ayar.isTipiSureleri || {}));
    Object.values(isler).forEach(j => { if (j && j.type) turler.add(String(j.type)); });
    try { if (typeof window.drArr === 'function') window.drArr().forEach(d => Object.values(d.prices || {}).forEach(p => p && p.name && turler.add(String(p.name)))); } catch (x) { /* yoksay */ }
    const isAlan = {};
    const varsayilan = el('input', { type: 'number', min: 1, max: 120, class: 'ia-alan', style: 'max-width:120px', value: ayar.varsayilanIsSuresi || K.VARSAYILAN_IS_SURESI });
    govde.appendChild(el('div', { class: 'ia-kutu' }, el('h3', {}, 'İş tipine göre standart süre (gün)'),
      el('div', { class: 'ia-soluk', style: 'margin-bottom:8px' }, 'Hekim “Laboratuvar önersin” derse teslim tarihi bugünden bu kadar gün sonrası önerilir (pazar günü pazartesiye kaydırılır). Boş bırakılan tipler için varsayılan süre kullanılır.'),
      el('label', {}, el('span', { class: 'ia-etiket' }, 'VARSAYILAN SÜRE'), varsayilan),
      el('div', { class: 'ia-izgara', style: 'margin-top:8px' }, [...turler].sort((a, b) => a.localeCompare(b, 'tr')).map(t => el('label', {}, el('span', { class: 'ia-etiket' }, t),
        isAlan[t] = el('input', { type: 'number', min: 1, max: 120, class: 'ia-alan', placeholder: String(ayar.varsayilanIsSuresi || K.VARSAYILAN_IS_SURESI), value: (ayar.isTipiSureleri || {})[t] != null ? ayar.isTipiSureleri[t] : '' }))))));
    govde.appendChild(el('button', { type: 'button', class: 'ia-d ana', onclick: ev => {
      const asamaSureleri = {}, isTipiSureleri = {};
      for (const [k, a] of Object.entries(alanlar)) asamaSureleri[k] = a.value;
      for (const [k, a] of Object.entries(isAlan)) if (a.value !== '') isTipiSureleri[k] = a.value;
      calis(ev.target, () => api('/api/is-akisi/ayar', { asamaSureleri, isTipiSureleri, varsayilanIsSuresi: varsayilan.value }).then(() => bildir('Süreler kaydedildi')));
    } }, 'Kaydet'));
  }

  // ── yönetim paneli: Genel Bakış listeleri, iş tablosu sütunu, süzgeç ──
  window.isAkisiHucre = function (j) {
    const d = durum(j);
    const [r, z] = ASAMA_RENK[d.e.bilgi.tur];
    const [tr, tz] = RENK[d.aciliyet];
    const rev = d.e.pmmaRevizyonSayisi ? ` <span title="PMMA revizyon sayısı" style="font-size:10px;font-weight:800;color:#9a3412">R${d.e.pmmaRevizyonSayisi}</span>` : '';
    const zil = d.e.hekimGuncelledi ? ' <span title="Hekim güncelledi">🔔</span>' : '';
    return `<button type="button" onclick="IsAkisi.ac(${JSON.stringify(String(j.id)).replace(/"/g, '&quot;')})" title="İş akışını aç" style="border:0;background:none;padding:0;cursor:pointer;text-align:left">` +
      `<span style="display:inline-block;padding:3px 8px;border-radius:999px;font-size:11px;font-weight:800;color:${r};background:${z};white-space:nowrap">${esc(d.e.bilgi.simge + ' ' + d.e.bilgi.kisa)}</span>${rev}${zil}` +
      (d.son ? `<div style="font-size:10.5px;font-weight:700;margin-top:3px;color:${tr};background:${tz};border-radius:6px;padding:1px 5px;display:inline-block">${d.aciliyet === 'gecikmis' ? '⛔ ' : d.aciliyet === 'yakin' ? '⏰ ' : ''}${esc(tarihTR(d.son))}</div>` : '') + '</button>';
  };
  let tabloSuzgeci = '', tarihSirasi = false;
  window.isAkisiSuzgec = function (l) {
    let s = l;
    if (tabloSuzgeci) s = s.filter(j => durum(j).e.asama === tabloSuzgeci);
    if (tarihSirasi) s = s.slice().sort((a, b) => String(durum(a).e.hedefTarih || '9999').localeCompare(String(durum(b).e.hedefTarih || '9999')));
    return s;
  };
  function tabloAraclari() {
    const yer = document.getElementById('jobs-status-filter');
    if (!yer || document.getElementById('ia-tablo-suzgec')) return;
    const sec = el('select', { id: 'ia-tablo-suzgec', class: 'inp', title: 'Aşamaya göre süz', onchange: e => { tabloSuzgeci = e.target.value; window.renderJobs && window.renderJobs(); } },
      el('option', { value: '' }, '🧭 Tüm aşamalar'), K.ASAMALAR.filter(a => a.kod !== 'teslim').map(a => el('option', { value: a.kod }, a.simge + ' ' + a.ad)));
    const sira = el('label', { style: 'display:inline-flex;gap:5px;align-items:center;font-size:12px;font-weight:600;white-space:nowrap' },
      el('input', { type: 'checkbox', onchange: e => { tarihSirasi = e.target.checked; window.renderJobs && window.renderJobs(); } }), 'Teslim tarihine göre sırala');
    yer.insertAdjacentElement('afterend', sira);
    yer.insertAdjacentElement('afterend', sec);
  }
  function panoCiz() {
    const sayfa = document.getElementById('page-dash');
    if (!sayfa || PANEL !== 'yonetici') return;
    let pano = document.getElementById('ia-pano');
    if (!pano) {
      pano = el('div', { id: 'ia-pano', class: 'ia-pano' });
      const bas = sayfa.querySelector('.page-header');
      if (bas) bas.insertAdjacentElement('afterend', pano); else sayfa.prepend(pano);
    }
    const l = liste(false), b = bugun(), yarin = K.tarihYaz(K.bugunGun() + 1);
    const yakin = l.filter(d => d.e.hedefTarih === b || d.e.hedefTarih === yarin);
    const gec = l.filter(d => d.aciliyet === 'gecikmis').sort((a, x) => String(a.son).localeCompare(String(x.son)));
    const hekim = l.filter(d => d.e.hekimGuncelledi);
    const kart = (bas, renk, dl, bos, aciklama) => el('div', { class: 'ia-kutu', style: `border-top:4px solid ${renk}` },
      el('h3', {}, bas + ' (' + dl.length + ')'),
      dl.length ? dl.slice(0, 12).map(d => el('div', { class: 'ia-pano-satir', onclick: () => window.IsAkisi.ac(d.j.id) },
        el('span', { style: 'flex:1;min-width:150px' }, el('b', {}, d.j.patient || 'Hasta'), ' · ' + (d.j.drName || '-')), rozet(d),
        el('span', { class: 'ia-soluk' }, aciklama(d)))) : el('div', { class: 'ia-soluk' }, bos),
      dl.length > 12 ? el('div', { class: 'ia-soluk', style: 'margin-top:6px' }, '+' + (dl.length - 12) + ' iş daha — 🧭 İş Akışı listesinde') : null);
    pano.textContent = '';
    pano.appendChild(kart('📅 Bugün ve yarın teslim/randevu', '#f59e0b', yakin, 'Bugün ya da yarın randevusu/teslimi olan iş yok.', d => (d.e.hedefTarih === b ? 'BUGÜN' : 'Yarın') + (d.e.randevu ? ' (randevu)' : ' (teslim)')));
    pano.appendChild(kart('⛔ Gecikmiş işler', '#dc2626', gec, 'Gecikmiş iş yok. 👍', d => 'son tarih ' + tarihTR(d.son)));
    if (hekim.length) pano.appendChild(kart('🔔 Hekimden güncelleme', '#7c3aed', hekim, '', () => 'prova sonucu / randevu'));
  }
  function panelleriYenile() {
    if (PANEL !== 'yonetici') return;
    panoCiz(); tabloAraclari();
    const aktif = document.querySelector('.section.active');
    if (aktif && aktif.id === 'page-jobs' && typeof window.renderJobs === 'function') { try { window.renderJobs(); } catch (x) { /* yoksay */ } }
  }
  if (PANEL === 'yonetici' && typeof window.renderDash === 'function') {
    const eskiDash = window.renderDash;
    window.renderDash = function () { const r = eskiDash.apply(this, arguments); try { panoCiz(); } catch (x) { console.error(x); } return r; };
    try { renderDash = window.renderDash; } catch (x) { /* yoksay */ }
  }

  // ── hekim portalı: yeni iş formunda PMMA tercihi ve teslim tarihi ──
  let labOnerisi = false;
  function formuHazirla() {
    if (PANEL !== 'hekim' || document.getElementById('ia-form-adim')) return;
    const notlar = document.getElementById('step-notes');
    if (!notlar) return;
    const masaustuTarih = document.getElementById('hp-dateout');
    const tarihAlani = masaustuTarih || el('input', { type: 'date', id: 'ia-dateout', class: 'inp', min: bugun() });
    const oneriBilgi = el('div', { class: 'ia-soluk', style: 'margin-top:6px' });
    const oneriDugme = el('button', { type: 'button', class: 'ia-d kucuk cizgi', style: 'margin-top:8px', onclick: () => {
      const tur = typeof window.getJobTypeValue === 'function' ? window.getJobTypeValue() : '';
      api('/api/is-akisi/oneri?tur=' + encodeURIComponent(tur || ''), null, 'GET').then(r => {
        tarihAlani.value = r.tarih; labOnerisi = true;
        oneriBilgi.textContent = '🧪 Laboratuvarın önerdiği tarih: ' + tarihTR(r.tarih) + (tur ? ' (' + tur + ' için standart süre)' : '') + '. Uygunsa böyle bırakın ya da tarihi değiştirin.';
        if (typeof window.updateSummary === 'function') window.updateSummary();
      }, e => bildir(e.message, 'error'));
    } }, '🧪 Tarihi bilmiyorum — laboratuvar önersin');
    tarihAlani.addEventListener('change', () => { if (labOnerisi) oneriBilgi.textContent += ' (değiştirildi)'; });
    const pmma = el('div', { class: 'ia-secenek', id: 'ia-pmma' }, Object.entries(K.PMMA_URETICI).map(([k, v]) =>
      el('label', {}, el('input', { type: 'radio', name: 'ia-pmma-uretici', value: k }), el('span', {}, k === 'lab' ? '🧪 ' + v : k === 'hekim' ? '🖨️ ' + v + ' (lab tasarım dosyasını gönderir)' : '➖ ' + v))));
    const adim = el('div', { class: 'step-card', id: 'ia-form-adim' }, el('div', { class: 'step-num' }, '★'),
      el('div', { class: 'step-content' },
        el('div', { class: 'step-title-row' }, el('div', { class: 'step-title' }, 'PMMA (geçici) üretimi' + (masaustuTarih ? '' : ' ve teslim tarihi'))),
        el('p', { class: 'section-note' }, 'Geçici (PMMA) provayı kim basacak? Geçici prova yapılmayacaksa “PMMA yok” seçin.'), pmma,
        masaustuTarih ? null : el('div', { style: 'margin-top:14px' }, el('div', { class: 'step-title', style: 'font-size:14px' }, 'Talep Edilen Teslim Tarihi *'), tarihAlani),
        masaustuTarih ? null : oneriDugme, masaustuTarih ? null : oneriBilgi));
    notlar.insertAdjacentElement('beforebegin', adim);
    if (masaustuTarih) { masaustuTarih.insertAdjacentElement('afterend', oneriBilgi); masaustuTarih.insertAdjacentElement('afterend', oneriDugme); }
    if (typeof window.resetFormForNewJob === 'function') {
      const eski = window.resetFormForNewJob;
      window.resetFormForNewJob = function () {
        const r = eski.apply(this, arguments);
        pmma.querySelectorAll('input').forEach(i => { i.checked = false; });
        if (!masaustuTarih) tarihAlani.value = '';
        labOnerisi = false; oneriBilgi.textContent = '';
        return r;
      };
      try { resetFormForNewJob = window.resetFormForNewJob; } catch (x) { /* yoksay */ }
    }
  }
  const formTarihi = () => { const a = document.getElementById('hp-dateout') || document.getElementById('ia-dateout'); return a ? a.value : ''; };
  window.isAkisiFormEksik = function () {
    const m = [];
    if (!document.querySelector('input[name="ia-pmma-uretici"]:checked')) m.push('PMMA üretim tercihi');
    if (!document.getElementById('hp-dateout') && !formTarihi()) m.push('Teslim Tarihi');
    if (m.length) { const a = document.getElementById('ia-form-adim'); if (a) a.classList.add('missing'); }
    return m;
  };
  window.isAkisiFormAlanlari = function () {
    const r = document.querySelector('input[name="ia-pmma-uretici"]:checked');
    const o = { pmmaUretici: r ? r.value : null, dateoutLabOnerisi: labOnerisi };
    if (!document.getElementById('hp-dateout')) o.dateout = formTarihi();
    return o;
  };

  // ── canlı veri ve bildirimler ────────────────────────────────────
  function olay(baslik, metin) {
    bildir(baslik + (metin ? ' — ' + metin : ''), 'info');
    try { if (typeof window.playNotificationSound === 'function') window.playNotificationSound(); } catch (x) { /* yoksay */ }
    try { if (typeof window.fireNativeAlert === 'function') window.fireNativeAlert(baslik, metin || '', 'is-akisi'); } catch (x) { /* yoksay */ }
  }
  function degisiklikler(eski, yeni) {
    for (const [id, k] of Object.entries(yeni)) {
      const o = eski[id] || {};
      if (!k || k.updatedAt === o.updatedAt) continue;
      const j = isBul(id); if (!j) continue;
      const ad = j.patient || 'Hasta';
      if (PANEL === 'yonetici' && k.labGormedi && !o.labGormedi) olay('🔔 Hekimden güncelleme', ad + ' (prova sonucu / randevu)');
      if (k.stage !== o.stage && K.ASAMA[k.stage]) {
        if (PANEL === 'hekim' && K.ASAMA[k.stage].tur === 'prova') olay('🦷 ' + K.ASAMA[k.stage].ad, ad + ' — provadan sonra sonucu bildirin');
        if (PANEL === 'teknisyen' && K.ASAMA[k.stage].tur === 'revizyon') olay('✏️ ' + K.ASAMA[k.stage].ad, ad);
        if (PANEL === 'teknisyen' && k.stage === 'zirkon' && o.stage === 'pmma_prova') olay('✅ PMMA provası uygun', ad + ' — zirkonyuma geçildi');
      }
    }
  }
  function yenile() { dugmeGuncelle(); ciz(false); panelleriYenile(); }
  function baslat() {
    if (!(window.firebase && firebase.database)) return;
    const db = firebase.database();
    db.ref(KOK + '/jobs').on('value', s => {
      const v = s.val();
      if (v !== null) girisli = true;
      isler = v || {};
      if (v === null && window.DL) window.DL.ben().then(r => { girisli = !!(r && r.kullanici); dugmeGuncelle(); if (!girisli) kapat(); }).catch(() => {});
      yenile();
    }, () => {});
    db.ref(KOK + '/workflows').on('value', s => {
      const yeni = s.val() || {};
      if (!ilk) degisiklikler(akislar, yeni);
      if (Object.keys(isler).length) ilk = false;
      akislar = yeni; yenile();
    }, () => {});
    db.ref(KOK + '/workflowSeeds').on('value', s => { seedler = s.val() || {}; yenile(); }, () => {});
    if (PANEL !== 'hekim') db.ref(KOK + '/workflowSettings').on('value', s => { ayar = s.val() || {}; yenile(); }, () => {});
  }
  baslat();
  window.IsAkisi = { ac: id => { if (id != null) { secili = String(id); gorunum = 'ayrinti'; } else gorunum = 'liste'; ac(); }, kapat, durum: id => { const j = isBul(id); return j ? durum(j) : null; } };
})();
