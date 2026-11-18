// Envanter paneli (PLAN §9 "UI"): yuva ızgarası, kategori filtreleri, kalite/organik/tazelik.
// state.inventory'yi yalnızca OKUR. Kapalıyken DOM işi yok; açıkken kirliyse rAF'ta toplu güncellenir.
import { ITEMS } from '../data/items.js';
import { CROPS } from '../data/crops.js';
import { INVENTORY } from '../data/progression.js';
import { STR } from './strings.js';
import { ICON } from './icons.js';
import { itemIcon } from './itemIcons.js';
import { h, setText } from './frame.js';
import { tap } from './touch.js';

const FILTERS = ['all', 'crop', 'animal', 'seed', 'fertilizer', 'chemical', 'feed'];
const CAT_ORDER = { crop: 0, seed: 1, fertilizer: 2, chemical: 3 };
const ITEM_ORDER = {};
Object.keys(ITEMS).forEach((id, i) => { ITEM_ORDER[id] = i; });
const Q_ORDER = { A: 0, B: 1, C: 2 };

const stackMax = () => INVENTORY.stackMax || 99;

/** Tazelik: crop yığınları için { left, total, pct, warn, rotNext } yoksa null. */
export function freshness(itemId, st) {
  const it = ITEMS[itemId];
  if (!it || (it.category !== 'crop' && it.category !== 'animal')) return null;
  const fd = it.freshDays ?? CROPS[it.crop]?.freshDays;
  const total = Number.isFinite(fd) && fd > 0 ? fd : 0;
  if (!total) return null;
  const age = Math.max(0, Number(st.age) || 0);
  const left = Math.max(0, total - age);
  return { left, total, pct: Math.max(0, Math.min(1, left / total)), warn: left <= 1, rotNext: st.q === 'C' };
}

/**
 * Envanteri yuvalara açar (bir yığın = bir yuva; 99'dan büyük eski yığınlar birden çok yuva sayılır).
 * Sıralama: kategori → katalog sırası → kalite → organik.
 * @returns {Array<{key,itemId,q,organic,qty,age,cat}>}
 */
export function inventorySlots(state) {
  const items = state.inventory && state.inventory.items;
  const out = [];
  if (!items) return out;
  const max = stackMax();
  for (const id in items) {
    const arr = items[id];
    if (!Array.isArray(arr) || !ITEMS[id]) continue;
    const cat = ITEMS[id].category;
    for (let i = 0; i < arr.length; i++) {
      const st = arr[i];
      const qty = st && st.qty > 0 ? Math.floor(st.qty) : 0;
      if (!qty) continue;
      const q = st.q || 'B';
      const organic = st.organic === true;
      let rest = qty, part = 0;
      while (rest > 0) {
        const n = Math.min(rest, max);
        out.push({ key: `${id}|${q}|${organic ? 1 : 0}|${part}`, itemId: id, q, organic, qty: n, age: st.age || 0, cat });
        rest -= n; part++;
      }
    }
  }
  out.sort((a, b) =>
    (CAT_ORDER[a.cat] ?? 9) - (CAT_ORDER[b.cat] ?? 9)
    || (ITEM_ORDER[a.itemId] ?? 0) - (ITEM_ORDER[b.itemId] ?? 0)
    || (Q_ORDER[a.q] ?? 9) - (Q_ORDER[b.q] ?? 9)
    || (a.organic === b.organic ? 0 : a.organic ? 1 : -1)
    || a.key.localeCompare(b.key));
  return out;
}

