// Gece İstilası: sabah rapor kartı (raid:report). state'i yalnızca OKUR; onarım komutları EventBus ile gider:
// defense:repair {placedId}, defense:repairHouse {}. DOM yazımı rAF'ta.
import { DAMAGE } from '../data/defense.js';
import { PLACEABLES } from '../data/placeables.js';
import { STR } from './strings.js';
import { h, setText } from './frame.js';
import { shield, tap } from './touch.js';
import { formatMoney } from './hud.js';
import { repairCost } from './repair.js';

const R = STR.raid;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function createRaidReport(root, ctx) {
  const { state, bus } = ctx;
  const el = h('div', 'raid-report glass');
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', R.reportTitle);
  shield(el);
  root.appendChild(el);
  let rep = null, dirty = false, hideT = 0;
  let list = null, houseRow = null, houseBtn = null, houseTx = null, penEl = null;
  const rows = new Map(); // placedId → {btn, tag, row}

  const money = () => Number(state.finance && state.finance.money) || 0;
  const nameOf = (type) => (PLACEABLES[type] && PLACEABLES[type].name) || String(type);

  function build() {
    const dmg = rep.damaged || [];
    el.innerHTML = `<header><small>${esc(R.reportSub(rep.day))}</small><b>${R.reportTitle}</b></header>
      <div class="rr-stats"><div><span>${R.kills}</span><b class="num">${Number(rep.kills) || 0}</b></div>
        <div><span>${R.lootLbl}</span><b class="num good">${esc(formatMoney(Number(rep.loot) || 0))}</b></div></div>
      <div class="rr-sec"><h4>${R.damaged}</h4><div class="rr-list scrollable"></div></div>
      <div class="rr-house" hidden><span class="rr-ht"></span><button type="button" class="solid-gold"></button></div>
      <p class="rr-pen" hidden></p>
      <button type="button" class="ghost rr-close">${R.close}</button>`;
    list = el.querySelector('.rr-list');
    houseRow = el.querySelector('.rr-house');
    houseTx = el.querySelector('.rr-ht');
    houseBtn = houseRow.querySelector('button');
    penEl = el.querySelector('.rr-pen');
    rows.clear();
    if (!dmg.length) list.appendChild(h('p', 'wrk-small', R.noDamage));
    for (const dm of dmg) {
      const r = h('div', 'rr-row');
      r.innerHTML = `<span class="rr-n"></span><span class="rr-tag"></span><button type="button" class="solid-gold"></button>`;
      r.querySelector('.rr-n').textContent = nameOf(dm.type);
      const btn = r.querySelector('button');
      tap(btn, () => { if (!btn.disabled) bus.emit('defense:repair', { placedId: dm.placedId }); });
      list.appendChild(r);
      rows.set(dm.placedId, { r, btn, tag: r.querySelector('.rr-tag'), dm });
    }
    tap(houseBtn, () => { if (!houseBtn.disabled) bus.emit('defense:repairHouse', {}); });
    tap(el.querySelector('.rr-close'), close);
    if (rep.penalty > 0) { penEl.hidden = false; penEl.textContent = R.penalty(formatMoney(rep.penalty)); }
  }

  function show(p) {
    rep = p || {};
    clearTimeout(hideT);
    build();
    el.hidden = false; void el.offsetWidth; el.classList.add('show');
    dirty = true;
  }
  function close() {
    el.classList.remove('show');
    clearTimeout(hideT);
    hideT = setTimeout(() => { if (!el.classList.contains('show')) { el.hidden = true; rep = null; } }, 260);
  }

  function render() {
    if (!rep || el.hidden) return;
    const m = money();
    for (const [id, o] of rows) {
      const p = (state.placed || []).find((x) => x.id === id);
      const hurt = p && (p.ruined || (p.maxHp > 0 && p.hp < p.maxHp));
      o.r.classList.toggle('fixed', !hurt);
      if (!hurt) { setText(o.tag, '✓'); setText(o.btn, ''); if (!o.btn.hidden) o.btn.hidden = true; continue; }
      const cost = repairCost(p);
      setText(o.tag, p.ruined ? R.ruinedTag : R.hp(Math.max(0, Math.round((p.hp / p.maxHp) * 100))));
      o.r.classList.toggle('ruined', !!p.ruined);
      setText(o.btn, `${R.repair} · ${formatMoney(cost)}`);
      const poor = m < cost;
      if (o.btn.disabled !== poor) o.btn.disabled = poor;
    }
    const d = state.defense || {};
    const missing = Math.max(0, (d.houseMax || 0) - (d.houseHp == null ? d.houseMax || 0 : d.houseHp));
    const showH = missing > 0 || (rep.houseDamage > 0 && missing > 0);
    if (houseRow.hidden === showH) houseRow.hidden = !showH;
    if (showH) {
      const cost = Math.ceil(missing * DAMAGE.houseRepairPerHp);
      setText(houseTx, `${R.houseDmg} · ${R.hp(Math.round(((d.houseHp || 0) / (d.houseMax || 1)) * 100))}`);
      setText(houseBtn, `${R.repairHouse} · ${formatMoney(cost)}`);
      const poor = m < cost;
      if (houseBtn.disabled !== poor) houseBtn.disabled = poor;
    }
    dirty = false;
  }
  void dirty;
  return { show, close, render, get isOpen() { return !el.hidden; }, destroy() { clearTimeout(hideT); el.remove(); } };
}
export default createRaidReport;
