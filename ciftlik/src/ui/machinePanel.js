// Makine paneli (PLAN §11): `ui:open {panel:'machine', machine}`. Boş arsa → inşa teklifi; kurulu → tarif kartları,
// kuyruk (oyun zamanına göre ilerleme çubukları), çıktı kutusu + Topla, durum + Bakım, Otomatik tarif seçici.
// state'i yalnızca OKUR; eylemler shop:buildMachine, machine:queue/auto/collect/repair komutlarıdır. Kapalıyken DOM işi yok.
import { MACHINES, MACHINE_RULES, RECIPES } from '../data/recipes.js';
import { ITEMS } from '../data/items.js';
import { STR } from './strings.js';
import { h, setText } from './frame.js';
import { tap } from './touch.js';
import { formatMoney } from './hud.js';
import { countItem } from './toolbar.js';
import { itemIcon } from './itemIcons.js';
import { recipesOf, recipeEconomics, repairCost, durationMin, isStopped } from '../systems/production/sim.js';

const PENDING_MS = 700;
const M = STR.mach;
const nameOf = (id) => (ITEMS[id] && ITEMS[id].name) || String(id);
const listText = (o) => Object.keys(o).map((id) => `${o[id]} ${nameOf(id)}`).join(' + ');

export function createMachinePanel(ctx) {
  const { state, bus } = ctx;
  const el = h('div', 'bld mach');
  el.innerHTML = `
    <div class="bp-body scrollable"><div class="bld-body">
      <section class="bld-card bld-empty" data-sec="empty">
        <b class="e-name"></b><p class="e-hint"></p>
        <div class="meta"><span class="e-lvl num"></span></div>
        <button type="button" class="cb solid-gold"><span class="cbt"></span><span class="cbv num"></span></button>
        <div class="why"></div>
      </section>
      <section class="bld-card" data-sec="status">
        <div class="gauge"><div class="gl"><span>${M.condition}</span><b class="num c-val"></b></div><div class="bar c-bar"><i></i></div></div>
        <div class="m-note"></div>
        <div class="bld-actions"><button type="button" class="ghost a-repair"><span>${M.repair}</span><span class="n num rp"></span></button></div>
      </section>
      <section class="bld-card" data-sec="recipes"><h4>${M.recipes}</h4><div class="m-recipes"></div></section>
      <section class="bld-card" data-sec="auto"><h4>${M.auto}</h4><div class="feed-pick"><span class="fchips"></span></div><div class="m-note">${M.autoHint}</div></section>
      <section class="bld-card" data-sec="queue"><h4>${M.queue}</h4><div class="m-queue"></div></section>
      <section class="bld-card" data-sec="output"><h4>${M.output}</h4><div class="m-out"></div>
        <div class="bld-actions"><button type="button" class="solid-gold a-collect"><span>${M.collect}</span><span class="n num"></span></button></div></section>
    </div></div>`;
  const $ = (s) => el.querySelector(s);
  const secs = {};
  for (const n of el.querySelectorAll('[data-sec]')) secs[n.dataset.sec] = n;
  const E = { name: $('.e-name'), hint: $('.e-hint'), lvl: $('.e-lvl'), buy: $('.bld-empty .cb'), buyT: $('.bld-empty .cbt'), buyV: $('.bld-empty .cbv'), why: $('.bld-empty .why') };
  const S = { val: $('.c-val'), bar: $('.c-bar'), fill: $('.c-bar i'), note: $('.m-note'), repair: $('.a-repair'), rp: $('.rp') };
  const recBox = $('.m-recipes'), qBox = $('.m-queue'), outBox = $('.m-out'), chips = $('.fchips');
  const collectBtn = $('.a-collect'), collectN = $('.a-collect .n');

  let type = null;
  let dirty = true;
  let placedId = null;
  const pending = new Map();
  const recCards = new Map(); // recipeId → refs
  const chipEls = new Map();
  let qRefs = [];
  let lastQKey = '';

  const machine = () => (type ? state.machines.find((m) => (placedId != null ? (m.placedId ?? m.type) === placedId : m.type === type)) || null : null);
  const money = () => Number(state.finance && state.finance.money) || 0;
  const busy = (k) => (pending.get(k) || 0) > performance.now();
  const hold = (k) => { pending.set(k, performance.now() + PENDING_MS); dirty = true; };
  const mid = () => (machine() ? machine().id : `m_${placedId ?? type}`);

  tap(S.repair, () => { if (!S.repair.disabled) { hold('repair'); bus.emit('machine:repair', { machineId: mid() }); } });
  tap(collectBtn, () => { if (!collectBtn.disabled) { hold('collect'); bus.emit('machine:collect', { machineId: mid() }); } });

  function recipeCard(id) {
    let c = recCards.get(id);
    if (c) return c;
    const r = RECIPES[id];
    const row = h('div', 'arow m-rec');
    row.innerHTML = `
      <div class="ah"><span class="ri"></span><span class="an"></span><span class="rprofit num"></span></div>
      <div class="aa rflow"></div>
      <div class="aa rmeta num"></div>
      <div class="ab"><button type="button" class="solid-gold q-add">${M.add}</button></div>`;
    c = { el: row, icon: row.querySelector('.ri'), name: row.querySelector('.an'), profit: row.querySelector('.rprofit'),
      flow: row.querySelector('.rflow'), meta: row.querySelector('.rmeta'), add: row.querySelector('.q-add') };
    const outId = Object.keys(r.out)[0];
    c.icon.innerHTML = itemIcon(outId);
    setText(c.name, nameOf(outId));
    setText(c.flow, `${listText(r.in)} → ${listText(r.out)}`);
    tap(c.add, () => { if (!c.add.disabled) { hold(`q${id}`); bus.emit('machine:queue', { machineId: mid(), recipe: id }); } });
    recCards.set(id, c);
    return c;
  }

  function renderRecipes(m) {
    const ids = recipesOf(m.type);
    const stopped = isStopped(m);
    const full = m.queue.length >= MACHINE_RULES.queueMax;
    let i = 0;
    for (const id of ids) {
      const c = recipeCard(id);
      const r = RECIPES[id];
      const eco = recipeEconomics(state, id, ctx.now());
      const have = Object.keys(r.in).every((k) => countItem(state, k) >= r.in[k]);
      setText(c.profit, M.profit(eco.profit));
      c.profit.classList.toggle('neg', eco.profit < 0);
      setText(c.meta, `${M.time(Math.round(durationMin(id, m.condition) / 6) / 10)} · ${M.kwh(r.kwh)} (${formatMoney(eco.power)}) · ${have ? M.have : M.missing}`);
      c.meta.classList.toggle('none', !have);
      c.add.disabled = !have || full || stopped || money() < eco.power || busy(`q${id}`);
      if (recBox.children[i] !== c.el) recBox.insertBefore(c.el, recBox.children[i] || null);
      i++;
    }
    while (recBox.children.length > i) recBox.lastChild.remove();
  }

  function renderChips(m) {
    const opts = [null, ...recipesOf(m.type)];
    for (const id of opts) {
      const key = id || '-';
      let c = chipEls.get(key);
      if (!c) {
        c = h('button', ''); c.type = 'button';
        tap(c, () => { hold('auto'); bus.emit('machine:auto', { machineId: mid(), recipe: id }); });
        chipEls.set(key, c);
        chips.appendChild(c);
      }
      setText(c, id ? nameOf(Object.keys(RECIPES[id].out)[0]) : M.autoOff);
      c.classList.toggle('on', (m.auto || null) === id);
    }
  }

  function renderQueue(m) {
    const key = m.queue.map((j) => `${j.recipe}:${j.endMin}`).join('|');
    if (key === lastQKey) return;
    lastQKey = key;
    qBox.textContent = '';
    qRefs = [];
    if (!m.queue.length) { qBox.appendChild(h('p', 'm-note', M.queueEmpty)); return; }
    m.queue.forEach((j, idx) => {
      const r = RECIPES[j.recipe];
      const row = h('div', 'qrow', `<div class="gl"><span class="qn"></span><b class="num qt"></b></div><div class="bar"><i></i></div>`);
      setText(row.querySelector('.qn'), `${idx + 1}. ${nameOf(Object.keys(r.out)[0])}`);
      qBox.appendChild(row);
      qRefs.push({ job: j, t: row.querySelector('.qt'), fill: row.querySelector('i'), p: -1, s: '' });
    });
  }

  function updateProgress() {
    const now = Math.floor(state.time.totalMinutes);
    for (const q of qRefs) {
      const j = q.job;
      let p = 0, s = M.waiting;
      if (j.endMin != null && j.startMin != null) {
        p = Math.max(0, Math.min(100, Math.round(((now - j.startMin) / Math.max(1, j.endMin - j.startMin)) * 100)));
        s = M.hours(Math.max(0, j.endMin - now));
      }
      if (q.p !== p) { q.p = p; q.fill.style.width = `${p}%`; }
      if (q.s !== s) { q.s = s; setText(q.t, s); }
    }
  }

  function renderBuilt(m) {
    const c = Math.round(m.condition);
    setText(S.val, `${c}%`);
    S.fill.style.width = `${c}%`;
    S.bar.classList.toggle('low', c < MACHINE_RULES.stopBelow);
    S.bar.classList.toggle('warn', c >= MACHINE_RULES.stopBelow && c < MACHINE_RULES.slowBelow);
    setText(S.note, c < MACHINE_RULES.stopBelow ? M.stopped : c < MACHINE_RULES.slowBelow ? M.slow : '');
    S.note.hidden = c >= MACHINE_RULES.slowBelow;
    const cost = repairCost(m.type);
    setText(S.rp, formatMoney(cost));
    S.repair.disabled = m.condition >= 100 || money() < cost || busy('repair');
    renderRecipes(m);
    renderChips(m);
    renderQueue(m);
    // çıktı
    outBox.textContent = '';
    let total = 0;
    const parts = [];
    for (const id in m.output) {
      let n = 0; for (const s of m.output[id]) n += s.qty;
      if (n > 0) { total += n; parts.push(`${n} ${nameOf(id)}`); }
    }
    outBox.appendChild(h('p', 'm-note', parts.length ? parts.join(' · ') : M.outputEmpty));
    collectBtn.disabled = total <= 0 || busy('collect');
    setText(collectN, total > 0 ? String(total) : '');
  }

  function renderEmpty() {
    const def = MACHINES[type];
    if (!def) return;
    setText(E.name, def.name);
    setText(E.hint, M.notFound);
    setText(E.lvl, '');
    E.buy.hidden = true;
    setText(E.why, '');
  }

  function render() {
    if (!type) return;
    const m = machine();
    if (dirty) {
      dirty = false;
      secs.empty.hidden = !!m;
      for (const k of ['status', 'recipes', 'auto', 'queue', 'output']) secs[k].hidden = !m;
      if (m) renderBuilt(m); else renderEmpty();
    }
    if (m) updateProgress();
  }

  return {
    id: 'machine',
    el,
    title() { const def = type && MACHINES[type]; return def ? def.name : ''; },
    onOpen(a) {
      if (a && a.machine && MACHINES[a.machine]) { type = a.machine; placedId = a.placedId ?? null; lastQKey = '\0'; }
      dirty = true;
      const sc = el.querySelector('.bp-body');
      if (sc) sc.scrollTop = 0;
    },
    onClose() { pending.clear(); },
    markDirty() { dirty = true; },
    onResult() { pending.clear(); dirty = true; },
    render,
    destroy() {},
  };
}
