// Mağaza paneli (PLAN §9 "UI"): SHOP_TABS sekmeleri, kartlarda ikon/ad/fiyat/mevsim/seviye kilidi,
// envanterdeki adet, adet seçici (1–MAX_BUY_QTY), toplam ve "Satın al" → shop:buy {itemId, qty}.
// state'i yalnızca OKUR. Kapalıyken DOM işi yok.
import { ITEMS } from '../data/items.js';
import { CROPS } from '../data/crops.js';
import { SHOP, SHOP_TABS, MAX_BUY_QTY } from '../data/shop.js';
import { ANIMALS, ANIMAL_PRODUCTS } from '../data/animals.js';
import { BUILDINGS } from '../data/buildings.js';
import { MACHINES } from '../data/recipes.js';
import { SEASON_NAMES_TR } from '../core/constants.js';
import { STR } from './strings.js';
import { ICON } from './icons.js';
import { itemIcon } from './itemIcons.js';
import { h, setText } from './frame.js';
import { tap } from './touch.js';
import { formatMoney } from './hud.js';
import { countItem } from './toolbar.js';

// Aşama 5: 'Atölyeler' sekmesi (shop:buildMachine) mağaza sekmelerine yerel olarak eklenir.
const TABS = [...SHOP_TABS, { id: 'workshops', name: STR.mach.tab }];

const HOLD_DELAY = 380, HOLD_EVERY = 70;
const PENDING_MS = 1500;

/** Basılı tutunca hızlanarak tekrarlayan düğme (dokunmatik + fare); klavye için click. */
function holdRepeat(btn, fn) {
  let t1 = 0, t2 = 0, n = 0;
  const stop = () => { clearTimeout(t1); clearInterval(t2); t1 = t2 = 0; };
  btn.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || btn.disabled) return;
    stop(); n = 0;
    fn(1);
    t1 = setTimeout(() => { t2 = setInterval(() => { n++; fn(n > 12 ? 5 : 1); }, HOLD_EVERY); }, HOLD_DELAY);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
  btn.addEventListener('click', (e) => { if (e.detail === 0) fn(1); }); // klavye (Enter/Boşluk)
  return stop;
}

