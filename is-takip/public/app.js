/* Klinik ⇄ Teknisyen İş Takip — istemci uygulaması (tek sayfa, framework yok) */

/* ================================================================== */
/* Yardımcılar                                                         */
/* ================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
  if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  const res = await fetch('/api' + path, init);
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error((data && data.error) || 'İşlem başarısız');
    err.status = res.status;
    if (res.status === 401 && state.me) { state.me = null; renderAuth(); }
    throw err;
  }
  return data;
}

function toast(text, opts = {}) {
  const el = document.createElement('div');
  el.className = 'toast ' + (opts.type || '');
  el.innerHTML = `${esc(text)}${opts.sub ? `<small>${esc(opts.sub)}</small>` : ''}`;
  el.onclick = () => { if (opts.href) location.hash = opts.href; el.remove(); };
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), opts.ms || 4500);
}
const toastErr = (e) => toast(e.message || String(e), { type: 'bad' });

/* --- Zaman --- */
const TR = 'tr-TR';
const pad = (n) => String(n).padStart(2, '0');
const fmtDate = (iso) => iso ? new Date(iso.length === 10 ? iso + 'T00:00:00' : iso).toLocaleDateString(TR, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString(TR, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtTime = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const dayKey = (iso) => new Date(iso).toLocaleDateString(TR);
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function rel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const s = (Date.now() - d) / 1000;
  if (s < 45) return 'az önce';
  if (s < 3600) return `${Math.round(s / 60)} dk önce`;
  if (s < 86400 && dayKey(iso) === dayKey(new Date().toISOString())) return `${Math.round(s / 3600)} sa önce`;
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (dayKey(iso) === y.toLocaleDateString(TR)) return `dün ${fmtTime(iso)}`;
  if (s < 7 * 86400) return d.toLocaleDateString(TR, { weekday: 'long' }) + ' ' + fmtTime(iso);
  return fmtDateTime(iso);
}
function dur(ms) {
  if (ms < 0) ms = 0;
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m} dk`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} sa ${m % 60} dk`;
  const d = Math.floor(h / 24);
  return `${d} gün ${h % 24} sa`;
}
function dueInfo(c) {
  if (!c.dueDate) return { text: 'Tarih yok', cls: '' };
  if (['tamamlandi', 'iptal'].includes(c.status)) return { text: fmtDate(c.dueDate), cls: '' };
  const diff = Math.round((new Date(c.dueDate + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 864e5);
  if (diff < 0) return { text: `${-diff} gün gecikti`, cls: 'late' };
  if (diff === 0) return { text: 'Bugün teslim', cls: 'soon' };
  if (diff === 1) return { text: 'Yarın teslim', cls: 'soon' };
  return { text: `${diff} gün kaldı`, cls: diff <= 2 ? 'soon' : '' };
}
const fmtSize = (b) => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB';

/* --- Görsel parçalar --- */
const COLORS = ['#1f6feb', '#138a5e', '#b7791f', '#6d4ad6', '#0e7490', '#c9302c', '#9c4dcc', '#2f855a', '#dd6b20'];
function avatar(name, cls = '') {
  const n = String(name || '?').replace(/^(Dt\.|Tekn\.|Dr\.)\s*/i, '');
  const ini = n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toLocaleUpperCase(TR) || '?';
  let h = 0; for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `<span class="avatar ${cls}" style="background:${COLORS[h % COLORS.length]}">${esc(ini)}</span>`;
}
const statusBadge = (s) => `<span class="badge st-${s}">${esc(state.statuses[s] || s)}</span>`;
const PRIO = { dusuk: 'Düşük', normal: 'Normal', yuksek: 'Yüksek', acil: 'ACİL' };
const prioBadge = (p) => p && p !== 'normal' ? `<span class="badge plain pr-${p}">${PRIO[p]}</span>` : '';
const dirTag = (c) => c.direction === 'incoming'
  ? `<span class="dir incoming">← Gelen</span>` : `<span class="dir outgoing">Giden →</span>`;
const roleName = (r) => r === 'clinic' ? 'Klinik' : 'Teknisyen';
const partnerWord = () => state.me.role === 'clinic' ? 'Teknisyen / Laboratuvar' : 'Klinik';

const ICON = {
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6"/><path d="M16 4a4 4 0 0 1 0 8M22 21c0-3-2-5-4-5.6"/>',
  box: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  inbox: '<path d="M3 13h5l2 3h4l2-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  upload: '<path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 20h16"/>',
  download: '<path d="M12 4v12M6 10l6 6 6-6"/><path d="M4 20h16"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
  cube: '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 22V12M21 7l-9 5-9-5"/>',
  edit: '<path d="M4 20h4L20 8l-4-4L4 16z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  csv: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  back: '<path d="M15 18l-6-6 6-6"/>'
};
const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[n]}</svg>`;

/* --- Sabit listeler --- */
const WORK_TYPES = ['Kron', 'Köprü', 'İmplant üstü kron', 'İmplant üstü köprü', 'İnley / Onley', 'Laminate veneer', 'Geçici kron/köprü', 'Total protez', 'Parsiyel protez', 'Hareketli protez tamiri', 'Plak / Splint', 'Ortodontik aparey', 'Şeffaf plak (aligner)', 'Cerrahi rehber', 'Model / Dijital model', 'Diğer'];
const MATERIALS = ['Zirkonyum', 'Monolitik zirkonyum', 'E.max (lityum disilikat)', 'Metal destekli porselen', 'PMMA', 'Kompozit', 'Akrilik', 'Şeffaf akrilik', 'Krom-kobalt', 'Titanyum', 'Diğer'];
const SHADES = ['', 'A1', 'A2', 'A3', 'A3.5', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'C4', 'D2', 'D3', 'D4', 'BL1', 'BL2', 'BL3', 'BL4', 'OM1', 'OM2', 'OM3'];
const FLOW = ['gonderildi', 'kabul', 'uretimde', 'prova', 'hazir', 'teslim', 'tamamlandi'];
const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

/* ================================================================== */
/* Durum                                                               */
/* ================================================================== */
const state = { me: null, statuses: {}, partners: null, stats: null, es: null, caseCache: null };

async function getPartners(force) {
  if (!state.partners || force) state.partners = await api('/partners');
  return state.partners;
}

/* ================================================================== */
/* Giriş / Kayıt                                                       */
/* ================================================================== */
function renderAuth(mode = 'login') {
  state.es?.close();
  $('#app').innerHTML = `
  <div class="auth">
    <div class="auth-hero">
      <div class="brand-logo" style="width:52px;height:52px">${toothSvg(30)}</div>
      <h1>Klinik ⇄ Teknisyen<br>İş Takip Sistemi</h1>
      <p style="margin:0;color:#dbe8fb;max-width:460px">Hastanın adının altında tüm işleri tek ekranda yönetin. Klinik ile laboratuvar arasında iş gönderin, kabul edin, not bırakın, STL yükleyin ve her aşamanın zamanını takip edin.</p>
      <ul>
        <li>Hasta bazlı iş kartları ve iş numaraları</li>
        <li>Gönder → Kabul → Üretim → Prova → Teslim akışı</li>
        <li>STL / görsel / PDF yükleme ve tarayıcıda 3D STL görüntüleme</li>
        <li>Anlık bildirimler, notlar, okundu bilgisi</li>
        <li>Teslim tarihi takibi, geciken iş uyarıları, aşama süreleri</li>
      </ul>
    </div>
    <div class="auth-form">
      <div class="card">
        ${mode === 'login' ? `
          <h2>Giriş yap</h2>
          <p class="muted small" style="margin:4px 0 18px">Hesabınız yok mu? <a href="#" id="to-reg">Kayıt olun</a></p>
          <form id="f-login" class="stack">
            <label class="field">E-posta<input name="email" type="email" required autocomplete="email"></label>
            <label class="field">Şifre<input name="password" type="password" required autocomplete="current-password"></label>
            <div class="err" id="err"></div>
            <button class="btn primary" type="submit">Giriş yap</button>
          </form>
          <div class="demo">
            <div class="small muted" style="margin-bottom:8px">Demo hesaplarla hızlı giriş (şifre: 1234)</div>
            <div class="grid-2">
              <button class="btn" data-demo="klinik@demo.com">🏥 Klinik</button>
              <button class="btn" data-demo="teknisyen@demo.com">🦷 Teknisyen</button>
            </div>
          </div>` : `
          <h2>Kayıt ol</h2>
          <p class="muted small" style="margin:4px 0 18px">Zaten hesabınız var mı? <a href="#" id="to-login">Giriş yapın</a></p>
          <form id="f-reg" class="stack">
            <div class="role-pick">
              <label><input type="radio" name="role" value="clinic" checked>🏥 Klinik / Hekim</label>
              <label><input type="radio" name="role" value="technician">🦷 Teknisyen / Lab</label>
            </div>
            <label class="field">Ad Soyad<input name="name" required placeholder="Dt. Ad Soyad"></label>
            <label class="field">Klinik / Laboratuvar adı<input name="org" placeholder="Örn. Gülüş Diş Kliniği"></label>
            <label class="field">Telefon<input name="phone" type="tel"></label>
            <label class="field">E-posta<input name="email" type="email" required></label>
            <label class="field">Şifre<input name="password" type="password" required minlength="4"></label>
            <div class="err" id="err"></div>
            <button class="btn primary" type="submit">Hesap oluştur</button>
          </form>`}
      </div>
    </div>
  </div>`;
  $('#to-reg')?.addEventListener('click', (e) => { e.preventDefault(); renderAuth('register'); });
  $('#to-login')?.addEventListener('click', (e) => { e.preventDefault(); renderAuth('login'); });
  const doLogin = async (body) => {
    try { await api('/login', { method: 'POST', body }); await boot(); }
    catch (e) { $('#err').textContent = e.message; }
  };
  $('#f-login')?.addEventListener('submit', (e) => { e.preventDefault(); doLogin(Object.fromEntries(new FormData(e.target))); });
  $$('[data-demo]').forEach((b) => b.onclick = () => doLogin({ email: b.dataset.demo, password: '1234' }));
  $('#f-reg')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/register', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); await boot(); }
    catch (err) { $('#err').textContent = err.message; }
  });
}
function toothSvg(s = 20) {
  return `<svg width="${s}" height="${s}" viewBox="0 0 64 64"><path d="M20 12c-7 0-11 6-10 14 1 7 4 12 5 19 1 5 6 5 7 0l2-9c1-4 6-4 7 0l2 9c1 5 6 5 7 0 1-7 4-12 5-19 1-8-3-14-10-14-5 0-7 2-8 2s-3-2-7-2z" fill="#fff"/></svg>`;
}

/* ================================================================== */
/* Uygulama iskeleti                                                   */
/* ================================================================== */
function renderShell() {
  const me = state.me;
  $('#app').innerHTML = `
  <div class="layout">
    <aside class="sidebar" id="sidebar">
      <div class="brand"><div class="brand-logo">${toothSvg()}</div><div><b>İş Takip</b><span>${me.role === 'clinic' ? 'Klinik paneli' : 'Teknisyen paneli'}</span></div></div>
      <nav class="nav">
        <a href="#/" data-nav="pano">${icon('home')}Pano</a>
        <a href="#/hastalar" data-nav="hastalar">${icon('users')}Hastalar</a>
        <a href="#/isler?tab=gelen" data-nav="gelen">${icon('inbox')}Gelen işler<span class="count" id="cnt-in"></span></a>
        <a href="#/isler?tab=giden" data-nav="giden">${icon('send')}Gönderdiğim işler</a>
        <a href="#/isler?tab=aktif" data-nav="isler">${icon('box')}Tüm işler<span class="count" id="cnt-unread"></span></a>
        <a href="#/profil" data-nav="profil">${icon('user')}Profil & ayarlar</a>
      </nav>
      <div class="side-foot">
        <div class="side-user">${avatar(me.name, 'sm')}<div style="min-width:0"><b style="font-size:13px">${esc(me.name)}</b><small>${esc(me.org || roleName(me.role))}</small></div></div>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="btn icon ghost menu-btn" id="menu" aria-label="Menü">${icon('menu')}</button>
        <form class="search" id="search"><input name="q" placeholder="Hasta, iş no, iş türü ara…" autocomplete="off">${icon('search')}</form>
        <div class="spacer"></div>
        <button class="btn primary" id="new-case">${icon('plus')}<span class="lbl">Yeni iş gönder</span></button>
        <button class="btn icon ghost" id="theme" title="Tema">${icon('moon')}</button>
        <button class="btn icon ghost" id="logout" title="Çıkış">${icon('logout')}</button>
      </header>
      <main class="content" id="view"></main>
    </div>
  </div>`;
  $('#menu').onclick = () => $('#sidebar').classList.toggle('open');
  $('#sidebar').addEventListener('click', (e) => { if (e.target.closest('a')) $('#sidebar').classList.remove('open'); });
  $('#new-case').onclick = () => openNewCase();
  $('#logout').onclick = async () => { await api('/logout', { method: 'POST' }).catch(() => {}); state.me = null; state.partners = null; renderAuth(); };
  $('#theme').onclick = toggleTheme;
  $('#search').onsubmit = (e) => { e.preventDefault(); const q = e.target.q.value.trim(); location.hash = '#/ara?q=' + encodeURIComponent(q); };
}

function toggleTheme() {
  const cur = document.documentElement.dataset.theme
    || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch {}
}
try { const t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch {}

async function refreshBadges() {
  try {
    state.stats = await api('/stats');
    const set = (id, n) => { const el = $(id); if (el) el.textContent = n ? n : ''; };
    set('#cnt-in', state.stats.incomingNew);
    set('#cnt-unread', state.stats.unread);
    document.title = (state.stats.unread ? `(${state.stats.unread}) ` : '') + 'Klinik ⇄ Teknisyen İş Takip';
  } catch {}
}

/* ================================================================== */
/* Yönlendirici                                                        */
/* ================================================================== */
function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [p, qs] = h.split('?');
  return { parts: p.split('/').filter(Boolean), query: new URLSearchParams(qs || '') };
}
let renderSeq = 0;
async function route(opts = {}) {
  if (!state.me) return;
  const { parts, query } = parseHash();
  const seq = ++renderSeq;
  const view = $('#view');
  const navKey = parts[0] === 'isler' ? ({ gelen: 'gelen', giden: 'giden' }[query.get('tab')] || 'isler')
    : parts[0] === 'hasta' ? 'hastalar' : parts[0] === 'is' ? '' : (parts[0] || 'pano');
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === navKey));
  // Canlı yenilemede yazılmakta olan metinleri koru
  const keep = {};
  $$('[data-keep]', view).forEach((el) => { keep[el.dataset.keep] = el.value; });
  const focused = document.activeElement?.dataset?.keep;
  try {
    let html;
    switch (parts[0] || '') {
      case '': html = await viewDashboard(); break;
      case 'hastalar': html = await viewPatients(query); break;
      case 'hasta': html = await viewPatient(parts[1]); break;
      case 'isler': html = await viewCases(query); break;
      case 'is': html = await viewCase(parts[1], opts); break;
      case 'ara': html = await viewSearch(query); break;
      case 'profil': html = viewProfile(); break;
      default: html = `<div class="empty">Sayfa bulunamadı. <a href="#/">Panoya dön</a></div>`;
    }
    if (seq !== renderSeq) return;
    if (typeof html === 'string') view.innerHTML = html;
    $$('[data-keep]', view).forEach((el) => { if (keep[el.dataset.keep] != null) el.value = keep[el.dataset.keep]; });
    if (focused) $(`[data-keep="${focused}"]`, view)?.focus();
    afterRender[parts[0] || '']?.(parts, query, opts);
    if (!opts.soft) window.scrollTo(0, 0);
  } catch (e) {
    if (seq !== renderSeq) return;
    view.innerHTML = `<div class="card empty">${esc(e.message)}<br><br><a href="#/">Panoya dön</a></div>`;
  }
}
const afterRender = {};
window.addEventListener('hashchange', () => route());

/* ================================================================== */
/* Ortak satır şablonları                                              */
/* ================================================================== */
function caseRow(c, { showPatient = true } = {}) {
  const d = dueInfo(c);
  const other = c.direction === 'incoming' ? c.from : c.to;
  return `<a class="case-row" href="#/is/${c.id}">
    <span class="no mono">#${esc(c.no)}</span>
    <span class="t"><b>${showPatient ? esc(c.patientName) + ' · ' : ''}${esc(c.title)}</b>
      <small>${dirTag(c)} ${esc(other?.org || other?.name || '')} · ${esc(c.workType)}${c.teeth?.length ? ' · Diş ' + c.teeth.join(', ') : ''} · ${rel(c.updatedAt)}</small></span>
    <span class="meta extra">${prioBadge(c.priority)}<span class="due ${d.cls}">${icon('clock').replace('<svg', '<svg width="13" height="13" style="vertical-align:-2px"')} ${d.text}</span></span>
    <span class="meta">${c.unread ? `<span class="dot-unread" title="Okunmamış">${c.unread}</span>` : ''}${statusBadge(c.status)}</span>
  </a>`;
}
function feedItem(e) {
  const verb = { note: 'not yazdı', status: 'durumu güncelledi', file: 'dosya işlemi', created: 'yeni iş', due: 'tarih değiştirdi', edit: 'bilgileri düzenledi' }[e.type] || '';
  return `<a class="feed-item" href="#/is/${e.caseId}" style="color:inherit;text-decoration:none">
    ${avatar(e.user?.name, 'sm')}
    <div class="txt"><b>${esc(e.user?.name)}</b> <span class="muted small">${verb} · ${rel(e.at)}</span>
      <p>#${esc(e.caseNo)} ${esc(e.patientName)} — ${esc(e.text)}</p></div></a>`;
}

