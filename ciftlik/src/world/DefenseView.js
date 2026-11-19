// DefenseView — Gece İstilası savunma yapıları + hasar katmanı + savaş efektleri (PLAN §16 Görsel).
// State'i YALNIZCA OKUR: state.placed [{id,type,tx,ty,hp,maxHp,ruined}]. Savunma tipleri (data/defense.js): barbedFence, stoneWall (komşulara bağlanan
// atlaslar), spikeTrap, brazier (alev + nokta ışık + bloom), tower (2x2, okçu yuvası + ok atışı). Hasar katmanı TÜM yapılara: hp<%60 çatlak,
// <%30 is + kıvılcım, ruined eğik/kırık + ince duman (savunma yapıları ayrıca eğilir/solar). Efekt havuzu: duman, vuruş yıldızı, sikke parıltısı, ok + iz.
// Olaylar: placed:changed, save:loaded, defense:hit {x,y,kind}, monster:killed {x,y,reward}. update'te bellek ayrılmaz (sabit havuzlar).
import { DEPTH, TILE_W, TILE_H, depthForY } from '../core/constants.js';
import { PLACEABLES } from '../data/placeables.js';
import { DEFENSES } from '../data/defense.js';
import { footOf } from './placedUtil.js';
import { genDefense, DEF, WIRE, WALL, defFrame, SPIKE, BRAZ, FLAME, TOWER } from '../render/textures/defense.js';

const STRIDE = 4096;
const key = (tx, ty) => tx + ty * STRIDE;
const isDef = (t) => !!DEFENSES[t];
const MAX_FX = 90, MAX_DMG = 64;
const DMG_TINT = 0xa4a0a8;

export default class DefenseView {
  constructor(scene, state, bus, renderer) {
    this.scene = scene; this.state = state; this.bus = bus; this.renderer = renderer;
    this.cells = new Map();    // karo anahtarı → { type, id } (telli çit/duvar komşuluğu)
    this.ents = new Map();     // placed.id → giriş (savunma yapıları)
    this.dmg = new Map();      // placed.id → hasar katmanı
    this.freeDmg = []; this.fx = []; this.dirty = true; this.poll = 0; this._offs = []; this.t = 0; this.q = 1; this.epoch = 0;
    this._foot = { x: 0, y: 0 }; this.lightsOn = true;
  }

  create() {
    const s = this.scene;
    genDefense(s); // idempotent
    for (let i = 0; i < MAX_FX; i++) {
      const im = s.add.image(0, 0, 'rd_smoke').setVisible(false);
      this.fx.push({ im, on: false, kind: 0, t: 0, life: 1, x: 0, y: 0, vx: 0, vy: 0, s0: 1, s1: 1, a: 1, rot: 0, vr: 0 });
    }
    const on = (n, f) => this._offs.push(this.bus.on(n, f, this));
    on('placed:changed', () => { this.dirty = true; });
    on('save:loaded', () => { this.dirty = true; });
    on('defense:hit', (p) => this._onHit(p));
    on('monster:killed', (p) => this._onKilled(p));
    this.sync();
  }

  // ------------------------------------------------------------ yardımcılar
  /** Komşu maskesi (aynı türden) N1 E2 S4 W8 — hayalet önizleme de kullanır. */
  maskAt(type, tx, ty) {
    const c = this.cells; let m = 0, n;
    n = c.get(key(tx, ty - 1)); if (n && n.type === type) m |= 1;
    n = c.get(key(tx + 1, ty)); if (n && n.type === type) m |= 2;
    n = c.get(key(tx, ty + 1)); if (n && n.type === type) m |= 4;
    n = c.get(key(tx - 1, ty)); if (n && n.type === type) m |= 8;
    return m;
  }

  /** Kule platformu: out {x, y (okçu ayak y), depth}. Yoksa false. */
  towerInfo(id, out) {
    const e = this.ents.get(id); if (!e || e.type !== 'tower') return false;
    out.x = e.x; out.y = e.y - TOWER.platY + 4; out.depth = e.depth; out.ruined = e.ruined; return true;
  }
  /** (x,y)'ye en yakın kule (kuleler az; döngü). out {x,y,id}; yoksa false. */
  nearestTower(x, y, out) {
    let best = 1e12, f = false;
    for (const e of this.ents.values()) {
      if (e.type !== 'tower' || e.ruined) continue;
      const d = (e.x - x) * (e.x - x) + (e.y - TOWER.platY - y) * (e.y - TOWER.platY - y);
      if (d < best) { best = d; out.x = e.x; out.y = e.y - TOWER.platY; out.id = e.id; f = true; }
    }
    return f;
  }

