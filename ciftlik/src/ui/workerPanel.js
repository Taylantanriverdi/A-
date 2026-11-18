// Çalışan paneli (PLAN §11): `ui:open {panel:'worker'}` ve HUD portre düğmesi.
// state'i yalnızca OKUR; eylemler worker:hire / worker:fire / worker:set komutları ve camera:follow olayıdır.
// Portre: ui/portrait.js (visual-dev) varsa portraitSVG(size); yoksa basit yedek daire.
import { WORKER_TYPES } from '../data/workers.js';
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

export function createWorkerPanel(ctx, { closePanel } = {}) {
  const { state, bus } = ctx;
  const el = h('div', 'wrk');
  el.innerHTML = `
    <div class="bp-body scrollable"><div class="wrk-body">
      <section class="bld-card wrk-none" data-sec="none">
        <div class="wrk-pic"></div>
        <b>${W.noneTitle}</b>
        <p>${W.noneBody}</p>
        <p class="wrk-small">${W.donkey}</p>
        <button type="button" class="cb solid-gold w-hire"><span class="cbt">${W.hire}</span><span class="cbv num"></span></button>
        <div class="why"></div>
      </section>
      <section class="bld-card wrk-head" data-sec="head">
        <div class="wrk-pic"></div>
        <div class="wrk-id">
          <label class="wrk-lbl">${W.nameLabel}<input type="text" class="w-name" maxlength="16" autocomplete="off" spellcheck="false"></label>
          <div class="wrk-role"></div>
          <div class="wrk-status"></div>
        </div>
        <button type="button" class="ghost w-enable"></button>
      </section>
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
  const pics = el.querySelectorAll('.wrk-pic');
  for (const p of pics) p.innerHTML = portraitHTML(72);
  const E = {
    hire: $('.w-hire'), hireV: $('.w-hire .cbv'), why: $('.wrk-none .why'),
    name: $('.w-name'), role: $('.wrk-role'), status: $('.wrk-status'), enable: $('.w-enable'),
    tasks: $('.wrk-tasks'), pay: $('.wrk-pay'), hours: $('.wrk-hours'), debt: $('.wrk-debt'),
    follow: $('.w-follow'), fire: $('.w-fire'),
  };
  let dirty = true;
  let following = false;
  let fireArmed = 0;
  let editing = false;

  const worker = () => state.workers[0] || null;
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

  tap(E.hire, () => { if (!E.hire.disabled) bus.emit('worker:hire', { type: 'apprentice' }); });
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
    if (t - fireArmed < 4000) { fireArmed = 0; following = false; bus.emit('camera:follow', { workerId: null }); bus.emit('worker:fire', { workerId: w.id }); } else { fireArmed = t; }
    dirty = true;
  });

  function renderStatic() {
    dirty = false;
    const w = worker();
    secs.none.hidden = !!w;
    for (const k of ['head', 'tasks', 'pay', 'actions']) secs[k].hidden = !w;
    if (!w) {
      const def = WORKER_TYPES.apprentice;
      setText(E.hireV, def.hireCost > 0 ? formatMoney(def.hireCost) : W.hireFree);
      E.hire.disabled = state.finance.money < def.hireCost;
      setText(E.why, '');
      return;
    }
    const def = WORKER_TYPES[w.type];
    if (!editing && E.name.value !== w.name) E.name.value = w.name;
    setText(E.role, W.role(def.title, formatMoney(def.wagePerDay)));
    setText(E.enable, w.enabled ? W.working : W.onLeave);
    E.enable.classList.toggle('on', w.enabled);
    E.tasks.innerHTML = '';
    w.order.forEach((k, i) => {
      const r = rows[k];
      r.cb.checked = !!w.tasks[k];
      r.up.disabled = i === 0; r.dn.disabled = i === w.order.length - 1;
      E.tasks.appendChild(r.el);
    });
    setText(E.pay, W.wageLine(formatMoney(def.wagePerDay), def.payHour));
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
    title() { const w = worker(); return w ? w.name : W.title; },
    onOpen() { dirty = true; fireArmed = 0; const sc = el.querySelector('.bp-body'); if (sc) sc.scrollTop = 0; },
    onClose() { fireArmed = 0; },
    markDirty() { dirty = true; },
    render() {
      if (dirty) renderStatic();
      const w = worker();
      if (w) {
        setText(E.status, statusText(state, w, ctx.now().hour));
        if (fireArmed && performance.now() - fireArmed >= 4000) { fireArmed = 0; dirty = true; }
      }
    },
    destroy() {},
  };
}

/** HUD düğmesi için portre içeriği. */
export function hudPortrait(size = 30) { return portraitHTML(size); }
export default createWorkerPanel;
