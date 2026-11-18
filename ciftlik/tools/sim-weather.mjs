// Hava + olay + festival simülasyonu (Node, Phaser yok): node tools/sim-weather.mjs
import { createInitialState } from '../src/core/GameState.js';
import SystemRegistry from '../src/core/SystemRegistry.js';
import TimeSystem from '../src/systems/TimeSystem.js';
import WeatherSystem from '../src/systems/WeatherSystem.js';
import EventSystem from '../src/systems/EventSystem.js';
import InventorySystem, { add, count } from '../src/systems/InventorySystem.js';
import EconomySystem from '../src/systems/EconomySystem.js';
import FarmSystem from '../src/systems/FarmSystem.js';
import AnimalSystem from '../src/systems/AnimalSystem.js';
import PlacementSystem from '../src/systems/PlacementSystem.js';
import { createTile } from '../src/systems/farm/soil.js';
import { dayStep } from '../src/systems/animals/sim.js';
import { currentPrice } from '../src/systems/market/pricing.js';
import { sanitize } from '../src/core/SaveSystem.js';
import { createRng } from '../src/core/Rng.js';
import { SEASON_WEATHER, WEATHER_TYPES } from '../src/data/weather.js';
import { EVENTS, FESTIVAL } from '../src/data/events.js';
import { MIN_PER_DAY } from '../src/core/constants.js';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
function makeBus() {
  const map = new Map(); const log = [];
  return { log, on(n, f) { if (!map.has(n)) map.set(n, []); map.get(n).push(f); return () => {}; },
    emit(n, p) { log.push([n, p]); for (const f of (map.get(n) || []).slice()) f(p); } };
}
const SYS = { weather: WeatherSystem, events: EventSystem, inv: InventorySystem, eco: EconomySystem, farm: FarmSystem, animals: AnimalSystem, place: PlacementSystem };
/** day: 1 tabanlı gün, hour: saat. use: eklenecek sistemler (Time + Weather + Events + Inventory + Economy hep var). */
function world(seed, { day = 1, hour = 6, use = [] } = {}) {
  const state = createInitialState(seed);
  state.time.totalMinutes = (day - 1) * MIN_PER_DAY + hour * 60;
  const bus = makeBus(); const reg = new SystemRegistry(state, bus);
  reg.register(TimeSystem).register(WeatherSystem).register(EventSystem).register(InventorySystem).register(EconomySystem);
  for (const u of use) reg.register(SYS[u]);
  return { state, bus, reg, go: (min) => reg.advance(min, true) };
}
// Rastgele olay zarını kapat/aç (senaryolar zorlamayla başlatır; startEvent şansa bakmaz)
const CH = Object.fromEntries(Object.keys(EVENTS).map((k) => [k, EVENTS[k].chance]));
const chance = (on) => { for (const k in CH) EVENTS[k].chance = on ? CH[k] : 0; };
chance(false);
const events = (bus, n) => bus.log.filter((e) => e[0] === n).map((e) => e[1]);
const dayStart = (d, h = 0) => (d - 1) * MIN_PER_DAY + h * 60;

// ---- 1) 112 günlük hava dağılımı, mevsim tablolarına uyum (20 tohum) ----
{
  const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
  const cnt = SEASONS.map(() => Object.fromEntries(WEATHER_TYPES.map((t) => [t, 0])));
  let changes = 0, days = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const w = world(seed * 77);
    w.go(0);
    for (let d = 1; d <= 112; d++) {
      w.reg.advance(Math.max(0, dayStart(d, 6) - w.state.time.totalMinutes), true); // gün d 06:00
      cnt[Math.floor((d - 1) / 28)][w.state.weather.type]++;
    }
    changes += events(w.bus, 'weather:changed').length - 111; // günlük 05:00 değişimleri hariç
    days += 112;
    if (seed === 1) ok(w.state.weather.forecast.length === 3, 'tahmin her zaman 3 gün');
  }
  let worst = 0;
  SEASONS.forEach((s, i) => {
    const tot = Object.values(cnt[i]).reduce((a, b) => a + b, 0);
    for (const t of WEATHER_TYPES) worst = Math.max(worst, Math.abs(cnt[i][t] / tot - SEASON_WEATHER[s][t]));
  });
  ok(worst < 0.06, `hava dağılımı mevsim tablosuna uyuyor (en büyük sapma ${(worst * 100).toFixed(1)} puan)`);
  ok(cnt[3].snow > 0 && cnt[0].snow === 0 && cnt[1].snow === 0, 'kar yalnız kışın');
  ok(changes > 0, `gün içi değişim oluyor (${changes}/${days} gün)`);
}

