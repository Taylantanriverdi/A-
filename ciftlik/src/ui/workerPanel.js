// Çalışan paneli (PLAN §11): `ui:open {panel:'worker'}` ve HUD portre düğmesi.
// state'i yalnızca OKUR; eylemler worker:hire / worker:fire / worker:set komutları ve camera:follow olayıdır.
// Portre: ui/portrait.js (visual-dev) varsa portraitSVG(size); yoksa basit yedek daire.
import { WORKER_TYPES, MAX_WORKERS, HIRING } from '../data/workers.js';
import { calendar } from '../core/timeUtils.js';
import { statusText, TASK_KINDS } from '../systems/workers/tasks.js';
import { STR } from './strings.js';
import { h, setText } from './frame.js';
import { tap } from './touch.js';
import { formatMoney } from './hud.js';

const W = STR.wrk;
const PORTRAIT_MOD = Object.values(import.meta.glob('./portrait.js', { eager: true }))[0] || null;

const FALLBACK = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
  <circle cx="32" cy="32" r="31" fill="#5a6a8a"/><path d="M8 62c2-14 14-20 24-20s22 6 24 20z" fill="#7a7fa8"/>
  <circle cx="32" cy="27" r="12" fill="#e8c196"/><path d="M19 25c2-10 24-12 27 0-6-4-17-5-27 0z" fill="#3a2a22"/></svg>`;

/** SVG portre HTML'i (HUD düğmesi + panel). */
export function portraitHTML(size) {
  try {
    if (PORTRAIT_MOD && typeof PORTRAIT_MOD.portraitSVG === 'function') return PORTRAIT_MOD.portraitSVG(size);
  } catch (_) { /* yedeğe düş */ }
  return FALLBACK(size);
}


// Yetişkin çalışan figür ikonu: look 0..3 → ten/saç/kıyafet rengi (visual-dev'in sahne varyantlarıyla uyumlu tonlar).
const LOOKS = [
  { skin: '#e8c196', hair: '#3a2a22', shirt: '#4f7fa8', pants: '#3b3f55' },
  { skin: '#c99468', hair: '#1f1a18', shirt: '#b5563f', pants: '#33384a' },
  { skin: '#f0d2b0', hair: '#9a6a3a', shirt: '#5f9a5a', pants: '#4a4036' },
  { skin: '#8d5c3c', hair: '#15110f', shirt: '#d1a23c', pants: '#2f3a4a' },
];
/** Basit SVG figür (baş-omuz daire içinde). Çırak için portre kullanılır. */
export function figureHTML(size, look, type) {
  if (type === 'apprentice') return portraitHTML(size);
  const c = LOOKS[((look | 0) % 4 + 4) % 4];
  const hat = type === 'master' ? '<path d="M18 27h28l-3-8H21z" fill="#6b4a2a"/><rect x="16" y="26" width="32" height="3" rx="1.5" fill="#54391f"/>' : '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
  <circle cx="32" cy="32" r="31" fill="#e7b46a"/><path d="M6 62c1-14 12-20 26-20s25 6 26 20z" fill="${c.shirt}"/>
  <rect x="27" y="36" width="10" height="8" rx="3" fill="${c.skin}"/><circle cx="32" cy="27" r="11" fill="${c.skin}"/>
  <path d="M20.5 26c0-9 7-13 12-13s11.500 3.500 11.500 13c-3-5-7-6.500-11.500-6.500S23.500 21 20.500 26z" fill="${c.hair}"/>
  <circle cx="28" cy="28" r="1.300" fill="#2a1a10"/><circle cx="36" cy="28" r="1.300" fill="#2a1a10"/>
  <path d="M28.500 33c2 1.700 5 1.700 7 0" fill="none" stroke="#7a4a30" stroke-width="1.300" stroke-linecap="round"/>${hat}</svg>`;
}

const skillBars = (skills) => ['farm', 'animal', 'machine'].map((k) => {
  const v = (skills && skills[k]) || 1;
  return `<div class="wk-sk"><span>${W.skill[k]}</span><span class="wk-bar"><i style="width:${v * 20}%"></i></span><b>${v}</b></div>`;
}).join('');

