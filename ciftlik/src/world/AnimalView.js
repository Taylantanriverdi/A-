// AnimalView — pen alanında dolaşan hayvanlar (PLAN §10 "Görsel"). State'i YALNIZCA OKUR: state.animals / state.buildings.
// Basit durum makinesi (yürü/otla/dur), havuzlanmış nesneler (hayvan başına bir kez kurulur, sync'te yeniden kullanılır),
// depthForY, küçük gölge. Yavru %65 boyut, hasta soluk doku + yavaş, mutlu (>80) ara sıra zıplar. Gece 20:30–05:30 binaya girer.
// Olaylar: animals:changed, animal:born (kalp/parıltı), save:loaded. update'te bellek ayrılmaz.
import { depthForY, DEPTH, TILE_W, TILE_H } from '../core/constants.js';
import { ANIMALS } from '../data/animals.js';
import { BUILDINGS } from '../data/buildings.js';
import { AN, POSES, animKey } from '../render/textures/animals.js';

const SPEED = { chicken: 34, cow: 17, sheep: 19, goat: 24 };
const HOP = { chicken: 9, cow: 6, sheep: 9, goat: 12 };
const STEP_RATE = { chicken: 0.16, cow: 0.2, sheep: 0.19, goat: 0.18 }; // adım fazı / px
const BABY = 0.65;
const KEYS = {}; // KEYS[type][sick 0/1][poseIdx]
for (const t of Object.keys(AN)) KEYS[t] = [POSES.map((p) => animKey(t, p, false)), POSES.map((p) => animKey(t, p, true))];

const STAND = 0, WALK = 1, GRAZE = 2;

export default class AnimalView {
  constructor(scene, state, bus, renderer, buildingView) {
    this.scene = scene; this.state = state; this.bus = bus; this.renderer = renderer; this.bv = buildingView;
    this.entries = new Map(); this.free = []; this.list = []; this.seq = 0;
    this.dirty = true; this.poll = 0; this._offs = []; this.t = 0;
  }

  create() {
    const on = (n, f) => this._offs.push(this.bus.on(n, f, this));
    on('animals:changed', () => { this.dirty = true; });
    on('save:loaded', () => { this.dirty = true; });
    on('animal:born', (p) => this._born(p));
    this.sync();
  }

  _penOf(b) {
    const def = BUILDINGS[b.type]; if (!def) return null;
    for (const l of def.lots) if (l.id === b.lotId) return l.pen || null;
    return null;
  }

  _mk(type) {
    const s = this.scene, L = AN[type];
    const c = s.add.container(0, 0);
    const tail = L.tail ? s.add.image(0, 0, L.tail.key).setOrigin(5 / L.tail.w, 2 / L.tail.h) : null;
    if (type === 'cow' && tail) tail.setOrigin(5 / L.tail.w, 2 / L.tail.h);
    if (type === 'goat' && tail) tail.setOrigin(2 / L.tail.w, 2 / L.tail.h);
    const body = s.add.image(0, 0, KEYS[type][0][0]).setOrigin(L.ox / L.w, L.oy / L.h);
    if (tail) c.add(tail);
    c.add(body);
    const shadow = s.add.image(0, 0, 'fx_ao').setDepth(DEPTH.SHADOW + 0.01);
    return { type, c, body, tail, shadow };
  }

