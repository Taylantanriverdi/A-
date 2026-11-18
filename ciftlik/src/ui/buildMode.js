// İnşa modu arayüzü — PLAN.md §12 "UI (ui-dev)".
// UI state'i yalnızca OKUR; eylemler build:place / build:move / build:remove / build:clear komutları,
// önizleme build:ghost olarak gider. Giriş: tool:select {tool:'build'}, çıkış: tool:select {tool:'hand'} + build:ghost null.
import { PLACEABLES, BUILD_CATS, CLEAR_COST } from '../data/placeables.js';
import * as occ from '../systems/world/occupancy.js';
import { STR } from './strings.js';
import { ICON } from './icons.js';
import { h, setText } from './frame.js';
import { shield, tap } from './touch.js';
import { formatMoney } from './hud.js';

const B = STR.build;
const MODES = ['place', 'move', 'remove', 'clear'];
const svg = (inner) => `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

// Katalog kartı simgeleri (basit, tek renk + yarı saydam dolgu)
const F = 'fill="currentColor" fill-opacity=".2"';
const CARD_ICON = {
  coop: svg(`<path d="M5 15L16 6l11 9" /><path d="M7 14v12h18V14" ${F}/><rect x="13" y="19" width="6" height="7" rx="1"/><circle cx="16" cy="13" r="1.2"/>`),
  barn: svg(`<path d="M4 14L16 5l12 9v12H4z" ${F}/><path d="M11 26v-9h10v9M11 17l10 9M21 17l-10 9"/>`),
  hive: svg(`<path d="M10 25h12M11 25v-4h10v4M12 21v-4h8v4M13.5 17v-4h5v4M16 13V9" ${F}/><path d="M14 9c0-2 4-2 4 0"/>`),
  workshop: svg(`<path d="M5 14l11-8 11 8" /><path d="M7 13v13h18V13" ${F}/><circle cx="16" cy="20" r="3.6"/><path d="M16 14.6v1.7M16 23.7v1.7M10.6 20h1.7M19.7 20h1.7"/>`),
  fence: svg(`<path d="M4 12h24M4 21h24"/><path d="M8 8v18M16 8v18M24 8v18" ${F}/><path d="M6.5 9.5L8 7.5l1.5 2M14.5 9.5L16 7.5l1.5 2M22.5 9.5L24 7.5l1.5 2"/>`),
  path: svg(`<ellipse cx="9" cy="22" rx="4.6" ry="3" ${F}/><ellipse cx="20" cy="17" rx="4.6" ry="3" ${F}/><ellipse cx="11" cy="10" rx="4.2" ry="2.8" ${F}/>`),
  stall: svg(`<path d="M4 13l2-6h20l2 6" ${F}/><path d="M4 13c0 2 2 3 3.7 3s3.6-1 3.6-3c0 2 1.7 3 3.4 3s3.4-1 3.4-3c0 2 1.7 3 3.5 3s4.4-1 4.4-3"/><path d="M6 16v10h20V16"/>`),
  well: svg(`<ellipse cx="16" cy="21" rx="8" ry="4" ${F}/><path d="M8 21v-3M24 21v-3M9 18l7-3.5 7 3.5"/><path d="M9 11l7-5 7 5M16 6v8"/>`),
  shed: svg(`<path d="M4 12l12-6 12 6" /><path d="M6 12v14h20V12" ${F}/><path d="M6 26h20"/><path d="M12 26v-8h8v8"/>`),
};
const iconFor = (id) => CARD_ICON[id] || (PLACEABLES[id] && PLACEABLES[id].cat === 'workshops' ? CARD_ICON.workshop : CARD_ICON.shed);
const MODE_ICON = {
  place: svg('<path d="M16 7v18M7 16h18" stroke-width="2.4"/>'),
  move: svg('<path d="M16 5v22M5 16h22M16 5l-3 3M16 5l3 3M16 27l-3-3M16 27l3-3M5 16l3-3M5 16l3 3M27 16l-3-3M27 16l-3 3"/>'),
  remove: svg('<path d="M7 10h18M13 10V7h6v3M9 10l1 16h12l1-16"/><path d="M13.5 14v8M18.5 14v8"/>'),
  clear: svg('<path d="M16 5c5 0 8 3.5 8 7.5S21 19 16 19s-8-2.5-8-6.5S11 5 16 5z" fill="currentColor" fill-opacity=".2"/><path d="M16 19v8M12 27h8"/>'),
};
const BUILD_ICON = svg('<path d="M4 25h24M7 25V14l9-7 9 7v11" fill="currentColor" fill-opacity=".18"/><path d="M13 25v-6h6v6M21 6.5l4 4" />');

const tilesOf = (type) => { const d = PLACEABLES[type]; return d ? [d.w, d.h] : [1, 1]; };
const originFor = (type, tx, ty) => { const [w, hh] = tilesOf(type); return [tx - Math.floor(w / 2), ty - (hh - 1)]; };
const fmtPrice = (p) => formatMoney(p);

/**
 * @param {HTMLElement} root  #ui
 * @param {object} ctx  {state, bus}
 * @param {{nav:HTMLElement, closeAll:()=>void, toast:(p:object)=>void, isBlockedByOverlay?:()=>boolean}} opts
 */
export function createBuildMode(root, ctx, opts) {
  const { state, bus } = ctx;
  const { nav, closeAll, toast } = opts;

  // ---- HUD düğmesi ----
  const btn = h('button', 'nav-btn bm-nav glass interactive', `<span class="ic">${BUILD_ICON}</span><span class="lbl">${B.btn}</span><kbd class="key">B</kbd>`);
  btn.type = 'button';
  btn.title = B.btnKey;
  btn.setAttribute('aria-label', B.btn);
  btn.setAttribute('aria-pressed', 'false');
  shield(btn);
  nav.insertBefore(btn, nav.firstChild);

  // ---- Üst mod çubuğu ----
  const modeBar = h('div', 'bm-modes glass interactive');
  modeBar.setAttribute('role', 'toolbar');
  modeBar.setAttribute('aria-label', B.modeBar);
  const modeBtns = {};
  for (const m of MODES) {
    const b = h('button', 'bm-mode', `<span class="ic">${MODE_ICON[m]}</span><span class="t">${B.modes[m]}</span>`);
    b.type = 'button';
    b.dataset.mode = m;
    b.setAttribute('aria-pressed', 'false');
    tap(b, () => setMode(m));
    modeBar.appendChild(b);
    modeBtns[m] = b;
  }
  const doneBtn = h('button', 'bm-done', `<span class="ic">${ICON.check}</span><span class="t">${B.done}</span>`);
  doneBtn.type = 'button';
  tap(doneBtn, () => api.exit());
  modeBar.appendChild(doneBtn);
  shield(modeBar);

  // ---- İpucu + onay çubuğu + balon ----
  const hint = h('div', 'bm-hint glass');
  hint.setAttribute('role', 'status');
  const confirmBar = h('div', 'bm-confirm glass interactive');
  const cancelBtn = h('button', 'bm-btn', B.cancel);
  const okBtn = h('button', 'bm-btn primary', B.confirm);
  cancelBtn.type = okBtn.type = 'button';
  confirmBar.append(cancelBtn, okBtn);
  shield(confirmBar);
  const bubble = h('div', 'bm-bubble glass interactive');
  const bubbleTx = h('span', 'bm-btx');
  const bubbleOk = h('button', 'bm-btn primary', `<span class="ic">${ICON.check}</span>`);
  const bubbleNo = h('button', 'bm-btn', `<span class="ic">${ICON.close}</span>`);
  bubbleOk.type = bubbleNo.type = 'button';
  bubbleOk.setAttribute('aria-label', B.confirm);
  bubbleNo.setAttribute('aria-label', B.cancel);
  bubble.append(bubbleTx, bubbleNo, bubbleOk);
  shield(bubble);

  // ---- Alt katalog ----
  const dock = h('div', 'bm-dock glass interactive');
  dock.setAttribute('aria-label', B.catalog);
  const tabs = h('div', 'bm-tabs scrollable');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', B.cats);
  const list = h('div', 'bm-list scrollable');
  dock.append(tabs, list);
  shield(dock);
  root.append(modeBar, hint, bubble, confirmBar, dock);

  const tabBtns = {};
  for (const c of BUILD_CATS) {
    const b = h('button', 'bm-tab', c.name);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    tap(b, () => { cat = c.id; catDirty = true; });
    tabs.appendChild(b);
    tabBtns[c.id] = b;
  }
  const cards = {}; // type → {el, price}
  for (const id of Object.keys(PLACEABLES)) {
    const d = PLACEABLES[id];
    const el = h('button', 'bm-card', `<span class="ci">${iconFor(id)}</span><span class="cn"></span><span class="cp num"></span><span class="cf num"></span>`);
    el.type = 'button';
    el.dataset.type = id;
    el.dataset.cat = d.cat;
    el.querySelector('.cn').textContent = d.name;
    el.querySelector('.cf').textContent = B.footprint(d.w, d.h);
    const cp = el.querySelector('.cp');
    cp.textContent = d.price > 0 ? fmtPrice(d.price) : B.movable;
    tap(el, () => pickType(id));
    list.appendChild(el);
    cards[id] = { el, price: d.price, cp, dim: null, sel: false };
  }

  // ---- Durum ----
  let active = false;
  let mode = 'place';
  let cat = BUILD_CATS[0].id;
  let selType = null;
  let moveId = null;          // taşınan placed id
  let pending = null;         // dokunmatik: {ox, oy} hedef (onay bekler)
  let ghostKey = '';
  let touch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches); // son işaretçi dokunmatik mi
  let strokeSeq = 0, strokeTaps = 0;
  const paintDone = new Set();
  const reasons = new Set();
  let lastPt = { x: 0, y: 0 };
  let bubbleCmd = null;       // {name, payload}
  let lastCmd = '';
  let hoverT = null;
  let dirty = true, catDirty = true, modeDirty = true;
  let shownHint = '', shownMoney = -1;

  const placedById = (id) => (state.placed || []).find((p) => p.id === id) || null;
  const check = (type, ox, oy, ignore) => {
    try { return (occ.canPlace && occ.canPlace(state, type, ox, oy, ignore)) || { ok: true }; } catch (e) { return { ok: true }; }
  };
  const objectAt = (tx, ty) => { try { return (occ.objectAt && occ.objectAt(state, tx, ty)) || null; } catch (e) { return null; } };
  const reasonOnce = (text, kind = 'bad') => {
    if (!text || reasons.has(text)) return;
    reasons.add(text);
    toast({ text: String(text), kind });
  };

  // ---- Hayalet ----
  function setGhost(type, ox, oy, extra) {
    if (!type) {
      if (ghostKey !== '') { ghostKey = ''; bus.emit('build:ghost', null); }
      return false;
    }
    const r = check(type, ox, oy, extra && extra.moving);
    const valid = !!r.ok;
    const key = `${type}|${ox}|${oy}|${valid}|${extra && extra.moving || ''}`;
    if (key !== ghostKey) {
      ghostKey = key;
      const g = { type, tx: ox, ty: oy, valid };
      if (extra && extra.moving) g.moving = extra.moving;
      bus.emit('build:ghost', g);
    }
    return valid;
  }
  function refreshGhost() {
    if (!active) { setGhost(null); return; }
    if (mode === 'place' && selType && !PLACEABLES[selType].paint) {
      if (pending) setGhost(selType, pending.ox, pending.oy);
      else if (!touch && hoverT) { const [ox, oy] = originFor(selType, hoverT.tx, hoverT.ty); setGhost(selType, ox, oy); }
      else setGhost(null);
    } else if (mode === 'place' && selType) { // boyama: tek karolu hayalet yalnızca fare ile
      if (!touch && hoverT) setGhost(selType, hoverT.tx, hoverT.ty); else setGhost(null);
    } else if (mode === 'move' && moveId) {
      const p = placedById(moveId);
      if (!p) { moveId = null; setGhost(null); return; }
      if (pending) setGhost(p.type, pending.ox, pending.oy, { moving: moveId });
      else if (!touch && hoverT) { const [ox, oy] = originFor(p.type, hoverT.tx, hoverT.ty); setGhost(p.type, ox, oy, { moving: moveId }); }
      else setGhost(p.type, p.tx, p.ty, { moving: moveId });
    } else setGhost(null);
  }

  // ---- Seçim / mod ----
  function clearTransient() { pending = null; bubbleCmd = null; moveId = null; }
  function setMode(m) {
    if (!MODES.includes(m)) return;
    if (m === mode) { clearTransient(); } else { mode = m; clearTransient(); }
    dirty = modeDirty = true;
    refreshGhost();
  }
  function pickType(id) {
    const d = PLACEABLES[id];
    if (!d) return;
    if (d.unique) { // tek tane: yerine taşınır
      toast({ text: B.uniqueGo(d.name), kind: 'info' });
      setMode('move');
      return;
    }
    if (mode !== 'place') { mode = 'place'; clearTransient(); modeDirty = true; }
    selType = selType === id ? null : id;
    pending = null;
    dirty = true;
    refreshGhost();
  }

  // ---- Komutlar ----
  function send(name, payload, label) {
    lastCmd = label;
    bus.emit(name, payload);
  }
  function commitPending() {
    if (!pending) return;
    if (mode === 'place' && selType) {
      const r = check(selType, pending.ox, pending.oy);
      if (!r.ok) { reasonOnce(r.reason || B.invalid); return; }
      send('build:place', { type: selType, tx: pending.ox, ty: pending.oy }, 'placed');
      pending = null;
    } else if (mode === 'move' && moveId) {
      const p = placedById(moveId);
      if (!p) return;
      const r = check(p.type, pending.ox, pending.oy, moveId);
      if (!r.ok) { reasonOnce(r.reason || B.invalid); return; }
      send('build:move', { placedId: moveId, tx: pending.ox, ty: pending.oy }, 'moved');
      pending = null;
    }
    dirty = true;
    refreshGhost();
  }
  tap(okBtn, commitPending);
  tap(cancelBtn, () => { pending = null; if (mode === 'move') moveId = null; dirty = true; refreshGhost(); });
  tap(bubbleOk, () => {
    if (!bubbleCmd) return;
    const c = bubbleCmd; bubbleCmd = null;
    send(c.name, c.payload, c.label);
    dirty = true;
  });
  tap(bubbleNo, () => { bubbleCmd = null; dirty = true; });

  // ---- Dünya girdileri ----
  function onHover(p) {
    hoverT = p && p.tx != null ? { tx: p.tx, ty: p.ty } : null;
    if (!active) return;
    if (!touch) refreshGhost();
  }
  function onTap(p) {
    if (!active || !p || p.tx == null) return;
    const tx = p.tx, ty = p.ty;
    const first = strokeTaps++ === 0;
    hoverT = { tx, ty };
    if (mode === 'place') {
      if (!selType) { reasonOnce(B.hint.place, 'info'); return; }
      const d = PLACEABLES[selType];
      if (d.paint) { // sürükleyerek boya: her karo bir komut
        const key = `${tx},${ty}`;
        if (paintDone.has(key)) return;
        paintDone.add(key);
        const r = check(selType, tx, ty);
        if (!r.ok) { reasonOnce(r.reason || B.invalid); return; }
        send('build:place', { type: selType, tx, ty }, 'paint');
        return;
      }
      const [ox, oy] = originFor(selType, tx, ty);
      if (touch) { pending = { ox, oy }; dirty = true; refreshGhost(); return; }
      if (!first) return;
      const r = check(selType, ox, oy);
      if (!r.ok) { reasonOnce(r.reason || B.invalid); return; }
      send('build:place', { type: selType, tx: ox, ty: oy }, 'placed');
      return;
    }
    if (mode === 'move') {
      if (!moveId) {
        if (!first) return;
        const o = objectAt(tx, ty);
        if (o && o.kind === 'placed') {
          moveId = o.id; pending = null; dirty = true; refreshGhost();
        } else if (o && o.kind === 'decor') reasonOnce(B.useClear, 'info');
        else reasonOnce(B.notSelectable, 'info');
        return;
      }
      const pl = placedById(moveId);
      if (!pl) { moveId = null; refreshGhost(); return; }
      const [ox, oy] = originFor(pl.type, tx, ty);
      if (touch) { pending = { ox, oy }; dirty = true; refreshGhost(); return; }
      if (!first) return;
      const r = check(pl.type, ox, oy, moveId);
      if (!r.ok) { reasonOnce(r.reason || B.invalid); return; }
      send('build:move', { placedId: moveId, tx: ox, ty: oy }, 'moved');
      return;
    }
    if (!first) return;
    const o = objectAt(tx, ty);
    if (mode === 'remove') {
      if (!o) { reasonOnce(B.nothing, 'info'); return; }
      if (o.kind === 'decor') { reasonOnce(B.useClear, 'info'); return; }
      const pl = placedById(o.id);
      const d = PLACEABLES[o.type];
      if (!d) return;
      if (d.required) { reasonOnce(B.required, 'info'); return; }
      const refund = Math.round(d.price * (d.refund || 0));
      bubbleCmd = { name: 'build:remove', payload: { placedId: o.id }, label: 'removed', text: B.removeAsk(d.name, refund > 0 ? fmtPrice(refund) : 0), x: lastPt.x, y: lastPt.y };
      void pl;
    } else if (mode === 'clear') {
      if (!o) { reasonOnce(B.nothing, 'info'); return; }
      if (o.kind !== 'decor') { reasonOnce(B.hint.clear, 'info'); return; }
      const bush = o.type === 'bush';
      const cost = CLEAR_COST[bush ? 'bush' : 'tree'] || 0;
      bubbleCmd = { name: 'build:clear', payload: { decorId: o.id }, label: 'cleared', text: B.clearAsk(bush ? B.bushAcc : B.treeAcc, fmtPrice(cost)), x: lastPt.x, y: lastPt.y };
    }
    dirty = true;
  }
  function onResult(p) {
    if (!active || !p) return;
    if (p.ok === false) {
      if (p.reason) reasonOnce(p.reason);
      return;
    }
    if (p.ok) {
      const t = lastCmd;
      if (t === 'moved') { moveId = null; pending = null; dirty = true; refreshGhost(); }
      if (t !== 'paint' && B[t]) toast({ text: B[t], kind: 'good' });
      ghostKey = ''; // sonuçtan sonra hayalet geçerliliği yeniden hesaplansın
      refreshGhost();
    }
  }
  // Fırça darbesi/işaretçi türü takibi
  const isWorld = (t) => !!(t && !root.contains(t));
  const onDown = (e) => {
    if (e.pointerType) touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    lastPt.x = e.clientX; lastPt.y = e.clientY;
    if (!active || !isWorld(e.target)) return;
    strokeSeq++; strokeTaps = 0; paintDone.clear(); reasons.clear();
    if (bubbleCmd) { bubbleCmd = null; dirty = true; }
  };
  const onUp = (e) => { lastPt.x = e.clientX; lastPt.y = e.clientY; if (bubbleCmd && !bubbleCmd.placed) { /* konum tap sırasında sabitlenir */ } };
  const onMove = (e) => {
    if (e.pointerType && e.pointerType !== 'touch') touch = false;
  };
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointermove', onMove, true);

  // ---- Giriş / çıkış ----
  tap(btn, () => api.toggle());
  const api = {
    el: btn,
    get active() { return active; },
    get mode() { return mode; },
    enter() {
      if (active) return;
      closeAll();
      active = true;
      mode = 'place'; selType = null; clearTransient();
      root.classList.add('building');
      btn.classList.add('on');
      btn.setAttribute('aria-pressed', 'true');
      dirty = catDirty = modeDirty = true;
      bus.emit('tool:select', { tool: 'build' });
    },
    exit() {
      if (!active) return;
      active = false;
      clearTransient(); selType = null; hoverT = null;
      root.classList.remove('building');
      btn.classList.remove('on');
      btn.setAttribute('aria-pressed', 'false');
      ghostKey = '';
      bus.emit('build:ghost', null);
      bus.emit('tool:select', { tool: 'hand' });
      render(true);
    },
    toggle() { if (active) api.exit(); else api.enter(); },
    onTap, onHover, onResult,
    markDirty() { dirty = true; },
    /** Esc: önce geçici durum (balon/onay/taşıma), sonra çıkış. */
    escape() {
      if (!active) return false;
      api.exit();
      return true;
    },
    render,
    destroy() {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointermove', onMove, true);
      for (const e of [modeBar, hint, bubble, confirmBar, dock, btn]) e.remove();
    },
  };

  function currentHint() {
    if (mode === 'place') {
      if (!selType) return B.hint.place;
      if (PLACEABLES[selType].paint) return B.hint.paint;
      return touch ? B.hint.placeTouch : B.hint.placeDesk;
    }
    if (mode === 'move') return moveId ? (touch ? B.hint.moveTo : B.hint.moveToDesk) : B.hint.move;
    return B.hint[mode];
  }

  function render(force) {
    if (!active && !force) return;
    const money = state.finance ? state.finance.money : 0;
    if (money !== shownMoney) { shownMoney = money; dirty = true; }
    if (!dirty && !catDirty && !modeDirty) return;
    dirty = false;
    if (modeDirty) {
      modeDirty = false;
      for (const m of MODES) { modeBtns[m].classList.toggle('on', m === mode); modeBtns[m].setAttribute('aria-pressed', m === mode ? 'true' : 'false'); }
    }
    if (catDirty) {
      catDirty = false;
      for (const c of BUILD_CATS) { const on = c.id === cat; tabBtns[c.id].classList.toggle('on', on); tabBtns[c.id].setAttribute('aria-selected', on ? 'true' : 'false'); }
      for (const id in cards) cards[id].el.hidden = PLACEABLES[id].cat !== cat;
      list.scrollLeft = 0;
    }
    // katalog: yalnızca Yerleştir modunda
    dock.classList.toggle('shut', mode !== 'place');
    for (const id in cards) {
      const c = cards[id];
      const poor = c.price > money;
      if (c.dim !== poor) { c.dim = poor; c.el.classList.toggle('poor', poor); }
      const sel = id === selType && mode === 'place';
      if (c.sel !== sel) { c.sel = sel; c.el.classList.toggle('sel', sel); c.el.setAttribute('aria-pressed', sel ? 'true' : 'false'); }
    }
    const ht = currentHint();
    if (ht !== shownHint) { shownHint = ht; setText(hint, ht); }
    // onay çubuğu (dokunmatik yerleştir/taşı)
    const needConfirm = touch && !!pending && ((mode === 'place' && selType) || (mode === 'move' && moveId));
    confirmBar.classList.toggle('show', needConfirm);
    if (needConfirm) {
      const price = mode === 'place' ? PLACEABLES[selType].price : 0;
      setText(okBtn, price > 0 ? B.confirmPlace(fmtPrice(price)) : B.confirm);
      const t = mode === 'place' ? selType : (placedById(moveId) || {}).type;
      const valid = !!t && !!check(t, pending.ox, pending.oy, mode === 'move' ? moveId : undefined).ok;
      okBtn.classList.toggle('bad', !valid);
    }
    // balon
    const showB = !!bubbleCmd;
    bubble.classList.toggle('show', showB);
    if (showB) {
      setText(bubbleTx, bubbleCmd.text);
      const w = 250, hgt = 56;
      const x = Math.max(8, Math.min(window.innerWidth - w - 8, bubbleCmd.x - w / 2));
      const y = Math.max(70, Math.min(window.innerHeight - 200, bubbleCmd.y - hgt - 18));
      bubble.style.left = `${Math.round(x)}px`;
      bubble.style.top = `${Math.round(y)}px`;
    }
  }

  api.hudBtn = btn;
  return api;
}

export default createBuildMode;
