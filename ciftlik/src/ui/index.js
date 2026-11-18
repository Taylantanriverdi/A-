// DOM UI kökü — PLAN.md §7 "UI API".
// UI state'i yalnızca OKUR; tüm eylemler EventBus komutu olarak gider.
import './styles.css';
import { calendar as defaultCalendar } from '../core/timeUtils.js';
import { STR } from './strings.js';
import { createFrameLoop, h, setText } from './frame.js';
import { createClock, createMoney } from './hud.js';
import { createSpeed } from './speed.js';
import { createSettings } from './settings.js';
import { createToasts } from './toast.js';
import { createToolbar } from './toolbar.js';
import { createTileCard } from './tileCard.js';
import { createHarvestNotes, createXp, createCelebration } from './notes.js';
import { blockedKind, BLOCK_LABELS_TR } from '../data/land.js';

const STROKE_GAP_MS = 400; // parmak/fare basılı değilken son tile:tap'ten bu kadar sonra yeni fırça darbesi
const CARD_OUTSIDE_MS = 450; // dışarı dokunma ile yeni karo dokunuşunu ayırt etme penceresi

const isTypingTarget = (t) => {
  if (!t || t === document.body) return false;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return true;
  if (tag === 'INPUT') {
    const type = (t.type || '').toLowerCase();
    return type !== 'button' && type !== 'checkbox' && type !== 'radio';
  }
  return false;
};

/**
 * @param {{state:object, bus:import('../core/EventBus.js').default, calendar?:Function, debug?:boolean}} opts
 * @returns {{destroy():void}}
 */
