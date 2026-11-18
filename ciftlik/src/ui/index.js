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
  const ctx = { state, bus, calendar };
  const offs = [];
  const on = (n, fn) => offs.push(bus.on(n, fn));

  // Katmanlar: üst HUD ve alt HUD letterbox'ta solar; toast + panel solmaz
  const top = h('div', 'hud-layer hud-top');
  const bottom = h('div', 'hud-layer hud-bottom');
  root.append(top, bottom);

  const clock = createClock(top, ctx);
  const money = createMoney(top, ctx);
  const speed = createSpeed(bottom, ctx);
  const toasts = createToasts(root); // panelden önce: açık modal toast'ların üstünde kalır
  const settings = createSettings(root, ctx, money.el);

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
  if (debug) on('fps', (p) => { if (p && typeof p.fps === 'number') fpsPending = p.fps; });

  const loop = createFrameLoop();
  loop.add(clock.render);
  loop.add(money.render);
  loop.add(speed.render);
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

  // Klavye
  const onKey = (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;
    if (e.key === 'Escape') {
      if (settings.isOpen) { settings.close(); e.preventDefault(); }
      return;
    }
    if (settings.isOpen) return; // panel açıkken oyun kısayolları kapalı
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault(); // odaktaki düğmenin "tıklanmasını" da engeller
      if (!e.repeat) speed.togglePause();
      return;
    }
    if (e.repeat) return;
    const map = { Digit1: 1, Digit2: 2, Digit3: 4, Numpad1: 1, Numpad2: 2, Numpad3: 4 };
    const s = map[e.code] ?? ({ 1: 1, 2: 2, 3: 4 })[e.key];
    if (s) { e.preventDefault(); speed.setSpeed(s); }
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
      money.destroy(); settings.destroy(); toasts.destroy();
      root.innerHTML = '';
      root.classList.remove('cinematic');
    },
  };
}

export default mountUI;
