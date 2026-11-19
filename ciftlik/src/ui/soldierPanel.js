// Asker paneli (PLAN §16): HUD "Askerler" düğmesi. state'i yalnızca OKUR;
// eylemler `soldier:hire {type}` / `soldier:fire {id}` komutlarıdır.
import { SOLDIERS, MAX_SOLDIERS } from '../data/defense.js';
import { STR } from './strings.js';
import { h, setText } from './frame.js';
import { tap } from './touch.js';
import { formatMoney } from './hud.js';

const R = STR.raid;
const FIRE_ARM_MS = 4000;
const LOOK_COL = { guard: '#b58a4a', archer: '#5f9a5a', knight: '#8fa3c4' };

const figure = (type) => `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="23" fill="rgba(40,44,60,.7)" stroke="${LOOK_COL[type] || '#999'}" stroke-width="2"/>
  <path d="M7 46c1-10 8-15 17-15s16 5 17 15z" fill="${LOOK_COL[type] || '#999'}" opacity=".85"/><circle cx="24" cy="21" r="8" fill="#e8c196"/>
  ${type === 'knight' ? '<path d="M15 21a9 9 0 0 1 18 0v2H15z" fill="#aab4c8"/><rect x="22.5" y="14" width="3" height="9" fill="#8895ac"/>'
    : type === 'archer' ? '<path d="M14 23c0-9 5-13 10-13s10 4 10 13c-3-3-6-4-10-4s-7 1-10 4z" fill="#3f6a3a"/>'
    : '<path d="M16 19c1-6 15-6 16 0-4-2-12-2-16 0z" fill="#5a3a22"/><path d="M38 6v30" stroke="#d8d2c0" stroke-width="2"/>'}</svg>`;

export function createSoldierPanel(ctx) {
  const { state, bus } = ctx;
  const el = h('div', 'bld sold');
  el.innerHTML = `<div class="bp-body scrollable"><div class="bld-body">
    <section class="bld-card" data-sec="mine"><h4 class="s-mine-h"></h4><div class="s-mine"></div><p class="wrk-small s-pay"></p></section>
    <section class="bld-card" data-sec="avail"><h4>${R.sAvail}</h4><div class="s-avail"></div><div class="why s-why"></div></section>
  </div></div>`;
  const $ = (s) => el.querySelector(s);
  const mineBox = $('.s-mine'), availBox = $('.s-avail'), mineH = $('.s-mine-h'), payEl = $('.s-pay'), whyEl = $('.s-why');
  let dirty = true;
  let armId = null, armAt = 0;
  let sig = '';
  const rows = new Map(); // id → refs
  const hire = {};        // type → {btn, t}

  const list = () => (state.defense && state.defense.soldiers) || [];
  const money = () => Number(state.finance && state.finance.money) || 0;

  for (const type of Object.keys(SOLDIERS)) {
    const d = SOLDIERS[type];
    const c = h('div', 'sd-card');
    c.innerHTML = `<div class="sd-head"><span class="sd-pic">${figure(type)}</span>
      <span class="sd-tx"><b>${d.title}</b><span class="wrk-small">${R.sDesc[type] || ''}</span></span></div>
      <div class="sd-stats"><span>${R.sHp} <b class="num">${d.hp}</b></span><span>${R.sDmg} <b class="num">${d.dmg}</b></span><span>${R.sRange} <b class="num">${d.range}</b></span><span class="num">${R.sWage(formatMoney(d.wagePerDay))}</span></div>
      <button type="button" class="cb solid-gold"><span class="cbt">${R.sHireFor(formatMoney(d.hireCost))}</span></button>`;
    const btn = c.querySelector('button');
    tap(btn, () => { if (!btn.disabled) bus.emit('soldier:hire', { type }); });
    availBox.appendChild(c);
    hire[type] = { btn };
  }

  function fire(id) {
    const t = performance.now();
    if (armId === id && t - armAt < FIRE_ARM_MS) { armId = null; bus.emit('soldier:fire', { id }); } else { armId = id; armAt = t; }
    dirty = true;
  }

  function buildRows() {
    mineBox.innerHTML = '';
    rows.clear();
    const ls = list();
    if (!ls.length) mineBox.appendChild(h('p', 'wrk-small', R.sNone));
    for (const s of ls) {
      const r = h('div', 'sd-row');
      r.innerHTML = `<span class="sd-pic sm">${figure(s.type)}</span>
        <span class="sd-tx"><b class="sn"></b><span class="wrk-small sub"></span><span class="bar sbar"><i></i></span></span>
        <button type="button" class="ghost sf"></button>`;
      r.querySelector('.sn').textContent = s.name;
      const btn = r.querySelector('.sf');
      tap(btn, () => fire(s.id));
      mineBox.appendChild(r);
      rows.set(s.id, { sub: r.querySelector('.sub'), fill: r.querySelector('.sbar i'), btn, s });
    }
  }

  function render() {
    const ls = list();
    const key = ls.map((s) => s.id).join(',');
    if (key !== sig) { sig = key; buildRows(); dirty = true; }
    if (armId && performance.now() - armAt >= FIRE_ARM_MS) { armId = null; dirty = true; }
    const full = ls.length >= MAX_SOLDIERS;
    const m = money();
    setText(mineH, `${R.sMine} · ${R.sCount(ls.length, MAX_SOLDIERS)}`);
    let wage = 0;
    for (const s of ls) {
      const d = SOLDIERS[s.type];
      if (!d) continue;
      wage += d.wagePerDay;
      const r = rows.get(s.id);
      if (!r) continue;
      const st = R.sState[s.state] || '';
      setText(r.sub, `${d.title} · ${st}${s.towerId != null ? ` · ${R.sTower}` : ''} · ${Math.max(0, Math.round(s.hp))}/${d.hp}`);
      const pct = Math.max(0, Math.min(100, (s.hp / d.hp) * 100));
      const w = `${pct.toFixed(0)}%`;
      if (r.fill.__w !== w) { r.fill.__w = w; r.fill.style.width = w; r.fill.style.background = pct < 35 ? 'var(--bad)' : pct < 70 ? 'var(--accent)' : 'var(--good)'; }
      const armed = armId === s.id;
      setText(r.btn, armed ? R.sFireSure : R.sFire);
      r.btn.classList.toggle('armed', armed);
    }
    setText(payEl, R.sPay(formatMoney(wage)));
    for (const type in hire) {
      const poor = m < SOLDIERS[type].hireCost;
      const b = hire[type].btn;
      const dis = full || poor;
      if (b.disabled !== dis) b.disabled = dis;
    }
    setText(whyEl, full ? R.sFull : '');
    dirty = false;
  }

  return {
    id: 'soldier',
    el,
    title: () => R.sTitle,
    onOpen() { armId = null; sig = '\0'; dirty = true; const sc = el.querySelector('.bp-body'); if (sc) sc.scrollTop = 0; },
    onClose() { armId = null; },
    markDirty() { dirty = true; },
    render() { render(); },
    destroy() {},
  };
}
export default createSoldierPanel;
