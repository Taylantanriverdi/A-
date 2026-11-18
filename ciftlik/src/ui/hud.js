// HUD: sol üst saat/takvim/hava kartı, sağ üst para + kayıt işareti.
import { SEASON_NAMES_TR } from '../core/constants.js';
import { STR } from './strings.js';
import { WEATHER_ICON, ICON } from './icons.js';
import { h, setText } from './frame.js';
import { shield } from './touch.js';

const nf = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
export const formatMoney = (n) => `${nf.format(Math.round(n))} ${STR.currency}`;
const formatDelta = (n) => `${n >= 0 ? '+' : '−'}${nf.format(Math.abs(Math.round(n)))} ${STR.currency}`;

/** Gündüz: 06:00–18:59 */
import { SUN } from '../data/palette.js';
// Gece/gündüz, güneş modeliyle aynı kaynaktan (palette.SUN): doğuş 06:00, batış 20:00.
export const isNightHour = (hr) => hr < SUN.rise || hr >= SUN.set;

// Gün yayı geometrisi (viewBox 0 0 60 34): merkez (30,30), yarıçap 24
const ARC_CX = 30, ARC_CY = 30, ARC_R = 24;

export function createClock(root, ctx) {
  const { state, calendar } = ctx;
  const el = h('div', 'hud-clock glass interactive');
  el.innerHTML = `
    <div class="wx"></div>
    <div class="tblock">
      <div class="time num">06:00</div>
      <div class="date"><span class="dl"></span><span class="sep2"> · </span><span class="wxname"></span></div>
    </div>
    <div class="arc" aria-hidden="true">
      <svg viewBox="0 0 60 34">
        <path class="track" d="M${ARC_CX - ARC_R} ${ARC_CY} A${ARC_R} ${ARC_R} 0 0 1 ${ARC_CX + ARC_R} ${ARC_CY}"/>
        <line class="horizon" x1="2" y1="${ARC_CY}" x2="58" y2="${ARC_CY}"/>
        <g class="orb"><circle class="glow" r="7.5"/><circle class="body" r="4.2"/></g>
      </svg>
    </div>`;
  shield(el);
  root.appendChild(el);

  const tEl = el.querySelector('.time');
  const dEl = el.querySelector('.dl');
  const wNameEl = el.querySelector('.wxname');
  const wxEl = el.querySelector('.wx');
  const orb = el.querySelector('.orb');
  const orbBody = el.querySelector('.orb .body');
  const orbGlow = el.querySelector('.orb .glow');

  let dirty = true;
  let lastMinuteKey = -1;
  let lastDay = -1;
  let lastWx = '';
  let lastOrb = '';
  let lastNight = null;

  const markDirty = () => { dirty = true; };

  function render() {
    const tm = state.time.totalMinutes;
    const minuteKey = Math.floor(tm);
    const wx = (state.weather && state.weather.type) || 'clear';
    // Olay gelmese bile (ör. debug setTime) ucuz bir karşılaştırma ile yakala
    if (!dirty && minuteKey === lastMinuteKey && wx === lastWx) return;
    dirty = false;
    const c = calendar(tm);
    const night = isNightHour(c.hour);

    if (minuteKey !== lastMinuteKey) {
      lastMinuteKey = minuteKey;
      setText(tEl, `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`);
      if (c.day !== lastDay) {
        lastDay = c.day;
        setText(dEl, STR.dateLine(SEASON_NAMES_TR[c.season] || c.season, c.dayOfSeason, c.year));
      }
      // Gün yayı: güneş 06→19, ay 19→06
      const hf = c.hour + c.minute / 60;
      let t;
      if (!night) t = (hf - 6) / 13;
      else t = (((hf - 19) + 24) % 24) / 11;
      const a = Math.PI - t * Math.PI;
      const x = (ARC_CX + Math.cos(a) * ARC_R).toFixed(1);
      const y = (ARC_CY - Math.sin(a) * ARC_R).toFixed(1);
      const key = `${x},${y}`;
      if (key !== lastOrb) { lastOrb = key; orb.setAttribute('transform', `translate(${x} ${y})`); }
    }
    if (night !== lastNight) {
      lastNight = night;
      const col = night ? '#dfe6ff' : '#f7c65a';
      orbBody.setAttribute('fill', col);
      orbGlow.setAttribute('fill', col);
      el.title = night ? STR.night : STR.day;
      lastWx = ''; // ikon gece/gündüz değişince yenilensin
    }
    if (wx !== lastWx) {
      lastWx = wx;
      const fn = WEATHER_ICON[wx] || WEATHER_ICON.clear;
      wxEl.innerHTML = fn(night);
      setText(wNameEl, STR.weather[wx] || wx);
    }
  }

  return { el, render, markDirty };
}

export function createMoney(root, ctx) {
  const { state } = ctx;
  const wrap = h('div', 'hud-right');
  const el = h('div', 'money glass interactive');
  el.innerHTML = `<span class="coin">${ICON.coin}</span><span class="val num"></span><span class="saved"><i></i>${STR.saved}</span>`;
  shield(el);
  wrap.appendChild(el);
  root.appendChild(wrap);
  const valEl = el.querySelector('.val');
  const savedEl = el.querySelector('.saved');

  let shown = state.finance.money;
  let target = shown;
  let from = shown, t0 = 0, dur = 0;
  let animating = false;
  let lastText = '';
  let flashTimer = 0;
  let pendingDeltas = [];
  let savedPending = false;
  const MAX_FLOATS = 4;
  let floats = 0;

  function setTarget(v, now) {
    if (v === target) return;
    from = shown; target = v; t0 = now; animating = true;
    const diff = Math.abs(target - from);
    dur = Math.min(1100, 380 + Math.log10(diff + 1) * 160);
  }

  function onMoney(p) {
    if (!p) return;
    const amount = Number(p.amount) || 0;
    if (amount !== 0) pendingDeltas.push(amount);
    if (typeof p.balance === 'number') setTarget(p.balance, performance.now());
  }
  function onSaved() { savedPending = true; }

  function render(now) {
    // state ile senkron (olay kaçırılırsa)
    const sv = state.finance.money;
    if (sv !== target && !animating) setTarget(sv, now);

    if (animating) {
      const k = dur > 0 ? Math.min(1, (now - t0) / dur) : 1;
      const e = 1 - Math.pow(1 - k, 3);
      shown = from + (target - from) * e;
      if (k >= 1) { shown = target; animating = false; }
    }
    const txt = formatMoney(shown);
    if (txt !== lastText) { lastText = txt; valEl.textContent = txt; }

    if (pendingDeltas.length) {
      // Aynı karedeki değişimleri tek bir yüzen etikette topla
      let sum = 0;
      for (let i = 0; i < pendingDeltas.length; i++) sum += pendingDeltas[i];
      pendingDeltas.length = 0;
      if (sum !== 0) {
        el.classList.toggle('up', sum > 0);
        el.classList.toggle('down', sum < 0);
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => el.classList.remove('up', 'down'), 700);
        if (floats < MAX_FLOATS) {
          floats++;
          const d = h('span', `delta num ${sum > 0 ? 'pos' : 'neg'}`);
          d.textContent = formatDelta(sum);
          d.addEventListener('animationend', () => { d.remove(); floats--; }, { once: true });
          el.appendChild(d);
        }
      }
    }
    if (savedPending) {
      savedPending = false;
      savedEl.classList.remove('on');
      void savedEl.offsetWidth; // animasyonu yeniden başlat
      savedEl.classList.add('on');
    }
  }

  return { el: wrap, render, onMoney, onSaved, destroy() { clearTimeout(flashTimer); } };
}
