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
    for (const id of PANEL_ORDER) {
      navBtns[id].classList.toggle('on', id === current);
      navBtns[id].setAttribute('aria-expanded', id === current ? 'true' : 'false');
    }
    panel.dataset.panel = current || '';
    panel.setAttribute('aria-label', current ? STR.panelTitle[current] : '');
  }

  const api = {
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