/* ================================================================== */
/* Pano                                                                */
/* ================================================================== */
async function viewDashboard() {
  const [s, cases] = await Promise.all([api('/stats'), api('/cases?status=active')]);
  state.stats = s;
  const waiting = cases.filter((c) => c.actions.length);
  const upcoming = cases.filter((c) => c.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 8);
  const max = Math.max(1, ...Object.values(s.byStatus));
  const hello = new Date().getHours() < 12 ? 'Günaydın' : new Date().getHours() < 18 ? 'İyi günler' : 'İyi akşamlar';
  return `
  <div class="page-head">
    <div><h1>${hello}, ${esc(state.me.name.split(' ').slice(0, 2).join(' '))}</h1>
    <p class="muted">${new Date().toLocaleDateString(TR, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${esc(state.me.org || '')}</p></div>
    <button class="btn" onclick="location.hash='#/hastalar?new=1'">${icon('plus')}Yeni hasta</button>
  </div>
  <div class="stats">
    <div class="card stat primary" onclick="location.hash='#/isler?tab=gelen'"><span class="label">Yeni gelen iş</span><span class="value">${s.incomingNew}</span><span class="small muted">Kabul bekliyor</span></div>
    <div class="card stat warn" onclick="location.hash='#/isler?tab=aktif'"><span class="label">Sizden işlem bekleyen</span><span class="value">${s.waitingMe}</span><span class="small muted">Aksiyon gerekli</span></div>
    <div class="card stat" onclick="location.hash='#/isler?tab=aktif'"><span class="label">Aktif işler</span><span class="value">${s.active}</span><span class="small muted">Toplam ${s.total} iş</span></div>
    <div class="card stat bad" onclick="location.hash='#/isler?tab=aktif&sort=due'"><span class="label">Geciken</span><span class="value">${s.overdue}</span><span class="small muted">Bugün teslim: ${s.dueToday}</span></div>
    <div class="card stat ok"><span class="label">Ort. tamamlanma</span><span class="value">${s.avgDays == null ? '—' : s.avgDays.toFixed(1)}</span><span class="small muted">gün / iş</span></div>
    <div class="card stat" onclick="location.hash='#/hastalar'"><span class="label">Hasta</span><span class="value">${s.patients}</span><span class="small muted">Okunmamış: ${s.unread}</span></div>
  </div>
  <div class="two-col">
    <div class="stack" style="gap:18px">
      <div class="card">
        <div class="card-head"><h2>Sizden işlem bekleyen işler</h2><a href="#/isler?tab=aktif" class="small">Tümü →</a></div>
        <div class="list">${waiting.length ? waiting.slice(0, 10).map((c) => caseRow(c)).join('') : '<div class="empty">Harika! Şu an sizden işlem bekleyen iş yok.</div>'}</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Yaklaşan teslimler</h2><a href="#/isler?tab=aktif&sort=due" class="small">Takvime göre →</a></div>
        <div class="list">${upcoming.length ? upcoming.map((c) => caseRow(c)).join('') : '<div class="empty">Teslim tarihi girilmiş aktif iş yok.</div>'}</div>
      </div>
    </div>
    <div class="stack" style="gap:18px">
      <div class="card">
        <div class="card-head"><h2>Aşamalara göre işler</h2></div>
        <div class="card-body bars">${Object.entries(s.byStatus).map(([k, v]) => `
          <div class="bar"><span>${esc(state.statuses[k])}</span><div class="track"><div class="fill" style="width:${(v / max) * 100}%"></div></div><b class="mono">${v}</b></div>`).join('')}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Son hareketler</h2></div>
        <div class="list">${s.recent.length ? s.recent.slice(0, 12).map(feedItem).join('') : '<div class="empty">Henüz hareket yok.</div>'}</div>
      </div>
    </div>
  </div>`;
}

