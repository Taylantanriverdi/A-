// Olay kartı (event:started) + festival paneli (festival:open → ürün seç → festival:result). PLAN §14.
// UI state'i yalnızca okur; eylem `festival:enter` komutuyla gider.
import { STR } from './strings.js';
import { ITEMS } from '../data/items.js';
import { FESTIVAL } from '../data/events.js';
import { unitBeforeSaturation, isSellable } from '../systems/market/pricing.js';
import { itemIcon } from './itemIcons.js';
import { h } from './frame.js';
import { shield, tap } from './touch.js';
import { formatMoney } from './hud.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const itemName = (id) => (ITEMS[id] && ITEMS[id].name) || String(id);
const C = STR.ev.chips;

/** Olay etki çipleri (data'dan). */
export function eventChips(kind, data = {}) {
  const out = [];
  if (data.mult && data.itemIds) {
    const pct = Math.round(Math.abs(data.mult - 1) * 100);
    for (const id of data.itemIds) out.push(data.mult >= 1 ? C.priceUp(itemName(id), pct) : C.priceDown(itemName(id), pct));
  }
  if (data.moistureLossMult) out.push(C.moisture(data.moistureLossMult));
  if (data.noRain) out.push(C.noRain);
  if (data.sickChanceMult) out.push(C.sick(data.sickChanceMult));
  if (data.pestChanceMult) out.push(C.pest(data.pestChanceMult));
  if (data.buildDiscount) out.push(C.discount(Math.round(data.buildDiscount * 100)));
  if (data.grant) out.push(C.grant(formatMoney(data.grant)));
  if (data.cropDamage) out.push(data.onlyNonHardy ? C.nonHardy : C.cropDamage);
  return out;
}

export function createEventCard(root) {
  const card = h('div', 'event-card glass');
  card.hidden = true;
  card.setAttribute('role', 'status');
  shield(card);
  root.appendChild(card);
  let timer = 0, hideT = 0;
  const queue = [];
  const close = () => {
    clearTimeout(timer);
    card.classList.remove('show');
    clearTimeout(hideT);
    hideT = setTimeout(() => { if (!card.classList.contains('show')) { card.hidden = true; if (queue.length) show(queue.shift()); } }, 260);
  };
  card.addEventListener('click', close);
  function show(p) {
    if (!card.hidden && card.classList.contains('show')) { queue.push(p); return; }
    const chips = eventChips(p.kind, p.data).map((c) => `<span class="ev-chip">${esc(c)}</span>`).join('');
    card.className = `event-card glass k-${p.kind}`;
    card.innerHTML = `<small>${esc(STR.ev.chip[p.kind] || '')}</small><b>${esc(p.title)}</b><p>${esc(p.text)}</p>`
      + (chips ? `<div class="ev-chips">${chips}</div>` : '') + `<em>${STR.ev.tap}</em>`;
    card.hidden = false; void card.offsetWidth; card.classList.add('show');
    clearTimeout(timer); timer = setTimeout(close, 6000);
  }
  return { show, destroy() { clearTimeout(timer); clearTimeout(hideT); card.remove(); } };
}

export function createFestivalPanel(root, ctx) {
  const { state, bus } = ctx;
  const F = STR.ev.fest;
  const el = h('div', 'fest-panel glass');
  el.hidden = true;
  shield(el);
  root.appendChild(el);
  let mode = null; // 'pick' | 'result'
  let result = null;
  const hide = () => { el.classList.remove('show'); mode = null; setTimeout(() => { if (!mode) el.hidden = true; }, 220); };
  const reveal = () => { el.hidden = false; void el.offsetWidth; el.classList.add('show'); };

  function stacks() {
    const out = [];
    const inv = state.inventory.items;
    for (const id in inv) {
      if (!isSellable(id)) continue;
      let best = null;
      for (const st of inv[id]) {
        if (st.qty <= 0) continue;
        const v = unitBeforeSaturation(state, id, st.q, st.organic === true, 'market');
        if (!best || v > best.v) best = { id, q: st.q, v, qty: 0 };
      }
      if (best) { for (const st of inv[id]) if (st.q === best.q) best.qty += st.qty; out.push(best); }
    }
    return out.sort((a, b) => b.v - a.v);
  }

  function renderPick() {
    const list = stacks();
    const dl = state.events.festival.deadlineMin;
    const left = Math.max(0, dl - state.time.totalMinutes);
    const prizes = FESTIVAL.prizes.map((p, i) => `<span>${i + 1}. ${formatMoney(p)}</span>`).join('');
    el.innerHTML = `<div class="fp-head"><b>${esc(FESTIVAL.title)}</b><small>${F.left(`${Math.floor(left / 60)} sa ${left % 60} dk`)}</small></div>
      <p>${F.hint}</p><div class="fp-prizes"><em>${F.prizes}</em>${prizes}</div>
      <div class="fp-list scrollable">${list.length ? list.map((s) => `<button class="fp-item" data-id="${s.id}" data-q="${s.q}">
        <span class="ct-i">${itemIcon(s.id)}</span><span class="fp-n">${esc(itemName(s.id))}<i class="qb q-${s.q}">${s.q}</i> <small>×${s.qty}</small></span>
        <b class="num">${formatMoney(Math.round(s.v))}</b></button>`).join('') : `<div class="fp-empty">${F.empty}</div>`}</div>
      <button class="ghost fp-later">${F.later}</button>`;
    for (const b of el.querySelectorAll('.fp-item')) tap(b, () => bus.emit('festival:enter', { itemId: b.dataset.id, q: b.dataset.q }));
    tap(el.querySelector('.fp-later'), hide);
  }

  function renderResult(r) {
    const body = !r.entered
      ? `<p>${r.reason ? esc(r.reason) : F.skipped}</p>`
      : `<div class="fp-rank">${F.rank(r.rank)}</div>
         <div class="sc-row"><span>${F.score}</span><b class="num">${formatMoney(Math.round(r.score))}</b></div>
         <div class="sc-row"><span>${F.rivals}</span><b class="num">${(r.rivals || []).map((v) => Math.round(v)).join(' · ')}</b></div>
         <div class="sc-row"><span>${r.prize ? esc(STR.ev.fest.prizes) : ''}</span><b class="num pos">${r.prize ? `+${formatMoney(r.prize)}` : F.noPrize}</b></div>
         ${r.reputation ? `<div class="sc-row"><span></span><b>${F.rep(r.reputation)}</b></div>` : ''}`;
    el.innerHTML = `<div class="fp-head"><b>${esc(FESTIVAL.title)}</b></div>${body}<button class="solid-gold fp-ok">${F.close}</button>`;
    tap(el.querySelector('.fp-ok'), hide);
  }

  return {
    onOpen() { mode = 'pick'; renderPick(); reveal(); },
    onResult(r) {
      if (!r) return;
      if (r.ok === false && r.reason && mode === 'pick') { /* ret: panel açık kalır */ return; }
      if (!r.entered && mode !== 'pick') return; // sessiz kapanış (panel zaten kapalı)
      mode = 'result'; renderResult(r); reveal();
    },
    refresh() { if (mode === 'pick') renderPick(); },
    destroy() { el.remove(); },
  };
}
