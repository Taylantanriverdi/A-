// Gece İstilası: yapı hasarı okuma + "Onar" şeridi (bina / makine panelleri). state'i yalnızca okur.
import { PLACEABLES } from '../data/placeables.js';
import { DAMAGE } from '../data/defense.js';
import { STR } from './strings.js';
import { h, setText } from './frame.js';
import { tap } from './touch.js';
import { formatMoney } from './hud.js';

const R = STR.raid;

/** Yapının onarım bedeli (₺). Harap: fiyat × repairPct; hasarlı: eksik can oranıyla orantılı. */
export function repairCost(p) {
  const def = PLACEABLES[p.type];
  const price = (def && def.price) || 0;
  const full = price * DAMAGE.repairPct;
  if (p.ruined) return Math.max(1, Math.round(full));
  const frac = p.maxHp > 0 ? 1 - Math.max(0, p.hp) / p.maxHp : 0;
  return Math.max(1, Math.round(full * frac));
}

/** Mod açıkken ve yapı hasarlıysa {pct, ruined, cost}; yoksa null. */
export function damageOf(state, placedId) {
  if (!state.settings || !state.settings.raids || placedId == null) return null;
  const p = (state.placed || []).find((x) => x.id === placedId);
  if (!p) return null;
  const hurt = p.ruined || (p.maxHp > 0 && p.hp < p.maxHp);
  if (!hurt) return null;
  return { pct: p.maxHp > 0 ? Math.max(0, Math.round((p.hp / p.maxHp) * 100)) : 0, ruined: !!p.ruined, cost: repairCost(p) };
}

/** Panel gövdesinin en üstüne eklenen uyarı şeridi. update(placedId) kare döngüsünde çağrılır. */
export function createRepairStrip(ctx, body) {
  const { state, bus } = ctx;
  const el = h('div', 'repair-strip');
  el.hidden = true;
  el.innerHTML = `<span class="rs-tx"></span><button type="button" class="solid-gold rs-btn"></button>`;
  const tx = el.querySelector('.rs-tx'), btn = el.querySelector('.rs-btn');
  let curId = null, cost = 0;
  tap(btn, () => { if (!btn.disabled && curId != null) bus.emit('defense:repair', { placedId: curId }); });
  body.insertBefore(el, body.firstChild);
  return {
    el,
    update(placedId) {
      curId = placedId;
      const d = damageOf(state, placedId);
      if (!d) { if (!el.hidden) el.hidden = true; return; }
      if (el.hidden) el.hidden = false;
      el.classList.toggle('ruined', d.ruined);
      setText(tx, d.ruined ? R.ruinedStrip : R.dmgStrip(d.pct));
      cost = d.cost;
      setText(btn, `${R.repair} · ${formatMoney(d.cost)}`);
      const poor = (Number(state.finance && state.finance.money) || 0) < d.cost;
      if (btn.disabled !== poor) btn.disabled = poor;
    },
  };
}