/* ================================================================== */
/* Hastalar                                                            */
/* ================================================================== */
async function viewPatients(query) {
  const q = query.get('q') || '';
  const list = await api('/patients?q=' + encodeURIComponent(q));
  return `
  <div class="page-head">
    <div><h1>Hastalar</h1><p class="muted">Her hastanın altında o hastaya ait tüm işler listelenir.</p></div>
    <button class="btn primary" id="add-patient">${icon('plus')}Yeni hasta</button>
  </div>
  <div class="toolbar"><input id="pq" placeholder="Hasta adı veya telefon ile filtrele" value="${esc(q)}" style="max-width:360px"></div>
  ${list.length ? list.map(patientCard).join('') : `<div class="card empty">${q ? 'Eşleşen hasta yok.' : 'Henüz hasta yok. “Yeni hasta” ile başlayın.'}</div>`}`;
}
function patientCard(p) {
  const active = p.cases.filter((c) => !['tamamlandi', 'iptal'].includes(c.status)).length;
  return `<div class="card patient-card">
    <div class="patient-head">
      ${avatar(p.name)}
      <div class="grow"><a class="name" href="#/hasta/${p.id}">${esc(p.name)}</a>
        <div class="small muted">${[p.phone, p.birthDate && 'Doğum: ' + fmtDate(p.birthDate), state.me.role === 'technician' && p.clinic ? p.clinic.org : '', `${p.cases.length} iş, ${active} aktif`].filter(Boolean).map(esc).join(' · ')}</div></div>
      <button class="btn sm" data-new-for="${p.id}">${icon('plus')}İş gönder</button>
    </div>
    <div class="list">${p.cases.length ? p.cases.map((c) => caseRow(c, { showPatient: false })).join('') : '<div class="empty" style="padding:16px">Bu hastaya ait iş yok.</div>'}</div>
  </div>`;
}
afterRender.hastalar = (parts, query) => {
  $('#add-patient').onclick = () => openPatientForm(null, (p) => { location.hash = '#/hasta/' + p.id; });
  $$('[data-new-for]').forEach((b) => b.onclick = () => openNewCase({ patientId: b.dataset.newFor }));
  const pq = $('#pq');
  pq.oninput = debounce(() => { history.replaceState(null, '', '#/hastalar?q=' + encodeURIComponent(pq.value)); route({ soft: true }).then(() => { const el = $('#pq'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }); }, 250);
  if (query.get('new') === '1') { history.replaceState(null, '', '#/hastalar'); $('#add-patient').click(); }
};

async function viewPatient(id) {
  const p = await api('/patients/' + id);
  const active = p.cases.filter((c) => !['tamamlandi', 'iptal'].includes(c.status));
  const done = p.cases.filter((c) => ['tamamlandi', 'iptal'].includes(c.status));
  const age = p.birthDate ? Math.floor((Date.now() - new Date(p.birthDate)) / (365.25 * 864e5)) : null;
  return `
  <div class="page-head">
    <div class="row" style="gap:14px">${avatar(p.name)}<div>
      <div class="small muted"><a href="#/hastalar">Hastalar</a> /</div>
      <h1>${esc(p.name)}</h1></div></div>
    <div class="row">
      ${p.canEdit ? `<button class="btn" id="edit-p">${icon('edit')}Düzenle</button>` : ''}
      <button class="btn primary" id="new-for">${icon('plus')}Bu hastaya iş gönder</button>
    </div>
  </div>
  <div class="two-col">
    <div class="stack" style="gap:18px">
      <div class="card"><div class="card-head"><h2>Aktif işler (${active.length})</h2></div>
        <div class="list">${active.length ? active.map((c) => caseRow(c, { showPatient: false })).join('') : '<div class="empty">Aktif iş yok.</div>'}</div></div>
      <div class="card"><div class="card-head"><h2>Geçmiş işler (${done.length})</h2></div>
        <div class="list">${done.length ? done.map((c) => caseRow(c, { showPatient: false })).join('') : '<div class="empty">Tamamlanmış iş yok.</div>'}</div></div>
    </div>
    <div class="card"><div class="card-head"><h2>Hasta bilgileri</h2></div>
      <div class="card-body"><div class="kv">
        <div><small>Telefon</small><b>${esc(p.phone || '—')}</b></div>
        <div><small>Doğum tarihi</small><b>${p.birthDate ? fmtDate(p.birthDate) + (age != null ? ` (${age} yaş)` : '') : '—'}</b></div>
        <div><small>Cinsiyet</small><b>${{ E: 'Erkek', K: 'Kadın' }[p.gender] || '—'}</b></div>
        <div><small>Klinik</small><b>${esc(p.clinic?.org || p.clinic?.name || '—')}</b></div>
        <div><small>Kayıt</small><b>${fmtDateTime(p.createdAt)}</b></div>
        <div><small>Toplam iş</small><b>${p.cases.length}</b></div>
      </div>
      ${p.notes ? `<div class="desc"><b class="small muted">Hasta notu</b><br>${esc(p.notes)}</div>` : ''}
      </div></div>
  </div>`;
}
afterRender.hasta = (parts) => {
  $('#new-for').onclick = () => openNewCase({ patientId: parts[1] });
  $('#edit-p')?.addEventListener('click', async () => {
    const p = await api('/patients/' + parts[1]);
    openPatientForm(p, () => route({ soft: true }));
  });
};

/* ================================================================== */
/* İş listesi                                                          */
/* ================================================================== */
const TABS = { aktif: 'Aktif', gelen: 'Gelen', giden: 'Gönderilen', tamam: 'Tamamlanan', tumu: 'Tümü' };
async function viewCases(query) {
  const tab = TABS[query.get('tab')] ? query.get('tab') : 'aktif';
  const st = query.get('status') || '';
  const q = query.get('q') || '';
  const sort = query.get('sort') || 'updated';
  const params = new URLSearchParams();
  if (tab === 'aktif') params.set('status', 'active');
  if (tab === 'tamam') params.set('status', 'tamamlandi');
  if (tab === 'gelen') params.set('dir', 'incoming');
  if (tab === 'giden') params.set('dir', 'outgoing');
  if (st) params.set('status', st);
  if (q) params.set('q', q);
  let list = await api('/cases?' + params);
  const pr = { acil: 0, yuksek: 1, normal: 2, dusuk: 3 };
  if (sort === 'due') list.sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  if (sort === 'prio') list.sort((a, b) => pr[a.priority] - pr[b.priority]);
  if (sort === 'created') list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  state.lastList = list;
  const link = (k, v) => { const p = new URLSearchParams(query); p.set(k, v); return '#/isler?' + p; };
  return `
  <div class="page-head">
    <div><h1>${tab === 'gelen' ? 'Gelen işler' : tab === 'giden' ? 'Gönderdiğim işler' : 'İşler'}</h1>
      <p class="muted">${list.length} iş listeleniyor</p></div>
    <div class="row"><button class="btn" id="csv">${icon('csv')}CSV indir</button>
      <button class="btn primary" onclick="document.getElementById('new-case').click()">${icon('plus')}Yeni iş</button></div>
  </div>
  <div class="toolbar">
    <div class="tabs">${Object.entries(TABS).map(([k, v]) => `<button class="${k === tab ? 'active' : ''}" onclick="location.hash='${link('tab', k).replace(/'/g, '')}'">${v}</button>`).join('')}</div>
    <select id="f-status"><option value="">Tüm aşamalar</option>${Object.entries(state.statuses).map(([k, v]) => `<option value="${k}" ${k === st ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
    <select id="f-sort">
      <option value="updated" ${sort === 'updated' ? 'selected' : ''}>Son güncellenen</option>
      <option value="due" ${sort === 'due' ? 'selected' : ''}>Teslim tarihi</option>
      <option value="prio" ${sort === 'prio' ? 'selected' : ''}>Öncelik</option>
      <option value="created" ${sort === 'created' ? 'selected' : ''}>Oluşturma</option>
    </select>
    <input id="f-q" placeholder="Bu listede ara" value="${esc(q)}">
  </div>
  <div class="card"><div class="list">${list.length ? list.map((c) => caseRow(c)).join('') : '<div class="empty">Bu filtrede iş yok.</div>'}</div></div>`;
}
afterRender.isler = (parts, query) => {
  const go = (k, v) => { const p = new URLSearchParams(query); v ? p.set(k, v) : p.delete(k); location.hash = '#/isler?' + p; };
  $('#f-status').onchange = (e) => go('status', e.target.value);
  $('#f-sort').onchange = (e) => go('sort', e.target.value);
  $('#f-q').onkeydown = (e) => { if (e.key === 'Enter') go('q', e.target.value.trim()); };
  $('#csv').onclick = () => exportCsv(state.lastList || []);
};
function exportCsv(list) {
  const cols = [['İş No', 'no'], ['Hasta', 'patientName'], ['Başlık', 'title'], ['İş türü', 'workType'], ['Dişler', (c) => c.teeth.join(' ')], ['Renk', 'shade'], ['Materyal', 'material'],
    ['Durum', 'statusLabel'], ['Öncelik', (c) => PRIO[c.priority]], ['Klinik', (c) => c.clinic?.org || c.clinic?.name], ['Teknisyen', (c) => c.technician?.org || c.technician?.name],
    ['Teslim tarihi', 'dueDate'], ['Oluşturma', (c) => fmtDateTime(c.createdAt)], ['Son güncelleme', (c) => fmtDateTime(c.updatedAt)]];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [cols.map((c) => cell(c[0])).join(';'), ...list.map((c) => cols.map(([, k]) => cell(typeof k === 'function' ? k(c) : c[k])).join(';'))];
  const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `isler-${todayStr()}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function viewSearch(query) {
  const q = query.get('q') || '';
  const [patients, cases] = await Promise.all([api('/patients?q=' + encodeURIComponent(q)), api('/cases?q=' + encodeURIComponent(q))]);
  return `<div class="page-head"><div><h1>Arama: “${esc(q)}”</h1><p class="muted">${patients.length} hasta, ${cases.length} iş bulundu</p></div></div>
    ${patients.map(patientCard).join('')}
    ${cases.length ? `<div class="card"><div class="card-head"><h2>Eşleşen işler</h2></div><div class="list">${cases.map((c) => caseRow(c)).join('')}</div></div>` : ''}
    ${!patients.length && !cases.length ? '<div class="card empty">Sonuç bulunamadı.</div>' : ''}`;
}
afterRender.ara = () => { $$('[data-new-for]').forEach((b) => b.onclick = () => openNewCase({ patientId: b.dataset.newFor })); };

/* ================================================================== */
/* İş detayı                                                           */
/* ================================================================== */
async function viewCase(id) {
  const c = await api('/cases/' + id);
  state.caseCache = c;
  if (c.unread) api(`/cases/${id}/read`, { method: 'POST' }).then(refreshBadges).catch(() => {});
  const d = dueInfo(c);
  const statusEvents = c.events.filter((e) => e.type === 'created' || e.type === 'status');
  const reachedAt = { gonderildi: c.createdAt };
  for (const e of statusEvents) if (e.meta?.to && !reachedAt[e.meta.to]) reachedAt[e.meta.to] = e.at;
  let curIdx = FLOW.indexOf(c.status);
  if (c.status === 'revizyon') curIdx = FLOW.indexOf('prova');
  const steps = FLOW.map((s, i) => {
    const cls = curIdx < 0 ? (reachedAt[s] ? 'done' : '') : i < curIdx || (i === curIdx && s === 'tamamlandi') ? 'done' : i === curIdx ? 'current' : '';
    return `<div class="step ${cls}"><div class="c">${cls === 'done' ? '✓' : i + 1}</div>${esc(state.statuses[s])}<span class="when">${reachedAt[s] ? rel(reachedAt[s]) : ''}</span></div>`;
  }).join('');

  // Aşama süreleri
  const segs = [];
  let cur = { s: 'gonderildi', at: c.createdAt };
  for (const e of statusEvents) if (e.type === 'status') { segs.push({ s: cur.s, ms: new Date(e.at) - new Date(cur.at) }); cur = { s: e.meta.to, at: e.at }; }
  const terminal = ['tamamlandi', 'iptal'].includes(c.status);
  if (!terminal) segs.push({ s: cur.s, ms: Date.now() - new Date(cur.at), live: true });
  const totals = {};
  for (const sg of segs) totals[sg.s] = (totals[sg.s] || 0) + sg.ms;
  const totalMs = (terminal ? new Date(c.completedAt || c.updatedAt) : new Date()) - new Date(c.createdAt);

  const canEdit = c.from?.id === state.me.id || state.me.role === 'clinic';
  const other = state.me.role === 'clinic' ? c.technician : c.clinic;
  return `
  <div class="page-head case-title">
    <div style="flex:1;min-width:260px">
      <div class="crumb"><a href="#/hastalar">Hastalar</a> / <a href="#/hasta/${c.patientId}">${esc(c.patientName)}</a> / İş #${esc(c.no)}</div>
      <h1>${esc(c.patientName)} — ${esc(c.title)}</h1>
      <div class="row" style="margin-top:8px">${statusBadge(c.status)} ${prioBadge(c.priority)} ${dirTag(c)}
        <span class="due ${d.cls}">${icon('clock').replace('<svg', '<svg width="13" height="13" style="vertical-align:-2px"')} ${d.text}${c.dueDate ? ' · ' + fmtDate(c.dueDate) : ''}</span></div>
    </div>
    <div class="row">${canEdit ? `<button class="btn" id="edit-case">${icon('edit')}Düzenle</button>` : ''}
      <button class="btn" id="due-case">${icon('clock')}Teslim tarihi</button></div>
  </div>
  <div class="case-layout">
    <div class="stack" style="gap:18px">
      <div class="card">
        <div class="stepper">${steps}</div>
        ${['reddedildi', 'iptal', 'revizyon'].includes(c.status) ? `<div style="padding:0 18px 14px">${statusBadge(c.status)} <span class="small muted">${esc(lastStatusNote(c))}</span></div>` : ''}
        <div class="card-body" style="border-top:1px solid var(--border)">
          <div class="kv">
            <div><small>Hasta</small><b><a href="#/hasta/${c.patientId}">${esc(c.patientName)}</a></b></div>
            <div><small>Klinik</small><b>${esc(c.clinic?.org || '—')}</b><div class="small muted">${esc(c.clinic?.name)} ${c.clinic?.phone ? '· ' + esc(c.clinic.phone) : ''}</div></div>
            <div><small>Teknisyen / Lab</small><b>${esc(c.technician?.org || '—')}</b><div class="small muted">${esc(c.technician?.name)} ${c.technician?.phone ? '· ' + esc(c.technician.phone) : ''}</div></div>
            <div><small>İş türü</small><b>${esc(c.workType || '—')}</b></div>
            <div><small>Renk</small><b>${esc(c.shade || '—')}</b></div>
            <div><small>Materyal</small><b>${esc(c.material || '—')}</b></div>
            <div><small>Öncelik</small><b>${PRIO[c.priority]}</b></div>
            <div><small>Teslim tarihi</small><b>${c.dueDate ? fmtDate(c.dueDate) : '—'}</b></div>
            <div><small>Gönderen → Alan</small><b>${esc(c.from?.name)} → ${esc(c.to?.name)}</b></div>
            <div><small>Oluşturulma</small><b>${fmtDateTime(c.createdAt)}</b></div>
            <div><small>Son güncelleme</small><b>${fmtDateTime(c.updatedAt)}</b><div class="small muted">${rel(c.updatedAt)}</div></div>
            <div><small>${terminal ? 'Toplam süre' : 'Geçen süre'}</small><b>${dur(totalMs)}</b></div>
          </div>
          <div style="margin-top:16px"><small class="muted" style="font-weight:600">Dişler (FDI)</small>${teethChart(c.teeth, true)}</div>
          ${c.description ? `<div class="desc">${esc(c.description)}</div>` : ''}
        </div>
        <div class="actions-bar">${c.actions.length
          ? c.actions.map((a) => `<button class="btn ${/iptal|Reddet/.test(a.to + a.label) ? 'danger' : /revizyon/.test(a.to) ? '' : 'primary'}" data-act="${a.to}">${esc(a.label)}</button>`).join('')
          : `<span class="muted small">${terminal ? 'Bu iş kapandı.' : `Şu an ${esc(other?.name || 'karşı taraf')} tarafında işlem bekleniyor.`}</span>`}</div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Dosyalar & STL (${c.files.length})</h2><span class="small muted">STL, PLY, OBJ, fotoğraf, PDF, ZIP · en fazla 300 MB</span></div>
        <div class="card-body">
          <div class="dropzone" id="drop">${icon('upload').replace('<svg', '<svg width="22" height="22"')}<div><b>Dosyaları sürükleyip bırakın</b> veya tıklayıp seçin</div></div>
          <input type="file" id="file-in" multiple hidden>
          <div id="uploads"></div>
          <div class="files">${c.files.map(fileCard).join('') || ''}</div>
          ${c.files.length ? '' : '<div class="small muted" style="margin-top:10px">Henüz dosya yok.</div>'}
        </div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Zaman bilgisi</h2><span class="small muted">Aşamalarda geçen süre</span></div>
        <div class="card-body durations">
          ${Object.entries(totals).map(([s, ms]) => `<div class="d"><span>${statusBadge(s)}</span><b class="mono">${dur(ms)}${s === c.status && !terminal ? ' <span class="small muted">(devam ediyor)</span>' : ''}</b></div>`).join('')}
          <div class="d"><span class="muted">Durum geçmişi</span><span></span></div>
          ${statusEvents.map((e) => `<div class="d small"><span>${fmtDateTime(e.at)} · ${esc(e.user?.name)}</span><span>${e.meta?.to ? esc(state.statuses[e.meta.to]) : 'Oluşturuldu'}</span></div>`).join('')}
        </div>
      </div>
    </div>

    <div class="card chat">
      <div class="card-head"><div><h2>Notlar & mesajlar</h2><div class="small muted">${esc(other?.name || '')} · ${esc(other?.org || '')}</div></div></div>
      <div class="chat-body" id="chat">${chatHtml(c)}</div>
      <form class="chat-foot" id="note-form">
        <textarea name="text" data-keep="note-${c.id}" placeholder="Not yazın… (Ctrl+Enter ile gönder)" rows="1"></textarea>
        <button class="btn icon" type="button" id="attach" title="Dosya ekle">${icon('upload')}</button>
        <button class="btn primary" type="submit">${icon('send')}</button>
      </form>
    </div>
  </div>`;
}
function lastStatusNote(c) {
  const e = [...c.events].reverse().find((x) => x.type === 'status' && x.meta?.to === c.status);
  return e ? `${e.user?.name}: ${e.meta.note || e.text} · ${rel(e.at)}` : '';
}
function chatHtml(c) {
  let lastDay = '';
  let html = '';
  const mine = c.events.filter((e) => e.type === 'note' && e.userId === state.me.id);
  const lastMine = mine[mine.length - 1];
  for (const e of c.events) {
    const dk = dayKey(e.at);
    if (dk !== lastDay) { html += `<div class="day-sep">${new Date(e.at).toLocaleDateString(TR, { weekday: 'long', day: 'numeric', month: 'long' })}</div>`; lastDay = dk; }
    if (e.type === 'note') {
      const me = e.userId === state.me.id;
      html += `<div class="msg ${me ? 'me' : ''}"><span class="who">${me ? 'Siz' : esc(e.user?.name)} · ${fmtTime(e.at)}</span><div class="bubble">${linkify(esc(e.text))}</div></div>`;
      if (lastMine && e.id === lastMine.id && c.otherRead && c.otherRead >= e.at) html += `<span class="seen">✓✓ Görüldü</span>`;
    } else {
      const fileLink = e.meta?.fileId && c.files.some((f) => f.id === e.meta.fileId)
        ? ` · <a href="/api/files/${e.meta.fileId}">indir</a>` : '';
      html += `<div class="sys ${e.type}"><b>${esc(e.user?.name)}</b> ${esc(e.text)}${fileLink} · ${fmtTime(e.at)}</div>`;
    }
  }
  return html || '<div class="empty">Henüz not yok.</div>';
}
const linkify = (s) => s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');

function fileCard(f) {
  const ext = (f.name.split('.').pop() || '').toLowerCase();
  const isStl = ext === 'stl';
  const isImg = /^(png|jpe?g|gif|webp|bmp)$/.test(ext);
  const mine = f.uploadedBy === state.me.id;
  return `<div class="file">
    <div class="ico ${isStl ? 'stl' : ''}">${isImg ? `<img src="/api/files/${f.id}?inline=1" alt="" loading="lazy">` : esc(ext.toUpperCase().slice(0, 4) || 'DOSYA')}</div>
    <div class="info"><b title="${esc(f.name)}">${esc(f.name)}</b><small>${fmtSize(f.size)} · ${esc(f.user?.name?.split(' ').slice(0, 2).join(' '))} · ${rel(f.at)}</small></div>
    <div class="fa">
      ${isStl ? `<button class="btn icon sm ghost" data-view="${f.id}" title="3D görüntüle">${icon('cube')}</button>` : ''}
      ${isImg ? `<a class="btn icon sm ghost" href="/api/files/${f.id}?inline=1" target="_blank" title="Aç">${icon('search')}</a>` : ''}
      <a class="btn icon sm ghost" href="/api/files/${f.id}" title="İndir">${icon('download')}</a>
      ${mine ? `<button class="btn icon sm ghost danger" data-del="${f.id}" title="Sil">${icon('trash')}</button>` : ''}
    </div></div>`;
}

afterRender.is = (parts, query, opts) => {
  const c = state.caseCache;
  const id = parts[1];
  const chat = $('#chat');
  if (chat) chat.scrollTop = chat.scrollHeight;

  const form = $('#note-form');
  const ta = form.text;
  const autoSize = () => { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight + 2) + 'px'; };
  ta.oninput = autoSize; autoSize();
  ta.onkeydown = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); } };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = ta.value.trim();
    if (!text) return;
    ta.value = '';
    try { await api(`/cases/${id}/notes`, { method: 'POST', body: { text } }); route({ soft: true }); }
    catch (err) { ta.value = text; toastErr(err); }
  };

  const fileIn = $('#file-in');
  $('#drop').onclick = () => fileIn.click();
  $('#attach').onclick = () => fileIn.click();
  fileIn.onchange = () => { uploadFiles(id, [...fileIn.files]); fileIn.value = ''; };
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => uploadFiles(id, [...e.dataTransfer.files]));

  $$('[data-view]').forEach((b) => b.onclick = () => openStl(c.files.find((f) => f.id === b.dataset.view)));
  $$('[data-del]').forEach((b) => b.onclick = async () => {
    const f = c.files.find((x) => x.id === b.dataset.del);
    if (!(await confirmBox(`“${f.name}” silinsin mi?`, 'Sil', true))) return;
    try { await api('/files/' + f.id, { method: 'DELETE' }); route({ soft: true }); } catch (err) { toastErr(err); }
  });
  $$('[data-act]').forEach((b) => b.onclick = () => openAction(c, c.actions.find((a) => a.to === b.dataset.act)));
  $('#edit-case')?.addEventListener('click', () => openEditCase(c));
  $('#due-case').onclick = () => openDue(c);
};

