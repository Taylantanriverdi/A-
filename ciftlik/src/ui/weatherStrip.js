// HUD saat kartının altında 3 günlük hava tahmini şeridi + aktif olay çipleri (PLAN §14). State'i yalnızca OKUR.
import { STR } from './strings.js';
import { WEATHER_ICON } from './icons.js';
import { h } from './frame.js';
import { shield } from './touch.js';

export function createWeatherStrip(root, ctx) {
  const { state } = ctx;
  const el = h('div', 'wx-strip glass');
  el.setAttribute('aria-label', STR.ev.forecast);
  shield(el);
  const chips = h('div', 'ev-chips');
  root.append(el, chips);
  let sig = '', chipSig = '';
  let dirty = true;

  function render() {
    if (!dirty) return;
    dirty = false;
    const fc = (state.weather && state.weather.forecast) || [];
    const s = fc.map((d) => d.type).join(',');
    if (s !== sig) {
      sig = s;
      el.hidden = fc.length === 0;
      el.innerHTML = fc.slice(0, 3).map((d, i) => {
        const fn = WEATHER_ICON[d.type] || WEATHER_ICON.clear;
        const label = i === 0 ? STR.ev.tomorrow : STR.ev.inDays(i + 1);
        return `<div class="wx-day" title="${STR.weather[d.type] || d.type}"><span class="wx-i">${fn(false)}</span><small>${label}</small></div>`;
      }).join('');
    }
    const act = (state.events && state.events.active) || [];
    const cs = act.map((a) => a.id).join('|');
    if (cs !== chipSig) {
      chipSig = cs;
      chips.innerHTML = act.map((a) => `<span class="ev-chip k-${a.kind}">${STR.ev.chip[a.kind] || a.kind}</span>`).join('');
    }
  }
  return { el, render, markDirty() { dirty = true; }, destroy() { el.remove(); chips.remove(); } };
}
