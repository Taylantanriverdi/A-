// WeatherSystem — günlük hava, tahmin, gün içi değişim, birikinti/ıslaklık/kar örtüsü (PLAN.md §14). Phaser import ETMEZ.
// state.weather = { type, intensity, wind, forecast:[{type,intensity,wind}]×3, puddles, snowCover, wetness, changeAtMin }
// Olaylar: weather:changed {type, intensity, wind}; hazard:crops / hazard:animals (fırtına başlarken; Farm/Animal işler).
// Dinler: weather:set {type} (debug), weather:force {type} (EventSystem: dolu). Rastgelelik yalnızca ctx.rng.
import {
  WEATHER_TYPES, SEASON_WEATHER, WIND, INTENSITY, PERSISTENCE, FORECAST_DAYS, INTRADAY_CHANGE, EFFECTS,
} from '../data/weather.js';
import { MIN_PER_DAY, DAYS_PER_SEASON, SEASONS } from '../core/constants.js';
import { calendar } from '../core/timeUtils.js';
import { createRng } from '../core/Rng.js';
import { isPlainObject } from '../core/GameState.js';
import { evActive } from './events/mods.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const WET_RISE = EFFECTS.rain.puddlePerHour * 2.5; // ıslaklık yağmurda puddle'dan hızlı artar, aynı hızda kurur
const WET_DRY = EFFECTS.rain.dryPerHour;

let regRef = null;
let fallbackRng = null;
let offs = [];

function rngOf(state) {
  const r = regRef?.ctx?.rng;
  if (r) return r;
  if (!fallbackRng) fallbackRng = createRng(state);
  return fallbackRng;
}

/** Mevsim dağılımından tür seçer; `prev` verilirse PERSISTENCE ile aynı gün tekrarı; noRain: yağmur/fırtına yerine bulutlu/açık. */
export function pickType(rng, season, prev, noRain = false, exclude = null) {
  let t = null;
  if (prev && prev !== exclude && rng.next() < PERSISTENCE && (SEASON_WEATHER[season][prev] || 0) > 0) t = prev;
  if (t === null) {
    const dist = SEASON_WEATHER[season];
    let tot = 0;
    for (const k of WEATHER_TYPES) if (k !== exclude) tot += dist[k] || 0;
    let r = rng.next() * tot;
    t = 'clear';
    for (const k of WEATHER_TYPES) {
      if (k === exclude) continue;
      const w = dist[k] || 0;
      if (w <= 0) continue;
      if (r < w) { t = k; break; }
      r -= w;
    }
  }
  if (noRain && (t === 'rain' || t === 'storm')) t = rng.next() < 0.5 ? 'clear' : 'cloudy';
  return t;
}

/** Tür için yoğunluk + rüzgâr üretir. */
export function makeDay(rng, type) {
  const [i0, i1] = INTENSITY[type] || [0, 0];
  const [w0, w1] = WIND[type] || [0.1, 0.3];
  return { type, intensity: round2(i0 + (i1 - i0) * rng.next()), wind: round2(w0 + (w1 - w0) * rng.next()) };
}
const round2 = (v) => Math.round(v * 100) / 100;

function seasonOfDayIndex(dayIndex) { return SEASONS[Math.floor(dayIndex / DAYS_PER_SEASON) % 4]; }

/** Tahmini FORECAST_DAYS güne tamamlar (bugün = state.time günü). */
function fillForecast(state, rng) {
  const w = state.weather;
  const today = Math.floor(state.time.totalMinutes / MIN_PER_DAY);
  const noRain = evActive(state, 'drought');
  while (w.forecast.length < FORECAST_DAYS) {
    const k = w.forecast.length + 1; // bugünden k gün sonra
    const prev = w.forecast.length ? w.forecast[w.forecast.length - 1].type : w.type;
    w.forecast.push(makeDay(rng, pickType(rng, seasonOfDayIndex(today + k), prev, noRain)));
  }
}

function emitChanged(bus, w) { bus.emit('weather:changed', { type: w.type, intensity: w.intensity, wind: w.wind }); }

/** Havayı ayarlar; fırtınaya geçişte hasar isteği yayar. */
function applyWeather(state, bus, rng, day, { storm = true } = {}) {
  const w = state.weather;
  const was = w.type;
  w.type = day.type; w.intensity = day.intensity; w.wind = day.wind;
  emitChanged(bus, w);
  if (storm && w.type === 'storm' && was !== 'storm') {
    const e = EFFECTS.storm;
    bus.emit('hazard:crops', { chance: e.cropDamageChance, damage: e.cropDamage, source: 'storm' });
    bus.emit('hazard:animals', { happiness: e.animalHappiness, source: 'storm' });
  }
}

function dailyRoll(state, bus, rng) {
  const w = state.weather;
  fillForecast(state, rng);
  const next = w.forecast.shift();
  const noRain = evActive(state, 'drought');
  if (noRain && (next.type === 'rain' || next.type === 'storm')) Object.assign(next, makeDay(rng, 'cloudy'));
  fillForecast(state, rng);
  applyWeather(state, bus, rng, next);
  w.changeAtMin = null;
  if (rng.next() < INTRADAY_CHANGE) {
    const dayStart = Math.floor(state.time.totalMinutes / MIN_PER_DAY) * MIN_PER_DAY;
    w.changeAtMin = dayStart + rng.int(12, 17) * 60;
  }
}

