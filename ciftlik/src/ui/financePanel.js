// Finans paneli (PLAN §13): Özet · Grafikler · Defter · Banka · Sözleşmeler.
// state'i yalnızca OKUR; eylemler EventBus komutu: bank:borrow / bank:repay / contract:accept / contract:deliver.
// Kapalıyken DOM işi yok; açıkken kirli bayrakla rAF'ta toplu güncelleme (HTML dizgesi değişmediyse DOM'a dokunulmaz).
import { ITEMS } from '../data/items.js';
import { LEDGER_CATEGORIES, BANK } from '../data/economy.js';
import { SEASONS, SEASON_NAMES_TR } from '../core/constants.js';
import { netWorth, assetBreakdown } from '../systems/economy/valuation.js';
import { loanLimit, previewLoan } from '../systems/economy/loans.js';
import { currentPrice } from '../systems/market/pricing.js';
import { STR } from './strings.js';
import { itemIcon } from './itemIcons.js';
import { h, setText } from './frame.js';
import { tap } from './touch.js';
import { formatMoney } from './hud.js';
import { drawFlow, drawHBars } from './charts.js';

const F = STR.fin;
const TABS = ['summary', 'charts', 'ledger', 'bank', 'contracts'];
const RANGES = [28, 56, 112];
const QR = { A: 0, B: 1, C: 2 };
const DAY = 1440;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sgn = (n) => `${n >= 0 ? '+' : '−'}${formatMoney(Math.abs(n)).replace(/\s?₺/, ' ₺')}`;
const cls = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const iname = (id) => (ITEMS[id] && ITEMS[id].name) || String(id || '');
const catName = (c) => LEDGER_CATEGORIES[c] || c;
const seasonName = (s) => { const k = typeof s === 'number' ? SEASONS[s] : s; return SEASON_NAMES_TR[k] || String(k); };

/** Sözleşme için envanterdeki uygun (min kalite ve üstü) adet. */
export function eligibleQty(state, itemId, minQ) {
  const arr = state.inventory && state.inventory.items && state.inventory.items[itemId];
  if (!Array.isArray(arr)) return 0;
  const lim = QR[minQ] ?? 2;
  let n = 0;
  for (const st of arr) if (st && st.qty > 0 && (QR[st.q || 'B'] ?? 1) <= lim) n += Math.floor(st.qty);
  return n;
}

/** HUD rozeti: {count, urgent} = yeni teklifler + 1 günden az kalan aktif sözleşmeler. */
export function financeBadge(state, totalMin) {
  const c = state.contracts;
  if (!c) return { count: 0, urgent: false };
  let urgent = 0;
  for (const a of c.active || []) if (a.dueMin - totalMin < DAY) urgent++;
  return { count: (c.offers ? c.offers.length : 0) + urgent, urgent: urgent > 0 };
}

const dur = (min) => { const m = Math.max(0, Math.ceil(min / 60)); return F.dur(Math.floor(m / 24), m % 24); };

