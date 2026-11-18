// DOM UI kökü — PLAN.md §7 "UI API".
// UI state'i yalnızca OKUR; tüm eylemler EventBus komutu olarak gider.
import './styles.css';
import { calendar as defaultCalendar } from '../core/timeUtils.js';
import { STR } from './strings.js';
import { createFrameLoop, h, setText } from './frame.js';
import { createClock, createMoney } from './hud.js';
import { createSpeed } from './speed.js';
import { createSettings } from './settings.js';
import { createToasts } from './toast.js';
import { createToolbar } from './toolbar.js';
import { createTileCard } from './tileCard.js';
import { createHarvestNotes, createCelebration } from './notes.js';
import { createPanelHost } from './panels.js';
import { createInventoryPanel } from './inventoryPanel.js';
import { createMarketPanel } from './marketPanel.js';
import { createShopPanel } from './shopPanel.js';
import { createBuildingPanel } from './buildingPanel.js';
import { createWorkerPanel, hudPortrait } from './workerPanel.js';
import { createMachinePanel } from './machinePanel.js';
import { createBuildMode } from './buildMode.js';
import { formatMoney } from './hud.js';
import { ITEMS } from '../data/items.js';
import { tileInfo } from '../systems/farm/rules.js';

const STROKE_GAP_MS = 400; // parmak/fare basılı değilken son tile:tap'ten bu kadar sonra yeni fırça darbesi
const CARD_OUTSIDE_MS = 450; // dışarı dokunma ile yeni karo dokunuşunu ayırt etme penceresi

const isTypingTarget = (t) => {
  if (!t || t === document.body) return false;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return true;
  if (tag === 'INPUT') {
    const type = (t.type || '').toLowerCase();
    return type !== 'button' && type !== 'checkbox' && type !== 'radio';
  }
  return false;
};

/**
 * @param {{state:object, bus:import('../core/EventBus.js').default, calendar?:Function, debug?:boolean}} opts
 * @returns {{destroy():void}}
 */