export function createInventoryPanel(ctx, { openPanel }) {
  const { state } = ctx;
  const el = h('div', 'inv');
  el.innerHTML = `
    <div class="bp-sub">
      <div class="seg chips" role="tablist">${FILTERS.map((f) => `<button type="button" role="tab" data-f="${f}">${STR.invFilters[f]}</button>`).join('')}</div>
      <div class="inv-cap"><span class="num t"></span><i class="bar"><i></i></i></div>
    </div>
    <div class="bp-body scrollable"><div class="inv-grid" role="list"></div><p class="bp-empty" hidden>${STR.invEmpty}</p></div>
    <div class="bp-foot inv-detail">
      <span class="di"></span>
      <div class="dt"><div class="dn"></div><div class="dm"></div></div>
      <button type="button" class="ghost dsell" hidden>${STR.sellThis}</button>
    </div>`;
  const fBtns = [...el.querySelectorAll('.seg button')];
  const capT = el.querySelector('.inv-cap .t');
  const capBar = el.querySelector('.inv-cap .bar > i');
  const capBox = el.querySelector('.inv-cap');
  const grid = el.querySelector('.inv-grid');
  const empty = el.querySelector('.bp-empty');
  const dI = el.querySelector('.di'), dN = el.querySelector('.dn'), dM = el.querySelector('.dm');
  const dSell = el.querySelector('.dsell');
  const detail = el.querySelector('.inv-detail');

  let filter = 'all';
  let dirty = true;
  let selKey = null;
  let lastSlots = [];
  const cells = []; // yeniden kullanılan yuva elemanları
  const sigs = [];

  for (const b of fBtns) tap(b, () => { filter = b.dataset.f; dirty = true; });
  grid.addEventListener('click', (e) => {
    const c = e.target.closest && e.target.closest('.slot');
    if (!c || !c.dataset.key) return;
    selKey = selKey === c.dataset.key ? null : c.dataset.key;
    dirty = true;
  });
  tap(dSell, () => {
    const s = lastSlots.find((x) => x.key === selKey);
    if (s) openPanel('market', { itemId: s.itemId, q: s.q, organic: s.organic });
  });

  function cell(i) {
    let c = cells[i];
    if (!c) {
      c = h('button', 'slot');
      c.type = 'button';
      c.setAttribute('role', 'listitem');
      cells[i] = c; sigs[i] = null;
    }
    return c;
  }

  function paintSlot(c, i, s) {
    if (!s) {
      if (sigs[i] !== 'empty') {
        sigs[i] = 'empty';
        c.className = 'slot empty';
        c.innerHTML = '';
        c.removeAttribute('data-key');
        c.title = '';
        c.disabled = true;
        c.setAttribute('aria-label', '');
      }
      return;
    }
    const fr = freshness(s.itemId, s);
    const sel = s.key === selKey;
    const sig = `${s.key}|${s.qty}|${fr ? fr.left : ''}|${sel ? 1 : 0}`;
    if (sigs[i] === sig) return;
    sigs[i] = sig;
    const it = ITEMS[s.itemId];
    const showQ = (it.category === 'crop' || it.category === 'animal');
    c.disabled = false;
    c.dataset.key = s.key;
    c.className = `slot${sel ? ' on' : ''}${fr && fr.warn ? (fr.rotNext ? ' rot' : ' stale') : ''}`;
    const name = it.name;
    c.title = `${name}${showQ ? ` · ${STR.qualityName[s.q]}` : ''}${s.organic ? ` · ${STR.organic}` : ''} · ${STR.qtyOf(s.qty)}`;
    c.setAttribute('aria-label', c.title);
    c.innerHTML =
      `<span class="si">${itemIcon(s.itemId)}</span>` +
      `<b class="sq num">${s.qty}</b>` +
      (showQ ? `<i class="sb q-${s.q}">${s.q}</i>` : '') +
      (s.organic ? `<span class="so">${ICON.leaf}</span>` : '') +
      (fr ? `<i class="sf"><i style="width:${Math.round(fr.pct * 100)}%"></i></i>` : '');
  }

  function paintDetail(s) {
    if (!s) {
      detail.classList.add('idle');
      dI.innerHTML = '';
      setText(dN, STR.invHint);
      setText(dM, '');
      dSell.hidden = true;
      return;
    }
    detail.classList.remove('idle');
    const it = ITEMS[s.itemId];
    dI.innerHTML = itemIcon(s.itemId);
    const parts = [STR.catName[it.category] || it.category, STR.qtyOf(s.qty)];
    if ((it.category === 'crop' || it.category === 'animal')) parts.splice(1, 0, STR.qualityName[s.q]);
    if (s.organic) parts.push(STR.organic);
    const fr = freshness(s.itemId, s);
    if (fr) parts.push(fr.rotNext ? STR.freshLastC(fr.left) : STR.freshLeft(fr.left));
    setText(dN, it.name);
    setText(dM, parts.join(' · '));
    dM.classList.toggle('warn', !!(fr && fr.warn));
    dSell.hidden = (it.category !== 'crop' && it.category !== 'animal');
  }

  function render() {
    if (!dirty) return;
    dirty = false;
    const slots = inventorySlots(state);
    lastSlots = slots;
    const cap = Math.max(0, Math.floor(Number(state.inventory && state.inventory.capacity) || INVENTORY.startSlots));
    const used = slots.length;
    setText(capT, STR.slotsUsed(used, cap));
    const ratio = cap > 0 ? Math.min(1, used / cap) : 1;
    capBar.style.width = `${Math.round(ratio * 100)}%`;
    capBox.classList.toggle('full', used >= cap);
    capBox.classList.toggle('near', used < cap && ratio >= 0.85);
    for (const b of fBtns) {
      const on = b.dataset.f === filter;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    const shown = filter === 'all' ? slots : slots.filter((s) => s.cat === filter);
    const total = filter === 'all' ? Math.max(cap, shown.length) : shown.length;
    for (let i = 0; i < total; i++) {
      const c = cell(i);
      paintSlot(c, i, shown[i] || null);
      if (grid.children[i] !== c) grid.insertBefore(c, grid.children[i] || null);
    }
    while (grid.children.length > total) grid.lastChild.remove();
    empty.hidden = shown.length > 0;
    if (selKey && !slots.some((s) => s.key === selKey)) selKey = null;
    paintDetail(selKey ? slots.find((s) => s.key === selKey) : null);
  }

  return {
    id: 'inventory',
    el,
    onOpen() { dirty = true; },
    onClose() {},
    markDirty() { dirty = true; },
    render,
  };
}