  sync() {
    this.dirty = false;
    const animals = Array.isArray(this.state?.animals) ? this.state.animals : [];
    const buildings = Array.isArray(this.state?.buildings) ? this.state.buildings : [];
    for (const e of this.list) e.seen = false;
    for (let i = 0; i < animals.length; i++) {
      const a = animals[i]; if (!a || !AN[a.type]) continue;
      let b = null; for (let k = 0; k < buildings.length; k++) if (buildings[k].id === a.buildingId) { b = buildings[k]; break; }
      if (!b) continue;
      const pen = this._penOf(b); if (!pen) continue;
      let e = this.entries.get(a.id);
      if (!e || e.type !== a.type) {
        if (e) this._release(e);
        // havuzdan aynı türde boş nesne ya da yeni
        let idx = -1; for (let k = 0; k < this.free.length; k++) if (this.free[k].type === a.type) { idx = k; break; }
        const v = idx >= 0 ? this.free.splice(idx, 1)[0] : this._mk(a.type);
        e = Object.assign(v, {
          id: a.id, seen: true, a, b, pen, x: 0, y: 0, tx: 0, ty: 0, mode: STAND, timer: 0, dir: 1, phase: 0, step: 0, seed: (this.seq * 2.399) % 6.28,
          off: (this.seq * 11) % 30, hopT: 3 + (this.seq * 3.7) % 9, hop: -1, inside: false, fade: 0, scale: 1, curKey: '', cx0: 0, cx1: 0, cy0: 0, cy1: 0, going: false,
        });
        this.seq++;
        this.entries.set(a.id, e); this.list.push(e);
        this._bounds(e); this._place(e);
        const m = this._minutes();
        e.inside = this._night(m, e) && m >= 1230 || m < 330; // yüklenirken gece ise doğrudan içeride
        e.fade = e.inside ? 0 : 1;
        e.scale = (Number(a.ageDays) < ANIMALS[a.type].adultDays) ? BABY : 1;
        e.c.setVisible(!e.inside); e.shadow.setVisible(!e.inside);
      } else { e.a = a; e.b = b; e.pen = pen; this._bounds(e); }
      e.seen = true;
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i]; if (!e.seen) { this.list.splice(i, 1); this.entries.delete(e.id); this._release(e); }
    }
  }

  _release(e) { e.c.setVisible(false); e.shadow.setVisible(false); this.free.push(e); this.entries.delete(e.id); }

  _bounds(e) {
    const p = e.pen;
    e.cx0 = p.x0 * TILE_W + 22; e.cx1 = (p.x1 + 1) * TILE_W - 22; e.cy0 = p.y0 * TILE_H + 16; e.cy1 = (p.y1 + 1) * TILE_H - 8;
  }
  _place(e) {
    e.x = e.cx0 + Math.random() * (e.cx1 - e.cx0); e.y = e.cy0 + Math.random() * (e.cy1 - e.cy0); e.tx = e.x; e.ty = e.y;
    e.timer = Math.random() * 2;
  }
  _minutes() { const tm = this.state?.time?.totalMinutes || 0; return ((tm % 1440) + 1440) % 1440; }
  _night(m, e) { return m >= 1170 + e.off || m < 330 + (e.off % 15); }

  _born(p) {
    this.sync();
    const a = p && p.animal; const e = a && this.entries.get(a.id);
    if (e) { this.bv?.fx.hearts(e.x, e.y - AN[e.type].h * 0.5 * e.scale, 3); return; }
    if (a && a.buildingId != null && this.bv) { const d = this.bv.doorOf(a.buildingId); if (d) this.bv.fx.hearts(d.x, d.y - 30, 3); }
  }

  update(env) {
    const dt = env.dt, t = env.t; this.t = t;
    this.poll += dt;
    if (this.dirty || this.poll > 0.6) { this.poll = 0; this.sync(); }
    const m = this._minutes();
    const v = this.scene.cameras.main.worldView;
    const shA = Math.max(0.12, Math.min(0.5, env.day.shadowAlpha * 1.5));
    const L = this.list;
    for (let i = 0; i < L.length; i++) {
      const e = L[i], a = e.a, A = ANIMALS[e.type], N = AN[e.type];
      const night = this._night(m, e);
      const on = e.cx1 + 160 > v.x && e.cx0 - 160 < v.right && e.cy1 + 60 > v.y && e.cy0 - 180 < v.bottom;
      if (!on) { // ekran dışı: yalnızca durum tutarlılığı
        if (night && !e.inside) { e.inside = true; e.c.setVisible(false); e.shadow.setVisible(false); e.going = false; }
        else if (!night && e.inside) { e.inside = false; e.fade = 1; this._place(e); e.c.setVisible(true); e.shadow.setVisible(true); }
        continue;
      }
      // ---- gece/gündüz
      if (night && !e.inside && !e.going) { e.going = true; const d = this.bv?.doorOf(a.buildingId); if (d) { e.tx = d.x; e.ty = d.y; e.mode = WALK; } else e.inside = true; }
      if (!night && e.inside) {
        const d = this.bv?.doorOf(a.buildingId);
        if (d) { e.x = d.x; e.y = d.y; } else this._place(e);
        e.inside = false; e.going = false; e.fade = 0; e.mode = STAND; e.timer = 0.2 + (i % 4) * 0.5; e.tx = e.x; e.ty = e.y;
        e.c.setVisible(true); e.shadow.setVisible(true);
      }
      if (e.inside) continue;
      // ---- hız / durum
      const sick = !!a.sick;
      const spd = SPEED[e.type] * (sick ? 0.45 : 1) * (0.85 + 0.3 * Math.sin(e.seed));
      e.timer -= dt;
      if (e.going) {
        // kapıya yürü; varınca küçül ve gizlen
        const dx = e.tx - e.x, dy = e.ty - e.y, d = Math.hypot(dx, dy);
        if (d < 5) { e.fade = Math.max(0, e.fade - dt * 3); if (e.fade <= 0) { e.inside = true; e.going = false; e.c.setVisible(false); e.shadow.setVisible(false); continue; } e.mode = STAND; }
        else { const sp = spd * 1.5 * dt; e.x += dx / d * Math.min(sp, d); e.y += dy / d * Math.min(sp, d); e.step += Math.min(sp, d) * STEP_RATE[e.type]; if (dx * e.dir < -2) e.dir = dx > 0 ? 1 : -1; }
      } else {
        if (e.fade < 1) e.fade = Math.min(1, e.fade + dt * 2);
        if (e.mode === WALK) {
          const dx = e.tx - e.x, dy = e.ty - e.y, d = Math.hypot(dx, dy);
          if (d < 3) { e.mode = STAND; e.timer = 0.8 + Math.random() * 2.5; }
          else { const sp = spd * dt; const k = Math.min(sp, d) / d; e.x += dx * k; e.y += dy * k; e.step += Math.min(sp, d) * STEP_RATE[e.type]; e.dir = dx >= 0 ? 1 : -1; }
        } else if (e.timer <= 0) {
          const r = Math.random();
          if (r < 0.45) { e.mode = WALK; e.tx = e.cx0 + Math.random() * (e.cx1 - e.cx0); e.ty = e.cy0 + Math.random() * (e.cy1 - e.cy0); }
          else if (r < 0.85) { e.mode = GRAZE; e.timer = 2 + Math.random() * 4; }
          else { e.mode = STAND; e.timer = 1 + Math.random() * 3; }
        }
        // mutlu zıplama
        if (e.hop >= 0) { e.hop += dt / 0.5; if (e.hop >= 1) e.hop = -1; }
        else if (!sick && (a.happiness || 0) > 80 && e.mode !== WALK) { e.hopT -= dt; if (e.hopT <= 0) { e.hop = 0; e.hopT = 6 + Math.random() * 10; } }
      }
      // ---- görünüm
      const sk = sick ? 1 : 0;
      const pi = e.mode === WALK || e.going && e.mode === WALK ? ((Math.floor(e.step) & 1) ? 2 : 1)
        : e.mode === GRAZE ? (e.type === 'chicken' && Math.sin(t * 9 + e.seed) < 0.1 ? 0 : 3) : 0;
      const key = KEYS[e.type][sk][pi];
      if (e.curKey !== key) { e.body.setTexture(key); e.curKey = key; }
      const baby = Number(a.ageDays) < A.adultDays;
      const ts = baby ? BABY : 1; e.scale += (ts - e.scale) * Math.min(1, dt * 3);
      const hopY = e.hop >= 0 ? Math.sin(e.hop * Math.PI) * HOP[e.type] : 0;
      const bob = e.mode === WALK ? -Math.abs(Math.sin(e.step * Math.PI)) * 1.4 : 0;
      const breathe = 1 + Math.sin(t * 2.1 + e.seed) * 0.012;
      const sq = e.hop >= 0 ? 1 + Math.sin(e.hop * Math.PI * 2) * 0.05 : 1;
      const fs = e.scale * (0.6 + 0.4 * e.fade);
      e.c.setPosition(e.x, e.y - bob - hopY).setDepth(depthForY(e.y)).setAlpha(e.fade);
      e.body.setFlipX(e.dir < 0).setScale(fs * (2 - sq), fs * breathe * sq);
      if (e.tail) {
        const T = N.tail; const wag = e.type === 'cow' ? Math.sin(t * 2.6 + e.seed) * 0.28 + 0.05 : Math.sin(t * 9 + e.seed) * 0.35;
        e.tail.setPosition(T.x * e.dir * fs, T.y * fs).setFlipX(e.dir < 0).setScale(fs).setRotation(wag * e.dir * (sick ? 0.3 : 1)).setTexture(e.tail.texture.key);
      }
      e.shadow.setPosition(e.x - 2 * e.dir * fs, e.y - 1).setDisplaySize(N.shw * fs * 1.05, N.shw * fs * 0.3).setAlpha(shA * e.fade * (hopY > 0 ? 0.7 : 1));
    }
  }

  setQuality() { /* kaliteden bağımsız */ }

  destroy() {
    for (const off of this._offs) off(); this._offs.length = 0;
    for (const e of this.list.concat(this.free)) { e.c.destroy(); e.shadow.destroy(); }
    this.list.length = 0; this.free.length = 0; this.entries.clear();
  }
}