  // ------------------------------------------------------------ savunma yapıları
  _mkEnt(p) {
    const s = this.scene, R = this.renderer, type = p.type;
    const e = { id: p.id, type, tx: p.tx, ty: p.ty, ep: this.epoch, ruined: false, x: 0, y: 0, depth: 0, im: null, flame: null, glow: null, light: null, front: null, mask: -1, sh: null, shake: 0, fl: 0 };
    if (type === 'barbedFence' || type === 'stoneWall') {
      e.im = s.add.image(0, 0, type === 'barbedFence' ? WIRE.key : WALL.key, defFrame(0)).setOrigin(DEF.footX / DEF.fw, DEF.footY / DEF.fh);
      e.x = p.tx * TILE_W + TILE_W / 2; e.y = p.ty * TILE_H + DEF.offY; e.depth = depthForY(e.y);
      e.im.setPosition(e.x, e.y).setDepth(e.depth);
      e.pop = 0;
    } else if (type === 'spikeTrap') {
      e.x = (p.tx + 0.5) * TILE_W; e.y = (p.ty + 0.5) * TILE_H + 8; e.depth = DEPTH.GROUND + 0.7 + (p.ty * 0.001);
      e.im = s.add.image(e.x, e.y, 'def_spike').setOrigin(SPIKE.ox / SPIKE.w, SPIKE.oy / SPIKE.h).setDepth(e.depth);
    } else if (type === 'brazier') {
      footOf(type, p.tx, p.ty, this._foot); e.x = this._foot.x; e.y = this._foot.y; e.depth = depthForY(e.y);
      e.im = s.add.image(e.x, e.y, 'def_brazier').setOrigin(BRAZ.ox / BRAZ.w, BRAZ.oy / BRAZ.h).setDepth(e.depth);
      e.flame = s.add.image(e.x, e.y - 36, 'def_flame0').setOrigin(FLAME.ox / FLAME.w, FLAME.oy / FLAME.h).setBlendMode('ADD').setDepth(e.depth + 0.01);
      e.glow = s.add.image(e.x, e.y - 40, 'fx_glow').setBlendMode('ADD').setTint(0xff9a3c).setDepth(DEPTH.LIGHT + 1).setDisplaySize(110, 84);
      try { e.light = R.lights.addPoint({ x: e.x, y: e.y - 34, radius: 190, color: 0xff9440, intensity: 0.92, nightOnly: true, flicker: 0.12 }); } catch { e.light = null; }
      e.ph = (p.id % 17) * 0.7;
    } else if (type === 'tower') {
      footOf(type, p.tx, p.ty, this._foot); e.x = this._foot.x; e.y = this._foot.y; e.depth = depthForY(e.y);
      e.im = s.add.image(e.x, e.y, 'def_tower').setOrigin(TOWER.ox / TOWER.w, TOWER.oy / TOWER.h).setDepth(e.depth);
      e.front = s.add.image(e.x, e.y - TOWER.platY - 22, 'def_tower_front').setOrigin(0.5, 0).setDepth(e.depth + 0.004);
      try { e.sh = R.shadows.register(e.im, { footX: e.x, footY: e.y, width: 100, height: 190 }); } catch { e.sh = null; }
    }
    return e;
  }

  _killEnt(e) {
    e.im?.destroy(); e.flame?.destroy(); e.glow?.destroy(); e.front?.destroy();
    try { e.light?.remove(); } catch { /* yok say */ } try { e.sh?.remove(); } catch { /* yok say */ }
  }