export function mountUI({ state, bus, calendar = defaultCalendar, debug = false }) {
  const root = document.getElementById('ui');
  if (!root) { console.warn('[ui] #ui kökü yok'); return { destroy() {} }; }
  root.innerHTML = '';
  root.lang = 'tr';
  const ctx = { state, bus, calendar, now: () => calendar(state.time.totalMinutes) };
  const offs = [];
  const on = (n, fn) => offs.push(bus.on(n, fn));

  // Katmanlar: üst HUD ve alt HUD letterbox'ta solar; toast + panel solmaz
  const top = h('div', 'hud-layer hud-top');
  const bottom = h('div', 'hud-layer hud-bottom');
  root.append(top, bottom);

  const left = h('div', 'hud-left');
  top.appendChild(left);
  const clock = createClock(left, ctx);
  const xp = createXp(left, ctx);
  const money = createMoney(top, ctx);
  const speed = createSpeed(bottom, ctx);
  const toolbar = createToolbar(bottom, ctx);
  const card = createTileCard(root, ctx);
  const notes = createHarvestNotes(bottom);
  const celebrate = createCelebration(root); // HUD katmanı dışında: sinematikte de görünür
  const toasts = createToasts(root); // panelden önce: açık modal toast'ların üstünde kalır
  const settings = createSettings(root, ctx, money.el);
  toolbar.onToolChange = (t) => { if (t !== 'hand') card.close(); };

  // FPS (debug)
  let fpsEl = null, fpsVal = null, fpsPending = -1, fpsCls = '';
  if (debug) {
    fpsEl = h('div', 'fps glass num', `${STR.fps} <b>--</b>`);
    fpsVal = fpsEl.querySelector('b');
    bottom.appendChild(fpsEl);
  }

  // Sinematik letterbox → HUD solar
  let letterboxPending = null;

  // Olaylar: yalnızca işaretle, yazım kare döngüsünde
  on('time:minute', clock.markDirty);
  on('time:day', clock.markDirty);
  on('weather:changed', clock.markDirty);
  on('money:changed', money.onMoney);
  on('save:done', money.onSaved);
  on('time:speedChanged', speed.onSpeedChanged);
  on('settings:quality', settings.onQuality);
  on('toast', toasts.push);
  on('cinematic:letterbox', (p) => { letterboxPending = p || { amount: 0 }; });

  // ---- Tarım (Aşama 2) ----
  // Fırça darbesi: dünyada yeni bir basış ya da (basılı değilken) 400 ms ara → yeni darbe.
  // Ret toast'ları darbe başına neden başına bir kez gösterilir (yavaş boyamada tekrar yok).
  let lastTileTap = 0;
  let stroke = 0, strokeSeenSeq = -1, downSeq = 0, pointerHeld = false;
  const strokeReasons = new Set();
  const blockedLabel = (id, p) => {
    const k = (p && p.blocked) || blockedKind(id);
    return k ? (BLOCK_LABELS_TR[k] || String(k)) : null;
  };
  on('tile:tap', (p) => {
    if (!p) return;
    const id = p.tileId != null ? p.tileId : (p.tx != null ? `${p.tx},${p.ty}` : null);
    const now = performance.now();
    if (downSeq !== strokeSeenSeq || (!pointerHeld && now - lastTileTap > STROKE_GAP_MS)) {
      strokeSeenSeq = downSeq; stroke++; strokeReasons.clear();
    }
    lastTileTap = now;
    if (toolbar.tool === 'hand') {
      const lbl = id != null ? blockedLabel(id) : null;
      if (lbl) {
        card.close();
        if (!strokeReasons.has(lbl)) { strokeReasons.add(lbl); toasts.push({ text: lbl, kind: 'info' }); }
        return;
      }
      card.show(id);
    } else toolbar.apply(id, stroke); // boyama: tek emit, DOM işi yok
  });
  on('inventory:changed', toolbar.markInventory);
  on('time:day', toolbar.markSeason);
  on('time:season', toolbar.markSeason);
  on('farm:changed', card.onFarmChanged);
  on('time:hour', card.markDirty);
  on('farm:harvested', notes.push);
  on('farm:milestone', (p) => {
    if (!p || p.kind !== 'firstHarvest') return;
    const h0 = notes.claim(p.tileId); // aynı hasadın küçük notu yerine büyük kutlama kartı
    celebrate.show(h0 || { cropId: p.cropId, itemId: p.cropId });
  });
  on('xp:gained', xp.onGained);
  on('farm:result', (p) => {
    if (!p || p.ok !== false || !p.reason) return;
    const r = String(p.reason);
    if (strokeReasons.has(r)) return;
    strokeReasons.add(r);
    toasts.push({ text: r, kind: 'bad' });
  });

  // Kart açıkken canvas'a "dokunup bırakma" (sürüklemesiz) ve ardından karo dokunuşu gelmezse → kapat
  let downX = 0, downY = 0, downOnWorld = false, outsideTimer = 0;
  const isWorld = (t) => !!(t && !root.contains(t));
  const onDown = (e) => {
    if (isWorld(e.target)) { downSeq++; pointerHeld = true; }
    downOnWorld = card.isOpen && isWorld(e.target);
    downX = e.clientX; downY = e.clientY;
  };
  const onUp = (e) => {
    if (e.isPrimary !== false) pointerHeld = false;
    if (!downOnWorld || !card.isOpen) return;
    downOnWorld = false;
    if (Math.abs(e.clientX - downX) > 8 || Math.abs(e.clientY - downY) > 8) return; // kaydırma
    const upAt = performance.now();
    clearTimeout(outsideTimer);
    outsideTimer = setTimeout(() => {
      if (lastTileTap < upAt - CARD_OUTSIDE_MS) card.close();
    }, 140);
  };
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointerup', onUp, true);
  const onCancel = () => { pointerHeld = false; };
  window.addEventListener('pointercancel', onCancel, true);

  if (debug) on('fps', (p) => { if (p && typeof p.fps === 'number') fpsPending = p.fps; });

  const loop = createFrameLoop();
  loop.add(clock.render);
  loop.add(money.render);
  loop.add(speed.render);
  loop.add(toolbar.render);
  loop.add(card.render);
  loop.add(notes.render);
  loop.add(celebrate.render);
  loop.add(xp.render);
  loop.add(() => {
    if (letterboxPending) {
      const p = letterboxPending; letterboxPending = null;
      const ms = Math.max(150, Math.min(2000, Number(p.duration) || 600));
      root.style.setProperty('--fade-ms', `${ms}ms`);
      const cin = (Number(p.amount) || 0) > 0;
      root.classList.toggle('cinematic', cin);
      notes.setPaused(cin); // HUD gizliyken hasat notlarının ömrü işlemez
    }
    if (fpsPending >= 0) {
      const f = Math.round(fpsPending); fpsPending = -1;
      setText(fpsVal, String(f));
      const cls = f < 30 ? 'low' : f < 50 ? 'warn' : '';
      if (cls !== fpsCls) { fpsEl.classList.remove('low', 'warn'); if (cls) fpsEl.classList.add(cls); fpsCls = cls; }
    }
  });
  loop.start();
  toolbar.init(); // açılışta 'hand'

  // Klavye
  const onKey = (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (settings.isOpen) settings.close();
      else if (toolbar.isPickerOpen) toolbar.closePicker();
      else if (card.isOpen) card.close();
      else toolbar.select('hand');
      return;
    }
    if (settings.isOpen) return; // panel açıkken oyun kısayolları kapalı
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault(); // odaktaki düğmenin "tıklanmasını" da engeller
      if (!e.repeat) speed.togglePause();
      return;
    }
    if (e.repeat) return;
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code || '');
    const d = m ? Number(m[1]) : 0;
    if (!d) return;
    if (e.shiftKey) {
      // Hız: Shift+1/2/3
      const s = ({ 1: 1, 2: 2, 3: 4 })[d];
      if (s) { e.preventDefault(); speed.setSpeed(s); }
    } else if (d <= 8) {
      e.preventDefault();
      toolbar.selectIndex(d - 1);
    }
  };
  // Boşluk tuşu odaktaki düğmede keyup ile "click" üretir; onu da bastır
  const onKeyUp = (e) => {
    if ((e.code === 'Space' || e.key === ' ') && !isTypingTarget(e.target) && !settings.isOpen
        && e.target && e.target.tagName === 'BUTTON') e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);

  return {
    destroy() {
      loop.stop();
      for (const off of offs) off();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      clearTimeout(outsideTimer);
      toolbar.destroy(); notes.destroy(); xp.destroy(); celebrate.destroy();
      money.destroy(); settings.destroy(); toasts.destroy();
      root.innerHTML = '';
      root.classList.remove('cinematic');
    },
  };
}

export default mountUI;
