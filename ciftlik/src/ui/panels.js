// Büyük panel yöneticisi (Envanter / Pazar / Mağaza): HUD düğmeleri + tek cam panel.
// Aynı anda tek büyük panel açıktır. Kapalıyken hiçbir görünüm DOM güncellemesi yapmaz;
// açıkken görünümün render()'ı kare döngüsünde (rAF) çağrılır, görünüm kendi kirli bayraklarına bakar.
import { STR } from './strings.js';
import { ICON } from './icons.js';
import { h, setText } from './frame.js';
import { shield, tap } from './touch.js';
import { formatMoney } from './hud.js';

export const PANEL_ORDER = ['inventory', 'market', 'shop'];
export const PANEL_KEYS = { inventory: 'I', market: 'P', shop: 'M' };
const PANEL_ICON = { inventory: ICON.bag, market: ICON.stall, shop: ICON.shop };

/**
 * @param {HTMLElement} root  #ui
 * @param {object} ctx
 * @param {HTMLElement} navParent  HUD düğmelerinin ekleneceği kap (para kartının yanı)
 */
export function createPanelHost(root, ctx, navParent) {
  const { state } = ctx;

  // ---- HUD düğmeleri ----
  const nav = h('div', 'hud-nav');
  nav.setAttribute('role', 'group');
  const navBtns = {};
  for (const id of PANEL_ORDER) {
    const b = h('button', 'nav-btn glass interactive', `<span class="ic">${PANEL_ICON[id]}</span><span class="lbl">${STR.nav[id]}</span><kbd class="key">${PANEL_KEYS[id]}</kbd>`);
    b.type = 'button';
    b.dataset.panel = id;
    b.title = STR.navKey(STR.nav[id], PANEL_KEYS[id]);
    b.setAttribute('aria-label', STR.nav[id]);
    b.setAttribute('aria-haspopup', 'dialog');
    shield(b);
    tap(b, () => api.toggle(id));
    nav.appendChild(b);
    navBtns[id] = b;
  }
  // Aşama 5: çalışan portre düğmesi (panel 'worker' ui/workerPanel.js'te kayıtlıdır)
  const wbtn = h('button', 'nav-btn worker-btn glass interactive', `<span class="wpic"></span><span class="lbl">${STR.nav.worker}</span>`);
  wbtn.type = 'button';
  wbtn.dataset.panel = 'worker';
  wbtn.title = STR.nav.worker;
  wbtn.setAttribute('aria-label', STR.nav.worker);
  wbtn.setAttribute('aria-haspopup', 'dialog');
  shield(wbtn);
  tap(wbtn, () => api.toggle('worker'));
  nav.appendChild(wbtn);
  navBtns.worker = wbtn;
  // Aşama 6: Finans düğmesi (panel 'finance' ui/financePanel.js'te kayıtlıdır) + rozet
  const fbtn = h('button', 'nav-btn finance-btn glass interactive', `<span class="ic">${ICON.chart}</span><span class="lbl">${STR.nav.finance}</span><kbd class="key">F</kbd><i class="nbadge" hidden></i>`);
  fbtn.type = 'button';
  fbtn.dataset.panel = 'finance';
  fbtn.title = STR.navKey(STR.nav.finance, 'F');
  fbtn.setAttribute('aria-label', STR.nav.finance);
  fbtn.setAttribute('aria-haspopup', 'dialog');
  shield(fbtn);
  tap(fbtn, () => api.toggle('finance'));
  nav.appendChild(fbtn);
  navBtns.finance = fbtn;
  // Gece İstilası: Askerler düğmesi (panel 'soldier' ui/soldierPanel.js'te); yalnız mod açıkken görünür
  const sbtn = h('button', 'nav-btn soldier-btn glass interactive', `<span class="ic">${ICON.shield}</span><span class="lbl">${STR.nav.soldier}</span>`);
  sbtn.type = 'button';
  sbtn.hidden = true;
  sbtn.dataset.panel = 'soldier';
  sbtn.title = STR.nav.soldier;
  sbtn.setAttribute('aria-label', STR.nav.soldier);
  sbtn.setAttribute('aria-haspopup', 'dialog');
  shield(sbtn);
  tap(sbtn, () => api.toggle('soldier'));
  nav.appendChild(sbtn);
  navBtns.soldier = sbtn;
  // K31: Zombi Modu düğmesi — her zaman görünür; basınca mod açılır ve bu gece baskın gelir, tekrar basınca kapanır
  const zbtn = h('button', 'nav-btn zombie-btn glass interactive', `<span class="ic">${ICON.zombie}</span><span class="lbl">${STR.nav.zombie}</span>`);
  zbtn.type = 'button';
  zbtn.title = STR.nav.zombie;
  zbtn.setAttribute('aria-label', STR.nav.zombie);
  shield(zbtn);
  tap(zbtn, () => {
    const bus = ctx.bus;
    if (state.settings?.raids === true) {
      bus.emit('settings:set', { key: 'raids', value: false });
      bus.emit('toast', { text: 'Zombi Modu kapandı. Geceler yine sakin.', kind: 'info' });
    } else {
      bus.emit('settings:set', { key: 'raids', value: true });
      bus.emit('raid:planTonight', {});
      bus.emit('toast', { text: 'Zombi Modu açıldı! Bu gece canavarlar geliyor — savunmanı kur.', kind: 'event' });
    }
    zbtn.classList.toggle('on', state.settings?.raids === true);
    zbtn.setAttribute('aria-pressed', String(state.settings?.raids === true));
  });
  zbtn.classList.toggle('on', state.settings?.raids === true);
  zbtn.setAttribute('aria-pressed', String(state.settings?.raids === true));
  nav.appendChild(zbtn);
  navBtns.zombie = zbtn;
  const fbadge = fbtn.querySelector('.nbadge');
  navParent.insertBefore(nav, navParent.firstChild);

  // ---- Panel ----
  const backdrop = h('div', 'bp-backdrop');
  const panel = h('div', 'bigpanel glass');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.innerHTML = `
    <header class="bp-head">
      <div class="bp-tabs" role="tablist">
        ${PANEL_ORDER.map((id) => `<button type="button" role="tab" data-panel="${id}"><span class="ic">${PANEL_ICON[id]}</span><span class="t">${STR.panelTitle[id]}</span></button>`).join('')}
      </div>
      <div class="bp-title"></div>
      <div class="bp-money num"><span class="coin">${ICON.coin}</span><span class="v"></span></div>
      <button type="button" class="bp-close" aria-label="${STR.close}"><span class="ic">${ICON.close}</span></button>
    </header>
    <div class="bp-views"></div>`;
  backdrop.appendChild(panel);
  shield(backdrop);
  root.appendChild(backdrop);

  const views = {};
  const viewsBox = panel.querySelector('.bp-views');
  const tabBtns = [...panel.querySelectorAll('.bp-tabs button')];
  const titleEl = panel.querySelector('.bp-title');
  const moneyV = panel.querySelector('.bp-money .v');
  for (const b of tabBtns) tap(b, () => api.open(b.dataset.panel));
  tap(panel.querySelector('.bp-close'), () => api.close());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) api.close(); });

  let current = null;
  let shownMoney = null;
  let shownTitle = null;
  let lastFocus = null;
  const listeners = [];

  function syncChrome() {
    for (const b of tabBtns) {
      const on = b.dataset.panel === current;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    for (const id in navBtns) {
      navBtns[id].classList.toggle('on', id === current);
      navBtns[id].setAttribute('aria-expanded', id === current ? 'true' : 'false');
    }
    panel.dataset.panel = current || '';
    panel.setAttribute('aria-label', current ? STR.panelTitle[current] : '');
  }

  const api = {
    /** HUD portre düğmesinin içeriğini yazar (workerPanel.hudPortrait). */
    setWorkerPortrait(html) { const c = wbtn.querySelector('.wpic'); if (c) c.innerHTML = html; },
    nav,
    /** Gece İstilası modu açık/kapalı: Askerler düğmesi + açık panel kapanır. */
    setRaidMode(on) {
      zbtn.classList.toggle('on', !!on); zbtn.setAttribute('aria-pressed', String(!!on));
      if (sbtn.hidden === !on) return;
      sbtn.hidden = !on;
      if (!on && current === 'soldier') api.close();
    },
    /** Finans düğmesi rozeti: n>0 sayı gösterir, urgent → amber. */
    setFinanceBadge(n, urgent) {
      const t = n > 0 ? String(n > 9 ? '9+' : n) : '';
      if (fbadge.__t !== t) { fbadge.__t = t; fbadge.textContent = t; fbadge.hidden = !t; fbtn.setAttribute('aria-label', t ? `${STR.nav.finance} (${STR.fin.badge(n)})` : STR.nav.finance); }
      fbadge.classList.toggle('urgent', !!urgent);
    },
    get isOpen() { return current != null; },
    get current() { return current; },
    /** Panel açılıp kapanınca çağrılır: fn(id|null) */
    onChange(fn) { listeners.push(fn); },
    register(view) {
      views[view.id] = view;
      view.el.classList.add('bp-view');
      view.el.hidden = true;
      viewsBox.appendChild(view.el);
    },
    open(id, arg) {
      const v = views[id];
      if (!v) return;
      if (current === id) { if (arg && v.onOpen) v.onOpen(arg); return; }
      const wasOpen = current != null;
      if (current && views[current]) { views[current].el.hidden = true; if (views[current].onClose) views[current].onClose(); }
      current = id;
      for (const k in views) if (k !== id) views[k].el.hidden = true; // kapanış zamanlayıcısı beklenmez
      v.el.hidden = false;
      if (v.onOpen) v.onOpen(arg || null);
      syncChrome();
      if (!wasOpen) {
        const ae = document.activeElement;
        lastFocus = ae && ae.matches && ae.matches(':focus-visible') ? ae : null;
        backdrop.classList.add('open');
        root.classList.add('bigpanel-open');
      } else {
        v.el.classList.remove('swap'); void v.el.offsetWidth; v.el.classList.add('swap');
      }
      shownMoney = null; shownTitle = null;
      for (const fn of listeners) fn(current);
    },
    close() {
      if (current == null) return;
      const v = views[current];
      current = null;
      if (v) { if (v.onClose) v.onClose(); }
      backdrop.classList.remove('open');
      root.classList.remove('bigpanel-open');
      syncChrome();
      // Kapanış animasyonundan sonra görünümü gizle (yeniden açılınca doğru görünüm gösterilir)
      setTimeout(() => { if (current == null && v) v.el.hidden = true; }, 240);
      if (document.activeElement && panel.contains(document.activeElement)) document.activeElement.blur();
      if (lastFocus && lastFocus.focus && lastFocus !== document.body) { try { lastFocus.focus({ preventScroll: true }); } catch (_) {} }
      lastFocus = null;
      for (const fn of listeners) fn(null);
    },
    toggle(id) { if (current === id) api.close(); else api.open(id); },
    render(now) {
      if (current == null) return;
      const m = state.finance ? state.finance.money : 0;
      if (m !== shownMoney) { shownMoney = m; setText(moneyV, formatMoney(m)); }
      const v = views[current];
      if (v && v.render) v.render(now);
      if (v && v.title) { const tt = v.title(); if (tt !== shownTitle) { shownTitle = tt; setText(titleEl, tt || ''); panel.setAttribute('aria-label', tt || STR.panelTitle[current] || ''); } }
    },
    destroy() { backdrop.remove(); nav.remove(); },
  };
  syncChrome();
  return api;
}
