// Pazar paneli (PLAN §9 "UI"): satılabilir yığınlar, canlı fiyat (pricing.quote), 28 günlük sparkline,
// doygunluk (talep) göstergesi, kanal seçimi, adet kaydırıcısı ve "Sat" → market:sell.
// state'i yalnızca OKUR. Kapalıyken DOM işi yok; açıkken kirli bayraklarla rAF'ta toplu güncelleme.
import { ITEMS } from '../data/items.js';
import { CHANNELS, SATURATION } from '../data/economy.js';
import { quote, trend } from '../systems/market/pricing.js';
import { STR } from './strings.js';
import { ICON } from './icons.js';
import { itemIcon } from './itemIcons.js';
import { h, setText } from './frame.js';
import { tap } from './touch.js';
import { formatMoney } from './hud.js';
import { createSparkline } from './sparkline.js';

const CH_IDS = ['market', 'wholesale'];
const Q_ORDER = { A: 0, B: 1, C: 2 };
const ITEM_ORDER = {};
Object.keys(ITEMS).forEach((id, i) => { ITEM_ORDER[id] = i; });
const PENDING_MS = 1500;

const safe = (fn, fallback) => { try { return fn(); } catch (e) { console.error('[ui] pricing', e); return fallback; } };

/** Satılabilir gruplar: (itemId, q, organic) başına toplam adet. Yalnızca category 'crop'. */
export function sellableGroups(state) {
  const items = state.inventory && state.inventory.items;
  const map = new Map();
  if (!items) return [];
  for (const id in items) {
    const it = ITEMS[id];
    const arr = items[id];
    if (!it || (it.category !== 'crop' && it.category !== 'animal') || !Array.isArray(arr)) continue;
    for (const st of arr) {
      const qty = st && st.qty > 0 ? Math.floor(st.qty) : 0;
      if (!qty) continue;
      const q = st.q || 'B', organic = st.organic === true;
      const key = `${id}|${q}|${organic ? 1 : 0}`;
      const g = map.get(key);
      if (g) g.qty += qty;
      else map.set(key, { key, itemId: id, q, organic, qty });
    }
  }
  return [...map.values()].sort((a, b) =>
    (ITEM_ORDER[a.itemId] ?? 0) - (ITEM_ORDER[b.itemId] ?? 0)
    || (Q_ORDER[a.q] ?? 9) - (Q_ORDER[b.q] ?? 9)
    || (a.organic === b.organic ? 0 : a.organic ? 1 : -1));
}

function demandOf(state, itemId) {
  const p = state.market && state.market.prices && state.market.prices[itemId];
  const sat = p && typeof p.saturation === 'number' ? p.saturation : 1;
  const min = SATURATION.min ?? 0.5;
  const f = Math.max(0, Math.min(1, (sat - min) / Math.max(1e-6, 1 - min)));
  return { f, lvl: f >= 0.75 ? 'high' : f >= 0.4 ? 'mid' : 'low' };
}

