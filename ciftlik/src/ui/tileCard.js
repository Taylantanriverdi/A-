// Karo bilgi kartı (İncele aleti). Masaüstünde sağda cam panel, telefonda alttan sayfa.
// Veri: rules.tileInfo(state, tileId, now) — yalnızca okunur. DOM bir kez kurulur, sonra yalnızca değişen yazılır.
import { tileInfo } from '../systems/farm/rules.js';
import { CROPS, WATER_BANDS, STAGE_NAMES_TR, STAGE_THRESHOLDS } from '../data/crops.js';
import { SOIL, HEALTH } from '../data/farming.js';
import { STR } from './strings.js';
import { ICON, TOOL_ICON } from './icons.js';
import { cropIcon } from './itemIcons.js';
import { h, setText } from './frame.js';
import { shield, tap } from './touch.js';

const PH_MIN = SOIL.phRange[0], PH_MAX = SOIL.phRange[1];
const pct = (v) => (v < 0 ? 0 : v > 100 ? 100 : v);
const phPos = (ph) => pct(((ph - PH_MIN) / (PH_MAX - PH_MIN)) * 100);
const r1 = (v) => Math.round(v * 10) / 10;
// Uyarı kodu → önem (bad/warn/info/late), ikon ve aynı bilgiyi gösteren çip anahtarı (tekrarı önlemek için)
const WARN_META = {
  dry: { sev: 'warn', ic: 'drop', chip: 'dry' },
  wet: { sev: 'warn', ic: 'drop', chip: 'wet' },
  lowN: { sev: 'warn', ic: 'fertilize' }, lowP: { sev: 'warn', ic: 'fertilize' }, lowK: { sev: 'warn', ic: 'fertilize' },
  acidic: { sev: 'warn', ic: 'alert' }, alkaline: { sev: 'warn', ic: 'alert' },
  pest: { sev: 'bad', ic: 'bug', chip: 'pest' },
  disease: { sev: 'bad', ic: 'alert', chip: 'disease' },
  weeds: { sev: 'warn', ic: 'weed', chip: 'weeds' },
  rotation: { sev: 'warn', ic: 'seed' },
  outOfSeason: { sev: 'bad', ic: 'calendar' },
  wither: { sev: 'warn', ic: 'alert', chip: 'wither' },
  rotting: { sev: 'bad', ic: 'harvest' },
  revertSoon: { sev: 'info', ic: 'grass' },
  lateInSeason: { sev: 'late', ic: 'calendar' },
};
const SEV_RANK = { bad: 0, warn: 1, late: 2, info: 3 };
// Eski şema (düz metin) → kod
const TEXT_CODE = {
  'Zararlı var': 'pest', 'Hastalık var': 'disease', 'Yabani ot': 'weeds', 'Bitki soluyor': 'wither', 'Toprak kuru': 'dry',
  'pH asidik': 'acidic', 'pH bazik': 'alkaline', 'Azot düşük': 'lowN', 'Mevsim dışı': 'outOfSeason', 'Çürümek üzere': 'rotting',
};
/** tileInfo.warnings ([{code,text}] ya da string[]) → [{code, text, sev, ic}] */
function normWarn(w) {
  let code = null, text = '';
  if (w && typeof w === 'object') { code = w.code || null; text = w.text || ''; }
  else if (w != null) {
    text = String(w);
    code = TEXT_CODE[text] || (/^Ekim nöbeti/.test(text) ? 'rotation' : null);
  }
  if (!text && code) text = STR.warn[code] || code;
  if (!text) return null;
  const m = (code && WARN_META[code]) || { sev: 'warn', ic: 'alert' };
  return { code, text, sev: m.sev, ic: m.ic, chip: m.chip };
}
const PORTRAIT_MQ = '(max-width: 600px) and (orientation: portrait)';

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
    <header class="tc-head">
      <span class="tc-ic"></span>
      <div class="tc-tt"><h3 class="tc-name"></h3><div class="tc-sub"></div></div>
      <span class="qbadge" hidden></span>
      <button type="button" class="close" aria-label="${STR.close}"><span class="ic">${ICON.close}</span></button>
    </header>
    <div class="tc-body scrollable">
      <div class="tc-hint"><span class="hi"></span><span class="ht"></span></div>
      <section class="tc-crop">
        <div class="row"><span class="k tc-stage"></span><span class="v num tc-gp"></span></div>
        <div class="bar grow"><i></i></div>
        <div class="tc-hpwrap">
          <div class="row"><span class="k">${STR.health}</span><span class="v num tc-hv"></span></div>
          <div class="bar hp"><i></i></div>
        </div>
        <div class="row dim"><span class="tc-days"></span><span class="tc-qn"></span></div>
      </section>
      <div class="tc-sum">
        <span class="sm sm-m"><span class="si">${TOOL_ICON.drop}</span><span class="sk">${STR.moisture}</span><b class="num"></b></span>
        <span class="sm sm-h"><span class="si">${TOOL_ICON.spark}</span><span class="sk"></span><b class="num"></b></span>
      </div>
      <div class="tc-topwarn"><span class="ci"></span><span class="ct"></span></div>
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
      <button type="button" class="tc-more"><span class="ic">${TOOL_ICON.chevron}</span><span class="tx">${STR.expand}</span></button>
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
    hint: q('.tc-hint'), hintIc: q('.tc-hint .hi'), hintTx: q('.tc-hint .ht'),
    sum: q('.tc-sum'), smM: q('.sm-m b'), smHk: q('.sm-h .sk'), smH: q('.sm-h b'), smHel: q('.sm-h'), smMel: q('.sm-m'),
    top: q('.tc-topwarn'), topIc: q('.tc-topwarn .ci'), topTx: q('.tc-topwarn .ct'),
    more: q('.tc-more'), moreTx: q('.tc-more .tx'), head: q('.tc-head'),
    nut: ['n', 'p', 'k'].map((k) => ({ k, fill: q(`.nut-${k} .bar i`), tick: q(`.nut-${k} .tick`), v: q(`.nut-${k} .nv`) })),
  };
  tap(q('.close'), () => api.close());
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia(PORTRAIT_MQ) : null;
  const isSheet = () => !!(mq && mq.matches);

  let openId = null;
  let dirty = false;
  let open = false;
  let compact = true;
  let ensurePending = false;
  let chipsKey = '', warnKey = '', histKey = '', icKey = '', topKey = '', hintKey = '';

  function setCompact(v) {
    compact = !!v;
    el.classList.toggle('compact', compact);
    setText(E.moreTx, compact ? STR.expand : STR.collapse);
    E.more.setAttribute('aria-expanded', compact ? 'false' : 'true');
    if (compact && E.body) E.body.scrollTop = 0;
  }
  setCompact(true);
  tap(E.more, () => setCompact(!compact));

  // Alttan sayfa jestleri (yalnızca dikey telefon): başlığa dokun → aç/kapa; yukarı çek → genişlet; aşağı çek → küçült/kapat
  let gY = 0, gId = -1;
  E.head.addEventListener('pointerdown', (e) => {
    if (!isSheet() || (e.target && e.target.closest && e.target.closest('.close'))) return;
    gId = e.pointerId; gY = e.clientY;
    try { E.head.setPointerCapture(e.pointerId); } catch (_) { /* yok say */ }
  });
  const gEnd = (e) => {
    if (e.pointerId !== gId) return;
    gId = -1;
    if (e.type === 'pointercancel') return;
    const dy = e.clientY - gY;
    if (dy < -18) setCompact(false);
    else if (dy > 18) { if (compact) api.close(); else setCompact(true); }
    else if (Math.abs(dy) < 8) setCompact(!compact);
  };
  E.head.addEventListener('pointerup', gEnd);
  E.head.addEventListener('pointercancel', gEnd);

  /** Dokunulan karo kartın / HUD'un altında kalmasın: kamera ondan sorumlu (engine). Kullanıcı eylemi başına bir kez ölçülür. */
  function ensureVisible(tile) {
    const vh = window.innerHeight || 0;
    let insetBottom = 0;
    if (isSheet()) insetBottom = vh - el.offsetTop + 16;
    else {
      const tools = root.querySelector('.hud-tools');
      if (tools) insetBottom = vh - tools.getBoundingClientRect().top + 16;
    }
    const left = root.querySelector('.hud-left');
    const insetTop = left ? Math.round(left.getBoundingClientRect().bottom + 8) : 0;
    ctx.bus.emit('camera:ensureVisible', {
      x: (tile.tx + 0.5) * 64, y: (tile.ty + 0.5) * 44,
      insetBottom: Math.max(0, Math.round(insetBottom)), insetTop,
    });
  }

  function paint() {
    const tile = state.tiles && state.tiles[openId];
    let info = null;
    try { info = tileInfo(state, openId, ctx.now ? ctx.now() : null); } catch (e) { console.error('[ui] tileInfo', e); }
    if (!tile || !info || info.blocked) { api.close(); return; }
    const soil = info.soil || {};
    const crop = info.crop || (tile.crop ? fallbackCrop(tile) : null);
    const cid = tile.crop && tile.crop.id;
    const def = cid ? CROPS[cid] : null;
    const dead = !!((crop && crop.dead) || (tile.crop && tile.crop.dead));

    // Başlık
    const ik = crop && cid ? `c:${cid}` : tile.state;
    // Ekin yokken ipucu (çim: çapa ile sür; sürülmüş: ekime hazır)
    const hintK = crop ? '' : tile.state === 'plowed' ? 'p' : 'g';
    if (hintK !== hintKey) {
      hintKey = hintK;
      setShow(E.hint, !!hintK);
      if (hintK) { E.hintIc.innerHTML = hintK === 'p' ? TOOL_ICON.seed : TOOL_ICON.hoe; setText(E.hintTx, hintK === 'p' ? STR.plowedHint : STR.grassHint); }
    }
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
      const dl = crop.daysLeft;
      let dtxt;
      if (dead) dtxt = STR.chips.dead;
      else if ((crop.stage | 0) >= 4) dtxt = crop.rotIn != null ? STR.rotIn(crop.rotIn) : STR.daysLeft(0);
      else if (typeof dl === 'number' && Number.isFinite(dl)) dtxt = STR.daysLeft(dl);
      else dtxt = typeof crop.readyIn === 'string' ? crop.readyIn : STR.notGrowing;
      setText(E.days, dtxt);
      setText(E.qn, qe ? `${STR.quality}: ${STR.qualityName[qe] || qe}` : '');
    }

    // Çipler
    const weeds = Number(info.weeds) || 0;
    const m = Number(soil.moisture) || 0;
    const band = WATER_BANDS[def ? def.water : 'med'];
    const chips = [];
    const has = { pest: false, disease: false, weeds: false, wither: false, dry: false, wet: false };
    if (dead) chips.push(['bad', STR.chips.dead, TOOL_ICON.alert]);
    else if (crop && crop.health < HEALTH.witherBelow) { has.wither = true; chips.push(['warn', STR.chips.wither, TOOL_ICON.alert]); }
    if (crop && !dead && crop.pest > 0) { has.pest = true; chips.push(['bad', `${STR.chips.pest} %${Math.max(1, Math.round(crop.pest * 100))}`, TOOL_ICON.bug]); }
    if (crop && !dead && crop.disease > 0) { has.disease = true; chips.push(['bad', `${STR.chips.disease} %${Math.max(1, Math.round(crop.disease * 100))}`, TOOL_ICON.alert]); }
    if (weeds > 0) { has.weeds = true; chips.push(['warn', `${STR.chips.weeds} %${Math.max(1, Math.round(weeds * 100))}`, TOOL_ICON.weed]); }
    if (tile.state === 'plowed' && m < SOIL.droughtBelow) { has.dry = true; chips.push(['warn', STR.chips.dry, TOOL_ICON.drop]); }
    else if (m > SOIL.waterlogAbove) { has.wet = true; chips.push(['warn', STR.chips.wet, TOOL_ICON.drop]); }
    const ck = chips.map((c) => c[0] + c[1]).join('|');
    if (ck !== chipsKey) {
      chipsKey = ck;
      E.chips.innerHTML = chips.map(([k, t, ic]) => `<span class="chip c-${k}"><span class="ci">${ic}</span>${t}</span>`).join('');
      setShow(E.chips, chips.length > 0);
    }

    // Nem
    // İdeal nem bandı yalnızca bir ekin varken anlamlı
    const live = !!(def && crop && !dead);
    setText(E.mv, `%${Math.round(m)}`);
    setShow(E.band, live);
    setShow(E.bandEl, live);
    if (live) {
      setText(E.band, ` · ${STR.idealBand(band.min, band.max)}`);
      setL(E.bandEl, band.min); setW(E.bandEl, band.max - band.min);
    }
    setW(E.moist, m);
    setCls(E.moistBar, `bar moist ${!live ? 'na' : m < band.min ? 'lo' : m > band.max ? 'hi' : 'ok'}`);
    // Kompakt özet (telefon): nem + sağlık (ekin yoksa pH)
    setText(E.smM, `%${Math.round(m)}`);
    setCls(E.smMel, `sm sm-m ${live ? (m < band.min ? 'lo' : m > band.max ? 'hi' : 'ok') : ''}`);
    if (crop) {
      const hp = Math.round(pct(Number(crop.health) || 0));
      setText(E.smHk, STR.health); setText(E.smH, String(hp));
      setCls(E.smHel, `sm sm-h ${hp < 40 ? 'lo' : hp < 70 ? 'mid' : 'ok'}`);
    } else {
      setText(E.smHk, STR.ph); setText(E.smH, r1(Number(soil.ph) || 7).toFixed(1));
      setCls(E.smHel, 'sm sm-h');
    }
    setText(E.org, (info.organic ?? tile.organic) === false ? '' : STR.organic);

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

    // Uyarılar — çip olarak zaten gösterilenleri tekrar listeleme
    const all = [];
    const src = Array.isArray(info.warnings) ? info.warnings : [];
    for (let i = 0; i < src.length; i++) { const w = normWarn(src[i]); if (w) all.push(w); }
    if (crop && !dead && crop.willMature === false && (crop.stage | 0) < 4
        && !all.some((w) => w.code === 'lateInSeason' || w.code === 'outOfSeason')) {
      const d = crop.seasonDaysLeft;
      all.push(normWarn({ code: 'lateInSeason', text: typeof d === 'number' ? STR.willNotMature(Math.max(0, Math.ceil(d))) : STR.lateInSeason }));
    }
    const warns = all.filter((w) => !(w.chip && has[w.chip]));
    warns.sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev]);
    const wk = warns.map((w) => w.sev + w.text).join('|');
    if (wk !== warnKey) {
      warnKey = wk;
      E.warns.textContent = '';
      for (const w of warns) {
        const li = document.createElement('li');
        li.className = `w-${w.sev}`;
        li.innerHTML = `<span class="wi">${TOOL_ICON[w.ic] || TOOL_ICON.alert}</span>`;
        li.appendChild(document.createTextNode(w.text));
        E.warns.appendChild(li);
      }
      setShow(E.warns, warns.length > 0);
    }
    // Kompakt: en önemli tek uyarı (önce çipler — ağır olanlar orada)
    let top = null;
    if (chips.length) {
      const c = chips.find((x) => x[0] === 'bad') || chips[0];
      top = { sev: c[0], text: c[1], icon: c[2] };
    }
    if (warns.length && (!top || SEV_RANK[warns[0].sev] < SEV_RANK[top.sev])) {
      top = { sev: warns[0].sev, text: warns[0].text, icon: TOOL_ICON[warns[0].ic] || TOOL_ICON.alert };
    }
    const tk = top ? top.sev + top.text : '';
    if (tk !== topKey) {
      topKey = tk;
      setShow(E.top, !!top);
      if (top) { setCls(E.top, `tc-topwarn w-${top.sev}`); E.topIc.innerHTML = top.icon; setText(E.topTx, top.text); }
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
      if (tileId !== openId) { E.body && (E.body.scrollTop = 0); ensurePending = true; }
      openId = tileId;
      dirty = true;
      if (!open) {
        open = true;
        setCompact(true);
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
      if (ensurePending && open) {
        ensurePending = false;
        const t = state.tiles && state.tiles[openId];
        if (t) ensureVisible(t);
      }
    },
  };
  E.body = q('.tc-body');
  return api;
}