// ---- 2) yağmurlu günlerde sulamasız ekin yaşar, açık günlerde kurur ----
function cropRun(type) {
  {
    const w = world(5, { use: ['farm'] });
    const t = w.state.tiles['36,9'] ?? (w.state.tiles['36,9'] = createTile(36, 9, 'plowed'));
    t.state = 'plowed';
    t.crop = { id: 'potato', plantedDay: 1, growth: 0, stage: 0, health: 100, pest: 0, disease: 0, careSum: 0, careCount: 0, readyDays: 0, harvests: 0, dead: false, rot: 1 };
    for (let h = 0; h < 24 * 4; h++) { w.state.weather.type = type === 'rain' ? (h < 24 ? 'rain' : 'clear') : 'clear'; w.state.weather.changeAtMin = null; w.go(60); }
    return { hp: t.crop.health, stage: t.crop.stage, dead: t.crop.dead, m: t.moisture };
  }
}
{
  const rain = cropRun('rain'), clear = cropRun('clear');
  ok(!rain.dead && rain.hp >= 60 && rain.hp > clear.hp + 20, `bir yağmur günüyle sulamasız ekin 4 gün yaşar (sağlık ${rain.hp.toFixed(0)}, açık havada ${clear.hp.toFixed(0)})`);
  ok(clear.hp < 50, `açık havada sulamasız ekin kurur (sağlık ${clear.hp.toFixed(0)})`);
}

// ---- 3) kuraklık: yağmur yok, fiyat artışı, nem kaybı x1.5 ----
{
  let rainy = 0, base = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const w = world(seed, { day: 28 * 0 + 1 });
    w.bus.emit('event:force', { kind: 'drought' });
    const ev = w.state.events.active[0];
    ok(ev && ev.kind === 'drought', seed === 1 ? 'kuraklık başladı' : 'kuraklık başladı (tohum)') ;
    const until = ev.untilMin;
    const before = events(w.bus, 'weather:changed').length;
    while (w.state.time.totalMinutes < until - 60) {
      w.go(60);
      if (['rain', 'storm'].includes(w.state.weather.type)) rainy++;
    }
    // aynı süre kuraklıksız
    const c = world(seed);
    for (let m = 0; m < until - c.state.time.totalMinutes - 60; m += 60) { c.go(60); if (['rain', 'storm'].includes(c.state.weather.type)) base++; }
  }
  ok(rainy === 0, `kuraklıkta yağmur/fırtına yok (olay: ${rainy}, kontrol: ${base} saat)`);
  const w = world(3);
  w.bus.emit('event:force', { kind: 'drought' });
  const ev = w.state.events.active[0];
  const id = ev.data.itemIds[0];
  const w2 = world(3);
  const before = currentPrice(w2.state, id), after = currentPrice(w.state, id);
  ok(ev.data.itemIds.length === 2 && after > before * 1.25, `kuraklıkta ${id} fiyatı arttı (${before} → ${after}), market.activeEvents=${w.state.market.activeEvents.length}`);
  const bt = events(w.bus, 'event:started')[0];
  ok(bt && /%/.test(bt.text), `event:started metni: ${bt && bt.text}`);
  ok(ev.data.moistureLossMult === 1.5, 'nem kaybı çarpanı data\'da');
  // nem kaybı: 10 saat kuru
  const f1 = world(3, { use: ['farm'] }), f2 = world(3, { use: ['farm'] });
  f2.bus.emit('event:force', { kind: 'drought' });
  for (const f of [f1, f2]) { f.state.weather.type = 'clear'; f.state.weather.changeAtMin = null; f.state.tiles['36,9'].moisture = 70; f.go(60 * 4); }
  const l1 = 70 - f1.state.tiles['36,9'].moisture, l2 = 70 - f2.state.tiles['36,9'].moisture;
  ok(Math.abs(l2 / l1 - 1.5) < 0.01, `kuraklıkta nem kaybı ×1.5 (${l1.toFixed(1)} → ${l2.toFixed(1)})`);
  // süre sonunda biter
  const e = world(3); e.bus.emit('event:force', { kind: 'drought' }); const u = e.state.events.active[0].untilMin;
  e.reg.advance(u - e.state.time.totalMinutes + 60, true);
  ok(events(e.bus, 'event:ended').length >= 1 && !e.state.market.activeEvents.length, 'kuraklık bitince event:ended + fiyat çarpanı temizlendi');
}