export function createShopPanel(ctx) {
  const { state, bus, now } = ctx;
  const el = h('div', 'shop');
  el.innerHTML = `
    <div class="bp-sub">
      <div class="seg chips" role="tablist">${TABS.map((t) => `<button type="button" role="tab" data-tab="${t.id}">${t.name}</button>`).join('')}</div>
    </div>
    <div class="bp-body scrollable"><div class="shop-grid" role="list"></div></div>`;
  const tabBtns = [...el.querySelectorAll('.seg button')];
  const grid = el.querySelector('.shop-grid');

  let tab = TABS[0] ? TABS[0].id : 'seeds';
  let dirty = true;
  const qtys = new Map();   // itemId → seçili adet
  const pending = new Map(); // itemId → zaman aşımı
  const cards = new Map();  // itemId → {el, refs}
  const stops = [];

  for (const b of tabBtns) tap(b, () => { if (tab !== b.dataset.tab) { tab = b.dataset.tab; dirty = true; grid.parentElement.scrollTop = 0; } });

  const level = () => Number(state.player && state.player.level) || 1;
  const priceOf = (id) => Math.max(0, Number(ITEMS[id] && ITEMS[id].price) || 0);

  function makeCard(entry) {
    const id = entry.itemId;
    const it = ITEMS[id];
    const c = h('div', 'scard');
    c.setAttribute('role', 'listitem');
    c.innerHTML = `
      <div class="sc-top">
        <span class="ci"></span>
        <div class="ct"><b class="cn"></b><span class="cs"></span></div>
      </div>
      <div class="sc-mid"><span class="cp num"></span><span class="co num"></span></div>
      <div class="sc-buy">
        <div class="cq">
          <button type="button" class="ghost dec" aria-label="${STR.dec}"><span class="ic">${ICON.minus}</span></button>
          <span class="qv num" aria-live="polite"></span>
          <button type="button" class="ghost inc" aria-label="${STR.inc}"><span class="ic">${ICON.plus}</span></button>
        </div>
        <button type="button" class="cb solid-gold"><span class="cbt">${STR.buy}</span><span class="cbv num"></span></button>
      </div>
      <div class="sc-lock"><span class="ic">${ICON.lock}</span><span class="lt"></span></div>`;
    const refs = {
      icon: c.querySelector('.ci'), name: c.querySelector('.cn'), season: c.querySelector('.cs'),
      price: c.querySelector('.cp'), owned: c.querySelector('.co'), qv: c.querySelector('.qv'),
      dec: c.querySelector('.dec'), inc: c.querySelector('.inc'), buy: c.querySelector('.cb'), buyV: c.querySelector('.cbv'),
      lockT: c.querySelector('.sc-lock .lt'),
    };
    refs.icon.innerHTML = itemIcon(id);
    setText(refs.name, it ? it.name : id);
    const step = (sign) => (k) => {
      const v = Math.max(1, Math.min(MAX_BUY_QTY, (qtys.get(id) || 1) + sign * k));
      if (v !== (qtys.get(id) || 1)) { qtys.set(id, v); dirty = true; }
    };
    stops.push(holdRepeat(refs.dec, step(-1)), holdRepeat(refs.inc, step(+1)));
    tap(refs.buy, () => {
      if (refs.buy.disabled) return;
      const qty = qtys.get(id) || 1;
      pending.set(id, performance.now() + PENDING_MS);
      bus.emit('shop:buy', { itemId: id, qty });
      dirty = true;
    });
    return { el: c, refs };
  }

  function seasonTag(id, season) {
    const it = ITEMS[id];
    if (!it || it.category !== 'seed') return null;
    const c = CROPS[it.crop];
    if (!c) return null;
    const inSeason = c.seasons.includes(season);
    const names = c.seasons.map((s) => SEASON_NAMES_TR[s] || s).join(' · ');
    return { inSeason, text: inSeason ? names : STR.seasonSeed(names) };
  }

  // ---- Hayvanlar / Binalar sekmeleri (shop:buyAnimal / shop:build) ----
  const CATALOG = { animals: 'a', buildings: 'b', workshops: 'w' };
  const catCards = new Map(); // 'a:chicken' | 'b:coop' → {el, refs}
  const animalsIn = (bid) => state.animals.reduce((n, a) => n + (a.buildingId === bid ? 1 : 0), 0);

  function catalogEntries(tabId) {
    const out = [];
    if (tabId === 'animals') {
      for (const id in ANIMALS) out.push({ kind: 'a', id, key: `a:${id}`, def: ANIMALS[id], level: ANIMALS[id].level, price: ANIMALS[id].price });
    } else if (tabId === 'workshops') {
      for (const id in MACHINES) out.push({ kind: 'w', id, key: `w:${id}`, def: MACHINES[id], level: MACHINES[id].level, price: MACHINES[id].price });
    } else {
      for (const id in BUILDINGS) if (BUILDINGS[id].price > 0) out.push({ kind: 'b', id, key: `b:${id}`, def: BUILDINGS[id], level: BUILDINGS[id].level, price: BUILDINGS[id].price });
    }
    return out;
  }

  function makeCatCard(e) {
    const c = h('div', 'scard');
    c.setAttribute('role', 'listitem');
    c.innerHTML = `
      <div class="sc-top">
        <span class="ci cat-dot"></span>
        <div class="ct"><b class="cn"></b><span class="cs"></span></div>
      </div>
      <div class="sc-mid"><span class="cp num"></span><span class="co num"></span></div>
      <div class="sc-buy">
        <div class="cat-why" hidden></div>
        <button type="button" class="cb solid-gold"><span class="cbt"></span><span class="cbv num"></span></button>
      </div>
      <div class="sc-lock"><span class="ic">${ICON.lock}</span><span class="lt"></span></div>`;
    const refs = {
      dot: c.querySelector('.cat-dot'), name: c.querySelector('.cn'), sub: c.querySelector('.cs'), price: c.querySelector('.cp'),
      own: c.querySelector('.co'), why: c.querySelector('.cat-why'), buy: c.querySelector('.cb'), buyT: c.querySelector('.cbt'),
      buyV: c.querySelector('.cbv'), lockT: c.querySelector('.sc-lock .lt'),
    };
    const def = e.def;
    refs.dot.style.background = e.kind === 'a' ? `radial-gradient(circle at 35% 30%, ${def.color}, ${def.accent})` : e.kind === 'w' ? `radial-gradient(circle at 35% 30%, ${def.color}, #4a3a2a)` : 'radial-gradient(circle at 35% 30%, #c8553d, #6b4a2f)';
    setText(refs.name, def.name);
    if (e.kind === 'a') {
      const pr = ANIMAL_PRODUCTS[def.product.itemId];
      setText(refs.sub, STR.bld.produces(pr ? pr.name : '', def.product.intervalDays));
    } else if (e.kind === 'w') setText(refs.sub, STR.mach.makes(e.id));
    else setText(refs.sub, STR.bld.capacityN(def.capacity));
    tap(refs.buy, () => {
      if (refs.buy.disabled) return;
      pending.set(e.key, performance.now() + PENDING_MS);
      if (e.kind === 'a') bus.emit('shop:buyAnimal', { animal: e.id });
      else if (e.kind === 'w') bus.emit('shop:buildMachine', { machine: e.id });
      else {
        const lot = def.lots.find((l) => !state.buildings.some((b) => b.lotId === l.id));
        if (lot) bus.emit('shop:build', { building: e.id, lotId: lot.id });
      }
      dirty = true;
    });
    return { el: c, refs };
  }

  function renderCatCard(e, lv, money) {
    let card = catCards.get(e.key);
    if (!card) { card = makeCatCard(e); catCards.set(e.key, card); }
    const R = card.refs;
    const locked = lv < e.level;
    let why = '';
    let hardBlock = false;
    if (e.kind === 'a') {
      const bdef = BUILDINGS[e.def.building];
      const bs = state.buildings.filter((b) => b.type === e.def.building);
      const isHive = e.def.building === 'hive';
      if (isHive) {
        if (bs.length >= bdef.lots.length) { why = STR.bld.noLot; hardBlock = true; }
      } else if (!bs.length) { why = STR.bld.needBuilding(bdef.name); hardBlock = true; }
      else if (!bs.some((b) => animalsIn(b.id) < bdef.capacity)) { why = STR.bld.full; hardBlock = true; }
      setText(R.own, STR.bld.have(state.animals.reduce((n, a) => n + (a.type === e.id ? 1 : 0), 0)));
      setText(R.buyT, STR.buy);
    } else if (e.kind === 'w') {
      const built = state.machines.some((m) => m.type === e.id);
      if (built) { why = STR.bld.built; hardBlock = true; }
      setText(R.own, built ? STR.mach.builtShort : '');
      setText(R.buyT, STR.bld.buildBtn);
    } else {
      const used = state.buildings.filter((b) => b.type === e.id).length;
      if (used >= e.def.lots.length) { why = STR.bld.built; hardBlock = true; }
      setText(R.own, used ? STR.bld.builtN(used) : '');
      setText(R.buyT, STR.bld.buildBtn);
    }
    const afford = e.price <= money;
    const busy = pending.has(e.key);
    card.el.classList.toggle('locked', locked);
    card.el.classList.toggle('poor', !afford && !locked && !hardBlock);
    setText(R.price, formatMoney(e.price));
    setText(R.buyV, formatMoney(e.price));
    setText(R.lockT, STR.levelLock(e.level));
    setText(R.why, why);
    R.why.hidden = !why;
    R.buy.disabled = locked || hardBlock || !afford || busy;
    R.buy.classList.toggle('busy', busy);
    R.buy.title = !afford && !locked ? STR.notEnoughMoney : '';
    return card.el;
  }

  function render(t) {
    // Bekleyen alış zaman aşımı → düğmeyi geri aç
    for (const [id, until] of pending) if (t >= until) { pending.delete(id); dirty = true; }
    if (!dirty) return;
    dirty = false;
    for (const b of tabBtns) {
      const on = b.dataset.tab === tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    const lv = level();
    const money = Number(state.finance && state.finance.money) || 0;
    const season = now().season;
    const isCat = tab in CATALOG;
    const entries = isCat ? catalogEntries(tab) : SHOP.filter((e) => e.tab === tab && ITEMS[e.itemId]);
    let i = 0;
    for (const e of entries) {
      if (isCat) {
        const el2 = renderCatCard(e, lv, money);
        if (grid.children[i] !== el2) grid.insertBefore(el2, grid.children[i] || null);
        i++;
        continue;
      }
      const id = e.itemId;
      let card = cards.get(id);
      if (!card) { card = makeCard(e); cards.set(id, card); }
      const R = card.refs;
      const locked = lv < (e.level || 1);
      const qty = qtys.get(id) || 1;
      const price = priceOf(id);
      const total = price * qty;
      const afford = total <= money;
      const st = seasonTag(id, season);
      card.el.classList.toggle('locked', locked);
      card.el.classList.toggle('offseason', !!(st && !st.inSeason));
      card.el.classList.toggle('poor', !afford && !locked);
      setText(R.season, st ? st.text : (ITEMS[id].organic ? STR.organic : ''));
      R.season.classList.toggle('in', !!(st && st.inSeason));
      R.season.classList.toggle('org', !st && !!ITEMS[id].organic);
      setText(R.price, formatMoney(price));
      const own = countItem(state, id);
      setText(R.owned, own > 0 ? STR.owned(own) : '');
      setText(R.qv, String(qty));
      setText(R.buyV, formatMoney(total));
      setText(R.lockT, STR.levelLock(e.level || 1));
      const busy = pending.has(id);
      R.dec.disabled = locked || qty <= 1;
      R.inc.disabled = locked || qty >= MAX_BUY_QTY;
      R.buy.disabled = locked || !afford || busy;
      R.buy.classList.toggle('busy', busy);
      R.buy.title = !afford && !locked ? STR.notEnoughMoney : '';
      if (grid.children[i] !== card.el) grid.insertBefore(card.el, grid.children[i] || null);
      i++;
    }
    while (grid.children.length > i) grid.lastChild.remove();
  }

  return {
    id: 'shop',
    el,
    onOpen(arg) { if (arg && arg.tab && TABS.some((x) => x.id === arg.tab)) tab = arg.tab; dirty = true; },
    onClose() { for (const s of stops) s(); },
    markDirty() { dirty = true; },
    onResult(p) { if (p && p.itemId) pending.delete(p.itemId); dirty = true; },
    onAnimalResult() { for (const k of [...pending.keys()]) if (k.includes(':')) pending.delete(k); dirty = true; },
    render,
    destroy() { for (const s of stops) s(); },
  };
}
