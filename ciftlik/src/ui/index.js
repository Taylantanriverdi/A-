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
import { createHarvestNotes, createXp } from './notes.js';

const FAIL_REPEAT_MS = 1500; // boyama sırasında aynı hata nedenini tekrar gösterme
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
  let lastTileTap = 0;
  on('tile:tap', (p) => {
    if (!p) return;
    const id = p.tileId != null ? p.tileId : (p.tx != null ? `${p.tx},${p.ty}` : null);
    if (toolbar.tool === 'hand') { lastTileTap = performance.now(); card.show(id); }
    else toolbar.apply(id); // boyama: tek emit, DOM işi yok
  });
  on('inventory:changed', toolbar.markInventory);
  on('time:day', toolbar.markSeason);
  on('time:season', toolbar.markSeason);
  on('farm:changed', card.onFarmChanged);
  on('time:hour', card.markDirty);
  on('farm:harvested', notes.push);
  on('xp:gained', xp.onGained);
  const failAt = new Map();
  on('farm:result', (p) => {
    if (!p || p.ok !== false || !p.reason) return;
    const now = performance.now();
    const t = failAt.get(p.reason);
    if (t !== undefined && now - t < FAIL_REPEAT_MS) return;
    failAt.set(p.reason, now);
    toasts.push({ text: p.reason, kind: 'bad' });
  });

  // Kart açıkken canvas'a "dokunup bırakma" (sürüklemesiz) ve ardından karo dokunuşu gelmezse → kapat
  let downX = 0, downY = 0, downOnWorld = false, outsideTimer = 0;
  const isWorld = (t) => !!(t && !root.contains(t));
  const onDown = (e) => {
    downOnWorld = card.isOpen && isWorld(e.target);
    downX = e.clientX; downY = e.clientY;
  };
  const onUp = (e) => {
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

  if (debug) on('fps', (p) => { if (p && typeof p.fps === 'number') fpsPending = p.fps; });

  const loop = createFrameLoop();
  loop.add(clock.render);
  loop.add(money.render);
  loop.add(speed.render);
  loop.add(toolbar.render);
  loop.add(card.render);
  loop.add(notes.render);
  loop.add(xp.render);
  loop.add(() => {
    if (letterboxPending) {
      const p = letterboxPending; letterboxPending = null;
      const ms = Math.max(150, Math.min(2000, Number(p.duration) || 600));
      root.style.setProperty('--fade-ms', `${ms}ms`);
      root.classList.toggle('cinematic', (Number(p.amount) || 0) > 0);
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
      clearTimeout(outsideTimer);
      toolbar.destroy(); notes.destroy(); xp.destroy();
      money.destroy(); settings.destroy(); toasts.destroy();
      root.innerHTML = '';
      root.classList.remove('cinematic');
    },
  };
}

export default mountUI;