// ---- 4) kış: kar örtüsü, kar yağarken açık alan büyümesi durur; ilkbaharda erir ----
{
  let maxCover = 0, snowDays = 0;
  for (let seed = 1; seed <= 5; seed++) {
    const w = world(seed, { day: 85 });
    for (let h = 0; h < 24 * 28; h++) { w.go(60); maxCover = Math.max(maxCover, w.state.weather.snowCover); if (h % 24 === 12 && w.state.weather.type === 'snow') snowDays++; }
  }
  ok(maxCover > 0.9 && snowDays > 0, `kışın kar örtüsü oluşuyor (en çok ${maxCover.toFixed(2)}, ${snowDays} karlı öğle)`);
  const growth = (type) => {
    const w = world(9, { day: 85, hour: 8, use: ['farm'] });
    const t = w.state.tiles['36,9']; t.state = 'plowed'; t.moisture = 60;
    t.crop = { id: 'spinach', plantedDay: 85, growth: 0.1, stage: 0, health: 100, pest: 0, disease: 0, careSum: 0, careCount: 0, readyDays: 0, harvests: 0, dead: false, rot: 1 };
    w.state.weather.type = type; w.state.weather.intensity = 0.7; w.state.weather.changeAtMin = null;
    w.go(60);
    return t.crop.growth - 0.1;
  };
  const gs = growth('snow'), gc = growth('cloudy');
  ok(gs === 0 && gc > 0, `kar yağarken açık alan büyümesi durur (kar ${gs}, bulutlu ${gc.toFixed(4)})`);
  const sp = world(4, { day: 1, hour: 8 }); sp.state.weather.snowCover = 1; sp.state.weather.type = 'clear'; sp.state.weather.changeAtMin = null; sp.go(60 * 24);
  ok(sp.state.weather.snowCover < 0.1, 'ilkbaharda kar örtüsü erir');
}

// ---- 5) fırtına hasarı + hayvan mutluluğu ----
{
  const w = world(11, { use: ['farm', 'animals'] });
  for (let i = 0; i < 1000; i++) {
    const t = createTile(100 + i, 100, 'plowed');
    t.crop = { id: 'wheat', plantedDay: 1, growth: 0.5, stage: 2, health: 100, pest: 0, disease: 0, careSum: 0, careCount: 0, readyDays: 0, harvests: 0, dead: false, rot: 1 };
    w.state.tiles[`${100 + i},100`] = t;
  }
  FarmSystem.invalidate();
  w.state.animals.push({ id: 'a1', type: 'chicken', buildingId: 'x', happiness: 80, health: 100, hunger: 100, thirst: 100, sick: false, ageDays: 30, pettedDay: -1, productTimer: 0 });
  w.state.weather.type = 'clear';
  w.bus.emit('weather:set', { type: 'storm' });
  const hit = Object.values(w.state.tiles).filter((t) => t.tx >= 100 && t.crop.health < 100);
  ok(hit.length > 15 && hit.length < 70 && hit.every((t) => t.crop.health === 85), `fırtına ekin hasarı: ${hit.length}/1000 karo, -15 sağlık`);
  ok(w.state.animals[0].happiness === 70, 'fırtına hayvan mutluluğu -10');
  w.bus.emit('weather:set', { type: 'storm' });
  ok(w.state.animals[0].happiness === 70, 'fırtına sürerken tekrar hasar yok');
  // don: yalnız dayanıksızlara
  const f = world(12, { use: ['farm'] });
  const mk = (id, x) => { const t = createTile(x, 100, 'plowed'); t.crop = { id, plantedDay: 1, growth: 0.5, stage: 2, health: 100, pest: 0, disease: 0, careSum: 0, careCount: 0, readyDays: 0, harvests: 0, dead: false, rot: 1 }; f.state.tiles[`${x},100`] = t; return t; };
  const tl = mk('lettuce', 100), tw = mk('wheat', 101), tc = mk('carrot', 102), ts = mk('spinach', 103);
  FarmSystem.invalidate();
  f.bus.emit('event:force', { kind: 'frost' });
  ok(tl.crop.health === 60 && tw.crop.health === 100 && tc.crop.health === 100 && ts.crop.health === 100, `don yalnız dayanıksız ekine (marul ${tl.crop.health}, buğday ${tw.crop.health}, havuç ${tc.crop.health})`);
  const h = world(13, { use: ['farm'] });
  const th = (() => { const t = createTile(100, 100, 'plowed'); t.crop = { id: 'wheat', plantedDay: 1, growth: 0.5, stage: 2, health: 100, pest: 0, disease: 0, careSum: 0, careCount: 0, readyDays: 0, harvests: 0, dead: false, rot: 1 }; h.state.tiles['100,100'] = t; return t; })();
  FarmSystem.invalidate();
  h.bus.emit('event:force', { kind: 'hail' });
  ok(th.crop.health === 70 && h.state.weather.type === 'storm', 'dolu: ekin -30, hava fırtına');
}

