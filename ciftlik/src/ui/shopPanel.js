// Mağaza paneli (PLAN §9 "UI"): SHOP_TABS sekmeleri, kartlarda ikon/ad/fiyat/mevsim/seviye kilidi,
// envanterdeki adet, adet seçici (1–MAX_BUY_QTY), toplam ve "Satın al" → shop:buy {itemId, qty}.
// state'i yalnızca OKUR. Kapalıyken DOM işi yok.
import { ITEMS } from '../data/items.js';
import { CROPS } from '../data/crops.js';
import { SHOP, SHOP_TABS, MAX_BUY_QTY } from '../data/shop.js';
import { SEASON_NAMES_TR } from '../core/constants.js';
import { STR } from './strings.js';
import { ICON } from './icons.js';
import { itemIcon } from './itemIcons.js';
import { h, setText } from './frame.js';
import { tap } from './touch.js';
import { formatMoney } from './hud.js';
import { countItem } from './toolbar.js';

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
      <div class="seg chips" role="tablist">${SHOP_TABS.map((t) => `<button type="button" role="tab" data-tab="${t.id}">${t.name}</button>`).join('')}</div>
    </div>
    <div class="bp-body scrollable"><div class="shop-grid" role="list"></div></div>`;
  const tabBtns = [...el.querySelectorAll('.seg button')];
  const grid = el.querySelector('.shop-grid');

  let tab = SHOP_TABS[0] ? SHOP_TABS[0].id : 'seeds';
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
    const entries = SHOP.filter((e) => e.tab === tab && ITEMS[e.itemId]);
    let i = 0;
    for (const e of entries) {
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
    onOpen(arg) { if (arg && arg.tab && SHOP_TABS.some((x) => x.id === arg.tab)) tab = arg.tab; dirty = true; },
    onClose() { for (const s of stops) s(); },
    markDirty() { dirty = true; },
    onResult(p) { if (p && p.itemId) pending.delete(p.itemId); dirty = true; },
    render,
    destroy() { for (const s of stops) s(); },
  };
}
