// Karo bilgi kartı (İncele aleti). Masaüstünde sağda cam panel, telefonda alttan sayfa.
// Veri: rules.tileInfo(state, tileId, now) — yalnızca okunur. DOM bir kez kurulur, sonra yalnızca değişen yazılır.
import { tileInfo } from '../systems/farm/rules.js';
import { CROPS, WATER_BANDS, STAGE_NAMES_TR, STAGE_THRESHOLDS } from '../data/crops.js';
import { SOIL } from '../data/farming.js';
import { STR } from './strings.js';
import { ICON, TOOL_ICON } from './icons.js';
import { cropIcon } from './itemIcons.js';
import { h, setText } from './frame.js';
import { shield, tap } from './touch.js';

const PH_MIN = SOIL.phRange[0], PH_MAX = SOIL.phRange[1];
const pct = (v) => (v < 0 ? 0 : v > 100 ? 100 : v);
const phPos = (ph) => pct(((ph - PH_MIN) / (PH_MAX - PH_MIN)) * 100);
const r1 = (v) => Math.round(v * 10) / 10;

function setW(el, v) {
  const s = `${pct(v).toFixed(1)}%`;
  if (el.__w !== s) { el.__w = s; el.style.width = s; }
}
function setL(el, v) {
  const s = `${pct(v).toFixed(1)}%`;
  if (el.__l !== s) { el.__l = s; el.style.left = s; }
}
function setCls(el, cls) {
  if (el.__c !== cls) { el.__c = cls; el.className = cls; }
}
function setShow(el, on) {
  if (el.__s !== on) { el.__s = on; el.hidden = !on; }
}

/** rules.tileInfo stub iken ekin bilgisini tile.crop'tan türet (yalnızca gösterim için). */
function fallbackCrop(tile) {
  const c = tile && tile.crop;
  if (!c) return null;
  const def = CROPS[c.id];
  const g = Math.max(0, Math.min(1, c.growth || 0));
  const stage = c.stage | 0;
  const days = def ? Math.max(0, (1 - g) * def.growDays) : 0;
  return {
    name: def ? def.name : c.id, stage, stageName: STAGE_NAMES_TR[stage] || '',
    growthPct: Math.round(g * 100), health: c.health ?? 100, daysLeft: stage >= STAGE_THRESHOLDS.length - 1 ? 0 : days,
    qualityEstimate: null, pest: c.pest || 0, disease: c.disease || 0, readyIn: days,
  };
}