function uploadFiles(caseId, files) {
  if (!files.length) return;
  const box = $('#uploads');
  let pending = files.length;
  for (const file of files) {
    const row = document.createElement('div');
    row.className = 'small';
    row.style.marginTop = '10px';
    row.innerHTML = `${esc(file.name)} <span class="muted">(${fmtSize(file.size)})</span> <span class="pct">%0</span><div class="progress"><div></div></div>`;
    box?.appendChild(row);
    uploadOne(caseId, file, (p) => {
      row.querySelector('.progress > div').style.width = p + '%';
      row.querySelector('.pct').textContent = '%' + p;
    }).then(() => { row.querySelector('.pct').textContent = '✓ yüklendi'; })
      .catch((e) => { row.querySelector('.pct').textContent = '✗ ' + e.message; row.style.color = 'var(--bad)'; })
      .finally(() => { if (--pending === 0) setTimeout(() => route({ soft: true }), 400); });
  }
}
function uploadOne(caseId, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/cases/${caseId}/files?name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      if (xhr.status < 300) resolve(JSON.parse(xhr.responseText));
      else { let m = 'Yükleme başarısız'; try { m = JSON.parse(xhr.responseText).error; } catch {} reject(new Error(m)); }
    };
    xhr.onerror = () => reject(new Error('Bağlantı hatası'));
    xhr.send(file);
  });
}

