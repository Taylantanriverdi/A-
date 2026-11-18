// Arazi paneli (PLAN §15): satın alınabilir parseller — ad, alan, fiyat, emlak vergisi, "Satın al" → land:buy {parcelId}.
// Kendi kendine yeten küçük kaplama (İnşa modundan açılır). State'i yalnızca OKUR; eylem EventBus komutudur.
import { listParcels } from '../systems/LandSystem.js';
import { h, setText } from './frame.js';
import { shield, tap } from './touch.js';
import { formatMoney } from './hud.js';

export function createLandPanel(root, ctx) {
  const { state, bus } = ctx;
  const el = h('div', 'land-panel glass interactive');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Arazi');
  el.hidden = true;
  el.innerHTML = '<div class="lp-head"><b>Arazi satın al</b><button type="button" class="lp-x" aria-label="Kapat">×</button></div><div class="lp-note"></div><div class="lp-list"></div>';
  const list = el.querySelector('.lp-list');
  const note = el.querySelector('.lp-note');
  tap(el.querySelector('.lp-x'), () => api.close());
  shield(el);
  root.appendChild(el);

  const rows = new Map(); // parcelId → {row, price, tax, btn, status}
  let dirty = true, open = false, pendingId = null;
  const offs = [
    bus.on('land:changed', () => { pendingId = null; dirty = true; }),
    bus.on('land:result', (p) => { pendingId = null; dirty = true; if (open && p && p.ok === false && p.reason) bus.emit('toast', { text: String(p.reason), kind: 'bad' }); }),
    bus.on('money:changed', () => { dirty = true; }),
  ];

  function makeRow(p) {
    const row = h('div', 'lp-row');
    row.innerHTML = `<div class="lp-info"><b class="lp-name"></b><span class="lp-sub num"></span><span class="lp-tax num"></span></div><div class="lp-buy"><span class="lp-price num"></span><button type="button" class="lp-btn solid-gold"></button></div>`;
    const r = { row, name: row.querySelector('.lp-name'), sub: row.querySelector('.lp-sub'), tax: row.querySelector('.lp-tax'), price: row.querySelector('.lp-price'), btn: row.querySelector('.lp-btn') };
    setText(r.name, p.name);
    setText(r.sub, `${p.w} × ${p.h} karo · ${p.area} karo alan`);
    setText(r.tax, `Emlak vergisi: ${formatMoney(p.tax)} / mevsim`);
    setText(r.price, formatMoney(p.price));
    tap(r.btn, () => {
      if (r.btn.disabled) return;
      pendingId = p.id; dirty = true;
      bus.emit('land:buy', { parcelId: p.id });
    });
    list.appendChild(row);
    rows.set(p.id, r);
    return r;
  }

  function render() {
    if (!open || !dirty) return;
    dirty = false;
    const money = Number(state.finance && state.finance.money) || 0;
    const ps = listParcels(state);
    setText(note, 'Satılık parsellerde ekim ve inşaat yapılamaz. Satın alınan arazi her mevsim sonunda emlak vergisi doğurur.');
    for (const p of ps) {
      const r = rows.get(p.id) || makeRow(p);
      r.row.classList.toggle('owned', p.owned);
      r.price.hidden = p.owned;
      r.btn.disabled = p.owned || money < p.price || pendingId === p.id;
      setText(r.btn, p.owned ? 'Sahipsin' : 'Satın al');
      r.btn.title = !p.owned && money < p.price ? 'Yeterli paran yok' : '';
      r.row.classList.toggle('poor', !p.owned && money < p.price);
    }
  }

  const api = {
    el,
    get isOpen() { return open; },
    open() { open = true; dirty = true; el.hidden = false; el.classList.add('show'); render(); },
    close() { open = false; el.hidden = true; el.classList.remove('show'); },
    toggle() { if (open) api.close(); else api.open(); },
    markDirty() { dirty = true; },
    render,
    destroy() { for (const o of offs) if (typeof o === 'function') o(); el.remove(); },
  };
  return api;
}
export default createLandPanel;