  sync() {
    this.dirty = false; this.epoch++;
    const ep = this.epoch, arr = Array.isArray(this.state?.placed) ? this.state.placed : [];
    this.cells.clear();
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i]; if (!p) continue;
      if (p.type === 'barbedFence' || p.type === 'stoneWall') this.cells.set(key(p.tx, p.ty), { type: p.type, id: p.id });
    }
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i]; if (!p || !isDef(p.type)) continue;
      let e = this.ents.get(p.id);
      if (e && (e.type !== p.type || e.tx !== p.tx || e.ty !== p.ty)) { this._killEnt(e); this.ents.delete(p.id); e = null; }
      if (!e) { e = this._mkEnt(p); this.ents.set(p.id, e); if (this._ready) { e.pop = 0; this._dust(e.x, e.y - 6); } }
      e.ep = ep; e.mask = -2; // maske yeniden uygulanır
    }
    for (const [id, e] of this.ents) if (e.ep !== ep) { this._killEnt(e); this.ents.delete(id); }
    this._ready = true;
    this._applyAll();
  }

  _applyAll() {
    const arr = Array.isArray(this.state?.placed) ? this.state.placed : [];
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i]; if (!p) continue;
      const e = this.ents.get(p.id);
      if (e) this._applyEnt(e, p);
    }
  }

  _applyEnt(e, p) {
    const ruined = !!p.ruined, lvl = this._level(p);
    if (e.type === 'barbedFence' || e.type === 'stoneWall') {
      const m = this.maskAt(e.type, e.tx, e.ty);
      if (m !== e.mask) { e.mask = m; e.im.setFrame(defFrame(m)); }
    }
    const was = e.ruined; e.ruined = ruined;
    // hasar: savunma yapıları eğilir/solar
    const im = e.im;
    if (e.type === 'spikeTrap') im.setTexture(ruined ? 'def_spike_broken' : 'def_spike');
    else if (e.type !== 'tower' || true) {
      const tilt = ruined ? (((p.id * 7) % 5) - 2.2) * 0.05 : lvl >= 2 ? (((p.id * 3) % 3) - 1) * 0.02 : 0;
      im.setRotation(tilt); e.baseTilt = tilt;
      if (ruined) im.setTint(DMG_TINT); else if (lvl >= 1) im.setTint(0xdcd6d6); else im.clearTint();
      if (e.type === 'tower') { e.front.setRotation(tilt); if (ruined) e.front.setTint(DMG_TINT); else e.front.clearTint(); }
    }
    if (e.type === 'brazier') {
      e.flame.setVisible(!ruined); e.glow.setVisible(!ruined);
      if (e.light) e.light.set({ intensity: ruined ? 0 : 0.92 });
    }
    if (ruined && !was && this._ready) this._puffs(e.x, e.y - 20, 5, 1.2);
  }

  /** 0 sağlam, 1 <%60, 2 <%30, 3 harap */
  _level(p) {
    if (p.ruined) return 3;
    const mx = Number(p.maxHp); if (!(mx > 0)) return 0;
    const r = Number(p.hp) / mx;
    return r < 0.3 ? 2 : r < 0.6 ? 1 : 0;
  }

  // ------------------------------------------------------------ hasar katmanı (tüm yapılar)
  _dmgFor(p, lvl) {
    let d = this.dmg.get(p.id);
    if (!d) {
      const s = this.scene; d = this.freeDmg.pop();
      if (!d) {
        d = {
          crack: s.add.image(0, 0, 'dm_crack').setVisible(false), soot: s.add.image(0, 0, 'dm_soot').setVisible(false), rub: s.add.image(0, 0, 'dm_rubble').setVisible(false),
          spark: s.add.image(0, 0, 'fx_spark').setBlendMode('ADD').setTint(0xffc060).setVisible(false), puff: [null, null, null], ph: 0, lvl: -1, id: 0, cx: 0, cy: 0, bw: 0, bh: 0,
        };
        for (let i = 0; i < 3; i++) d.puff[i] = s.add.image(0, 0, 'rd_smoke').setVisible(false);
      }
      d.id = p.id; d.ph = (p.id * 0.37) % 6.28; d.lvl = -1; this.dmg.set(p.id, d);
    }
    if (d.lvl !== lvl) {
      d.lvl = lvl;
      const pd = PLACEABLES[p.type], w = pd ? pd.w : 1, h = pd ? pd.h : 1;
      const e = this.ents.get(p.id);
      if (e) { d.cx = e.x; d.cy = e.y; } else { footOf(p.type, p.tx, p.ty, this._foot); d.cx = this._foot.x; d.cy = this._foot.y; }
      d.bw = Math.max(40, w * TILE_W * 0.9); d.bh = Math.max(34, Math.min(120, d.bw * 0.78 + (h > 1 ? 18 : 0)));
      if (p.type === 'tower') { d.bw = 96; d.bh = 120; d.cy = d.cy - 24; }
      const depth = depthForY(d.cy) + (e ? 0.006 : 0.02);
      const small = p.type === 'barbedFence' || p.type === 'spikeTrap' || p.type === 'brazier';
      const dc = d.cy - d.bh * 0.46;
      d.crack.setPosition(d.cx, dc).setDisplaySize(d.bw * 0.9, d.bw * 0.68).setDepth(depth).setAlpha(0.9).setVisible(lvl >= 1 && !small);
      d.soot.setPosition(d.cx, dc + 4).setDisplaySize(d.bw, d.bw * 0.75).setDepth(depth + 0.001).setAlpha(lvl === 1 ? 0.0 : lvl === 2 ? 0.75 : 1).setVisible(lvl >= 2 && !small);
      d.rub.setPosition(d.cx, d.cy + 4).setDisplaySize(d.bw * 1.05, d.bw * 0.42).setDepth(depth + 0.002).setVisible(lvl >= 3 && !small);
      d.spark.setDepth(DEPTH.LIGHT + 1).setVisible(false);
      for (let i = 0; i < 3; i++) d.puff[i].setDepth(DEPTH.WEATHER - 0.4).setVisible(false);
    }
    return d;
  }
  _dmgRelease(id) {
    const d = this.dmg.get(id); if (!d) return; this.dmg.delete(id);
    d.crack.setVisible(false); d.soot.setVisible(false); d.rub.setVisible(false); d.spark.setVisible(false); for (let i = 0; i < 3; i++) d.puff[i].setVisible(false);
    this.freeDmg.push(d);
  }
  _scanDamage() {
    const arr = Array.isArray(this.state?.placed) ? this.state.placed : [];
    this.epoch++; const ep = this.epoch; let n = 0;
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i]; if (!p) continue;
      const lvl = this._level(p);
      const e = this.ents.get(p.id);
      if (e) { const was = e.ruined, wl = e.lvl; if (was !== !!p.ruined || wl !== lvl) { e.lvl = lvl; this._applyEnt(e, p); } }
      if (lvl <= 0) continue;
      if (++n > MAX_DMG) break;
      const d = this._dmgFor(p, lvl); d.seenEp = ep;
    }
    for (const id of Array.from(this.dmg.keys())) { const d = this.dmg.get(id); if (d.seenEp !== ep) this._dmgRelease(id); }
  }

  // ------------------------------------------------------------ efekt havuzu
  _slot() { for (let i = 0; i < this.fx.length; i++) if (!this.fx[i].on) return this.fx[i]; return null; }
  // kind: 0 duman, 1 vuruş yıldızı, 2 sikke, 3 parıltı, 4 ok, 5 ok izi, 6 toz
  _spawn(kind, tex, x, y, life, o) {
    const f = this._slot(); if (!f) return null;
    f.on = true; f.kind = kind; f.t = 0; f.life = life; f.x = x; f.y = y; f.vx = o.vx || 0; f.vy = o.vy || 0; f.s0 = o.s0 ?? 1; f.s1 = o.s1 ?? 1; f.a = o.a ?? 1; f.rot = o.rot || 0; f.vr = o.vr || 0;
    f.ex = o.ex || 0; f.ey = o.ey || 0;
    f.im.setTexture(tex).setVisible(true).setPosition(x, y).setRotation(f.rot).setScale(f.s0).setAlpha(f.a).setOrigin(0.5, 0.5).clearTint();
    f.im.setBlendMode(o.add ? 'ADD' : 'NORMAL').setDepth(o.depth ?? DEPTH.WEATHER - 0.3);
    if (o.tint != null) f.im.setTint(o.tint);
    return f;
  }
  _puffs(x, y, n, sc) {
    const k = Math.max(1, Math.round(n * this.q));
    for (let i = 0; i < k; i++) { const a = (i / k) * 6.28 + this.t; this._spawn(0, 'rd_smoke', x + Math.cos(a) * 8, y + Math.sin(a) * 4, 0.9 + (i % 3) * 0.15, { vx: Math.cos(a) * 22, vy: -16 - (i % 3) * 8, s0: 0.35 * sc, s1: 1.1 * sc, a: 0.55, tint: 0xb4b0bc }); }
  }
  _dust(x, y) { for (let i = 0; i < 3; i++) this._spawn(6, 'rd_smoke', x + (i - 1) * 12, y, 0.6, { vx: (i - 1) * 24, vy: -8, s0: 0.25, s1: 0.7, a: 0.4, tint: 0xc8b898 }); }
  _coins(x, y) {
    const k = Math.max(1, Math.round(3 * this.q));
    for (let i = 0; i < k; i++) this._spawn(2, 'fx_coin', x + (i - (k - 1) / 2) * 7, y - 6, 0.85, { vx: (i - (k - 1) / 2) * 18, vy: -70 - i * 12, s0: 0.7, s1: 0.7, a: 1, depth: DEPTH.LIGHT + 2 });
    this._spawn(3, 'fx_sparkle_gold', x, y - 14, 0.7, { s0: 0.4, s1: 1.5, a: 1, add: true, depth: DEPTH.LIGHT + 2, rot: 0, vr: 2 });
  }
  /** Ok atışı: (x0,y0) → (x1,y1) ok sprite'ı + ince parlak iz. */
  shootArrow(x0, y0, x1, y1) {
    const ang = Math.atan2(y1 - y0, x1 - x0), dist = Math.hypot(x1 - x0, y1 - y0), life = Math.min(0.5, 0.12 + dist / 1500);
    const f = this._spawn(4, 'def_arrow', x0, y0, life, { rot: ang, ex: x1, ey: y1, s0: 1.1, s1: 1.1, depth: DEPTH.WEATHER - 0.2 }); if (f) { f.x0 = x0; f.y0 = y0; }
    const g = this._spawn(5, 'def_trail', x0, y0, life + 0.18, { rot: ang, ex: x1, ey: y1, a: 0.85, add: true, depth: DEPTH.WEATHER - 0.21 }); if (g) { g.x0 = x0; g.y0 = y0; g.im.setOrigin(1, 0.5); }
  }

  _onHit(p) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    const kind = String(p.kind || '');
    if (/tower|arrow|ok|bolt/i.test(kind)) {
      const o = this._near || (this._near = { x: 0, y: 0, id: 0 });
      if (this.nearestTower(p.x, p.y, o)) { this.shootArrow(o.x, o.y, p.x, p.y - 22); const e = this.ents.get(o.id); if (e) e.shake = 0.16; }
    }
    if (/trap|spike|kazik/i.test(kind)) this._dust(p.x, p.y);
    this._spawn(1, 'rd_hit', p.x, p.y - 22, 0.26, { s0: 0.35, s1: 1.05, a: 1, add: true, rot: (p.x * 0.01) % 6.28, depth: DEPTH.LIGHT + 2 });
  }
  _onKilled(p) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    this._puffs(p.x, p.y - 16, 5, 1.0);
    this._coins(p.x, p.y - 8);
  }

  // ------------------------------------------------------------ kare güncellemesi
  update(env) {
    const dt = env.dt; this.t = env.t;
    if (this.dirty) this.sync();
    this.poll -= dt;
    if (this.poll <= 0) { this.poll = 0.25; this._scanDamage(); }
    const night = Math.min(1, Math.max(0, (0.78 - env.day.light) / 0.4));
    // yapılar
    for (const e of this.ents.values()) {
      if (e.pop !== undefined && e.pop >= 0) { e.pop += dt / 0.3; const k = Math.min(1, e.pop); const sc = k >= 1 ? 1 : Math.max(0.05, 1 - Math.exp(-6 * k) * Math.cos(k * 7.5)); e.im.setScale(1, sc); if (k >= 1) e.pop = -1; }
      if (e.type === 'brazier' && !e.ruined) {
        const fi = Math.floor((env.t * 9 + e.ph) % FLAME.n), fl = 0.92 + Math.sin(env.t * 11 + e.ph) * 0.07 + Math.sin(env.t * 23 + e.ph * 2) * 0.04;
        e.flame.setTexture('def_flame' + fi).setScale(fl * (1 + env.wind * 0.06), fl * (1 + Math.sin(env.t * 7 + e.ph) * 0.06)).setRotation(Math.sin(env.t * 5 + e.ph) * 0.05 + env.wind * 0.1);
        e.glow.setAlpha((0.45 + 0.2 * night) * fl);
      }
      if (e.type === 'tower') {
        if (e.shake > 0) { e.shake -= dt; const k = Math.max(0, e.shake / 0.16); e.im.setPosition(e.x + Math.sin(env.t * 90) * 1.2 * k, e.y); e.front.setPosition(e.x + Math.sin(env.t * 90) * 1.2 * k, e.front.y); }
      }
    }
    // hasar katmanı: kıvılcım + duman
    for (const d of this.dmg.values()) {
      if (d.lvl >= 2 && this.q > 0.5) {
        const k = Math.sin(env.t * 6 + d.ph) * Math.sin(env.t * 2.3 + d.ph * 3);
        const on = k > 0.55;
        d.spark.setVisible(on);
        if (on) d.spark.setPosition(d.cx + Math.sin(d.ph * 9 + Math.floor(env.t * 2)) * d.bw * 0.3, d.cy - d.bh * (0.2 + 0.5 * ((d.ph * 3.7 + Math.floor(env.t * 2.7)) % 1))).setScale(0.45 + 0.25 * k).setAlpha(k);
      }
      for (let i = 0; i < 3; i++) {
        const im = d.puff[i];
        if (d.lvl < 3 && !(d.lvl === 2 && i === 0)) { im.setVisible(false); continue; }
        const u = (env.t * 0.42 + i / 3 + d.ph) % 1;
        im.setVisible(true).setPosition(d.cx + (i - 1) * 8 + Math.sin(u * 5 + d.ph) * 6 + env.wind * u * 26, d.cy - d.bh * 0.55 - u * 54).setScale(0.28 + u * 0.8).setAlpha((1 - u) * (d.lvl === 3 ? 0.34 : 0.2)).setTint(0x8c8a96);
      }
    }
    // efektler
    for (let i = 0; i < this.fx.length; i++) {
      const f = this.fx[i]; if (!f.on) continue;
      f.t += dt; const k = f.t / f.life;
      if (k >= 1) { f.on = false; f.im.setVisible(false); continue; }
      const im = f.im;
      switch (f.kind) {
        case 0: case 6: { f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.96; im.setPosition(f.x, f.y).setScale(f.s0 + (f.s1 - f.s0) * k).setAlpha(f.a * (1 - k) * (1 - k * 0.3)); break; }
        case 1: im.setScale(f.s0 + (f.s1 - f.s0) * Math.sqrt(k)).setAlpha(f.a * (1 - k)).setRotation(f.rot + k * 0.6); break;
        case 2: { f.x += f.vx * dt; f.vy += 260 * dt; f.y += f.vy * dt; const fl = Math.abs(Math.cos(f.t * 14)); im.setPosition(f.x, f.y).setScale(f.s0 * fl, f.s0).setAlpha(k > 0.7 ? (1 - k) / 0.3 : 1); break; }
        case 3: im.setScale(f.s0 + (f.s1 - f.s0) * k).setRotation(f.rot + f.vr * k).setAlpha(f.a * (1 - k)); break;
        case 4: { const kk = Math.min(1, k * 1.0); im.setPosition(f.x0 + (f.ex - f.x0) * kk, f.y0 + (f.ey - f.y0) * kk - Math.sin(kk * Math.PI) * 8); im.setAlpha(k > 0.85 ? (1 - k) / 0.15 : 1); break; }
        case 5: { const kk = Math.min(1, k * (f.life / (f.life - 0.18))); const hx = f.x0 + (f.ex - f.x0) * kk, hy = f.y0 + (f.ey - f.y0) * kk, L = Math.hypot(f.ex - f.x0, f.ey - f.y0) * Math.min(1, kk + 0.01);
          im.setPosition(hx, hy).setDisplaySize(Math.min(110, L), 3.4).setAlpha(f.a * (1 - Math.max(0, (k - 0.5) * 2))); break; }
        default: break;
      }
    }
  }

  setQuality(level) { this.q = level === 'low' ? 0.4 : level === 'medium' ? 0.7 : 1; }

  destroy() {
    for (const off of this._offs) off(); this._offs.length = 0;
    for (const e of this.ents.values()) this._killEnt(e);
    this.ents.clear();
    for (const d of this.dmg.values()) this.freeDmg.push(d);
    for (const d of this.freeDmg) { d.crack.destroy(); d.soot.destroy(); d.rub.destroy(); d.spark.destroy(); for (const p of d.puff) p.destroy(); }
    this.dmg.clear(); this.freeDmg.length = 0;
    for (const f of this.fx) f.im.destroy(); this.fx.length = 0;
  }
}