/* ================================================================== */
/* Profil                                                              */
/* ================================================================== */
function viewProfile() {
  const me = state.me;
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  return `
  <div class="page-head"><div><h1>Profil & ayarlar</h1><p class="muted">${roleName(me.role)} hesabı · ${esc(me.email)}</p></div></div>
  <div class="two-col">
    <div class="card"><div class="card-head"><h2>Bilgilerim</h2></div>
      <form class="card-body stack" id="f-prof">
        <label class="field">Ad Soyad<input name="name" value="${esc(me.name)}" required></label>
        <label class="field">${me.role === 'clinic' ? 'Klinik' : 'Laboratuvar'} adı<input name="org" value="${esc(me.org)}"></label>
        <label class="field">Telefon<input name="phone" value="${esc(me.phone)}"></label>
        <div><button class="btn primary">Kaydet</button></div>
      </form>
      <div class="card-head" style="border-top:1px solid var(--border)"><h2>Şifre değiştir</h2></div>
      <form class="card-body stack" id="f-pw">
        <label class="field">Mevcut şifre<input name="currentPassword" type="password" required></label>
        <label class="field">Yeni şifre<input name="newPassword" type="password" minlength="4" required></label>
        <div><button class="btn">Şifreyi güncelle</button></div>
      </form>
    </div>
    <div class="card"><div class="card-head"><h2>Bildirimler & görünüm</h2></div>
      <div class="card-body stack">
        <div>Masaüstü bildirimleri: <b>${{ granted: 'Açık', denied: 'Engellendi (tarayıcı ayarlarından açın)', default: 'Kapalı', unsupported: 'Desteklenmiyor' }[perm]}</b></div>
        ${perm === 'default' ? `<div><button class="btn" id="notif">${icon('bell')}Bildirimleri aç</button></div>` : ''}
        <div><button class="btn" onclick="document.getElementById('theme').click()">${icon('moon')}Açık / koyu tema</button></div>
        <p class="small muted">Karşı taraf bir iş gönderdiğinde, durum değiştirdiğinde, not yazdığında veya dosya yüklediğinde anında bildirim alırsınız.</p>
      </div>
    </div>
  </div>`;
}
afterRender.profil = () => {
  $('#f-prof').onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api('/me', { method: 'PATCH', body: Object.fromEntries(new FormData(e.target)) }); state.me = r.user; toast('Bilgiler kaydedildi', { type: 'ok' }); renderShell(); route(); }
    catch (err) { toastErr(err); }
  };
  $('#f-pw').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/me', { method: 'PATCH', body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); toast('Şifre güncellendi', { type: 'ok' }); }
    catch (err) { toastErr(err); }
  };
  $('#notif')?.addEventListener('click', async () => { await Notification.requestPermission(); route({ soft: true }); });
};

