// Hız kontrolleri (⏸ ▶ ⏩ ⏭) ve gece "Sabaha geç" düğmesi.
import { SPEEDS, MIN_PER_DAY } from '../core/constants.js';
import { STR } from './strings.js';
import { ICON } from './icons.js';
import { h } from './frame.js';
import { shield, tap } from './touch.js';

const SPEED_ICON = { 0: ICON.pause, 1: ICON.play, 2: ICON.fast, 4: ICON.faster };

export function createSpeed(root, ctx) {
  const { state, bus } = ctx;
  const wrap = h('div', 'hud-speed');
  const sleep = h('button', 'sleep-btn glass interactive', `<span class="ic">${ICON.bed}</span><span>${STR.sleep}</span>`);
  sleep.type = 'button';
  sleep.title = STR.sleepHint;
  sleep.setAttribute('aria-hidden', 'true');
  sleep.tabIndex = -1;
  const bar = h('div', 'speedbar glass interactive');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', STR.speedGroup);
  const btns = new Map();
  for (const s of SPEEDS) {
    const b = h('button', '', `<span class="ic">${SPEED_ICON[s] || ICON.play}</span>`);
    b.type = 'button';
    b.title = STR.speed[s] || `${s}x`;
    b.setAttribute('aria-label', b.title);
    b.dataset.speed = String(s);
    tap(b, () => api.setSpeed(s));
    btns.set(s, b);
    bar.appendChild(b);
  }
  tap(sleep, () => { if (sleepShown) bus.emit('time:sleep', {}); });
  shield(sleep); shield(bar);
  wrap.append(sleep, bar);
  root.appendChild(wrap);

  let current = state.time.speed;
  let lastNonZero = current > 0 ? current : 1;
  let shownSpeed = null;
  let sleepShown = false;
  let lastHour = -1;

  const api = {
    el: wrap,
    setSpeed(s) {
      if (s > 0) lastNonZero = s;
      bus.emit('time:speed', { speed: s });
    },
    togglePause() {
      const cur = state.time.speed;
      if (cur > 0) { lastNonZero = cur; api.setSpeed(0); } else api.setSpeed(lastNonZero || 1);
    },
    onSpeedChanged(p) {
      if (p && typeof p.speed === 'number') {
        current = p.speed;
        if (current > 0) lastNonZero = current;
      }
    },
    render() {
      // Olay gelmezse state'ten yakala (TimeSystem state.time.speed'i yazar)
      const sv = state.time.speed;
      if (sv !== current) { current = sv; if (sv > 0) lastNonZero = sv; }
      if (current !== shownSpeed) {
        shownSpeed = current;
        for (const [s, b] of btns) {
          const on = s === current;
          b.classList.toggle('on', on);
          b.classList.toggle('paused', on && s === 0);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
      }
      const tm = state.time.totalMinutes;
      const hr = Math.floor((((tm % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY) / 60); // ayırma yapmadan
      if (hr !== lastHour) {
        lastHour = hr;
        const show = hr >= 22 || hr < 6;
        if (show !== sleepShown) {
          sleepShown = show;
          sleep.classList.toggle('show', show);
          sleep.setAttribute('aria-hidden', show ? 'false' : 'true');
          sleep.tabIndex = show ? 0 : -1;
        }
      }
    },
  };
  return api;
}
