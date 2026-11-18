// Bina paneli (PLAN §10): arsaya dokununca `ui:open {panel:'building', buildingType, lotId}`.
// Boş arsa → inşa teklifi; dolu bina → yemlik/suluk/kir göstergeleri, eylemler, hayvan listesi, hayvan al.
// state'i yalnızca OKUR; eylemler `shop:build`, `shop:buyAnimal`, `animal:action` komutlarıdır. Kapalıyken DOM işi yok.
import { ANIMALS, ANIMAL_PRODUCTS } from '../data/animals.js';
import { BUILDINGS, TROUGH } from '../data/buildings.js';
import { ITEMS } from '../data/items.js';
import { STR } from './strings.js';
import { h, setText } from './frame.js';
import { tap } from './touch.js';
import { formatMoney } from './hud.js';
import { countItem } from './toolbar.js';

const PENDING_MS = 800;
const B = STR.bld;

const pct = (v) => Math.max(0, Math.min(100, Math.round(v)));
const barCls = (v, dirt) => (dirt ? (v > 60 ? 'low' : '') : v < 30 ? 'low' : v < 55 ? 'warn' : '');

function bar(label) {
  const w = h('div', 'b', `<span class="bl"></span><div class="bar"><i></i></div>`);
  w.querySelector('.bl').textContent = label;
  return { el: w, bar: w.querySelector('.bar'), fill: w.querySelector('i') };
}
function setBar(r, v, dirt = false) {
  const p = pct(v);
  if (r.__p !== p) { r.__p = p; r.fill.style.width = `${p}%`; }
  const c = barCls(p, dirt);
  if (r.__c !== c) { r.__c = c; r.bar.classList.toggle('low', c === 'low'); r.bar.classList.toggle('warn', c === 'warn'); }
}