/* ================================================================== */
/* Modallar                                                            */
/* ================================================================== */
function modal({ title, body, foot = '', size = '' , onClose }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>${title}</h2><button class="btn icon ghost" data-close aria-label="Kapat">✕</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  $('#modal-root').appendChild(back);
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  $$('[data-close]', back).forEach((b) => b.onclick = close);
  return { el: back, close };
}
function confirmBox(text, okLabel = 'Tamam', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({ title: 'Onay', body: `<p style="margin:0">${esc(text)}</p>`,
      foot: `<button class="btn" data-close>Vazgeç</button><button class="btn ${danger ? 'danger solid' : 'primary'}" id="ok">${esc(okLabel)}</button>`,
      onClose: () => { if (!done) resolve(false); } });
    $('#ok', m.el).onclick = () => { done = true; m.close(); resolve(true); };
  });
}

function teethChart(selected = [], readonly = false) {
  const sel = new Set(selected.map(Number));
  const btn = (n) => `<button type="button" class="tooth ${sel.has(n) ? 'on' : ''} ${readonly ? 'ro' : ''}" data-tooth="${n}">${n}</button>`;
  return `<div class="teeth-labels"><span>Sağ</span><span>Üst çene</span><span>Sol</span></div>
    <div class="teeth">${UPPER.map(btn).join('')}<div class="sep"></div>${LOWER.map(btn).join('')}</div>
    <div class="teeth-labels" style="margin-top:4px"><span></span><span>Alt çene</span><span></span></div>`;
}
function bindTeeth(root) {
  $$('.tooth:not(.ro)', root).forEach((b) => b.onclick = () => b.classList.toggle('on'));
  return () => $$('.tooth.on', root).map((b) => Number(b.dataset.tooth));
}