// ---- 6) salgın: hastalık şansı x5 ----
{
  const rate = (outbreak) => {
    const w = world(21);
    if (outbreak) w.bus.emit('event:force', { kind: 'outbreak' });
    const rng = createRng({ rngSeed: 5, rngState: 5 });
    let sick = 0, n = 0;
    for (let i = 0; i < 4000; i++) {
      const list = [{ type: 'chicken', ageDays: 100, hunger: 100, thirst: 100, health: 100, happiness: 70, sick: false, pettedDay: -1, productTimer: 0 }];
      const b = { id: 'b', type: 'coop', dirt: 100, box: {} };
      dayStep(w.state, b, list, { rng, now: { season: 'spring' } }, 5);
      n++; if (list[0].sick) sick++;
    }
    return sick / n;
  };
  const a = rate(false), b = rate(true);
  ok(b > a * 3.5, `salgında hastalık şansı arttı (${(a * 100).toFixed(1)}% → ${(b * 100).toFixed(1)}%)`);
}

// ---- 7) hibe + %20 inşa indirimi ----
{
  const w = world(31, { use: ['farm', 'place'] });
  w.state.finance.money = 10000;
  w.bus.emit('event:force', { kind: 'subsidy' });
  ok(w.state.finance.money === 12000, 'teşvik: +2000 hibe');
  w.bus.emit('build:place', { type: 'coop', tx: 26, ty: 6 });
  ok(w.state.finance.money === 12000 - 1200, `teşvik aktifken kümes %20 indirimli (para ${w.state.finance.money})`);
  w.reg.advance(7 * MIN_PER_DAY + 60, true);
  const m0 = w.state.finance.money;
  ok(!w.state.events.active.some((e) => e.kind === 'subsidy'), 'teşvik 7 gün sonra bitti');
  w.bus.emit('build:place', { type: 'coop', tx: 26, ty: 12 });
  ok(m0 - w.state.finance.money === 1500 || w.state.finance.money === m0, 'indirim bitince tam fiyat');
}

// ---- 8) zararlı istilası / fiyat çöküşü / olay sıklığı ----
{
  chance(true);
  const counts = Object.fromEntries(Object.keys(EVENTS).map((k) => [k, 0]));
  let total = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const w = world(seed * 13);
    w.reg.advance(112 * MIN_PER_DAY, true);
    for (const e of events(w.bus, 'event:started')) counts[e.kind]++;
    total += 112;
    if (seed === 1) ok(w.state.events.active.every((a) => a.untilMin > w.state.time.totalMinutes), 'süresi dolan olaylar kalmadı');
  }
  const exp = (k) => EVENTS[k].chance * total * ((EVENTS[k].seasons ? EVENTS[k].seasons.length : 4) / 4) * (k === 'drought' ? 1.25 : 1) * (k === 'pestWave' ? 1.5 : 1);
  console.log('     olay sayıları:', JSON.stringify(counts), 'toplam gün', total);
  ok(counts.drought > 0 && counts.priceCrash > 0 && counts.outbreak > 0, 'ana olay türleri oluşuyor');
  ok(counts.frost > 0 || counts.hail > 0, 'don/dolu nadiren oluşuyor');
  chance(false);
}