export function createWorkerPanel(ctx, { closePanel } = {}) {
  const { state, bus } = ctx;
  const el = h('div', 'wrk');
  el.innerHTML = `
    <div class="bp-body scrollable"><div class="wrk-body">
      <div class="seg chips wrk-tabs" role="tablist">
        <button type="button" role="tab" data-tab="staff">${W.tabs.staff}</button>
        <button type="button" role="tab" data-tab="board">${W.tabs.board}</button>
      </div>
      <section class="wrk-list" data-sec="list"></section>
      <section class="wrk-list" data-sec="board"></section>
      <button type="button" class="ghost wrk-back" data-sec="back">‹ ${W.back}</button>
      <section class="bld-card wrk-head" data-sec="head">
        <div class="wrk-pic"></div>
        <div class="wrk-id">
          <label class="wrk-lbl">${W.nameLabel}<input type="text" class="w-name" maxlength="16" autocomplete="off" spellcheck="false"></label>
          <div class="wrk-role"></div>
          <div class="wrk-status"></div>
        </div>
        <button type="button" class="ghost w-enable"></button>
      </section>
      <section class="bld-card" data-sec="skills"><h4>${W.skills}</h4><div class="wk-skills"></div><p class="wrk-small wk-perk"></p></section>
      <section class="bld-card" data-sec="tasks">
        <h4>${W.tasks}</h4>
        <div class="wrk-tasks"></div>
        <p class="wrk-small">${W.tasksHint}</p>
      </section>
      <section class="bld-card" data-sec="pay">
        <div class="wrk-pay"></div>
        <div class="wrk-small wrk-hours"></div>
        <div class="wrk-debt" hidden></div>
      </section>
      <section class="bld-card wrk-actions" data-sec="actions">
        <button type="button" class="solid-gold w-follow"></button>
        <button type="button" class="ghost w-fire"></button>
      </section>
    </div></div>`;
  const $ = (s) => el.querySelector(s);
  const secs = {};
  for (const n of el.querySelectorAll('[data-sec]')) secs[n.dataset.sec] = n;
  const tabBtns = [...el.querySelectorAll('.wrk-tabs button')];
  $('.wrk-head .wrk-pic').innerHTML = portraitHTML(72);
  const E = {
    name: $('.w-name'), role: $('.wrk-role'), status: $('.wrk-status'), enable: $('.w-enable'), pic: $('.wrk-head .wrk-pic'),
    skills: $('.wk-skills'), perk: $('.wk-perk'),
    tasks: $('.wrk-tasks'), pay: $('.wrk-pay'), hours: $('.wrk-hours'), debt: $('.wrk-debt'),
    follow: $('.w-follow'), fire: $('.w-fire'),
  };
  let dirty = true;
  let following = false;
  let fireArmed = 0;
  let editing = false;
  let tab = 'staff';
  let selId = null;
  let statusEls = [];

  const worker = () => (selId ? state.workers.find((w) => w.id === selId) || null : null);
  const rows = {};
  for (const k of TASK_KINDS) {
    const r = h('div', 'wrk-task');
    r.innerHTML = `<label class="wt-sw"><input type="checkbox"><span class="wt-n"></span><span class="wt-h"></span></label>
      <span class="wt-mv"><button type="button" class="ghost up" aria-label="${W.up}">▲</button><button type="button" class="ghost dn" aria-label="${W.down}">▼</button></span>`;
    const cb = r.querySelector('input');
    r.querySelector('.wt-n').textContent = W.task[k];
    r.querySelector('.wt-h').textContent = W.taskHint[k];
    cb.addEventListener('change', () => { const w = worker(); if (w) bus.emit('worker:set', { workerId: w.id, tasks: { [k]: cb.checked } }); });
    tap(r.querySelector('.up'), () => move(k, -1));
    tap(r.querySelector('.dn'), () => move(k, 1));
    rows[k] = { el: r, cb, up: r.querySelector('.up'), dn: r.querySelector('.dn') };
  }
  function move(k, d) {
    const w = worker(); if (!w) return;
    const o = w.order.slice(); const i = o.indexOf(k); const j = i + d;
    if (i < 0 || j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    bus.emit('worker:set', { workerId: w.id, order: o });
  }

  function commitName() {
    editing = false;
    const w = worker(); if (!w) return;
    const v = E.name.value.trim();
    if (v && v !== w.name) bus.emit('worker:set', { workerId: w.id, name: v });
    else E.name.value = w.name;
  }
  E.name.addEventListener('focus', () => { editing = true; });
  E.name.addEventListener('blur', commitName);
  E.name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); E.name.blur(); } e.stopPropagation(); });
  E.name.addEventListener('keyup', (e) => e.stopPropagation());

  for (const b of tabBtns) tap(b, () => { if (tab !== b.dataset.tab) { tab = b.dataset.tab; selId = null; dirty = true; } });
  tap(secs.back, () => { selId = null; dirty = true; });
  tap(E.enable, () => { const w = worker(); if (w) bus.emit('worker:set', { workerId: w.id, enabled: !w.enabled }); });
  tap(E.follow, () => {
    const w = worker(); if (!w) return;
    following = !following;
    bus.emit('camera:follow', { workerId: following ? w.id : null });
    if (following && closePanel) closePanel();
    dirty = true;
  });
  tap(E.fire, () => {
    const w = worker(); if (!w) return;
    const t = performance.now();
    if (t - fireArmed < 4000) { fireArmed = 0; following = false; selId = null; bus.emit('camera:follow', { workerId: null }); bus.emit('worker:fire', { workerId: w.id }); } else { fireArmed = t; }
    dirty = true;
  });

  function renderList() {
    const box = secs.list;
    box.innerHTML = '';
    statusEls = [];
    const head = h('div', 'wrk-small', W.count(state.workers.length, MAX_WORKERS));
    box.appendChild(head);
    if (!state.workers.length) box.appendChild(h('p', 'wrk-small', W.listEmpty));
    if (!state.workers.some((x) => x.type === 'apprentice') && state.workers.length < MAX_WORKERS) {
      const card = h('div', 'bld-card wk-cand');
      card.innerHTML = `<div class="wk-chead"><span class="wrk-pic wk-ic">${portraitHTML(52)}</span><span class="wk-tx"><b>${W.type.apprentice}</b><span class="wk-ty">${W.apprenticeCand}</span></span></div>
        <button type="button" class="cb solid-gold"><span class="cbt">${W.hire} · ${W.hireFree}</span></button>`;
      tap(card.querySelector('button'), () => bus.emit('worker:hire', { type: 'apprentice' }));
      box.appendChild(card);
    }
    for (const w of state.workers) {
      const def = WORKER_TYPES[w.type];
      const b = h('button', 'bld-card wk-row');
      b.type = 'button';
      b.innerHTML = `<span class="wrk-pic wk-ic">${figureHTML(48, w.look, w.type)}</span>
        <span class="wk-tx"><b></b><span class="wk-ty"></span><span class="wk-st"></span></span><span class="wk-wage num"></span>`;
      b.querySelector('b').textContent = w.name;
      b.querySelector('.wk-ty').textContent = def.title;
      b.querySelector('.wk-wage').textContent = W.wagePer(formatMoney(w.wage || def.wagePerDay));
      statusEls.push([b.querySelector('.wk-st'), w]);
      tap(b, () => { selId = w.id; dirty = true; });
      box.appendChild(b);
    }
  }
  function renderBoard() {
    const box = secs.board;
    box.innerHTML = '';
    const hr = state.hiring || { candidates: [], refreshedDay: 0 };
    const day = calendar(state.time.totalMinutes).day;
    box.appendChild(h('div', 'wrk-small', `${W.boardInfo(Math.max(0, hr.refreshedDay + HIRING.refreshEveryDays - day))} · ${W.count(state.workers.length, MAX_WORKERS)}`));
    if (!hr.candidates.length) box.appendChild(h('p', 'wrk-small', W.boardEmpty));
    const full = state.workers.length >= MAX_WORKERS;
    for (const c of hr.candidates) {
      const def = WORKER_TYPES[c.type];
      const card = h('div', 'bld-card wk-cand');
      card.innerHTML = `<div class="wk-chead"><span class="wrk-pic wk-ic">${figureHTML(52, c.look, c.type)}</span>
        <span class="wk-tx"><b></b><span class="wk-ty"></span><span class="wk-wage num"></span></span></div>
        <div class="wk-skills">${skillBars(c.skills)}</div><p class="wrk-small wk-note"></p>
        <button type="button" class="cb solid-gold"><span class="cbt"></span></button><div class="why"></div>`;
      card.querySelector('b').textContent = c.name;
      card.querySelector('.wk-ty').textContent = def.title;
      card.querySelector('.wk-wage').textContent = W.wagePer(formatMoney(c.wage));
      card.querySelector('.wk-note').textContent = c.type === 'master' ? W.masterPerk : c.type === 'apprentice' ? W.apprenticeCand : '';
      const btn = card.querySelector('button');
      btn.querySelector('.cbt').textContent = W.hireFor(c.hireCost > 0 ? formatMoney(c.hireCost) : W.hireFree);
      const poor = state.finance.money < c.hireCost;
      btn.disabled = full || poor;
      setText(card.querySelector('.why'), full ? W.full : poor ? 'Yeterli paran yok.' : '');
      tap(btn, () => { if (!btn.disabled) bus.emit('worker:hire', { candidateId: c.id }); });
      box.appendChild(card);
    }
  }

  function renderStatic() {
    dirty = false;
    if (selId && !worker()) selId = null;
    const w = worker();
    for (const b of tabBtns) b.classList.toggle('on', b.dataset.tab === tab);
    const showCard = tab === 'staff' && !!w;
    secs.list.hidden = !(tab === 'staff' && !w);
    secs.board.hidden = tab !== 'board';
    for (const k of ['back', 'head', 'skills', 'tasks', 'pay', 'actions']) secs[k].hidden = !showCard;
    if (tab === 'board') renderBoard();
    else if (!w) renderList();
    if (!showCard) return;
    const def = WORKER_TYPES[w.type];
    if (!editing && E.name.value !== w.name) E.name.value = w.name;
    E.pic.innerHTML = figureHTML(72, w.look, w.type);
    const wage = w.wage || def.wagePerDay;
    setText(E.role, W.role(def.title, formatMoney(wage)));
    setText(E.enable, w.enabled ? W.working : W.onLeave);
    E.enable.classList.toggle('on', w.enabled);
    E.skills.innerHTML = skillBars(w.skills);
    setText(E.perk, w.type === 'master' ? W.masterPerk : '');
    E.tasks.innerHTML = '';
    w.order.forEach((k, i) => {
      const r = rows[k];
      if (!r) return;
      r.cb.checked = !!w.tasks[k];
      r.up.disabled = i === 0; r.dn.disabled = i === w.order.length - 1;
      E.tasks.appendChild(r.el);
    });
    setText(E.pay, W.wageLine(formatMoney(wage), def.payHour));
    setText(E.hours, W.hours(def.workHours[0], def.workHours[1]));
    E.debt.hidden = !(w.debt > 0);
    if (w.debt > 0) setText(E.debt, W.debt(formatMoney(w.debt)));
    setText(E.follow, following ? W.unfollow : W.follow);
    const armed = performance.now() - fireArmed < 4000;
    setText(E.fire, armed ? W.fireConfirm : W.fire);
    E.fire.classList.toggle('armed', armed);
  }

  return {
    id: 'worker',
    el,
    title() { const w = worker(); return w ? w.name : tab === 'board' ? W.tabs.board : W.title; },
    onOpen(arg) {
      dirty = true; fireArmed = 0;
      tab = arg && arg.tab === 'board' ? 'board' : 'staff';
      selId = arg && arg.workerId && state.workers.some((x) => x.id === arg.workerId) ? arg.workerId : (state.workers.length === 1 && tab === 'staff' ? state.workers[0].id : null);
      const sc = el.querySelector('.bp-body'); if (sc) sc.scrollTop = 0;
    },
    onClose() { fireArmed = 0; },
    markDirty() { dirty = true; },
    render() {
      if (dirty) renderStatic();
      const w = worker();
      const hr = ctx.now().hour;
      if (w && tab === 'staff') {
        setText(E.status, statusText(state, w, hr));
        if (fireArmed && performance.now() - fireArmed >= 4000) { fireArmed = 0; dirty = true; }
      } else if (tab === 'staff') for (const [n, x] of statusEls) setText(n, statusText(state, x, hr));
    },
    destroy() {},
  };
}

/** HUD düğmesi için portre içeriği. */
export function hudPortrait(size = 30) { return portraitHTML(size); }
export default createWorkerPanel;