export function createTileCard(root, ctx) {
  const { state } = ctx;
  const el = h('div', 'tilecard glass interactive');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', STR.tileCard);
  el.innerHTML = `
    <header>
      <span class="tc-ic"></span>
      <div class="tc-tt"><h3 class="tc-name"></h3><div class="tc-sub"></div></div>
      <span class="qbadge" hidden></span>
      <button type="button" class="close" aria-label="${STR.close}"><span class="ic">${ICON.close}</span></button>
    </header>
    <div class="tc-body scrollable">
      <section class="tc-crop">
        <div class="row"><span class="k tc-stage"></span><span class="v num tc-gp"></span></div>
        <div class="bar grow"><i></i></div>
        <div class="row"><span class="k">${STR.health}</span><span class="v num tc-hv"></span></div>
        <div class="bar hp"><i></i></div>
        <div class="row dim"><span class="tc-days"></span><span class="tc-qn"></span></div>
      </section>
      <div class="chips"></div>
      <section class="tc-soil">
        <div class="row"><span class="k">${STR.moisture}</span><span class="v"><b class="num tc-mv"></b><small class="tc-band"></small></span></div>
        <div class="bar moist"><span class="band"></span><i></i></div>
        <div class="row l2"><span class="k">${STR.nutrients}</span><span class="v small tc-org"></span></div>
        <div class="npk">
          ${['n', 'p', 'k'].map((k) => `<div class="nut nut-${k}"><span class="nk">${k.toUpperCase()}</span><div class="bar"><span class="tick"></span><i></i></div><span class="nv num"></span></div>`).join('')}
        </div>
        <div class="row l2"><span class="k">${STR.ph}</span><span class="v"><b class="num tc-ph"></b><small class="tc-phs"></small></span></div>
        <div class="phscale"><span class="ideal" style="left:${phPos(SOIL.phIdeal[0])}%;width:${phPos(SOIL.phIdeal[1]) - phPos(SOIL.phIdeal[0])}%"></span><span class="mk"></span></div>
        <div class="phlbl num"><span>${PH_MIN}</span><span>${STR.phIdeal}</span><span>${PH_MAX}</span></div>
      </section>
      <ul class="warns"></ul>
      <section class="tc-hist">
        <div class="row"><span class="k">${STR.history}</span></div>
        <div class="hist"></div>
      </section>
    </div>`;
  shield(el);
  root.appendChild(el);

  const q = (s) => el.querySelector(s);
  const E = {
    ic: q('.tc-ic'), name: q('.tc-name'), sub: q('.tc-sub'), qb: q('.qbadge'),
    crop: q('.tc-crop'), stage: q('.tc-stage'), gp: q('.tc-gp'), grow: q('.bar.grow i'),
    hv: q('.tc-hv'), hp: q('.bar.hp i'), hpBar: q('.bar.hp'), days: q('.tc-days'), qn: q('.tc-qn'),
    chips: q('.chips'), mv: q('.tc-mv'), band: q('.tc-band'), moist: q('.bar.moist i'), moistBar: q('.bar.moist'),
    bandEl: q('.bar.moist .band'), org: q('.tc-org'), ph: q('.tc-ph'), phs: q('.tc-phs'), phMk: q('.phscale .mk'),
    warns: q('.warns'), hist: q('.hist'),
    nut: ['n', 'p', 'k'].map((k) => ({ k, fill: q(`.nut-${k} .bar i`), tick: q(`.nut-${k} .tick`), v: q(`.nut-${k} .nv`) })),
  };
  tap(q('.close'), () => api.close());

  let openId = null;
  let dirty = false;
  let open = false;
  let chipsKey = '', warnKey = '', histKey = '', icKey = '';

  function paint() {
    const tile = state.tiles && state.tiles[openId];
    let info = null;
    try { info = tileInfo(state, openId, ctx.now ? ctx.now() : null); } catch (e) { console.error('[ui] tileInfo', e); }
    if (!tile || !info) { api.close(); return; }
    const soil = info.soil || {};
    const crop = info.crop || (tile.crop ? fallbackCrop(tile) : null);
    const cid = tile.crop && tile.crop.id;
    const def = cid ? CROPS[cid] : null;
    const dead = !!(tile.crop && tile.crop.dead);

    // Başlık
    const ik = crop && cid ? `c:${cid}` : tile.state;
    if (ik !== icKey) {
      icKey = ik;
      E.ic.innerHTML = crop && cid ? cropIcon(cid) : (tile.state === 'plowed' ? TOOL_ICON.hoe : TOOL_ICON.weed);
      setCls(E.ic, `tc-ic${crop ? ' crop' : ''}`);
    }
    setText(E.name, crop ? crop.name : tile.state === 'plowed' ? STR.soilPlowed : STR.soilGrass);
    setText(E.sub, crop ? `${crop.stageName || ''}` : `${tile.state === 'plowed' ? STR.soilEmpty : STR.noCrop} · ${STR.tileTitle(tile.tx, tile.ty)}`);

    // Kalite rozeti
    const qe = crop && !dead ? crop.qualityEstimate : null;
    setShow(E.qb, !!qe);
    if (qe) { setText(E.qb, qe); setCls(E.qb, `qbadge q-${qe}`); E.qb.title = `${STR.quality}: ${STR.qualityName[qe] || qe}`; }

    // Ekin bölümü
    setShow(E.crop, !!crop);
    if (crop) {
      const gp = Math.round(pct(Number(crop.growthPct) || 0));
      setText(E.stage, `${STR.growth} · ${crop.stageName || ''}`);
      setText(E.gp, `%${gp}`);
      setW(E.grow, gp);
      const hp = Math.round(pct(Number(crop.health) || 0));
      setText(E.hv, `${hp}`);
      setW(E.hp, hp);
      setCls(E.hpBar, `bar hp ${hp < 40 ? 'low' : hp < 70 ? 'mid' : 'ok'}`);
      const dl = Number(crop.daysLeft);
      setText(E.days, dead ? STR.chips.dead : STR.daysLeft(Number.isFinite(dl) ? dl : 0));
      setText(E.qn, qe ? `${STR.quality}: ${STR.qualityName[qe] || qe}` : '');
    }

    // Çipler
    const weeds = Number(info.weeds) || 0;
    const m = Number(soil.moisture) || 0;
    const band = WATER_BANDS[def ? def.water : 'med'];
    const chips = [];
    if (dead) chips.push(['bad', STR.chips.dead, TOOL_ICON.alert]);
    else if (crop && crop.health < 40) chips.push(['warn', STR.chips.wither, TOOL_ICON.alert]);
    if (crop && crop.pest > 0.05) chips.push(['bad', `${STR.chips.pest} %${Math.round(crop.pest * 100)}`, TOOL_ICON.bug]);
    if (crop && crop.disease > 0.05) chips.push(['bad', `${STR.chips.disease} %${Math.round(crop.disease * 100)}`, TOOL_ICON.alert]);
    if (weeds > 0.08) chips.push(['warn', `${STR.chips.weeds} %${Math.round(weeds * 100)}`, TOOL_ICON.weed]);
    if (tile.state === 'plowed' && m < SOIL.droughtBelow) chips.push(['warn', STR.chips.dry, TOOL_ICON.drop]);
    else if (m > SOIL.waterlogAbove) chips.push(['warn', STR.chips.wet, TOOL_ICON.drop]);
    const ck = chips.map((c) => c[0] + c[1]).join('|');
    if (ck !== chipsKey) {
      chipsKey = ck;
      E.chips.innerHTML = chips.map(([k, t, ic]) => `<span class="chip c-${k}"><span class="ci">${ic}</span>${t}</span>`).join('');
      setShow(E.chips, chips.length > 0);
    }

    // Nem
    setText(E.mv, `%${Math.round(m)}`);
    setText(E.band, ` · ${STR.idealBand(band.min, band.max)}`);
    setW(E.moist, m);
    setL(E.bandEl, band.min); setW(E.bandEl, band.max - band.min);
    setCls(E.moistBar, `bar moist ${m < band.min ? 'lo' : m > band.max ? 'hi' : 'ok'}`);
    setText(E.org, tile.organic === false ? '' : STR.organic);

    // N/P/K
    for (const nu of E.nut) {
      const v = Number(soil[nu.k]) || 0;
      setW(nu.fill, v);
      setText(nu.v, String(Math.round(v)));
      const need = def ? def.need[nu.k] : null;
      setShow(nu.tick, need != null);
      if (need != null) setL(nu.tick, need);
      setCls(nu.fill, need != null && v < need * 0.8 ? 'lo' : '');
    }

    // pH
    const ph = Number(soil.ph) || 7;
    setText(E.ph, r1(ph).toFixed(1));
    setText(E.phs, ` · ${ph < SOIL.phIdeal[0] ? STR.phAcid : ph > SOIL.phIdeal[1] ? STR.phBase : STR.phOk}`);
    setL(E.phMk, phPos(ph));
    setCls(E.phMk, `mk ${ph < SOIL.phIdeal[0] - 0.5 || ph > SOIL.phIdeal[1] + 0.5 ? 'bad' : ph < SOIL.phIdeal[0] || ph > SOIL.phIdeal[1] ? 'warn' : 'ok'}`);

    // Uyarılar
    const warns = Array.isArray(info.warnings) ? info.warnings : [];
    const wk = warns.join('|');
    if (wk !== warnKey) {
      warnKey = wk;
      E.warns.textContent = '';
      for (const w of warns) { const li = document.createElement('li'); li.textContent = String(w); E.warns.appendChild(li); }
      setShow(E.warns, warns.length > 0);
    }

    // Geçmiş
    const hist = Array.isArray(info.history) ? info.history : [];
    const hk = hist.join(',');
    if (hk !== histKey) {
      histKey = hk;
      if (!hist.length) E.hist.innerHTML = `<span class="none">${STR.historyNone}</span>`;
      else E.hist.innerHTML = hist.map((id) => `<span class="hi" title="${CROPS[id] ? CROPS[id].name : id}">${cropIcon(id)}<small>${CROPS[id] ? CROPS[id].name : id}</small></span>`).join('');
    }
  }

  const api = {
    el,
    get isOpen() { return open; },
    get tileId() { return openId; },
    show(tileId) {
      if (tileId == null || !(state.tiles && state.tiles[tileId])) { api.close(); return; }
      if (tileId !== openId) { E.body && (E.body.scrollTop = 0); }
      openId = tileId;
      dirty = true;
      if (!open) {
        open = true;
        el.classList.add('open');
        root.classList.add('card-open');
      } else {
        el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap');
      }
    },
    close() {
      if (!open) return;
      open = false;
      openId = null;
      el.classList.remove('open', 'swap');
      root.classList.remove('card-open');
    },
    /** farm:changed {tileIds} — açık karo içindeyse (ya da liste yoksa) yeniden çiz. */
    onFarmChanged(p) {
      if (!open) return;
      const ids = p && p.tileIds;
      if (!Array.isArray(ids) || ids.indexOf(openId) >= 0) dirty = true;
    },
    markDirty() { if (open) dirty = true; },
    render() {
      if (!open || !dirty) return;
      dirty = false;
      paint();
    },
  };
  E.body = q('.tc-body');
  return api;
}