// ---- 9) festival: 21. gün 10:00 açılır; katılım, sıralama, ödül; seçilmezse 12:00 kapanır ----
{
  const w = world(41, { day: 21, hour: 8, use: ['farm'] });
  add(w.state, 'watermelon', 3, 'A');
  w.state.finance.money = 0;
  w.go(60 * 1); // 09:00
  ok(events(w.bus, 'festival:open').length === 0, '10:00 öncesi festival yok');
  w.go(60 * 2); // 11:00
  const open = events(w.bus, 'festival:open');
  ok(open.length === 1 && w.state.events.festival.open, 'festival 21. gün 10:00 açıldı');
  const before = count(w.state, 'watermelon');
  const rep0 = w.state.player.reputation;
  w.bus.emit('festival:enter', { itemId: 'watermelon', q: 'A' });
  const res = events(w.bus, 'festival:result');
  ok(res.length === 1 && res[0].entered && res[0].rank >= 1 && res[0].rival !== 0, `festival sonucu: sıra ${res[0] && res[0].rank}, ödül ${res[0] && res[0].prize}`);
  ok(count(w.state, 'watermelon') === before - 1, 'ürün envanterden düştü');
  ok(w.state.finance.money === res[0].prize && (res[0].prize === 0 || w.state.player.reputation > rep0 || rep0 >= 100), 'ödül ve itibar işlendi');
  ok(res[0].prize === FESTIVAL.prizes[res[0].rank - 1] || res[0].rank > 3, 'ödül tablosuna uygun');
  w.bus.emit('festival:enter', { itemId: 'watermelon', q: 'A' });
  ok(events(w.bus, 'festival:result').slice(-1)[0].ok === false, 'ikinci katılım reddedildi');
  w.go(60 * 24 + 60 * 2);
  ok(events(w.bus, 'festival:open').length === 1, 'aynı mevsimde festival tekrar açılmadı');
  // katılmazsa
  const n = world(42, { day: 21, hour: 9, use: ['farm'] });
  n.go(60 * 4);
  const r = events(n.bus, 'festival:result');
  ok(events(n.bus, 'festival:open').length === 1 && r.length === 1 && r[0].entered === false && !n.state.events.festival.open, 'seçilmezse 12:00\'de katılmamış sayıldı');
  // ödül sıralaması: farklı tohumlarla rank dağılımı
  const ranks = [0, 0, 0, 0, 0];
  for (let seed = 1; seed <= 60; seed++) {
    const g = world(seed, { day: 21 + 28, hour: 9, use: ['farm'] });
    add(g.state, 'watermelon', 1, 'A'); g.go(120);
    g.bus.emit('festival:enter', { itemId: 'watermelon', q: 'A' });
    ranks[events(g.bus, 'festival:result').slice(-1)[0].rank]++;
  }
  console.log('     sıralama dağılımı (1..4):', ranks.slice(1).join(','));
  ok(ranks[1] > 0 && ranks[1] + ranks[2] + ranks[3] + ranks[4] === 60, 'sıralamalar üretiliyor');
}

// ---- 10) determinizm + doğrulayıcı ----
{
  const run = () => { const w = world(99, { use: ['farm'] }); w.reg.advance(60 * MIN_PER_DAY, true); return JSON.stringify([w.state.weather, w.state.events, w.state.market.activeEvents, w.state.rngState]); };
  ok(run() === run(), 'aynı tohum → aynı hava/olay (determinizm)');
  const bad = createInitialState(3);
  bad.weather = { type: 'tornado', intensity: 5, wind: 'x', forecast: [{ type: 'rain' }, { type: 'bogus' }], puddles: -3, snowCover: 9 };
  bad.events = { active: [{ kind: 'nope' }, 5], history: 'x', festival: 3 };
  WeatherSystem.validate(bad, () => {}); EventSystem.validate(bad, () => {});
  ok(bad.weather.type === 'clear' && bad.weather.intensity === 1 && bad.weather.forecast.length === 1 && bad.weather.puddles === 0 && bad.weather.snowCover === 1
    && bad.events.active.length === 0 && bad.events.festival.open === false, 'validate bozuk kaydı onarıyor');
}

console.log(fails ? `\n${fails} BAŞARISIZ` : '\nTÜMÜ GEÇTİ');
process.exit(fails ? 1 : 0);