export function createMarketPanel(ctx) {
  const { state, bus, now } = ctx;
  const el = h('div', 'mkt');
  el.innerHTML = `
    <div class="bp-sub">
      <div class="seg mk-ch" role="radiogroup" aria-label="${STR.channel}">
        ${CH_IDS.map((c) => `<button type="button" role="radio" data-ch="${c}"><span class="lk ic">${ICON.lock}</span><span class="cn">${CHANNELS[c].name}</span><small class="cl"></small></button>`).join('')}
      </div>
      <div class="mk-note"></div>
    </div>
    <div class="bp-body scrollable"><div class="mk-list" role="list"></div>
      <div class="bp-empty mk-empty" hidden><span class="ic">${ICON.stall}</span><b>${STR.noSellable}</b><small>${STR.noSellableHint}</small></div>
    </div>`;
  const chBtns = [...el.querySelectorAll('.mk-ch button')];
  const note = el.querySelector('.mk-note');
  const list = el.querySelector('.mk-list');
  const emptyEl = el.querySelector('.mk-empty');

  // Seçili satırın altında açılan satış kutusu (tek eleman, satırlar arasında taşınır)
  const box = h('div', 'mk-sell');
  box.innerHTML = `
    <div class="ms-info"><span class="ms-dem"><i class="m"><i></i><i></i><i></i><i></i><i></i></i><span class="t"></span></span><span class="ms-lim"></span></div>
    <div class="ms-ctrl">
      <div class="slider"><input type="range" min="1" max="1" step="1" value="1" aria-label="${STR.qtyOf('')}"></div>
      <div class="ms-quick"><button type="button" data-k="a" class="ghost"></button><button type="button" data-k="b" class="ghost"></button><button type="button" data-k="all" class="ghost">${STR.sellAll}</button></div>
    </div>
    <div class="ms-sum">
      <div class="ms-tot"><div class="ms-qty num"></div><div class="ms-val num"></div><div class="ms-avg num"></div></div>
      <button type="button" class="ms-go solid-gold"><span>${STR.sell}</span></button>
    </div>
    <div class="ms-why" hidden></div>`;
  const range = box.querySelector('input[type=range]');
  const quickA = box.querySelector('[data-k=a]'), quickB = box.querySelector('[data-k=b]'), quickAll = box.querySelector('[data-k=all]');
  const demM = box.querySelector('.ms-dem'), demT = box.querySelector('.ms-dem .t');
  const limEl = box.querySelector('.ms-lim');
  const qtyEl = box.querySelector('.ms-qty'), valEl = box.querySelector('.ms-val'), avgEl = box.querySelector('.ms-avg');
  const goBtn = box.querySelector('.ms-go');
  const whyEl = box.querySelector('.ms-why');
  const ctrl = box.querySelector('.ms-ctrl'), sum = box.querySelector('.ms-sum');

  let channel = 'market';
  let dirty = true;       // satırlar
  let sellDirty = true;   // satış kutusu (quote)
  let selKey = null;
  let qty = 0;            // seçili adet (0 → varsayılan: hepsi)
  let lim = { min: 1, max: 0, ok: false };
  let pendingUntil = 0;
  let groups = [];
  const rows = new Map(); // key → {el, refs, sig}

  const wholesaleLocked = () => (Number(state.player && state.player.level) || 1) < (CHANNELS.wholesale.level || 1);

  for (const b of chBtns) tap(b, () => {
    const c = b.dataset.ch;
    if (c === 'wholesale' && wholesaleLocked()) return;
    if (c === channel) return;
    channel = c; qty = 0; dirty = true; sellDirty = true;
    // Seçili yığın bu kanalın en az lotunu karşılamıyorsa karşılayan ilk yığına geç
    const lot = CHANNELS[c].minLot || 1;
    const cur = groups.find((g) => g.key === selKey);
    if (!cur || cur.qty < lot) { const g = groups.find((x) => x.qty >= lot); if (g) selKey = g.key; }
  });
  list.addEventListener('click', (e) => {
    const hd = e.target.closest && e.target.closest('.mrow-h');
    if (!hd) return;
    const k = hd.parentElement.dataset.key;
    selKey = selKey === k ? null : k;
    qty = 0; dirty = true; sellDirty = true;
  });
  range.addEventListener('input', () => { qty = Number(range.value) || lim.min; sellDirty = true; });
  range.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
  const quick = (b, v) => tap(b, () => { if (!b.disabled) { qty = v(); sellDirty = true; } });
  quick(quickA, () => lim.min);
  quick(quickB, () => Math.min(lim.max, quickBVal()));
  quick(quickAll, () => lim.max);
  tap(goBtn, () => {
    if (goBtn.disabled) return;
    const g = groups.find((x) => x.key === selKey);
    if (!g || !lim.ok) return;
    const n = clampQty();
    if (n < lim.min || n > lim.max) return;
    pendingUntil = performance.now() + PENDING_MS;
    bus.emit('market:sell', { itemId: g.itemId, q: g.q, organic: g.organic, qty: n, channel });
    sellDirty = true;
  });

  const quickBVal = () => Math.max(10, lim.min * 2);
  function clampQty() {
    if (!lim.ok) return 0;
    let n = qty > 0 ? qty : lim.max;
    if (n > lim.max) n = lim.max;
    if (n < lim.min) n = lim.min;
    return n;
  }

  function makeRow(g) {
    const r = h('div', 'mrow');
    r.dataset.key = g.key;
    r.setAttribute('role', 'listitem');
    r.innerHTML = `
      <button type="button" class="mrow-h">
        <span class="mi"></span>
        <span class="mt"><span class="mn"></span><span class="ms"><i class="qb"></i><span class="lf ic">${ICON.leaf}</span><span class="mq num"></span></span></span>
        <span class="mg"><span class="sp"></span><span class="mc num"></span></span>
        <span class="mp"><b class="num"></b><small>${STR.unitPrice}</small></span>
        <span class="md" aria-hidden="true"><i></i></span>
      </button>`;
    const spark = createSparkline(84, 26);
    r.querySelector('.sp').appendChild(spark.el);
    const refs = {
      icon: r.querySelector('.mi'), name: r.querySelector('.mn'), qb: r.querySelector('.qb'), lf: r.querySelector('.lf'),
      qty: r.querySelector('.mq'), chg: r.querySelector('.mc'), price: r.querySelector('.mp b'), dem: r.querySelector('.md'),
      demI: r.querySelector('.md i'), spark,
    };
    refs.icon.innerHTML = itemIcon(g.itemId);
    setText(refs.name, ITEMS[g.itemId].name);
    refs.qb.className = `qb q-${g.q}`;
    setText(refs.qb, g.q);
    refs.lf.hidden = !g.organic;
    return { el: r, refs };
  }

  function paintRow(row, g, nowCal) {
    const q1 = safe(() => quote(state, { itemId: g.itemId, q: g.q, organic: g.organic, qty: 1, channel }, nowCal), null);
    const tr = safe(() => trend(state, g.itemId), null) || { change: 0, history: [] };
    const change = Number(tr.change) || 0;
    const R = row.refs;
    setText(R.qty, STR.qtyOf(g.qty));
    setText(R.price, q1 && q1.unit > 0 ? formatMoney(q1.unit) : '—');
    setText(R.chg, Array.isArray(tr.history) && tr.history.length > 1 ? STR.pct(change * 100) : '');
    R.chg.className = `mc num ${change > 0.005 ? 'up' : change < -0.005 ? 'down' : ''}`;
    R.spark.draw(tr.history, change);
    const d = demandOf(state, g.itemId);
    R.demI.style.height = `${Math.round(12 + d.f * 88)}%`;
    R.dem.className = `md ${d.lvl}`;
    R.dem.title = `${STR.demand}: ${STR.demandLvl[d.lvl]}`;
    row.el.classList.toggle('on', g.key === selKey);
    row.el.firstElementChild.setAttribute('aria-expanded', g.key === selKey ? 'true' : 'false');
  }

  function renderRows() {
    const nowCal = now();
    groups = sellableGroups(state);
    const locked = wholesaleLocked();
    if (locked && channel === 'wholesale') channel = 'market';
    for (const b of chBtns) {
      const c = b.dataset.ch;
      const lk = c === 'wholesale' && locked;
      b.classList.toggle('on', c === channel);
      b.classList.toggle('locked', lk);
      b.setAttribute('aria-checked', c === channel ? 'true' : 'false');
      b.setAttribute('aria-disabled', lk ? 'true' : 'false');
      setText(b.querySelector('.cl'), lk ? STR.channelLocked(CHANNELS[c].level) : '');
    }
    setText(note, channel === 'wholesale' ? `${STR.payTomorrow} · ${STR.minLotNote(CHANNELS.wholesale.minLot)}` : STR.payNow);
    note.classList.toggle('later', channel === 'wholesale');

    if (selKey && !groups.some((g) => g.key === selKey)) selKey = null;
    if (!selKey && groups.length) selKey = groups[0].key;
    const seen = new Set();
    let i = 0;
    for (const g of groups) {
      seen.add(g.key);
      let row = rows.get(g.key);
      if (!row) { row = makeRow(g); rows.set(g.key, row); }
      paintRow(row, g, nowCal);
      if (list.children[i] !== row.el) list.insertBefore(row.el, list.children[i] || null);
      i++;
    }
    for (const [k, row] of rows) if (!seen.has(k)) { row.el.remove(); rows.delete(k); }
    emptyEl.hidden = groups.length > 0;
    const sel = selKey && rows.get(selKey);
    if (sel) { if (box.parentElement !== sel.el) sel.el.appendChild(box); }
    else if (box.parentElement) box.remove();
    sellDirty = true;
  }

  function renderSell(t) {
    const g = groups.find((x) => x.key === selKey);
    if (!g) return;
    const nowCal = now();
    const base = { itemId: g.itemId, q: g.q, organic: g.organic, channel };
    const q1 = safe(() => quote(state, { ...base, qty: 1 }, nowCal), null);
    const minLot = Math.max(1, Math.floor(Number(q1 && q1.minLot) || CHANNELS[channel].minLot || 1));
    const limitLeft = q1 && Number.isFinite(q1.limitLeft) ? Math.max(0, Math.floor(q1.limitLeft)) : Infinity;
    const max = Math.min(g.qty, limitLeft);
    let why = '';
    if (!q1) why = STR.limitReached;
    else if (limitLeft < minLot || limitLeft === 0) why = STR.limitReached;
    else if (g.qty < minLot) why = STR.belowMinLot(minLot, g.qty);
    else if (q1.ok === false && q1.reason && !(max >= minLot)) why = String(q1.reason);
    lim = { min: minLot, max, ok: !why };

    const d = demandOf(state, g.itemId);
    demM.className = `ms-dem ${d.lvl}`;
    demM.dataset.seg = String(Math.max(1, Math.round(d.f * 5)));
    setText(demT, `${STR.demand}: ${STR.demandLvl[d.lvl]}`);
    setText(limEl, channel === 'wholesale' ? STR.payTomorrow : Number.isFinite(limitLeft) ? STR.dailyLimit(limitLeft) : '');
    limEl.classList.toggle('later', channel === 'wholesale');

    whyEl.hidden = !why;
    setText(whyEl, why);
    ctrl.classList.toggle('off', !lim.ok);
    sum.classList.toggle('off', !lim.ok);
    const pending = t < pendingUntil;
    if (!lim.ok) {
      range.disabled = true;
      goBtn.disabled = true;
      quickA.disabled = quickB.disabled = quickAll.disabled = true;
      setText(qtyEl, STR.qtyOf(0)); setText(valEl, formatMoney(0)); setText(avgEl, '');
      return;
    }
    const n = clampQty();
    qty = n;
    range.disabled = lim.max <= lim.min;
    range.min = String(lim.min);
    range.max = String(Math.max(lim.min, lim.max));
    if (Number(range.value) !== n) range.value = String(n);
    const span = lim.max - lim.min;
    range.style.setProperty('--p', `${span > 0 ? ((n - lim.min) / span) * 100 : 100}%`);
    const bv = quickBVal();
    setText(quickA, String(lim.min));
    setText(quickB, String(bv));
    quickA.disabled = false;
    quickB.disabled = bv > lim.max || bv <= lim.min;
    quickB.hidden = bv <= lim.min;
    quickAll.disabled = false;
    quickA.classList.toggle('on', n === lim.min);
    quickB.classList.toggle('on', n === bv && !quickB.disabled);
    quickAll.classList.toggle('on', n === lim.max);

    const qn = safe(() => quote(state, { ...base, qty: n }, nowCal), null);
    const total = qn && qn.total > 0 ? qn.total : 0;
    const avg = qn && qn.avg > 0 ? qn.avg : (n ? total / n : 0);
    setText(qtyEl, `${STR.qtyOf(n)} · ${ITEMS[g.itemId].name}`);
    setText(valEl, formatMoney(total));
    setText(avgEl, STR.avgUnit(formatMoney(avg)));
    const bad = !!(qn && qn.ok === false);
    if (bad && qn.reason) { whyEl.hidden = false; setText(whyEl, String(qn.reason)); }
    goBtn.disabled = pending || bad || !(total > 0);
    goBtn.classList.toggle('busy', pending);
  }

  return {
    id: 'market',
    el,
    onOpen(arg) {
      if (arg && arg.itemId) {
        selKey = `${arg.itemId}|${arg.q || 'B'}|${arg.organic ? 1 : 0}`;
        qty = 0;
      }
      dirty = true; sellDirty = true;
    },
    onClose() {},
    markDirty() { dirty = true; },
    onResult() { pendingUntil = 0; qty = 0; dirty = true; sellDirty = true; },
    render(t) {
      if (dirty) { dirty = false; renderRows(); }
      // Bekleme süresi dolunca düğmeyi geri aç
      if (pendingUntil && t >= pendingUntil) { pendingUntil = 0; sellDirty = true; }
      if (sellDirty) { sellDirty = false; renderSell(t); }
    },
  };
}