function openPatientForm(p, onSaved) {
  const isTech = state.me.role === 'technician';
  const m = modal({
    title: p ? 'Hastayı düzenle' : 'Yeni hasta',
    body: `<form id="pf" class="stack">
      <label class="field">Ad Soyad *<input name="name" required value="${esc(p?.name)}" autofocus></label>
      ${isTech && !p ? `<label class="field">Bağlı olduğu klinik *<select name="clinicId" required id="pf-clinic"><option value="">Yükleniyor…</option></select></label>` : ''}
      <div class="grid-3">
        <label class="field">Telefon<input name="phone" value="${esc(p?.phone)}"></label>
        <label class="field">Doğum tarihi<input name="birthDate" type="date" value="${esc(p?.birthDate)}"></label>
        <label class="field">Cinsiyet<select name="gender"><option value="">—</option><option value="K" ${p?.gender === 'K' ? 'selected' : ''}>Kadın</option><option value="E" ${p?.gender === 'E' ? 'selected' : ''}>Erkek</option></select></label>
      </div>
      <label class="field">Hasta notu (alerji, özel durum…)<textarea name="notes">${esc(p?.notes)}</textarea></label>
    </form>`,
    foot: `<button class="btn" data-close>Vazgeç</button><button class="btn primary" id="pf-save">Kaydet</button>`
  });
  if (isTech && !p) getPartners().then((list) => {
    $('#pf-clinic', m.el).innerHTML = '<option value="">Klinik seçin</option>' + list.map((u) => `<option value="${u.id}">${esc(u.org || u.name)} — ${esc(u.name)}</option>`).join('');
  });
  $('#pf-save', m.el).onclick = async () => {
    const f = $('#pf', m.el);
    if (!f.reportValidity()) return;
    const body = Object.fromEntries(new FormData(f));
    try {
      const saved = p ? await api('/patients/' + p.id, { method: 'PATCH', body }) : await api('/patients', { method: 'POST', body });
      m.close(); toast(p ? 'Hasta güncellendi' : 'Hasta eklendi', { type: 'ok' }); onSaved?.(saved);
    } catch (e) { toastErr(e); }
  };
}