export function createFinancePanel(ctx) {
  const { state, bus, now } = ctx;
  const el = h('div', 'fin');
  el.innerHTML = `
    <div class="bp-sub fin-tabs"><div class="seg chips" role="tablist">${TABS.map((t) => `<button type="button" role="tab" data-tab="${t}">${F.tabs[t]}<i class="fdot" hidden></i></button>`).join('')}</div></div>
    <div class="bp-body scrollable fin-body">
      <section data-s="summary"><div class="fs-html"></div>
        <div class="fin-lab">${F.last7}</div><canvas class="fin-cv mini"></canvas></section>
      <section data-s="charts">
        <div class="fin-row"><div class="fin-lab">${F.daily}</div><div class="seg chips rng">${RANGES.map((r) => `<button type="button" data-r="${r}">${F.days(r)}</button>`).join('')}</div></div>
        <canvas class="fin-cv flow"></canvas>
        <div class="fin-read num"></div>
        <div class="fin-leg"><i class="g"></i>${F.income}<i class="b"></i>${F.expense}<i class="a"></i>${F.netLine}</div>
        <div class="fin-lab">${F.byCat}</div><canvas class="fin-cv hb"></canvas>
        <div class="fin-lab">${F.seasonTable}</div><div class="fin-tbl"></div></section>
      <section data-s="ledger"><div class="fl-html"></div></section>
      <section data-s="bank"><div class="bk-html"></div>
        <div class="bk-form fin-card"><div class="fin-lab"><b>${F.newLoan}</b></div>
          <div class="bk-off"></div>
          <div class="bk-ctl"><div class="fin-line"><span>${F.amount}</span><b class="num bk-amt"></b></div>
            <div class="slider"><input type="range" min="1000" max="1000" step="100" value="1000" aria-label="${F.amount}"></div>
            <div class="fin-line"><span>${F.term}</span></div>
            <div class="seg chips bk-terms">${BANK.termsSeasons.map((t) => `<button type="button" data-term="${t}">${F.termOpt(t)}</button>`).join('')}</div>
            <div class="bk-prev num"></div>
            <button type="button" class="bk-go solid-gold">${F.borrow}</button></div></div></section>
      <section data-s="contracts"><div class="ct-html"></div></section>
    </div>`;
  const body = el.querySelector('.fin-body');
  const tabBtns = [...el.querySelectorAll('[data-tab]')];
  const rngBtns = [...el.querySelectorAll('[data-r]')];
  const secs = {}; for (const s of el.querySelectorAll('section')) secs[s.dataset.s] = s;
  const q = (s) => el.querySelector(s);
  const sumHtml = q('.fs-html'), mini = q('.mini'), flow = q('.flow'), hb = q('.hb'), readEl = q('.fin-read'), tbl = q('.fin-tbl');
  const ledHtml = q('.fl-html'), bkHtml = q('.bk-html'), ctHtml = q('.ct-html');
  const bkForm = q('.bk-form'), bkOff = q('.bk-off'), bkCtl = q('.bk-ctl'), range = q('.bk-form input'), bkAmt = q('.bk-amt');
  const bkPrev = q('.bk-prev'), bkGo = q('.bk-go'), termBtns = [...el.querySelectorAll('[data-term]')];
  range.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });

  let tab = 'summary', rangeDays = 28, ledgerCat = 'all', loanAmt = 0, loanTerm = BANK.termsSeasons[0];
  let dirty = true, sel = -1, flowMeta = null, flowDays = null, pendingUntil = 0;
  const last = {};

  const put = (node, key, html) => { if (last[key] !== html) { last[key] = html; node.innerHTML = html; } };
  const cal = () => now();
  const T = () => state.time.totalMinutes;
  const fin = () => state.finance;
  const daysOf = () => fin().dailySummary || [];

  // ---------- Etkileşim ----------
  for (const b of tabBtns) tap(b, () => { tab = b.dataset.tab; body.scrollTop = 0; dirty = true; });
  for (const b of rngBtns) tap(b, () => { rangeDays = Number(b.dataset.r); sel = -1; dirty = true; });
  for (const b of termBtns) tap(b, () => { loanTerm = Number(b.dataset.term); dirty = true; });
  range.addEventListener('input', () => { loanAmt = Number(range.value); dirty = true; });
  tap(bkGo, () => {
    if (bkGo.disabled) return;
    pendingUntil = performance.now() + 1200;
    bus.emit('bank:borrow', { amount: loanAmt, termSeasons: loanTerm });
    dirty = true;
  });
  el.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-act]');
    if (!t || t.disabled) return;
    const a = t.dataset.act, id = t.dataset.id;
    if (a === 'cat') { ledgerCat = t.dataset.cat; dirty = true; }
    else if (a === 'repay') bus.emit('bank:repay', { loanId: Number.isNaN(Number(id)) ? id : Number(id) });
    else if (a === 'accept') bus.emit('contract:accept', { id: Number.isNaN(Number(id)) ? id : Number(id) });
    else if (a === 'deliver') bus.emit('contract:deliver', { id: Number.isNaN(Number(id)) ? id : Number(id) });
  });
  const pick = (e) => {
    if (!flowMeta || !flowDays) return;
    const r = flow.getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left - flowMeta.left) / flowMeta.slot);
    const ni = i >= 0 && i < flowDays.length ? i : -1;
    if (ni !== sel) { sel = ni; dirty = true; }
  };
  flow.addEventListener('click', pick);
  flow.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') pick(e); });
  flow.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && sel !== -1) { sel = -1; dirty = true; } });

  // ---------- Veri ----------
  function flowData(n) {
    const c = cal(), map = new Map();
    for (const s of daysOf()) map.set(s.day, s);
    const out = [];
    for (let d = c.day - n + 1; d <= c.day; d++) {
      const s = map.get(d);
      out.push({ day: d, label: d > 0 ? d : null, income: s ? Number(s.income) || 0 : 0, expense: s ? Math.abs(Number(s.expense) || 0) : 0, net: s && typeof s.netWorth === 'number' ? s.netWorth : null });
    }
    return out;
  }
  function seasonAgg() {
    const c = cal(), start = c.day - c.dayOfSeason + 1;
    let income = 0, expense = 0; const cats = {};
    for (const s of daysOf()) {
      if (s.day < start) continue;
      income += Number(s.income) || 0; expense += Math.abs(Number(s.expense) || 0);
      const bc = s.byCategory || {};
      for (const k in bc) cats[k] = (cats[k] || 0) + (Number(bc[k]) || 0);
    }
    return { income, expense, profit: income - expense, cats };
  }
  const debtOf = () => { let d = 0; for (const l of fin().loans || []) d += Number(l.remaining) || 0; return d; };

  // ---------- Sekmeler ----------
  function renderSummary() {
    const f = fin(), c = cal();
    const today = daysOf().find((s) => s.day === c.day) || { income: 0, expense: 0 };
    const tI = Number(today.income) || 0, tE = Math.abs(Number(today.expense) || 0);
    const se = seasonAgg();
    const ab = assetBreakdown(state);
    const nw = netWorth(state);
    const debt = debtOf();
    const rep = Math.max(0, Math.min(100, Number(state.player && state.player.reputation) || 0));
    const segs = ['money', 'buildings', 'animals', 'inventory'].map((k) => [k, Math.max(0, Number(ab[k]) || 0)]);
    const tot = segs.reduce((a, s) => a + s[1], 0) || 1;
    const col = (lab, i, e) => `<div class="fs-col"><b>${lab}</b><span class="pos num">${formatMoney(i)}</span><span class="neg num">${formatMoney(e)}</span><em class="num ${cls(i - e)}">${sgn(i - e)}</em></div>`;
    put(sumHtml, 'sum', `
      <div class="fs-top"><div class="fin-card"><small>${F.money}</small><b class="big num">${formatMoney(f.money)}</b></div>
        <div class="fin-card"><small>${F.netWorth}</small><b class="big num ${cls(nw)}">${formatMoney(nw)}</b></div></div>
      <div class="fin-card fs-pl"><div class="fs-head"><span></span><span>${F.income}</span><span>${F.expense}</span><span>${F.profit}</span></div>
        ${col(F.today, tI, tE)}${col(F.season, se.income, se.expense)}</div>
      <div class="fin-card"><div class="fin-line"><span>${F.debt}</span><b class="num ${debt > 0 ? 'neg' : ''}">${debt > 0 ? formatMoney(debt) : F.noDebt}</b></div>
        <div class="fin-line"><span>${F.reputation}</span><b class="num">${Math.round(rep)}/100</b></div>
        <div class="fin-bar rep"><i style="width:${rep}%"></i></div></div>
      <div class="fin-card"><div class="fin-lab"><b>${F.assets}</b></div>
        <div class="fin-stack">${segs.map(([k, v]) => `<i class="s-${k}" style="flex:${v / tot}" title="${F.asset[k]}"></i>`).join('')}</div>
        <div class="fin-legend">${segs.map(([k, v]) => `<span><i class="s-${k}"></i>${F.asset[k]} <b class="num">${formatMoney(v)}</b></span>`).join('')}${ab.debt ? `<span><i class="s-debt"></i>${F.asset.debt} <b class="num neg">${formatMoney(Math.abs(ab.debt))}</b></span>` : ''}</div></div>`);
    const d7 = flowData(7);
    drawFlow(mini, d7, { compact: true, height: 70 });
  }

  function renderCharts() {
    for (const b of rngBtns) b.classList.toggle('on', Number(b.dataset.r) === rangeDays);
    flowDays = flowData(rangeDays);
    flowMeta = drawFlow(flow, flowDays, { height: 210, sel });
    const d = flowDays[sel >= 0 ? sel : flowDays.length - 1];
    setText(readEl, d ? F.dayTip(d.day, formatMoney(d.income), formatMoney(d.expense)) + (d.net != null ? ` · ${F.netLine} ${formatMoney(d.net)}` : '') : '');
    const se = seasonAgg();
    const rows = Object.keys(se.cats).filter((k) => se.cats[k] && k !== 'loan').map((k) => ({ label: catName(k), value: se.cats[k] }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 8);
    hb.style.display = rows.length ? '' : 'none';
    if (rows.length) drawHBars(hb, rows);
    // Mevsim tablosu
    const ss = (fin().seasonSummary || []).slice(-4);
    if (!ss.length) { put(tbl, 'tbl', `<div class="fin-empty">${F.noData}</div>`); return; }
    const keys = new Set();
    for (const s of ss) for (const k in s.byCategory || {}) if (k !== 'tax' && k !== 'loan') keys.add(k);
    const ordered = [...keys].sort((a, b) => ss.reduce((t, s) => t + Math.abs((s.byCategory || {})[b] || 0), 0) - ss.reduce((t, s) => t + Math.abs((s.byCategory || {})[a] || 0), 0));
    const cell = (v) => `<td class="num ${cls(v)}">${v ? sgn(v).replace(/^\+/, '') : '·'}</td>`;
    const tr = (lab, fn, c = '') => `<tr class="${c}"><th>${lab}</th>${ss.map((s) => fn(s)).join('')}</tr>`;
    put(tbl, 'tbl', `<table><thead><tr><th></th>${ss.map((s) => `<th>${esc(seasonName(s.season))}<small>${s.year ?? ''}</small></th>`).join('')}</tr></thead><tbody>
      ${ordered.map((k) => tr(esc(catName(k)), (s) => cell(Number((s.byCategory || {})[k]) || 0))).join('')}
      ${tr(F.profit, (s) => cell(Number(s.profit) || 0), 'sum')}${tr(F.tax, (s) => cell(-(Number(s.tax) || 0)))}
      ${tr(F.net, (s) => cell((Number(s.profit) || 0) - (Number(s.tax) || 0)), 'sum total')}</tbody></table>`);
  }

  function renderLedger() {
    const led = fin().ledger || [];
    const present = new Set(); for (const e of led) present.add(e.category);
    if (ledgerCat !== 'all' && !present.has(ledgerCat)) ledgerCat = 'all';
    const chips = ['all', ...Object.keys(LEDGER_CATEGORIES).filter((k) => present.has(k))];
    let rows = '', n = 0;
    for (let i = led.length - 1; i >= 0 && n < 500; i--) {
      const e = led[i];
      if (ledgerCat !== 'all' && e.category !== ledgerCat) continue;
      n++;
      const a = Number(e.amount) || 0;
      rows += `<div class="lg-row"><span class="lg-t">${F.ledgerTime(e.day, Math.floor(e.min / 60), e.min % 60)}</span><span class="lg-l">${esc(e.label)}</span><span class="lg-c">${esc(catName(e.category))}</span><b class="lg-a num ${cls(a)}">${sgn(a)}</b></div>`;
    }
    put(ledHtml, 'led', `<div class="seg chips lg-chips">${chips.map((k) => `<button type="button" data-act="cat" data-cat="${k}" class="${k === ledgerCat ? 'on' : ''}">${k === 'all' ? F.ledgerAll : esc(catName(k))}</button>`).join('')}</div>
      <div class="lg-list">${rows || `<div class="fin-empty">${F.ledgerEmpty}</div>`}</div>`);
  }

  function renderBank() {
    const f = fin(), c = cal(), t = T();
    const frozen = (f.bankLates || 0) >= BANK.maxLatesBeforeFreeze;
    let lim = 0; try { lim = Math.floor(Number(loanLimit(state)) || 0); } catch (e) { lim = 0; }
    const loans = f.loans || [];
    put(bkHtml, 'bk', `
      <div class="fin-card"><div class="fin-line"><span>${F.limit}</span><b class="num">${formatMoney(frozen ? 0 : Math.max(0, lim))}</b></div>
        ${frozen ? `<div class="fin-warn">${F.frozen}</div>` : ''}</div>
      <div class="fin-lab"><b>${F.active}</b></div>
      ${loans.length ? loans.map((l) => {
        const nc = calendarOf(l.nextDueMin, c);
        const pct = l.totalCount ? Math.round(((l.paidCount || 0) / l.totalCount) * 100) : 0;
        const close = Math.round((Number(l.remaining) || 0) * (1 + BANK.earlyCloseFeePct));
        return `<div class="fin-card ln"><div class="fin-line"><span>${F.left}</span><b class="num neg">${formatMoney(l.remaining)}</b></div>
          <div class="fin-line"><span>${F.installment}</span><b class="num">${formatMoney(l.installment)}</b></div>
          <div class="fin-line"><span>${F.nextPay}</span><b class="num">${nc ? F.nextAt(nc.dayOfSeason, nc.hour) : '—'}</b></div>
          <div class="fin-bar"><i style="width:${pct}%"></i></div>
          <div class="fin-line sm"><span>${F.paid(l.paidCount || 0, l.totalCount || 0)}</span>${l.lates ? `<span class="neg">${F.lates(l.lates)}</span>` : ''}</div>
          <button type="button" class="ghost" data-act="repay" data-id="${esc(l.id)}" ${(state.finance.money < close) ? 'disabled' : ''}>${F.earlyClose(formatMoney(close))}</button></div>`;
      }).join('') : `<div class="fin-empty">${F.none}</div>`}`);
    // Yeni kredi formu (kalıcı DOM)
    const maxA = Math.floor(lim / 100) * 100;
    const ok = !frozen && maxA >= BANK.minLoan;
    bkCtl.hidden = !ok; bkOff.hidden = ok;
    setText(bkOff, frozen ? F.frozen : F.limitLow);
    if (!ok) return;
    loanAmt = Math.max(BANK.minLoan, Math.min(maxA, loanAmt || maxA));
    range.min = String(BANK.minLoan); range.max = String(maxA); range.step = '100';
    if (Number(range.value) !== loanAmt) range.value = String(loanAmt);
    range.style.setProperty('--p', `${maxA > BANK.minLoan ? ((loanAmt - BANK.minLoan) / (maxA - BANK.minLoan)) * 100 : 100}%`);
    setText(bkAmt, formatMoney(loanAmt));
    for (const b of termBtns) b.classList.toggle('on', Number(b.dataset.term) === loanTerm);
    let pv = { installment: 0, count: 0, totalRepay: loanAmt };
    try { pv = previewLoan(loanAmt, loanTerm); } catch (e) { /* stub */ }
    setText(bkPrev, `${F.perWeek}: ${formatMoney(pv.installment)} × ${pv.count} · ${F.totalRepay}: ${formatMoney(pv.totalRepay)}`);
    bkGo.disabled = performance.now() < pendingUntil;
  }

  function calendarOf(min, c) { return Number.isFinite(min) ? ctx.calendar(min) : null; }

  function renderContracts() {
    const ct = state.contracts || { offers: [], active: [], history: [] }, t = T(), c = cal();
    const icon = (id) => `<span class="ct-i">${itemIcon(id)}</span>`;
    const qb = (qv) => `<i class="qb q-${qv || 'C'}">${F.minQ(qv || 'C')}</i>`;
    const offers = (ct.offers || []).map((o) => {
      let mk = 0; try { mk = currentPrice(state, o.itemId, c) * o.qty; } catch (e) { mk = 0; }
      const pct = mk > 0 ? Math.round((o.reward / mk - 1) * 100) : null;
      return `<div class="fin-card ct">${icon(o.itemId)}<div class="ct-m"><b>${esc(iname(o.itemId))} × ${o.qty} ${qb(o.minQ)}</b>
        <span class="num pos">${formatMoney(o.reward)}${pct != null ? ` <small>${F.premium(pct)}</small>` : ''}</span>
        <small>${F.expiresIn(dur(o.expiresMin - t))} · ${F.deadline(o.deadlineDays || 0)}</small></div>
        <button type="button" class="solid-gold" data-act="accept" data-id="${esc(o.id)}">${F.accept}</button></div>`;
    }).join('');
    const actives = (ct.active || []).map((a) => {
      const left = a.dueMin - t, elig = eligibleQty(state, a.itemId, a.minQ), need = Math.max(0, a.qty - (a.delivered || 0));
      const pct = a.qty ? Math.round(((a.delivered || 0) / a.qty) * 100) : 0;
      return `<div class="fin-card ct">${icon(a.itemId)}<div class="ct-m"><b>${esc(iname(a.itemId))} ${qb(a.minQ)}</b>
        <span class="num">${F.delivered(a.delivered || 0, a.qty)} · <span class="pos">${formatMoney(a.reward)}</span></span>
        <div class="fin-bar"><i style="width:${pct}%"></i></div>
        <small class="${left < DAY ? 'amber' : ''}">${F.due(dur(left))}</small><small>${F.inStock(elig)}</small></div>
        <button type="button" class="solid-gold" data-act="deliver" data-id="${esc(a.id)}" ${elig > 0 && need > 0 ? '' : 'disabled'}>${F.deliver}</button></div>`;
    }).join('');
    const hist = (ct.history || []).slice(-5).reverse().map((x) => {
      const ok = x.ok === true || x.status === 'completed' || x.status === 'done' || x.result === 'completed';
      return `<div class="lg-row"><span class="lg-l">${esc(iname(x.itemId))} × ${x.qty ?? ''}</span><span class="lg-c ${ok ? 'pos' : 'neg'}">${ok ? F.done : F.failed}</span><b class="lg-a num ${ok ? 'pos' : 'neg'}">${ok ? sgn(x.reward || 0) : (x.penalty ? sgn(-Math.abs(x.penalty)) : '')}</b></div>`;
    }).join('');
    put(ctHtml, 'ct', `<div class="fin-lab"><b>${F.offers}</b></div>${offers || `<div class="fin-empty">${F.noOffers}</div>`}
      <div class="fin-lab"><b>${F.actives}</b></div>${actives || `<div class="fin-empty">${F.noActive}</div>`}
      ${hist ? `<div class="fin-lab"><b>${F.history}</b></div><div class="lg-list">${hist}</div>` : ''}`);
  }

  const RENDER = { summary: renderSummary, charts: renderCharts, ledger: renderLedger, bank: renderBank, contracts: renderContracts };
  const dots = tabBtns.map((b) => b.querySelector('.fdot'));

  return {
    id: 'finance',
    el,
    title: () => STR.panelTitle.finance,
    onOpen(arg) { if (arg && arg.tab && TABS.includes(arg.tab)) tab = arg.tab; dirty = true; sel = -1; body.scrollTop = 0; },
    onClose() {},
    markDirty() { dirty = true; },
    onResult() { pendingUntil = 0; dirty = true; },
    render() {
      if (pendingUntil && performance.now() >= pendingUntil) { pendingUntil = 0; dirty = true; }
      if (!dirty) return;
      dirty = false;
      for (const b of tabBtns) { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); }
      for (const k in secs) secs[k].hidden = k !== tab;
      const ct = state.contracts;
      dots[4].hidden = !(ct && ((ct.offers && ct.offers.length) || (ct.active && ct.active.length && financeBadge(state, T()).urgent)));
      try { RENDER[tab](); } catch (e) { console.error('[ui] finans', e); }
    },
  };
}