export function createBuildingPanel(ctx) {
  const { state, bus } = ctx;
  const el = h('div', 'bld');
  el.innerHTML = `
    <div class="bp-body scrollable"><div class="bld-body">
      <section class="bld-card bld-empty" data-sec="empty">
        <b class="e-name"></b>
        <p class="e-hint"></p>
        <div class="meta"><span class="e-lvl num"></span><span class="e-cap num"></span></div>
        <button type="button" class="cb solid-gold"><span class="cbt"></span><span class="cbv num"></span></button>
        <div class="why"></div>
      </section>
      <section class="bld-card" data-sec="gauges">
        <div class="gauges">
          <div class="gauge g-feed"><div class="gl"><span>${B.trough}</span><b class="num"></b></div><div class="bar"><i></i></div></div>
          <div class="gauge g-water"><div class="gl"><span>${B.water}</span><b class="num"></b></div><div class="bar"><i></i></div></div>
          <div class="gauge g-dirt"><div class="gl"><span>${B.dirt}</span><b class="num"></b></div><div class="bar dirt"><i></i></div></div>
        </div>
      </section>
      <section class="bld-card" data-sec="actions">
        <div class="feed-pick"><span class="fl">${B.feedLabel}</span><span class="fchips"></span></div>
        <div class="bld-actions">
          <button type="button" class="solid-gold a-feed">${B.addFeed}</button>
          <button type="button" class="ghost a-water">${B.fillWater}</button>
          <button type="button" class="ghost a-clean">${B.clean}</button>
          <button type="button" class="solid-gold a-collect"><span>${B.collect}</span><span class="n num"></span></button>
        </div>
        <div class="boxline" style="font-size:12.5px;color:var(--text-dim)"></div>
      </section>
      <section class="bld-card" data-sec="animals">
        <h4 class="a-title"></h4>
        <div class="alist"></div>
        <p class="a-none" style="margin:0;font-size:13px;color:var(--text-dim)">${B.noAnimals}</p>
      </section>
      <section class="bld-card" data-sec="buy">
        <h4>${B.buyAnimal}</h4>
        <div class="buylist"></div>
      </section>
    </div></div>`;
  const $ = (s) => el.querySelector(s);
  const secs = {};
  for (const n of el.querySelectorAll('[data-sec]')) secs[n.dataset.sec] = n;
  const E = {
    name: $('.e-name'), hint: $('.e-hint'), lvl: $('.e-lvl'), cap: $('.e-cap'), buy: $('.bld-empty .cb'),
    buyT: $('.bld-empty .cbt'), buyV: $('.bld-empty .cbv'), why: $('.bld-empty .why'),
  };
  const G = {
    feed: { v: $('.g-feed b'), bar: $('.g-feed .bar'), fill: $('.g-feed i') },
    water: { v: $('.g-water b'), bar: $('.g-water .bar'), fill: $('.g-water i') },
    dirt: { v: $('.g-dirt b'), bar: $('.g-dirt .bar'), fill: $('.g-dirt i') },
  };
  const A = {
    feed: $('.a-feed'), water: $('.a-water'), clean: $('.a-clean'), collect: $('.a-collect'), collectN: $('.a-collect .n'),
    chips: $('.fchips'), box: $('.boxline'),
  };
  const list = $('.alist'), none = $('.a-none'), aTitle = $('.a-title'), buylist = $('.buylist');

  let arg = null;          // {buildingType, lotId}
  let dirty = true;
  let feedPick = null;     // seçili yem itemId
  const pendingUntil = new Map();
  const rows = new Map();  // animalId → {el, refs}
  const chipEls = new Map();
  const buyRows = new Map();

  const lotType = () => arg && arg.buildingType;
  const building = () => (arg ? state.buildings.find((b) => b.lotId === arg.lotId) || null : null);
  const level = () => Number(state.player && state.player.level) || 1;
  const money = () => Number(state.finance && state.finance.money) || 0;
  const busy = (k) => (pendingUntil.get(k) || 0) > performance.now();
  const hold = (k) => { pendingUntil.set(k, performance.now() + PENDING_MS); dirty = true; };
  const act = (type, extra) => {
    const b = building();
    if (!b) return;
    hold(type + (extra && extra.animalId ? extra.animalId : ''));
    bus.emit('animal:action', { type, buildingId: b.id, ...extra });
  };

  tap(E.buy, () => {
    if (E.buy.disabled) return;
    const type = lotType();
    if (type === 'hive') { hold('build'); bus.emit('shop:buyAnimal', { animal: 'bee', lotId: arg.lotId }); }
    else { hold('build'); bus.emit('shop:build', { building: type, lotId: arg.lotId }); }
  });
  tap(A.feed, () => { if (!A.feed.disabled && feedPick) act('feed', { itemId: feedPick }); });
  tap(A.water, () => { if (!A.water.disabled) act('water'); });
  tap(A.clean, () => { if (!A.clean.disabled) act('clean'); });
  tap(A.collect, () => { if (!A.collect.disabled) act('collect'); });

  // ---- yardımcılar ----
  const animalsOf = (b) => state.animals.filter((a) => a.buildingId === b.id);
  function acceptedFeeds(listA) {
    const out = new Map();
    for (const a of listA) {
      const d = ANIMALS[a.type];
      if (!d || !d.feed) continue;
      out.set(d.feed.itemId, true);
      if (d.altFeed) for (const k in d.altFeed) out.set(k, true);
    }
    return [...out.keys()];
  }
  const perDay = (listA) => listA.reduce((n, a) => n + ((ANIMALS[a.type] && ANIMALS[a.type].feed && ANIMALS[a.type].feed.perDay) || 0), 0);

  function makeRow(a) {
    const d = ANIMALS[a.type];
    const r = h('div', 'arow');
    r.innerHTML = `
      <div class="ah"><span class="adot"></span><span class="an"></span><span class="badge" hidden>${B.sick}</span></div>
      <div class="aa"></div>
      <div class="bars"></div>
      <div class="ab"><button type="button" class="ghost pet">${B.pet}</button><button type="button" class="solid-gold vet" hidden>${B.vet}</button></div>`;
    const refs = { dot: r.querySelector('.adot'), name: r.querySelector('.an'), badge: r.querySelector('.badge'), age: r.querySelector('.aa'),
      pet: r.querySelector('.pet'), vet: r.querySelector('.vet'), bars: {} };
    refs.dot.style.background = `radial-gradient(circle at 35% 30%, ${d.color}, ${d.accent})`;
    const barsEl = r.querySelector('.bars');
    for (const k of ['hunger', 'thirst', 'health', 'happy']) {
      if ((k === 'hunger' || k === 'thirst') && !d.feed) continue;
      const bb = bar(B.bars[k]);
      refs.bars[k] = bb; barsEl.appendChild(bb.el);
    }
    tap(refs.pet, () => { if (!refs.pet.disabled) act('pet', { animalId: a.id }); });
    tap(refs.vet, () => { if (!refs.vet.disabled) act('vet', { animalId: a.id }); });
    return { el: r, refs };
  }

  function renderBuilt(b) {
    const alist = animalsOf(b);
    const def = BUILDINGS[b.type];
    const cap = perDay(alist) * TROUGH.feedDaysMax;
    const hive = b.type === 'hive';
    // göstergeler
    secs.gauges.querySelector('.g-feed').hidden = hive;
    secs.gauges.querySelector('.g-water').hidden = hive;
    secs.gauges.querySelector('.g-dirt').hidden = hive;
    secs.gauges.hidden = hive;
    setText(G.feed.v, B.portions(b.trough.feed, cap));
    setBar(G.feed, cap > 0 ? (b.trough.feed / cap) * 100 : 0);
    setText(G.water.v, B.days(b.trough.water));
    setBar(G.water, (b.trough.water / TROUGH.waterDaysMax) * 100);
    setText(G.dirt.v, `${pct(b.dirt)}%`);
    setBar(G.dirt, b.dirt, true);
    // yem seçici
    const feeds = hive ? [] : acceptedFeeds(alist);
    A.chips.parentElement.hidden = hive || !feeds.length;
    if (!feeds.includes(feedPick)) feedPick = null;
    if (!feedPick) feedPick = feeds.find((id) => countItem(state, id) > 0) || feeds[0] || null;
    for (const id of feeds) {
      let c = chipEls.get(id);
      if (!c) {
        c = h('button', '');
        c.type = 'button';
        tap(c, () => { feedPick = id; dirty = true; });
        chipEls.set(id, c);
      }
      const n = countItem(state, id);
      setText(c, `${(ITEMS[id] && ITEMS[id].name) || id} ×${n}`);
      c.classList.toggle('on', id === feedPick);
      c.classList.toggle('none', n <= 0);
      if (c.parentElement !== A.chips) A.chips.appendChild(c);
    }
    for (const [id, c] of chipEls) if (!feeds.includes(id) && c.parentElement) c.remove();
    // eylemler
    A.feed.hidden = A.water.hidden = A.clean.hidden = hive;
    const hasA = alist.length > 0;
    A.feed.disabled = !hasA || !feedPick || countItem(state, feedPick) <= 0 || b.trough.feed >= cap - 1e-6 || busy('feed');
    A.water.disabled = !hasA || b.trough.water >= TROUGH.waterDaysMax - 1e-6 || busy('water');
    A.clean.disabled = b.dirt <= 0 || busy('clean');
    let boxN = 0; const parts = [];
    for (const id in b.box) {
      let n = 0; for (const s of b.box[id]) n += s.qty;
      if (n > 0) { boxN += n; parts.push(`${n} ${(ITEMS[id] && ITEMS[id].name) || id}`); }
    }
    A.collect.disabled = boxN <= 0 || busy('collect');
    setText(A.collectN, boxN > 0 ? String(boxN) : '');
    setText(A.box, parts.length ? `${B.box}: ${parts.join(' · ')}` : B.boxEmpty);
    // hayvan listesi
    setText(aTitle, `${def.name} · ${B.capacity(alist.length, def.capacity)}`);
    none.hidden = hasA;
    const seen = new Set();
    let i = 0;
    for (const a of alist) {
      seen.add(a.id);
      let row = rows.get(a.id);
      if (!row) { row = makeRow(a); rows.set(a.id, row); }
      const R = row.refs, d = ANIMALS[a.type];
      setText(R.name, a.name);
      const young = a.ageDays < d.adultDays;
      const old = Number.isFinite(d.lifeDays) && a.ageDays > d.lifeDays * d.oldAt;
      setText(R.age, `${d.name} · ${young ? `${B.baby} · ` : old ? `${B.old} · ` : ''}${B.age(Math.floor(a.ageDays))}`);
      row.el.classList.toggle('sick', a.sick);
      R.badge.hidden = !a.sick;
      if (R.bars.hunger) setBar(R.bars.hunger, a.hunger);
      if (R.bars.thirst) setBar(R.bars.thirst, a.thirst);
      setBar(R.bars.health, a.health);
      setBar(R.bars.happy, a.happiness);
      const day = ctx.now().day;
      R.pet.disabled = a.pettedDay === day || busy(`pet${a.id}`);
      R.pet.title = a.pettedDay === day ? B.petTip : '';
      R.vet.hidden = !a.sick;
      R.vet.disabled = busy(`vet${a.id}`);
      if (list.children[i] !== row.el) list.insertBefore(row.el, list.children[i] || null);
      i++;
    }
    for (const [id, row] of rows) if (!seen.has(id)) { row.el.remove(); rows.delete(id); }
    // hayvan al (bu binaya uygun türler)
    const hereTypes = Object.keys(ANIMALS).filter((t) => ANIMALS[t].building === b.type);
    secs.buy.hidden = hive || !hereTypes.length;
    for (const t of hereTypes) {
      const d = ANIMALS[t];
      let r = buyRows.get(t);
      if (!r) {
        const row = h('div', 'buyrow', `<div class="bn"></div><button type="button" class="solid-gold"><span>${STR.buy}</span><span class="num bv"></span></button>`);
        const btn = row.querySelector('button');
        tap(btn, () => { if (!btn.disabled) { hold(`buy${t}`); bus.emit('shop:buyAnimal', { animal: t, buildingId: building() && building().id }); } });
        r = { el: row, name: row.querySelector('.bn'), btn, bv: row.querySelector('.bv') };
        buyRows.set(t, r);
        buylist.appendChild(row);
      }
      const locked = level() < d.level;
      const full = alist.length >= def.capacity;
      const poor = money() < d.price;
      const pr = ANIMAL_PRODUCTS[d.product.itemId];
      r.name.innerHTML = '';
      const nm = document.createElement('span'); nm.textContent = d.name;
      const sub = document.createElement('span'); sub.className = 'bs';
      sub.textContent = locked ? STR.levelLock(d.level) : full ? B.full : B.produces(pr ? pr.name : '', d.product.intervalDays);
      r.name.append(nm, sub);
      setText(r.bv, formatMoney(d.price));
      r.btn.disabled = locked || full || poor || busy(`buy${t}`);
      r.btn.title = poor && !locked ? STR.notEnoughMoney : '';
    }
  }

  function renderEmpty(type) {
    const def = BUILDINGS[type];
    const hive = type === 'hive';
    const bee = ANIMALS.bee;
    const price = hive ? bee.price : def.price;
    const lv = hive ? bee.level : def.level;
    setText(E.name, hive ? B.buyHive : `${B.emptyLot} · ${def.name}`);
    setText(E.hint, hive ? B.hiveHint : B.emptyLotHint);
    setText(E.lvl, STR.levelLock(lv));
    setText(E.cap, hive ? '' : B.capacityN(def.capacity));
    setText(E.buyT, hive ? B.buyHive : B.buildBtn);
    setText(E.buyV, formatMoney(price));
    const locked = level() < lv, poor = money() < price;
    E.buy.disabled = locked || poor || busy('build');
    setText(E.why, locked ? STR.levelLock(lv) : poor ? STR.notEnoughMoney : '');
  }

  function render() {
    if (!dirty || !arg) return;
    dirty = false;
    const b = building();
    const type = lotType();
    secs.empty.hidden = !!b;
    for (const k of ['gauges', 'actions', 'animals', 'buy']) secs[k].hidden = !b;
    if (b) renderBuilt(b); else if (BUILDINGS[type]) renderEmpty(type);
  }

  return {
    id: 'building',
    el,
    title() {
      if (!arg) return '';
      const def = BUILDINGS[lotType()];
      const b = building();
      return def ? (b ? def.name : `${B.emptyLot} · ${def.name}`) : '';
    },
    onOpen(a) {
      if (a && a.lotId) { arg = { buildingType: a.buildingType, lotId: a.lotId }; feedPick = null; }
      dirty = true;
      const sc = el.querySelector('.bp-body');
      if (sc) sc.scrollTop = 0;
    },
    onClose() { pendingUntil.clear(); },
    markDirty() { dirty = true; },
    render,
    destroy() {},
  };
}
