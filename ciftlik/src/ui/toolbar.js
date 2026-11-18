// Alt orta araç çubuğu (PLAN §8 "UI (ui-dev)"): 8 alet, tohum/gübre/ilaç seçici, tile:tap → farm:action.
// UI state'i yalnızca OKUR (state.inventory.items); seçim `tool:select`, eylem `farm:action` olarak gider.
import { TOOLS, TOOL_NAMES_TR, ITEMS } from '../data/items.js';
import { CROPS } from '../data/crops.js';
import { SEASON_NAMES_TR } from '../core/constants.js';
import { STR } from './strings.js';
import { TOOL_ICON } from './icons.js';
import { itemIcon } from './itemIcons.js';
import { h, setText } from './frame.js';
import { shield, tap } from './touch.js';
import * as rules from '../systems/farm/rules.js';
import { areaTiles } from '../systems/VehicleSystem.js';

// Aşama 8 (PLAN §15): İşaretle aleti (her zaman), Traktör/Biçerdöver (sahip olunca görünür).
const svg0 = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const EXTRA = ['mark', 'tractor', 'harvester'];
const ALL_TOOLS = TOOLS.concat(EXTRA);
const EXTRA_NAME = { mark: 'İşaretle', tractor: 'Traktör', harvester: 'Biçerdöver' };
const EXTRA_ICON = {
  mark: svg0('<path d="M6 20V4"/><path d="M6 5h11l-2.5 3.5L17 12H6" fill="currentColor" fill-opacity=".25"/>'),
  tractor: svg0('<circle cx="7" cy="16.5" r="3.3"/><circle cx="17.5" cy="17.5" r="2.2"/><path d="M10 16h5.5M4 13V8h6l2 5M12 8h3l2 4v3.5"/>'),
  harvester: svg0('<path d="M3 17h13V8H8l-2 4H3z" fill="currentColor" fill-opacity=".2"/><circle cx="8" cy="18" r="2"/><circle cx="16" cy="18" r="2"/><path d="M16 12h5v6h-3M19 6v6"/>'),
};
const VEH_TOOLS = ['tractor', 'harvester'];
const SEED_PICK = ['seed', 'mark', 'tractor']; // tohum seçici açan aletler (mark/tractor: boş seçim = yalnız sür)

/** rules.seedWarning (gameplay-dev ekliyor) varsa → {code,text} | null; yoksa / hata → null. */
function seedWarn(state, cropId, now) {
  const fn = rules.seedWarning;
  if (typeof fn !== 'function') return null;
  try { return fn(state, cropId, now) || null; } catch (e) { return null; }
}

/** Alet → farm:action tipi. 'hand' eylem üretmez (bilgi kartı). */
export const TOOL_ACTION = {
  hoe: 'plow', seed: 'plant', water: 'water', fertilize: 'fertilize', treat: 'treat', weed: 'weed', harvest: 'harvest',
};

// Eşya seçen aletler. seed listesi envanterden dinamik, diğerleri sabit.
const SEED_IDS = Object.keys(ITEMS).filter((id) => ITEMS[id].category === 'seed');
const FIXED_ITEMS = { fertilize: ['compost', 'npk', 'lime'], treat: ['pesticide', 'organic_spray'] };
const PICK_TITLE = { seed: STR.pickSeed, fertilize: STR.pickFert, treat: STR.pickTreat, mark: 'Tohum seç (seçilmezse: sürülecek işareti)', tractor: 'Tohum seç (seçilmezse yalnız sürer)' };

export function countItem(state, itemId) {
  const inv = state.inventory && state.inventory.items;
  const arr = inv && inv[itemId];
  if (!Array.isArray(arr)) return 0;
  let n = 0;
  for (let i = 0; i < arr.length; i++) { const q = arr[i] && arr[i].qty; if (q > 0) n += q; }
  return n;
}

