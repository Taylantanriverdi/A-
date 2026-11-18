// Küçük oyun içi bildirimler: hasat ("+2 Patates · A", art arda hasatlar birleşir).
// Olaylar yalnızca biriktirilir; DOM yazımı kare döngüsünde (render).
import { ITEMS } from '../data/items.js';
import { STR } from './strings.js';
import { TOOL_ICON, ICON } from './icons.js';
import { shield } from './touch.js';
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
  let paused = false; // sinematik: HUD gizliyken ömür sayılmaz

  function retire(n) {
    const i = live.indexOf(n);
    if (i >= 0) live.splice(i, 1);
    clearTimeout(n.timer);
    n.el.classList.add('out');
    setTimeout(() => n.el.remove(), 300);
  }
  const arm = (n) => { clearTimeout(n.timer); n.timer = paused ? 0 : setTimeout(() => retire(n), LIFE_MS); };

  function text(n) {
    const name = (ITEMS[n.itemId] && ITEMS[n.itemId].name) || n.itemId;
    return STR.harvestNote(n.qty, name, n.mixed ? null : n.q);
  }

  return {
    push(p) {
      if (!p || !p.itemId || !(p.qty > 0)) return;
      pending.push(p);
    },
    /** Bekleyen (henüz çizilmemiş) hasat bildirimini al — ilk hasat kutlamasına devredilir. */
    claim(tileId) {
      for (let i = pending.length - 1; i >= 0; i--) {
        if (pending[i].tileId === tileId) return pending.splice(i, 1)[0];
      }
      return null;
    },
    /** Sinematik sırasında zamanlayıcıları dondur; bitince tam ömürle yeniden başlat. */
    setPaused(v) {
      v = !!v;
      if (v === paused) return;
      paused = v;
      for (const n of live) arm(n);
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

/**
 * İlk hasat kutlaması: letterbox'ın üstünde, HUD'dan bağımsız katmanda ortada zarif kart.
 * Sinematik sırasında da görünür (hud-layer dışında).
 */
const CELEB_MS = 3800;      // sinematik yoksa görünme süresi
const CINE_WAIT_MS = 6000;  // milestone'dan sonra sinematik bu sürede başlamazsa yine de göster
const CINE_TAIL_MS = 1000;  // sinematik bitince kartın kalma süresi
const CINE_MAX_MS = 9000;   // güvenlik: bitiş sinyali gelmezse kapat
export function createCelebration(root) {
  const el = h('div', 'celebrate', `<div class="cb-card glass"><span class="cb-ic"></span><div class="cb-tt"><div class="cb-k"></div><div class="cb-v num"></div><div class="cb-s"></div></div></div>`);
  el.setAttribute('aria-live', 'assertive');
  root.appendChild(el);
  const ic = el.querySelector('.cb-ic'), k = el.querySelector('.cb-k'), v = el.querySelector('.cb-v'), sub = el.querySelector('.cb-s');
  const card = el.querySelector('.cb-card');
  let pendingShow = null;
  let timer = 0;
  let waiting = null;   // sinematiği bekleyen yük
  let waitTimer = 0;
  let holding = false;  // sinematik boyunca açık
  let lastStartAt = 0;
  const hideIn = (ms) => { clearTimeout(timer); timer = setTimeout(() => { holding = false; el.classList.remove('show'); }, ms); };
  return {
    /** firstHarvest: yükü sakla; kart camera:cinematicStart{reason:'firstHarvest'} ile açılır (K16: sinematik ertelenebilir). */
    arm(p) {
      // Sinematik aynı olay zincirinde (milestone'dan önce) başlamış olabilir
      if (lastStartAt && performance.now() - lastStartAt < 500) {
        clearTimeout(waitTimer); waiting = null; pendingShow = p || {}; holding = true; return;
      }
      waiting = p || {};
      clearTimeout(waitTimer);
      waitTimer = setTimeout(() => {
        if (!waiting) return;
        pendingShow = waiting; waiting = null; holding = false;
      }, CINE_WAIT_MS);
    },
    onCinematicStart(p) {
      if (!p || p.reason !== 'firstHarvest') return;
      lastStartAt = performance.now();
      if (!waiting) return;
      clearTimeout(waitTimer);
      pendingShow = waiting; waiting = null; holding = true;
    },
    /** cinematic:letterbox {amount:0} → sinematik bitti: ~1 sn sonra kapan. */
    onLetterbox(p) {
      if (holding && !((Number(p && p.amount) || 0) > 0)) hideIn(CINE_TAIL_MS);
    },
    show(p) { pendingShow = p || {}; holding = false; },
    render() {
      if (!pendingShow) return;
      const p = pendingShow; pendingShow = null;
      const id = p.itemId || p.cropId;
      const name = (ITEMS[id] && ITEMS[id].name) || id || '';
      ic.innerHTML = id ? itemIcon(id) : TOOL_ICON.spark;
      setText(k, STR.firstHarvest);
      setText(v, p.qty > 0 ? STR.harvestNote(p.qty, name, p.quality) : name);
      setText(sub, STR.firstHarvestSub);
      card.dataset.q = p.quality || '';
      el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
      hideIn(holding ? CINE_MAX_MS : CELEB_MS);
    },
    destroy() { clearTimeout(timer); clearTimeout(waitTimer); el.remove(); },
  };
}