function hourlyEnv(state, now) {
  const w = state.weather;
  const t = w.type;
  const wet = t === 'rain' || t === 'storm';
  if (wet) {
    w.puddles += EFFECTS.rain.puddlePerHour * (0.5 + w.intensity);
    w.wetness += WET_RISE * (0.5 + w.intensity);
  } else {
    w.puddles -= EFFECTS.rain.dryPerHour;
    w.wetness -= WET_DRY * (t === 'clear' ? 1 : 0.5) * 0.5;
  }
  if (t === 'snow') w.wetness += EFFECTS.rain.puddlePerHour * 0.5;
  if (now.season === 'winter') w.puddles = 0; // kışta göl/birikinti yok
  const S = EFFECTS.snow;
  if (t === 'snow') w.snowCover += S.snowCoverPerHour * (0.5 + w.intensity);
  else if (w.snowCover > 0) w.snowCover -= S.meltPerHour * (now.season === 'winter' ? (t === 'clear' ? 0.5 : 0.25) : 3);
  w.puddles = clamp(w.puddles, 0, 1);
  w.wetness = clamp(w.wetness, 0, 1);
  w.snowCover = clamp(w.snowCover, 0, 1);
}

function onHour(state, bus, ctx) {
  const w = state.weather;
  const rng = rngOf(state);
  const now = ctx.now;
  if (now.hour === 5) dailyRoll(state, bus, rng);
  else if (isNum(w.changeAtMin) && state.time.totalMinutes >= w.changeAtMin) {
    w.changeAtMin = null;
    const season = now.season;
    const t = pickType(rng, season, null, evActive(state, 'drought'), w.type);
    applyWeather(state, bus, rng, makeDay(rng, t));
  }
  hourlyEnv(state, now);
}

/** Kayıt doğrulayıcı. */
export function validate(state, onFix = () => {}) {
  if (!isPlainObject(state.weather)) { onFix('weather'); state.weather = {}; }
  const w = state.weather;
  if (!WEATHER_TYPES.includes(w.type)) { onFix('weather.type'); w.type = 'clear'; }
  const num = (k, def, lo, hi) => { if (!isNum(w[k])) { if (k in w) onFix(`weather.${k}`); w[k] = def; } else { const c = clamp(w[k], lo, hi); if (c !== w[k]) onFix(`weather.${k}`); w[k] = c; } };
  num('intensity', w.type === 'clear' ? 0 : 0.6, 0, 1);
  num('wind', 0.2, 0, 1);
  num('puddles', 0, 0, 1); num('wetness', 0, 0, 1); num('snowCover', 0, 0, 1);
  if (w.changeAtMin !== null && !isNum(w.changeAtMin)) { if ('changeAtMin' in w) onFix('weather.changeAtMin'); w.changeAtMin = null; }
  if (w.changeAtMin === undefined) w.changeAtMin = null;
  if (!Array.isArray(w.forecast)) { if ('forecast' in w) onFix('weather.forecast'); w.forecast = []; }
  const f = w.forecast.filter((d) => isPlainObject(d) && WEATHER_TYPES.includes(d.type)).map((d) => ({
    type: d.type, intensity: isNum(d.intensity) ? clamp(d.intensity, 0, 1) : 0.5, wind: isNum(d.wind) ? clamp(d.wind, 0, 1) : 0.2,
  }));
  if (f.length !== w.forecast.length) onFix('weather.forecast');
  w.forecast = f.slice(0, FORECAST_DAYS);
  return state;
}

/** debug / olay: havayı doğrudan ayarla. */
function setType(state, bus, type, storm) {
  if (!WEATHER_TYPES.includes(type)) return false;
  applyWeather(state, bus, rngOf(state), makeDay(rngOf(state), type), { storm });
  state.weather.changeAtMin = null;
  return true;
}

const WeatherSystem = {
  id: 'weather',
  validate,
  pickType,
  makeDay,
  init(state, bus, registry) {
    for (const off of offs) off();
    offs = [];
    regRef = registry || null;
    fallbackRng = null;
    validate(state, () => {});
    fillForecast(state, rngOf(state));
    offs.push(bus.on('weather:set', (p) => { setType(state, bus, String(p?.type), true); }));
    offs.push(bus.on('weather:force', (p) => { if (p && state.weather.type !== p.type) setType(state, bus, String(p.type), false); }));
    offs.push(bus.on('event:started', (p) => {
      if (!p || p.kind !== 'drought') return; // kuraklık: yağmur çıkmaz — bugünü ve tahmini kuruya çevir
      const w = state.weather, rng = rngOf(state);
      const fix = (d) => { if (d.type === 'rain' || d.type === 'storm') Object.assign(d, makeDay(rng, 'cloudy')); };
      if (w.type === 'rain' || w.type === 'storm') setType(state, bus, 'cloudy', false);
      for (const d of w.forecast) fix(d);
    }));
  },
  onHour,
};

export default WeatherSystem;