export function createToolbar(root, ctx) {
  const { state, bus, calendar } = ctx;

  const wrap = h('div', 'hud-tools');
  const bar = h('div', 'toolbar glass interactive');
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', STR.toolbar);
  const picker = h('div', 'picker glass interactive scrollable');
  picker.setAttribute('role', 'listbox');
  picker.innerHTML = '<div class="pk-head"></div><div class="pk-grid"></div><div class="pk-empty"></div>';
  const pkHead = picker.querySelector('.pk-head');
  const pkGrid = picker.querySelector('.pk-grid');
  const pkEmpty = picker.querySelector('.pk-empty');
  shield(bar); shield(picker);
  wrap.append(picker, bar);
  root.appendChild(wrap);

  const btns = new Map(); // tool → {b, sel, selIc, selQty}
  ALL_TOOLS.forEach((t, i) => {
    const hasPick = SEED_PICK.includes(t) || t in FIXED_ITEMS;
    const b = h('button', `tool${hasPick ? ' has-pick' : ''}`,
      `<span class="ic">${TOOL_ICON[t] || EXTRA_ICON[t] || ''}</span><span class="lbl">${TOOL_NAMES_TR[t] || EXTRA_NAME[t] || t}</span><span class="key">${i < 8 ? i + 1 : ''}</span>` +
      (hasPick ? '<span class="sel"><span class="sel-ic"></span><span class="sel-q num"></span></span>' : ''));
    b.type = 'button';
    b.dataset.tool = t;
    const name = TOOL_NAMES_TR[t] || EXTRA_NAME[t] || t;
    b.title = i < 8 ? STR.toolKey(name, i + 1) : name;
    if (VEH_TOOLS.includes(t)) { b.classList.add('vehicle'); b.hidden = true; }
    b.setAttribute('aria-label', name);
    b.setAttribute('aria-pressed', 'false');
    tap(b, () => onToolButton(t));
    bar.appendChild(b);
    btns.set(t, {
      b,
      sel: b.querySelector('.sel'),
      selIc: b.querySelector('.sel-ic'),
      selQty: b.querySelector('.sel-q'),
      shownItem: undefined,
      shownQty: -1,
    });
  });

  let tool = 'hand';
  const selected = { seed: null, fertilize: null, treat: null, mark: null, tractor: null };
  let pickerFor = null;          // açık seçicinin aleti
  let pickerKey = '';            // seçici içeriği anahtarı (yeniden kurmayı önler)
  const pickRows = new Map();    // itemId → {b, q, sub, shownQty, shownOff, shownOn}
  const counts = Object.create(null);
  let invDirty = true;
  let seasonDirty = true;
  let season = '';
  let toolDirty = true;
  let markStroke = -3; const markSeen = new Set();
  let needToastStroke = -1; // "önce eşya seç" toast'ı fırça darbesi başına bir kez

  let emitting = false; // kendi yaydığımız tool:select'i dış olay sanmayalım
  const emitSelect = () => {
    const itemId = tool in selected ? selected[tool] : undefined;
    emitting = true;
    try { bus.emit('tool:select', itemId ? { tool, itemId } : { tool }); } finally { emitting = false; }
  };
  /** Dışarıdan gelen tool:select {tool, itemId?} (ör. debug.tool) → seçili aleti/eşyayı senkronla. */
  function onExternalSelect(p) {
    if (emitting || !p || !ALL_TOOLS.includes(p.tool)) return;
    const t = p.tool;
    if (t in selected && p.itemId && ITEMS[p.itemId]) selected[t] = p.itemId;
    const changed = t !== tool;
    if (changed) {
      tool = t;
      if (t in selected) {
        if (invDirty) { refreshCounts(); invDirty = false; }
        if (seasonDirty) { refreshSeason(); seasonDirty = false; }
        autoPick(t);
      }
      if (pickerFor && pickerFor !== t) closePicker();
      if (api.onToolChange) api.onToolChange(t);
    }
    toolDirty = true;
    // autoPick ile eşya değiştiyse diğer sistemler de bilsin
    if (t in selected && selected[t] && selected[t] !== p.itemId) emitSelect();
  }
  const offSelect = bus.on('tool:select', onExternalSelect);

  function refreshCounts() {
    for (const id of SEED_IDS) counts[id] = countItem(state, id);
    for (const k in FIXED_ITEMS) for (const id of FIXED_ITEMS[k]) counts[id] = countItem(state, id);
  }
  function refreshSeason() {
    const s = calendar(state.time.totalMinutes).season;
    if (s !== season) { season = s; return true; }
    return false;
  }
  const inSeason = (id) => {
    const c = CROPS[ITEMS[id].crop];
    return !!(c && c.seasons.includes(season));
  };
  const usable = (t, id) => (t === 'mark' || counts[id] > 0) && (!SEED_PICK.includes(t) || inSeason(id));
  const optionsFor = (t) => (t === 'mark' ? SEED_IDS : SEED_PICK.includes(t) ? SEED_IDS.filter((id) => counts[id] > 0) : FIXED_ITEMS[t] || []);

  function autoPick(t) {
    if (!(t in selected) || selected[t] || t === 'mark' || t === 'tractor') return;
    const opts = optionsFor(t);
    for (const id of opts) if (usable(t, id)) { selected[t] = id; return; }
  }

  function setTool(t, { open = false } = {}) {
    if (!ALL_TOOLS.includes(t)) return;
    const changed = t !== tool;
    const prevItem = t in selected ? selected[t] : null;
    tool = t;
    if (t in selected) {
      if (invDirty) { refreshCounts(); invDirty = false; }
      if (seasonDirty) { refreshSeason(); seasonDirty = false; }
      autoPick(t);
    }
    if (open && t in selected) openPicker(t);
    else if (pickerFor && pickerFor !== t) closePicker();
    const itemChanged = t in selected && selected[t] !== prevItem;
    if (changed || itemChanged) { toolDirty = true; emitSelect(); }
    if (changed && api.onToolChange) api.onToolChange(t);
  }

  function onToolButton(t) {
    if (t in selected) {
      if (tool === t && pickerFor === t) { closePicker(); return; }
      setTool(t, { open: true });
    } else {
      setTool(t);
      closePicker();
    }
  }

  function chooseItem(t, id) {
    if (!usable(t, id)) return;
    const changed = selected[t] !== id || tool !== t;
    selected[t] = (t === 'mark' || t === 'tractor') && selected[t] === id && tool === t ? null : id; // aynı tohuma tekrar dokunma: seçimi kaldır
    if (tool !== t) { tool = t; toolDirty = true; api.onToolChange && api.onToolChange(t); }
    toolDirty = true;
    closePicker();
    if (changed) emitSelect();
  }

  // ---- seçici (popover) ----
  function buildPicker(t) {
    const opts = optionsFor(t);
    const key = `${t}|${opts.join(',')}`;
    if (key === pickerKey) return;
    pickerKey = key;
    pickRows.clear();
    pkGrid.innerHTML = '';
    setText(pkHead, PICK_TITLE[t] || '');
    for (const id of opts) {
      const it = ITEMS[id];
      const b = h('button', 'pick',
        `<span class="pi">${itemIcon(id)}</span><span class="pn">${it.name.replace(/ Tohumu$/, '')}</span><span class="ps"></span><span class="pq num"></span>`);
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.dataset.item = id;
      tap(b, () => chooseItem(t, id));
      pkGrid.appendChild(b);
      pickRows.set(id, { b, q: b.querySelector('.pq'), sub: b.querySelector('.ps'), shownQty: -1, shownOff: null, shownOn: null, shownSub: null });
    }
    const empty = opts.length === 0;
    pkEmpty.style.display = empty ? '' : 'none';
    if (empty) setText(pkEmpty, STR.noSeeds);
  }

  function paintPicker() {
    if (!pickerFor) return;
    buildPicker(pickerFor);
    const now = SEED_PICK.includes(pickerFor) ? calendar(state.time.totalMinutes) : null;
    for (const [id, r] of pickRows) {
      const n = counts[id] | 0;
      if (n !== r.shownQty) { r.shownQty = n; setText(r.q, STR.qtyBadge(n)); }
      const seasonOk = !SEED_PICK.includes(pickerFor) || inSeason(id);
      const off = (n <= 0 && pickerFor !== 'mark') || !seasonOk;
      if (off !== r.shownOff) {
        r.shownOff = off;
        r.b.classList.toggle('off', off);
        r.b.disabled = off;
        r.b.setAttribute('aria-disabled', off ? 'true' : 'false');
      }
      let sub = '';
      let late = false;
      if (!seasonOk) {
        const c = CROPS[ITEMS[id].crop];
        sub = c.seasons.map((s) => SEASON_NAMES_TR[s]).join(' · ');
      } else if (n <= 0 && pickerFor !== 'mark') sub = STR.noneLeft;
      else if (SEED_PICK.includes(pickerFor)) {
        const w = seedWarn(state, ITEMS[id].crop, now);
        if (w) { late = true; sub = STR.lateShort; r.lateText = w.text || STR.lateInSeason; }
      }
      const subKey = (late ? '!' : '') + sub;
      if (subKey !== r.shownSub) {
        r.shownSub = subKey;
        setText(r.sub, sub);
        r.b.classList.toggle('late', late);
        r.b.title = !seasonOk ? `${STR.outOfSeason} — ${STR.seasonsLine(sub)}` : late ? `${ITEMS[id].name} — ${r.lateText}` : ITEMS[id].name;
      }
      const on = selected[pickerFor] === id;
      if (on !== r.shownOn) { r.shownOn = on; r.b.classList.toggle('on', on); r.b.setAttribute('aria-selected', on ? 'true' : 'false'); }
    }
  }

  function placePicker(t) {
    // Kullanıcı eylemi anında bir kez ölçülür (kare döngüsünde değil)
    const bb = btns.get(t).b.getBoundingClientRect();
    const wb = wrap.getBoundingClientRect();
    const pw = picker.offsetWidth;
    const vw = window.innerWidth;
    const margin = 8;
    let left = bb.left + bb.width / 2 - pw / 2;
    left = Math.max(margin, Math.min(vw - margin - pw, left));
    picker.style.left = `${Math.round(left - wb.left)}px`;
    picker.style.setProperty('--arrow-x', `${Math.round(bb.left + bb.width / 2 - left)}px`);
  }

  function openPicker(t) {
    if (invDirty) { refreshCounts(); invDirty = false; }
    if (seasonDirty) { refreshSeason(); seasonDirty = false; }
    pickerFor = t;
    paintPicker();
    picker.classList.add('open');
    placePicker(t);
    for (const [k, r] of btns) r.b.classList.toggle('picking', k === t);
  }
  function closePicker() {
    if (!pickerFor) return;
    pickerFor = null;
    picker.classList.remove('open');
    for (const [, r] of btns) r.b.classList.remove('picking');
  }

  // Seçici dışına dokunma → kapat (canvas dahil; eylem yine de gider)
  const onDownOutside = (e) => {
    if (!pickerFor) return;
    if (e.target && wrap.contains(e.target)) return;
    closePicker();
  };
  window.addEventListener('pointerdown', onDownOutside, true);
  const onResize = () => { if (pickerFor) placePicker(pickerFor); };
  window.addEventListener('resize', onResize);

  // ---- Araç modu: 3×3 önizleme (farm:areaHint) ve görünürlük ----
  let hintOn = false, vehKey = '';
  const isVeh = () => VEH_TOOLS.includes(tool);
  function onHover(p) {
    if (isVeh() && p && p.tileId) { hintOn = true; bus.emit('farm:areaHint', { tiles: areaTiles(p.tileId, 3) }); }
    else if (hintOn) { hintOn = false; bus.emit('farm:areaHint', { tiles: null }); }
  }
  const offHover = bus.on('tile:hover', onHover);
  let lastVehMsg = '', lastVehAt = 0;
  const offVeh = bus.on('vehicle:result', (p) => {
    if (!p || p.ok !== false || !p.reason || !isVeh()) return;
    const t = performance.now();
    if (p.reason === lastVehMsg && t - lastVehAt < 2500) return;
    lastVehMsg = p.reason; lastVehAt = t;
    bus.emit('toast', { text: String(p.reason), kind: 'bad' });
  });
  function syncVehicles() {
    const own = Array.isArray(state.vehicles) ? state.vehicles : [];
    const key = own.map((v) => v.type).join(',');
    if (key === vehKey) return;
    vehKey = key;
    for (const vt of VEH_TOOLS) {
      const has = own.some((v) => v.type === vt);
      btns.get(vt).b.hidden = !has;
      if (!has && tool === vt) setTool('hand');
    }
  }

  function render() {
    syncVehicles();
    if (toolDirty && !isVeh() && hintOn) { hintOn = false; bus.emit('farm:areaHint', { tiles: null }); }
    let selDirty = toolDirty;
    if (seasonDirty) { seasonDirty = false; if (refreshSeason()) selDirty = true; }
    if (invDirty) {
      invDirty = false;
      refreshCounts();
      selDirty = true;
      // Biten seçimi temizle
      for (const t in selected) {
        const id = selected[t];
        if (id && !(counts[id] > 0) && t !== 'mark') {
          selected[t] = null;
          if (tool === t) emitSelect();
        }
      }
    }
    if (selDirty) {
      if (pickerFor) paintPicker();
      for (const [t, r] of btns) {
        if (toolDirty) {
          const on = t === tool;
          r.b.classList.toggle('on', on);
          r.b.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
        if (!r.sel) continue;
        const id = selected[t] || null;
        if (id !== r.shownItem) {
          r.shownItem = id;
          r.sel.classList.toggle('show', !!id);
          r.selIc.innerHTML = id ? itemIcon(id) : '';
          const ti = ALL_TOOLS.indexOf(t);
          r.b.title = (ti < 8 ? STR.toolKey(TOOL_NAMES_TR[t] || EXTRA_NAME[t], ti + 1) : EXTRA_NAME[t]) + (id ? ` — ${ITEMS[id].name}` : '');
        }
        const n = id ? counts[id] | 0 : -1;
        if (n !== r.shownQty) { r.shownQty = n; setText(r.selQty, n >= 0 ? STR.qtyBadge(n) : ''); }
      }
      toolDirty = false;
    }
  }

  const api = {
    el: wrap,
    get tool() { return tool; },
    get isPickerOpen() { return !!pickerFor; },
    onToolChange: null,
    render,
    select: (t) => setTool(t),
    selectIndex(i) { const t = TOOLS[i]; if (t) onToolButton(t); },
    onHover,
    closePicker,
    markInventory() { invDirty = true; },
    markSeason() { seasonDirty = true; },
    /** tile:tap (alet ≠ hand) → tek farm:action. DOM işi yok (yalnızca nadir, kısıtlı toast). */
    apply(tileId, stroke = -2) {
      if (tileId == null) return;
      if (tool === 'tractor' || tool === 'harvester') {
        bus.emit('vehicle:work', tool === 'tractor' && selected.tractor ? { type: tool, tileId, itemId: selected.tractor } : { type: tool, tileId });
        return;
      }
      if (tool === 'mark') {
        if (stroke !== markStroke) { markStroke = stroke; markSeen.clear(); }
        if (markSeen.has(tileId)) return; // sürüklerken aynı karo iki kez aç/kapa olmasın
        markSeen.add(tileId);
        const itemId = selected.mark;
        bus.emit('farm:mark', itemId ? { tileId, plan: 'plant', itemId } : { tileId, plan: 'plow' });
        return;
      }
      const type = TOOL_ACTION[tool];
      if (!type || tileId == null) return;
      if (tool in selected) {
        const itemId = selected[tool];
        if (!itemId) {
          if (stroke !== needToastStroke || stroke === -2) {
            needToastStroke = stroke;
            bus.emit('toast', { text: STR.needItem[tool], kind: 'bad' });
            if (!pickerFor) openPicker(tool);
          }
          return;
        }
        bus.emit('farm:action', { type, tileId, itemId });
      } else {
        bus.emit('farm:action', { type, tileId });
      }
    },
    /** Açılış: 'hand' yayınla. */
    init() { emitSelect(); },
    destroy() {
      if (typeof offSelect === 'function') offSelect();
      if (typeof offHover === 'function') offHover();
      if (typeof offVeh === 'function') offVeh();
      window.removeEventListener('pointerdown', onDownOutside, true);
      window.removeEventListener('resize', onResize);
    },
  };
  return api;
}
