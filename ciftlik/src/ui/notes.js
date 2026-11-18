// Küçük oyun içi bildirimler: hasat ("+2 Patates · A", art arda hasatlar birleşir) ve XP göstergesi.
// Olaylar yalnızca biriktirilir; DOM yazımı kare döngüsünde (render).
import { ITEMS } from '../data/items.js';
import { STR } from './strings.js';
import { TOOL_ICON } from './icons.js';
import { itemIcon } from './itemIcons.js';
import { h, setText } from './frame.js';

const MERGE_MS = 2200;   // bu süre içindeki aynı ürün hasatları tek bildirimde toplanır
const LIFE_MS = 2400;
const MAX_NOTES = 3;

export function createHarvestNotes(root) {
  const box = h('div', 'hnotes');
  box.setAttribute('aria-live', 'polite');
  root.appendChild(box);
  const pending = [];
  const live = []; // {itemId, qty, q, mixed, el, txt, t, timer}

  function retire(n) {
    const i = live.indexOf(n);
    if (i >= 0) live.splice(i, 1);
    clearTimeout(n.timer);
    n.el.classList.add('out');
    setTimeout(() => n.el.remove(), 300);
  }
  const arm = (n) => { clearTimeout(n.timer); n.timer = setTimeout(() => retire(n), LIFE_MS); };

  function text(n) {
    const name = (ITEMS[n.itemId] && ITEMS[n.itemId].name) || n.itemId;
    return STR.harvestNote(n.qty, name, n.mixed ? null : n.q);
  }

  return {
    push(p) {
      if (!p || !p.itemId || !(p.qty > 0)) return;
      pending.push(p);
    },
    render(now) {
      if (!pending.length) return;
      for (let i = 0; i < pending.length; i++) {
        const p = pending[i];
        let n = null;
        for (const l of live) if (l.itemId === p.itemId && now - l.t < MERGE_MS) { n = l; break; }
        if (n) {
          n.qty += p.qty;
          if (p.quality !== n.q) n.mixed = true;
          n.t = now;
          n.el.classList.remove('bump'); void n.el.offsetWidth; n.el.classList.add('bump');
        } else {
          if (live.length >= MAX_NOTES) retire(live[0]);
          const el = h('div', 'hnote glass', `<span class="hi">${itemIcon(p.itemId)}</span><span class="ht num"></span>`);
          n = { itemId: p.itemId, qty: p.qty, q: p.quality, mixed: false, el, txt: el.querySelector('.ht'), t: now, timer: 0 };
          box.appendChild(el);
          live.push(n);
        }
        setText(n.txt, text(n));
        n.el.dataset.q = n.mixed ? '' : (n.q || '');
        arm(n);
      }
      pending.length = 0;
    },
    destroy() { for (const n of live) clearTimeout(n.timer); },
  };
}

/** Saat kartının altında ince XP göstergesi. */
export function createXp(parent, ctx) {
  const { state } = ctx;
  const el = h('div', 'xp glass', `<span class="xs">${TOOL_ICON.spark}</span><span class="xl num"></span><span class="xv num"></span><span class="xg num"></span><i class="xline"></i>`);
  el.setAttribute('aria-label', STR.xp);
  parent.appendChild(el);
  const lvl = el.querySelector('.xl'), val = el.querySelector('.xv'), gain = el.querySelector('.xg');
  let pendingGain = 0;
  let shownXp = null, shownLvl = null;
  let timer = 0;
  let gainSum = 0; // gösterge açıkken gelen kazançlar birikir
  return {
    onGained(p) { const a = Number(p && p.amount) || 0; if (a > 0) pendingGain += a; },
    render() {
      const pl = state.player || {};
      const xp = Math.floor(Number(pl.xp) || 0), lv = Number(pl.level) || 1;
      if (xp !== shownXp) { shownXp = xp; setText(val, `${xp} ${STR.xp}`); }
      if (lv !== shownLvl) { shownLvl = lv; setText(lvl, STR.level(lv)); }
      if (pendingGain > 0) {
        gainSum += pendingGain;
        pendingGain = 0;
        setText(gain, STR.xpGain(Math.round(gainSum * 10) / 10));
        el.classList.remove('gain'); void el.offsetWidth; el.classList.add('gain');
        clearTimeout(timer);
        timer = setTimeout(() => { el.classList.remove('gain'); gainSum = 0; }, 1600);
      }
    },
    destroy() { clearTimeout(timer); },
  };
}