export function mountUI({ state, bus, calendar = defaultCalendar, debug = false }) {
  const root = document.getElementById('ui');
  if (!root) { console.warn('[ui] #ui kökü yok'); return { destroy() {} }; }
  root.innerHTML = '';
  root.lang = 'tr';
  const ctx = { state, bus, calendar, now: () => calendar(state.time.totalMinutes) };
  const offs = [];
  const on = (n, fn) => offs.push(bus.on(n, fn));

  // Katmanlar: üst HUD ve alt HUD letterbox'ta solar; toast + panel solmaz
  const top = h('div', 'hud-layer hud-top');
  const bottom = h('div', 'hud-layer hud-bottom');
  root.append(top, bottom);

  const left = h('div', 'hud-left');
  top.appendChild(left);
  const clock = createClock(left, ctx);
  const money = createMoney(top, ctx);
  const speed = createSpeed(bottom, ctx);
  const toolbar = createToolbar(bottom, ctx);
  const card = createTileCard(root, ctx);
  const notes = createHarvestNotes(bottom);
  const celebrate = createCelebration(root); // HUD katmanı dışında: sinematikte de görünür
  const toasts = createToasts(root); // z-index ile büyük panelin de üstünde kalır (styles.css)
  const settings = createSettings(root, ctx, money.el);
  toolbar.onToolChange = (t) => { if (t !== 'hand') card.close(); };

  // ---- Aşama 3: Envanter / Pazar / Mağaza (tek büyük panel) + seviye kutlaması ----
  const panels = createPanelHost(root, ctx, money.el);
  const openPanel = (id, arg) => panels.open(id, arg);
  const invPanel = createInventoryPanel(ctx, { openPanel });
  const mktPanel = createMarketPanel(ctx);
  const shopPanel = createShopPanel(ctx);
  panels.register(invPanel);
  panels.register(mktPanel);
  const bldPanel = createBuildingPanel(ctx);
  panels.register(shopPanel);
  panels.register(bldPanel);
  const wrkPanel = createWorkerPanel(ctx, { closePanel: () => panels.close() });
  panels.register(wrkPanel);
  panels.setWorkerPortrait(hudPortrait(30));
  const machPanel = createMachinePanel(ctx);
  panels.register(machPanel);
  const build = createBuildMode(root, ctx, {
    nav: panels.nav,
    closeAll: () => { panels.close(); if (toolbar.isPickerOpen) toolbar.closePicker(); if (card.isOpen) card.close(); if (settings.isOpen) settings.close(); toolbar.select('hand'); },
    toast: toasts.push,
  });
  panels.onChange((id) => {
    if (!id) return;
    if (build.active) build.exit();
    if (toolbar.isPickerOpen) toolbar.closePicker();
    if (card.isOpen) card.close();
    if (settings.isOpen) settings.close();
  });

  // FPS (debug)
  let fpsEl = null, fpsVal = null, fpsPending = -1, fpsCls = '';
  if (debug) {
    fpsEl = h('div', 'fps glass num', `${STR.fps} <b>--</b>`);
    fpsVal = fpsEl.querySelector('b');
    bottom.appendChild(fpsEl);
  }

  // Sinematik letterbox → HUD solar
  let letterboxPending = null;

  // Olaylar: yalnızca işaretle, yazım kare döngüsünde
  on('time:minute', clock.markDirty);
  on('time:day', clock.markDirty);
  on('weather:changed', clock.markDirty);
  on('money:changed', money.onMoney);
  on('save:done', money.onSaved);
  on('time:speedChanged', speed.onSpeedChanged);
  on('settings:quality', settings.onQuality);
  on('toast', toasts.push);
  on('cinematic:letterbox', (p) => { letterboxPending = p || { amount: 0 }; celebrate.onLetterbox(p); });
  on('camera:cinematicStart', (p) => celebrate.onCinematicStart(p));

  // ---- Tarım (Aşama 2) ----
  // Fırça darbesi: dünyada yeni bir basış ya da (basılı değilken) 400 ms ara → yeni darbe.
  // Ret toast'ları darbe başına neden başına bir kez gösterilir (yavaş boyamada tekrar yok).
  let lastTileTap = 0;
  let stroke = 0, strokeSeenSeq = -1, downSeq = 0, pointerHeld = false;
  const strokeReasons = new Set();
  const blockedLabel = (id, p) => {
    if (p && p.blocked && p.label) return p.label;
    let info = null;
    try { info = tileInfo(state, id, null); } catch (e) { info = null; }
    return info && info.blocked ? (info.label || 'Engel') : null;
  };
  on('tile:tap', (p) => {
    if (!p) return;
    const id = p.tileId != null ? p.tileId : (p.tx != null ? `${p.tx},${p.ty}` : null);
    const now = performance.now();
    if (downSeq !== strokeSeenSeq || (!pointerHeld && now - lastTileTap > STROKE_GAP_MS)) {
      strokeSeenSeq = downSeq; stroke++; strokeReasons.clear();
    }
    lastTileTap = now;
    if (build.active) { build.onTap(p); return; }
    if (toolbar.tool === 'hand') {
      const lbl = id != null ? blockedLabel(id) : null;
      if (lbl) {
        card.close();
        if (!strokeReasons.has(lbl)) { strokeReasons.add(lbl); toasts.push({ text: lbl, kind: 'info' }); }
        return;
      }
      card.show(id);
    } else toolbar.apply(id, stroke); // boyama: tek emit, DOM işi yok
  });
  on('tile:hover', build.onHover);
  on('build:result', build.onResult);
  on('money:changed', build.markDirty);
  on('placed:changed', build.markDirty);
  on('inventory:changed', toolbar.markInventory);
  on('time:day', toolbar.markSeason);
  on('time:season', toolbar.markSeason);
  on('farm:changed', card.onFarmChanged);
  on('time:hour', card.markDirty);
  on('farm:harvested', notes.push);
  on('farm:milestone', (p) => {
    if (!p || p.kind !== 'firstHarvest') return;
    const h0 = notes.claim(p.tileId); // aynı hasadın küçük notu yerine büyük kutlama kartı
    celebrate.arm(h0 || { cropId: p.cropId, itemId: p.cropId }); // sinematik başlayınca görünür
  });

  // ---- Aşama 3 olayları (yalnızca kirli işaretler; DOM işi panel açıkken rAF'ta) ----
  const markAll = () => { invPanel.markDirty(); mktPanel.markDirty(); shopPanel.markDirty(); bldPanel.markDirty(); machPanel.markDirty(); };
  const itemName = (id) => (ITEMS[id] && ITEMS[id].name) || String(id || '');
  on('ui:open', (p) => {
    const id = p && p.panel;
    if (build.active) build.exit();
    if (id === 'inventory' || id === 'market' || id === 'shop' || id === 'building' || id === 'worker' || id === 'machine') openPanel(id, p);
  });
  on('workers:changed', () => wrkPanel.markDirty());
  on('worker:result', (p) => { wrkPanel.markDirty(); if (p && p.ok === false && p.reason) toasts.push({ text: String(p.reason), kind: 'bad' }); });
  on('money:changed', () => wrkPanel.markDirty());
  on('time:day', () => wrkPanel.markDirty());
  on('inventory:changed', markAll);
  // ---- Aşama 4: hayvancılık ----
  on('animals:changed', () => { bldPanel.markDirty(); shopPanel.markDirty(); });
  on('building:built', () => { bldPanel.markDirty(); shopPanel.markDirty(); });
  on('time:hour', () => bldPanel.markDirty());
  on('animal:result', (p) => {
    shopPanel.onAnimalResult(); bldPanel.markDirty();
    if (!p) return;
    if (p.ok === false && p.reason) toasts.push({ text: String(p.reason), kind: 'bad' });
    else if (p.ok && p.type === 'collect') toasts.push({ text: STR.bld.collected(p.collected, itemName), kind: 'good' });
    else if (p.ok && p.text) toasts.push({ text: p.text, kind: 'info' });
  });
  on('animal:born', (p) => { if (p && p.reason === 'bred' && p.animal) toasts.push({ text: STR.bld.born(p.animal.name), kind: 'good' }); });
  // ---- Aşama 5: atölyeler ----
  on('machines:changed', () => { machPanel.markDirty(); shopPanel.markDirty(); });
  on('time:hour', () => machPanel.markDirty());
  on('machine:result', (p) => {
    machPanel.onResult(); shopPanel.onAnimalResult();
    if (!p) return;
    if (p.ok === false && p.reason) toasts.push({ text: String(p.reason), kind: 'bad' });
    else if (p.ok && p.type === 'collect') toasts.push({ text: STR.mach.collected(p.collected, itemName), kind: 'good' });
    else if (p.ok && p.text && p.type !== 'queue') toasts.push({ text: p.text, kind: 'info' });
  });
  on('market:pricesUpdated', () => { mktPanel.markDirty(); machPanel.markDirty(); });
  on('money:changed', () => shopPanel.markDirty());
  on('time:day', markAll);
  on('market:result', (p) => {
    mktPanel.onResult(p);
    if (!p) return;
    if (p.ok) {
      const amt = formatMoney(Number(p.total) || 0);
      const later = p.paidNow === false || p.channel === 'wholesale' && p.paidNow !== true;
      toasts.push({ text: later ? STR.soldLater(amt, p.qty, itemName(p.itemId)) : STR.sold(amt, p.qty, itemName(p.itemId)), kind: 'good' });
    } else if (p.reason) toasts.push({ text: String(p.reason), kind: 'bad' });
  });
  on('shop:result', (p) => {
    shopPanel.onResult(p);
    if (!p) return;
    if (p.ok) toasts.push({ text: STR.bought(formatMoney(Number(p.total) || 0), p.qty, itemName(p.itemId)), kind: 'info' });
    else if (p.reason) toasts.push({ text: String(p.reason), kind: 'bad' });
  });
  // Dolu envanter: spam yok (gerçek zamanda 5 sn'de bir)
  let fullAt = -1e9;
  on('inventory:full', () => {
    const t = performance.now();
    if (t - fullAt < 5000) return;
    fullAt = t;
    toasts.push({ text: STR.invFull, kind: 'bad' });
  });
  // Bozulma: aynı gün gelen olaylar tek özet bildirimde birleşir
  const spoil = { stale: 0, rotten: 0, timer: 0 };
  on('inventory:spoiled', (p) => {
    if (!p) return;
    if (p.toQ == null) spoil.rotten++; else spoil.stale++;
    clearTimeout(spoil.timer);
    spoil.timer = setTimeout(() => {
      const text = STR.spoiled(spoil.stale, spoil.rotten);
      spoil.stale = spoil.rotten = 0;
      if (text) toasts.push({ text, kind: 'bad' });
    }, 350);
  });
  on('farm:result', (p) => {
    if (!p || p.ok !== false || !p.reason) return;
    const r = String(p.reason);
    if (strokeReasons.has(r)) return;
    strokeReasons.add(r);
    toasts.push({ text: r, kind: 'bad' });
  });

  // Kart açıkken canvas'a "dokunup bırakma" (sürüklemesiz) ve ardından karo dokunuşu gelmezse → kapat
  let downX = 0, downY = 0, downOnWorld = false, outsideTimer = 0;
  const isWorld = (t) => !!(t && !root.contains(t));
  const onDown = (e) => {
    if (isWorld(e.target)) { downSeq++; pointerHeld = true; }
    downOnWorld = card.isOpen && isWorld(e.target);
    downX = e.clientX; downY = e.clientY;
  };
  const onUp = (e) => {
    if (e.isPrimary !== false) pointerHeld = false;
    if (!downOnWorld || !card.isOpen) return;
    downOnWorld = false;
    if (Math.abs(e.clientX - downX) > 8 || Math.abs(e.clientY - downY) > 8) return; // kaydırma
    const upAt = performance.now();
    clearTimeout(outsideTimer);
    outsideTimer = setTimeout(() => {
      if (lastTileTap < upAt - CARD_OUTSIDE_MS) card.close();
    }, 140);
  };
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointerup', onUp, true);
  const onCancel = () => { pointerHeld = false; };
  window.addEventListener('pointercancel', onCancel, true);

  if (debug) on('fps', (p) => { if (p && typeof p.fps === 'number') fpsPending = p.fps; });

  const loop = createFrameLoop();
  loop.add(clock.render);
  loop.add(money.render);
  loop.add(speed.render);
  loop.add(toolbar.render);
  loop.add(card.render);
  loop.add(notes.render);
  loop.add(celebrate.render);
  loop.add(panels.render);
  loop.add(build.render);
  loop.add(() => {
    if (letterboxPending) {
      const p = letterboxPending; letterboxPending = null;
      const ms = Math.max(150, Math.min(2000, Number(p.duration) || 600));
      root.style.setProperty('--fade-ms', `${ms}ms`);
      const cin = (Number(p.amount) || 0) > 0;
      root.classList.toggle('cinematic', cin);
      notes.setPaused(cin); // HUD gizliyken hasat notlarının ömrü işlemez
    }
    if (fpsPending >= 0) {
      const f = Math.round(fpsPending); fpsPending = -1;
      setText(fpsVal, String(f));
      const cls = f < 30 ? 'low' : f < 50 ? 'warn' : '';
      if (cls !== fpsCls) { fpsEl.classList.remove('low', 'warn'); if (cls) fpsEl.classList.add(cls); fpsCls = cls; }
    }
  });
  loop.start();
  toolbar.init(); // açılışta 'hand'

  // Klavye
  const onKey = (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target) && !(e.key === 'Escape' && e.target.type === 'range')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (build.active) build.escape();
      else if (settings.isOpen) settings.close();
      else if (panels.isOpen) panels.close();
      else if (toolbar.isPickerOpen) toolbar.closePicker();
      else if (card.isOpen) card.close();
      else toolbar.select('hand');
      return;
    }
    if (settings.isOpen) return; // panel açıkken oyun kısayolları kapalı
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault(); // odaktaki düğmenin "tıklanmasını" da engeller
      if (!e.repeat) speed.togglePause();
      return;
    }
    if (e.repeat) return;
    // Paneller: I / P / M (fiziksel tuş; TR klavyede de aynı yer)
    if (e.code === 'KeyB' && !e.shiftKey) { e.preventDefault(); build.toggle(); return; }
    const pk = ({ KeyI: 'inventory', KeyP: 'market', KeyM: 'shop' })[e.code];
    if (pk && !e.shiftKey) { e.preventDefault(); panels.toggle(pk); return; }
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code || '');
    const d = m ? Number(m[1]) : 0;
    if (!d) return;
    if (e.shiftKey) {
      // Hız: Shift+1/2/3
      const s = ({ 1: 1, 2: 2, 3: 4 })[d];
      if (s) { e.preventDefault(); speed.setSpeed(s); }
    } else if (d <= 8 && !panels.isOpen && !build.active) { // panel açıkken alet kısayolları kapalı
      e.preventDefault();
      toolbar.selectIndex(d - 1);
    }
  };
  // Boşluk tuşu odaktaki düğmede keyup ile "click" üretir; onu da bastır
  const onKeyUp = (e) => {
    if ((e.code === 'Space' || e.key === ' ') && !isTypingTarget(e.target) && !settings.isOpen
        && e.target && e.target.tagName === 'BUTTON') e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);

  return {
    destroy() {
      loop.stop();
      for (const off of offs) off();
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      clearTimeout(outsideTimer);
      clearTimeout(spoil.timer);
      build.destroy(); toolbar.destroy(); notes.destroy(); celebrate.destroy();
      shopPanel.destroy(); panels.destroy();
      money.destroy(); settings.destroy(); toasts.destroy();
      root.innerHTML = '';
      root.classList.remove('cinematic');
    },
  };
}

export default mountUI;