async function openNewCase(pre = {}) {
  let [patients, partners] = await Promise.all([api('/patients'), getPartners(true)]).catch((e) => { toastErr(e); return []; });
  if (!patients) return;
  const isTech = state.me.role === 'technician';
  const files = [];
  const m = modal({
    size: 'wide',
    title: 'Yeni iş gönder',
    body: `<form id="nc" class="stack">
      <div class="grid-2">
        <label class="field">Hasta *<div class="row" style="flex-wrap:nowrap">
          <select name="patientId" required id="nc-patient"><option value="">Hasta seçin</option>${patients.map((p) => `<option value="${p.id}" data-clinic="${p.clinicId}" ${p.id === pre.patientId ? 'selected' : ''}>${esc(p.name)}${isTech ? ' — ' + esc(p.clinic?.org || '') : ''}</option>`).join('')}</select>
          <button type="button" class="btn" id="nc-addp" title="Yeni hasta">${icon('plus')}</button></div></label>
        <label class="field">Gönderilecek ${partnerWord()} *<select name="toId" required id="nc-to">
          <option value="">Seçin</option>${partners.map((u) => `<option value="${u.id}">${esc(u.org || u.name)} — ${esc(u.name)}</option>`).join('')}</select></label>
      </div>
      <div class="grid-2">
        <label class="field">İş türü *<select name="workType" required><option value="">Seçin</option>${WORK_TYPES.map((w) => `<option>${w}</option>`).join('')}</select></label>
        <label class="field">Başlık<input name="title" placeholder="Örn. Üst çene 3'lü zirkonyum köprü"></label>
      </div>
      <div><small class="muted" style="font-weight:600">Dişleri seçin (FDI numaralandırma)</small>${teethChart([])}</div>
      <div class="grid-3">
        <label class="field">Renk (Vita)<select name="shade">${SHADES.map((s) => `<option value="${s}">${s || '—'}</option>`).join('')}</select></label>
        <label class="field">Materyal<select name="material"><option value="">—</option>${MATERIALS.map((x) => `<option>${x}</option>`).join('')}</select></label>
        <label class="field">Öncelik<select name="priority">${Object.entries(PRIO).map(([k, v]) => `<option value="${k}" ${k === 'normal' ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      </div>
      <div class="grid-2">
        <label class="field">İstenen teslim tarihi<input name="dueDate" type="date" min="${todayStr()}"></label>
        <label class="field">Hızlı seçim<div class="row">${[2, 3, 5, 7, 10].map((d) => `<button type="button" class="btn sm" data-days="${d}">+${d} gün</button>`).join('')}</div></label>
      </div>
      <label class="field">Açıklama / talimatlar<textarea name="description" rows="3" placeholder="Hazırlık, okluzyon, özel istekler…"></textarea></label>
      <label class="field">İlk not (isteğe bağlı)<input name="note" placeholder="Karşı tarafa kısa mesaj"></label>
      <div>
        <div class="dropzone" id="nc-drop">${icon('upload').replace('<svg', '<svg width="20" height="20"')}<div><b>STL / fotoğraf / PDF ekleyin</b> — sürükleyin veya tıklayın</div></div>
        <input type="file" id="nc-file" multiple hidden>
        <div id="nc-files" class="small" style="margin-top:8px"></div>
      </div>
    </form>`,
    foot: `<button class="btn" data-close>Vazgeç</button><button class="btn primary" id="nc-send">${icon('send')}İşi gönder</button>`
  });
  const el = m.el;
  const getTeeth = bindTeeth(el);
  const syncClinic = () => {
    if (!isTech) return;
    const opt = $('#nc-patient', el).selectedOptions[0];
    if (opt?.dataset.clinic) { $('#nc-to', el).value = opt.dataset.clinic; }
  };
  $('#nc-patient', el).onchange = syncClinic; syncClinic();
  $('#nc-addp', el).onclick = () => openPatientForm(null, async (p) => {
    patients = await api('/patients');
    const sel = $('#nc-patient', el);
    sel.insertAdjacentHTML('beforeend', `<option value="${p.id}" data-clinic="${p.clinicId}">${esc(p.name)}</option>`);
    sel.value = p.id; syncClinic();
  });
  $$('[data-days]', el).forEach((b) => b.onclick = () => {
    const d = new Date(); d.setDate(d.getDate() + Number(b.dataset.days));
    $('[name=dueDate]', el).value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
  const listFiles = () => { $('#nc-files', el).innerHTML = files.map((f, i) => `<div>📎 ${esc(f.name)} <span class="muted">(${fmtSize(f.size)})</span> <a href="#" data-rm="${i}">kaldır</a></div>`).join('');
    $$('[data-rm]', el).forEach((a) => a.onclick = (e) => { e.preventDefault(); files.splice(Number(a.dataset.rm), 1); listFiles(); }); };
  const fin = $('#nc-file', el);
  const dz = $('#nc-drop', el);
  dz.onclick = () => fin.click();
  fin.onchange = () => { files.push(...fin.files); fin.value = ''; listFiles(); };
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', (e) => { files.push(...e.dataTransfer.files); listFiles(); });

  $('#nc-send', el).onclick = async () => {
    const f = $('#nc', el);
    if (!f.reportValidity()) return;
    const body = Object.fromEntries(new FormData(f));
    body.teeth = getTeeth();
    if (!body.title) body.title = body.workType + (body.teeth.length ? ' (' + body.teeth.join(', ') + ')' : '');
    const btn = $('#nc-send', el);
    btn.disabled = true; btn.textContent = 'Gönderiliyor…';
    try {
      const c = await api('/cases', { method: 'POST', body });
      for (let i = 0; i < files.length; i++) {
        btn.textContent = `Dosya yükleniyor ${i + 1}/${files.length}…`;
        await uploadOne(c.id, files[i], (p) => { btn.textContent = `Dosya ${i + 1}/${files.length} · %${p}`; });
      }
      m.close();
      toast(`İş #${c.no} gönderildi`, { type: 'ok', sub: `${c.patientName} → ${c.to.name}` });
      location.hash = '#/is/' + c.id;
      refreshBadges();
    } catch (e) { toastErr(e); btn.disabled = false; btn.innerHTML = `${icon('send')}İşi gönder`; }
  };
}

function openAction(c, a) {
  const resend = a.to === 'gonderildi';
  const m = modal({
    title: esc(a.label),
    body: `<div class="stack">
      <div>${statusBadge(c.status)} → ${statusBadge(a.to)}</div>
      ${resend ? `<label class="field">Gönderilecek ${partnerWord()}<select id="ac-to"><option value="">Aynı kişiye (${esc(c.to?.name)})</option></select></label>` : ''}
      <label class="field">${a.needNote ? 'Açıklama (zorunlu)' : 'Not (isteğe bağlı)'}<textarea id="ac-note" placeholder="${a.needNote ? 'Neden? Ne değişmeli?' : 'Karşı tarafa iletmek istediğiniz not'}"></textarea></label>
    </div>`,
    foot: `<button class="btn" data-close>Vazgeç</button><button class="btn ${/iptal|reddedildi/.test(a.to) ? 'danger solid' : 'primary'}" id="ac-ok">${esc(a.label)}</button>`
  });
  if (resend && c.from?.id === state.me.id) getPartners().then((list) => {
    $('#ac-to', m.el).insertAdjacentHTML('beforeend', list.filter((u) => u.id !== c.to?.id && (state.me.role === 'clinic' || u.id === c.clinicId)).map((u) => `<option value="${u.id}">${esc(u.org || u.name)} — ${esc(u.name)}</option>`).join(''));
  });
  $('#ac-ok', m.el).onclick = async () => {
    const note = $('#ac-note', m.el).value.trim();
    if (a.needNote && !note) { toast('Lütfen açıklama yazın', { type: 'bad' }); return; }
    try {
      await api('/cases/' + c.id, { method: 'PATCH', body: { status: a.to, note, toId: $('#ac-to', m.el)?.value || undefined } });
      m.close(); toast(`Durum: ${state.statuses[a.to]}`, { type: 'ok' }); route({ soft: true }); refreshBadges();
    } catch (e) { toastErr(e); }
  };
}

function openEditCase(c) {
  const m = modal({
    size: 'wide', title: `İş #${esc(c.no)} — düzenle`,
    body: `<form id="ec" class="stack">
      <div class="grid-2">
        <label class="field">Başlık<input name="title" value="${esc(c.title)}"></label>
        <label class="field">İş türü<select name="workType">${[...new Set([c.workType, ...WORK_TYPES])].filter(Boolean).map((w) => `<option ${w === c.workType ? 'selected' : ''}>${esc(w)}</option>`).join('')}</select></label>
      </div>
      <div>${teethChart(c.teeth)}</div>
      <div class="grid-3">
        <label class="field">Renk<select name="shade">${SHADES.map((s) => `<option value="${s}" ${s === c.shade ? 'selected' : ''}>${s || '—'}</option>`).join('')}</select></label>
        <label class="field">Materyal<select name="material"><option value="">—</option>${[...new Set([c.material, ...MATERIALS])].filter(Boolean).map((x) => `<option ${x === c.material ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
        <label class="field">Öncelik<select name="priority">${Object.entries(PRIO).map(([k, v]) => `<option value="${k}" ${k === c.priority ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      </div>
      <label class="field">Açıklama<textarea name="description" rows="4">${esc(c.description)}</textarea></label>
    </form>`,
    foot: `<button class="btn" data-close>Vazgeç</button><button class="btn primary" id="ec-save">Kaydet</button>`
  });
  const getTeeth = bindTeeth(m.el);
  $('#ec-save', m.el).onclick = async () => {
    const body = Object.fromEntries(new FormData($('#ec', m.el)));
    body.teeth = getTeeth();
    try { await api('/cases/' + c.id, { method: 'PATCH', body }); m.close(); toast('İş güncellendi', { type: 'ok' }); route({ soft: true }); }
    catch (e) { toastErr(e); }
  };
}

function openDue(c) {
  const m = modal({
    title: 'Teslim tarihi',
    body: `<label class="field">Teslim tarihi<input type="date" id="due-in" value="${esc(c.dueDate || '')}"></label>
      <p class="small muted">Değişiklik zaman çizelgesine kaydedilir ve karşı tarafa bildirilir.</p>`,
    foot: `<button class="btn" id="due-clear">Tarihi kaldır</button><button class="btn primary" id="due-ok">Kaydet</button>`
  });
  const saveDue = async (v) => {
    try { await api('/cases/' + c.id, { method: 'PATCH', body: { dueDate: v } }); m.close(); route({ soft: true }); }
    catch (e) { toastErr(e); }
  };
  $('#due-ok', m.el).onclick = () => saveDue($('#due-in', m.el).value || null);
  $('#due-clear', m.el).onclick = () => saveDue(null);
}

async function openStl(f) {
  let viewer = null;
  const m = modal({
    size: 'full', title: `${icon('cube').replace('<svg', '<svg width="18" height="18" style="vertical-align:-3px"')} ${esc(f.name)}`,
    body: `<div class="viewer" id="vw"><div class="viewer-msg" id="vw-msg">3D model yükleniyor…</div>
      <div class="viewer-tools hidden" id="vw-tools">
        <button class="btn sm" id="vw-reset">Görünümü sıfırla</button>
        <button class="btn sm" id="vw-wire">Tel kafes</button>
        <button class="btn sm" data-col="#f1e9dc">Diş</button>
        <button class="btn sm" data-col="#c9b79c">Alçı</button>
        <button class="btn sm" data-col="#9fb7d6">Mavi</button>
        <button class="btn sm" id="vw-shot">Ekran görüntüsü</button>
        <a class="btn sm" href="/api/files/${f.id}">İndir</a>
      </div>
      <div class="viewer-info hidden" id="vw-info"></div></div>`,
    onClose: () => viewer?.dispose()
  });
  $('.modal-body', m.el).style.cssText = 'padding:0;display:flex';
  try {
    const res = await fetch(`/api/files/${f.id}`);
    if (!res.ok) throw new Error('Dosya indirilemedi');
    const buf = await res.arrayBuffer();
    if (!m.el.isConnected) return;
    viewer = await import('./stl-viewer.js').then((mod) => mod.mountViewer($('#vw', m.el), buf));
    if (!m.el.isConnected) { viewer.dispose(); return; }
    $('#vw-msg', m.el).remove();
    $('#vw-tools', m.el).classList.remove('hidden');
    const s = viewer.info.size;
    const info = $('#vw-info', m.el);
    info.classList.remove('hidden');
    info.textContent = `${viewer.info.triangles.toLocaleString(TR)} üçgen · ${s.x.toFixed(1)} × ${s.y.toFixed(1)} × ${s.z.toFixed(1)} mm · Döndür: sol tık · Kaydır: sağ tık · Yakınlaştır: tekerlek`;
    let wire = false;
    $('#vw-wire', m.el).onclick = () => viewer.setWire((wire = !wire));
    $('#vw-reset', m.el).onclick = () => viewer.reset();
    $$('[data-col]', m.el).forEach((b) => b.onclick = () => viewer.setColor(b.dataset.col));
    $('#vw-shot', m.el).onclick = () => { const a = document.createElement('a'); a.href = viewer.snapshot(); a.download = f.name.replace(/\.stl$/i, '') + '.png'; a.click(); };
  } catch (e) {
    const msg = $('#vw-msg', m.el);
    if (msg) msg.textContent = 'Model açılamadı: ' + e.message;
  }
}

/* ================================================================== */
/* Gerçek zamanlı bildirimler                                          */
/* ================================================================== */
function connectStream() {
  state.es?.close();
  const es = new EventSource('/api/stream');
  state.es = es;
  es.onmessage = (ev) => {
    let d; try { d = JSON.parse(ev.data); } catch { return; }
    const { parts } = parseHash();
    const onThisCase = parts[0] === 'is' && parts[1] === d.caseId;
    if (d.kind === 'read') { if (onThisCase) route({ soft: true }); return; }
    if (d.actorId === state.me.id) return; // kendi işlemlerimiz
    refreshBadges();
    if (onThisCase) {
      route({ soft: true });
      if (document.visibilityState === 'visible') api(`/cases/${d.caseId}/read`, { method: 'POST' }).catch(() => {});
    } else {
      toast(d.text, { sub: d.actorName + ' · şimdi', href: '#/is/' + d.caseId });
      if (['', 'isler', 'hastalar', 'hasta'].includes(parts[0] || '') && !$('.modal-back')) route({ soft: true });
    }
    if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
      const n = new Notification('İş Takip', { body: `${d.actorName}: ${d.text}`, tag: d.caseId });
      n.onclick = () => { window.focus(); location.hash = '#/is/' + d.caseId; n.close(); };
    }
  };
}
// Okunmamışlar ve göreli zamanlar için periyodik tazeleme
setInterval(() => { if (state.me && !$('.modal-back') && !document.activeElement?.matches('input,textarea,select')) { refreshBadges(); } }, 60000);

/* ================================================================== */
/* Başlat                                                              */
/* ================================================================== */
async function boot() {
  try {
    const r = await api('/me');
    state.me = r.user;
    state.statuses = r.statuses;
  } catch {
    state.me = null;
    return renderAuth();
  }
  renderShell();
  connectStream();
  refreshBadges();
  await route();
  if ('Notification' in window && Notification.permission === 'default') {
    setTimeout(() => toast('Anlık bildirimler için tıklayın', { sub: 'Yeni iş ve mesajlarda masaüstü bildirimi alın', ms: 8000 }), 1500);
    $('#toasts').addEventListener('click', () => Notification.requestPermission(), { once: true });
  }
}
boot();