/** Mevsim kapanış kartı (kök üzerinde, dokununca kapanır). */
export function createSeasonCard(root) {
  const card = h('div', 'season-card glass');
  card.hidden = true;
  card.setAttribute('role', 'status');
  root.appendChild(card);
  let timer = 0;
  const close = () => { clearTimeout(timer); card.classList.remove('show'); setTimeout(() => { if (!card.classList.contains('show')) card.hidden = true; }, 260); };
  card.addEventListener('click', close);
  card.addEventListener('pointerdown', (e) => e.stopPropagation());
  return {
    show(p) {
      const s = (p && (p.summary || p)) || {};
      const profit = Number(s.profit) || 0, tax = Number(s.tax) || 0;
      let best = null;
      const bc = s.byCategory || {};
      for (const k in bc) if (bc[k] > 0 && (!best || bc[k] > best[1])) best = [k, bc[k]];
      card.innerHTML = `<small>${F.closed} · ${esc(seasonName(s.season))} ${s.year ?? ''}</small>
        <div class="sc-row"><span>${F.profit}</span><b class="num ${cls(profit)}">${sgn(profit)}</b></div>
        <div class="sc-row"><span>${F.tax}</span><b class="num ${tax ? 'neg' : ''}">${formatMoney(tax)}</b></div>
        ${best ? `<div class="sc-row"><span>${F.bestCat}</span><b>${esc(catName(best[0]))} · ${sgn(best[1])}</b></div>` : ''}
        <em>${F.closedTap}</em>`;
      card.hidden = false; void card.offsetWidth; card.classList.add('show');
      clearTimeout(timer); timer = setTimeout(close, 14000);
    },
    destroy() { clearTimeout(timer); card.remove(); },
  };
}
