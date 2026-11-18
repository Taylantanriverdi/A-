// WorkerView — Çırak (çocuk) ve eşek (PLAN §11 "Görsel"). State'i YALNIZCA OKUR: state.workers [{x,y,mode,task,onDonkey}], state.donkey {x,y,mode}.
// Konum: state'teki x,y oyun hızıyla sıçrayarak güncellenir → görünüm hedefi hız tahminli kovalar (akıcı). Yön: ayna. Mod → animasyon:
// walk (6 kare yürüme), ride (eşek üstünde otururken eşek 4 kare yürür), work (eğilme + kova/sepet), idle (nefes + göz kırpma), home (gizli).
// Görevde ikon baloncuğu; worker:did ok → parıltı. Gece fener ışığı. depthForY + gölge. update'te bellek ayrılmaz; ekran dışı atlanır.
import { depthForY, DEPTH, TILE_W, TILE_H } from '../core/constants.js';
import { DONKEY } from '../data/workers.js';
import { firstPlacedOfType } from './placedUtil.js';
import { genWorker, KID, DK, WALK_N, kidKey, dkKey, bubbleKey } from '../render/textures/worker.js';

const WALK_KEYS = []; for (let i = 0; i < WALK_N; i++) WALK_KEYS.push(kidKey('walk' + i));
const DK_WALK = [dkKey('w0'), dkKey('w1'), dkKey('w2'), dkKey('w3')];
const K = { idle0: kidKey('idle0'), idle1: kidKey('idle1'), b0: kidKey('bucket0'), b1: kidKey('bucket1'), k0: kidKey('basket0'), k1: kidKey('basket1'), r0: kidKey('ride0'), r1: kidKey('ride1'), r2: kidKey('ride2') };
const ICON = { water: 'water', waterAnimals: 'water', harvest: 'basket', collect: 'basket', machineCollect: 'basket', feed: 'feed', animals: 'feed', clean: 'gear', machineLoad: 'gear', machines: 'gear' };
const BUCKET = { water: 1, waterAnimals: 1 };
const KID_STRIDE = 40, DK_STRIDE = 52;     // bir tam adım döngüsünün px uzunluğu
let HOME_X = (DONKEY.homeTile.tx + 0.5) * TILE_W, HOME_Y = (DONKEY.homeTile.ty + 0.5) * TILE_H + 6; // sundurma placed'e göre güncellenir

function chase(e, tx, ty, dt, t) {
  // hedef değişince hız tahmini; görünüm hız + oransal düzeltmeyle kovalar
  if (tx !== e.ptx || ty !== e.pty) {
    const dtr = Math.max(0.016, t - e.tChange), v = Math.hypot(tx - e.ptx, ty - e.pty) / dtr;
    e.vEst = Math.min(700, e.vEst * 0.5 + v * 0.5); e.ptx = tx; e.pty = ty; e.tChange = t;
  } else if (t - e.tChange > 0.7) e.vEst *= Math.exp(-dt * 4);
  const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
  if (d > 420) { e.x = tx; e.y = ty; e.mvx = 0; e.mvy = 0; return 0; }
  if (d < 0.05) { e.mvx = 0; e.mvy = 0; return 0; }
  const step = Math.min(d, (e.vEst + d * 2.6) * dt);
  e.mvx = dx / d * step; e.mvy = dy / d * step; e.x += e.mvx; e.y += e.mvy;
  return step;
}

export default class WorkerView {
  constructor(scene, state, bus, renderer) {
    this.scene = scene; this.state = state; this.bus = bus; this.renderer = renderer;
    this.kids = new Map(); this.list = []; this.donkey = null; this.dirty = true; this.poll = 0; this._offs = []; this.t = 0;
  }

  create() {
    genWorker(this.scene); // idempotent
    this._mkDonkey();
    const on = (n, f) => this._offs.push(this.bus.on(n, f, this));
    on('workers:changed', () => { this.dirty = true; });
    on('placed:changed', () => { this.dirty = true; });
    on('worker:state', () => { this.dirty = true; });
    on('save:loaded', () => { this.dirty = true; });
    on('worker:did', (p) => this._did(p));
    this.sync();
  }

  _mkDonkey() {
    const s = this.scene, c = s.add.container(HOME_X, HOME_Y);
    const tail = s.add.image(-24, -40, 'dk_tail').setOrigin(0.5, 0.036).setScale(0.5);
    const body = s.add.image(0, 0, dkKey('stand')).setOrigin(DK.ox / DK.w, DK.oy / DK.h).setScale(0.5);
    const earF = s.add.image(28, -61, 'dk_ear').setOrigin(0.55, 0.95).setScale(0.5).setTint(0xb5a898);
    const earN = s.add.image(24, -60, 'dk_ear').setOrigin(0.55, 0.95).setScale(0.5);
    const rider = s.add.image(-4, -42, K.r0).setOrigin(KID.ox / KID.w, KID.sitOy / KID.h).setScale(0.5).setVisible(false);
    c.add([tail, body, earF, earN, rider]);
    const shadow = s.add.image(0, 0, 'fx_ao').setDepth(DEPTH.SHADOW + 0.01);
    this.donkey = {
      c, tail, body, earF, earN, rider, shadow, x: HOME_X, y: HOME_Y, ptx: HOME_X, pty: HOME_Y, tChange: 0, vEst: 0, mvx: 0, mvy: 0,
      dir: 1, dAcc: 0, step: 0, curKey: '', eat: 0, eatT: 4, flick: 0, flickT: 3, ph: 1.3, shown: false, mounted: false, rKey: '',
    };
    c.setVisible(false); shadow.setVisible(false);
  }

  _mkKid(w) {
    const s = this.scene;
    const c = s.add.container(0, 0);
    const body = s.add.image(0, 0, K.idle0).setOrigin(KID.ox / KID.w, KID.oy / KID.h).setScale(0.5);
    const bub = s.add.image(0, -64, bubbleKey('water')).setOrigin(0.5, 29.6 / 32).setScale(0).setVisible(false);
    c.add([body, bub]);
    const shadow = s.add.image(0, 0, 'fx_ao').setDepth(DEPTH.SHADOW + 0.01);
    const light = this.renderer.lights.addPoint({ x: 0, y: 0, radius: 58, color: 0xffd08a, intensity: 0.0, nightOnly: true, flicker: 0.06 });
    const x = Number.isFinite(w.x) ? w.x : HOME_X, y = Number.isFinite(w.y) ? w.y : HOME_Y;
    return {
      id: w.id, w, c, body, bub, shadow, light, lightI: 0, x, y, ptx: x, pty: y, tChange: 0, vEst: 0, mvx: 0, mvy: 0, dir: 1, dAcc: 0, step: 0,
      fade: 1, curKey: '', blinkT: 2.2 + this.kids.size, blink: 0, bubK: '', bubS: 0, seen: true, spd: 0, ph: this.kids.size * 1.7,
    };
  }

  sync() {
    const sp = firstPlacedOfType(this.state, 'shed'); // eşeğin evi: sundurmanın sağ-alt karosu
    if (sp) { HOME_X = (sp.tx + 1.5) * TILE_W; HOME_Y = (sp.ty + 1.5) * TILE_H + 6; }
    this.dirty = false;
    const ws = Array.isArray(this.state?.workers) ? this.state.workers : [];
    for (const e of this.list) e.seen = false;
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i]; if (!w) continue;
      let e = this.kids.get(w.id);
      if (!e) { e = this._mkKid(w); this.kids.set(w.id, e); this.list.push(e); }
      e.w = w; e.seen = true;
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i]; if (e.seen) continue;
      this.list.splice(i, 1); this.kids.delete(e.id); e.light.remove(); e.c.destroy(); e.shadow.destroy();
    }
  }

  _did(p) {
    if (!p || !p.ok) return;
    const e = this.kids.get(p.workerId) || this.list[0]; if (!e) return;
    this.renderer.buildings?.fx?.sparkle(e.x, e.y - 30, 24, 26, 7);
  }

  update(env) {
    const dt = env.dt, t = env.t; this.t = t;
    this.poll += dt;
    if (this.dirty || this.poll > 0.6) { this.poll = 0; this.sync(); }
    const st = this.state, d = this.donkey;
    const v = this.scene.cameras.main.worldView;
    const shA = Math.max(0.12, Math.min(0.5, env.day.shadowAlpha * 1.5));
    const night = env.day.light < 0.78 ? 1 : 0;
    let rider = null;
    // ---- çocuklar
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i], w = e.w;
      const tx = Number.isFinite(w.x) ? w.x : e.x, ty = Number.isFinite(w.y) ? w.y : e.y;
      const moved = chase(e, tx, ty, dt, t);
      e.spd += ((dt > 0 ? moved / dt : 0) - e.spd) * Math.min(1, dt * 8);
      e.dAcc = Math.max(-8, Math.min(8, e.dAcc * 0.9 + e.mvx));
      if (e.dAcc > 1.5) e.dir = 1; else if (e.dAcc < -1.5) e.dir = -1;
      const mode = w.mode || 'idle';
      const riding = !!w.onDonkey && mode !== 'home';
      const hide = mode === 'home';
      e.fade += ((hide ? 0 : 1) - e.fade) * Math.min(1, dt * 6);
      if (riding) { rider = e; }
      // fener ışığı: yalnızca gece ve görünürken
      const wantL = (!hide && night) ? 0.45 : 0;
      if (wantL !== e.lightI) { e.lightI = wantL; e.light.set({ intensity: wantL }); }
      if (wantL > 0) e.light.set({ x: e.x, y: e.y - 14 });
      const on = e.fade > 0.02 && e.x > v.x - 120 && e.x < v.right + 120 && e.y > v.y - 40 && e.y < v.bottom + 200;
      const vis = on && !riding;
      e.c.setVisible(vis); e.shadow.setVisible(on && !riding);
      if (!on) continue;
      e.shadow.setPosition(e.x, e.y - 1).setDisplaySize(27, 9).setAlpha(shA * e.fade);
      if (!vis) continue;
      // ---- kare seçimi
      let key, bob = 0, sy = 1;
      const moving = e.spd > 9;
      if (mode === 'work') {
        const kind = w.task && w.task.kind;
        const f = (Math.floor(t * 2.2 + e.ph) & 1);
        key = BUCKET[kind] ? (f ? K.b1 : K.b0) : (f ? K.k1 : K.k0);
      } else if (moving && (mode === 'walk' || mode === 'ride' || mode === 'idle')) {
        e.step += moved * (WALK_N / KID_STRIDE);
        key = WALK_KEYS[((Math.floor(e.step) % WALK_N) + WALK_N) % WALK_N];
        bob = 0;
      } else {
        e.blinkT -= dt; if (e.blinkT <= 0) { e.blink = 0.13; e.blinkT = 2.6 + ((i * 1.3 + t) % 2.4); }
        if (e.blink > 0) e.blink -= dt;
        key = e.blink > 0 ? K.idle1 : K.idle0;
        sy = 1 + Math.sin(t * 2.1 + e.ph) * 0.012;
      }
      if (e.curKey !== key) { e.body.setTexture(key); e.curKey = key; }
      e.c.setPosition(e.x, e.y).setDepth(depthForY(e.y)).setAlpha(e.fade);
      e.body.setScale(0.5 * e.dir, 0.5 * sy).setY(-bob);
      // ---- görev baloncuğu
      const kind = w.task && w.task.kind;
      const bk = mode === 'work' && kind ? (ICON[kind] || 'gear') : '';
      if (bk !== e.bubK) { e.bubK = bk; if (bk) e.bub.setTexture(bubbleKey(bk)); }
      e.bubS += ((bk ? 1 : 0) - e.bubS) * Math.min(1, dt * 10);
      if (e.bubS > 0.02) e.bub.setVisible(true).setScale(0.5 * e.bubS * (1 + Math.sin(t * 4 + e.ph) * 0.04)).setY(-64 + Math.sin(t * 2.4 + e.ph) * 1.5); else e.bub.setVisible(false);
    }
    // ---- eşek
    const hasDk = !!st?.donkey || this.list.length > 0;
    if (!hasDk) { if (d.shown) { d.c.setVisible(false); d.shadow.setVisible(false); d.shown = false; } return; }
    let moved = 0;
    if (rider) {
      moved = Math.hypot(rider.mvx, rider.mvy); d.x = rider.x; d.y = rider.y; d.mvx = rider.mvx; d.mvy = rider.mvy; d.ptx = d.x; d.pty = d.y; d.dir = rider.dir; d.dAcc = rider.dAcc;
      d.vEst = rider.vEst;
    } else {
      const s = st?.donkey; const tx = s && Number.isFinite(s.x) ? s.x : HOME_X, ty = s && Number.isFinite(s.y) ? s.y : HOME_Y;
      moved = chase(d, tx, ty, dt, t);
      d.dAcc = Math.max(-8, Math.min(8, d.dAcc * 0.9 + d.mvx));
      if (d.dAcc > 1.5) d.dir = 1; else if (d.dAcc < -1.5) d.dir = -1;
    }
    const dOn = d.x > v.x - 140 && d.x < v.right + 140 && d.y > v.y - 40 && d.y < v.bottom + 200;
    d.shown = dOn; d.c.setVisible(dOn); d.shadow.setVisible(dOn);
    if (!dOn) return;
    const dmoving = moved > 0.02 && (rider ? rider.spd > 9 : true);
    let key;
    if (dmoving) { d.step += moved * (4 / DK_STRIDE); key = DK_WALK[((Math.floor(d.step) % 4) + 4) % 4]; d.eat = 0; }
    else {
      d.eatT -= dt;
      if (d.eatT <= 0) { d.eat = d.eat > 0 ? 0 : 2.6 + (d.ph % 1.5); d.eatT = d.eat > 0 ? d.eat : 6 + (t % 5); }
      key = d.eat > 0 && !rider ? dkKey('eat') : dkKey('stand');
    }
    if (d.curKey !== key) { d.body.setTexture(key); d.curKey = key; }
    const eating = key === dkKey('eat');
    const bobD = dmoving ? Math.abs(Math.sin(d.step * Math.PI * 0.5)) * 1.2 : 0;
    d.c.setPosition(d.x, d.y - bobD).setScale(d.dir, 1).setDepth(depthForY(d.y) + 0.001);
    d.body.setScale(0.5, 0.5 * (1 + Math.sin(t * 1.9) * 0.01));
    // kulak + kuyruk
    d.flickT -= dt; if (d.flickT <= 0) { d.flick = 0.32; d.flickT = 3 + (t * 7.3 % 4); }
    if (d.flick > 0) d.flick -= dt;
    const fk = d.flick > 0 ? Math.sin((1 - d.flick / 0.32) * Math.PI * 2) * 0.4 : 0;
    const base = dmoving ? -0.22 : -0.08, sway = Math.sin(t * 1.1 + d.ph) * 0.05;
    if (eating) { d.earN.setPosition(33, -34).setRotation(0.85 + fk * 0.5); d.earF.setPosition(36, -37).setRotation(0.95); }
    else { d.earN.setPosition(24, -60).setRotation(base + sway + fk); d.earF.setPosition(28, -61).setRotation(base + 0.12 - sway * 0.6 - fk * 0.3); }
    d.tail.setRotation(Math.sin(t * (dmoving ? 4.6 : 2.2) + d.ph) * (dmoving ? 0.26 : 0.16) + 0.06);
    d.shadow.setPosition(d.x, d.y - 1).setDisplaySize(66, 17).setAlpha(shA);
    d.shadow.setDepth(DEPTH.SHADOW + 0.01);
    // binici
    if (rider) {
      const rk = rider.blink > 0 || ((t * 0.37 + rider.ph) % 3.1) < 0.12 ? K.r1 : (dmoving && (Math.floor(d.step * 0.5) & 1) ? K.r2 : K.r0);
      if (d.rKey !== rk) { d.rider.setTexture(rk); d.rKey = rk; }
      d.rider.setVisible(true).setY(-42 + (dmoving ? Math.sin(d.step * Math.PI * 0.5 + 0.8) * 0.8 : 0));
      d.mounted = true;
    } else if (d.mounted) { d.rider.setVisible(false); d.mounted = false; }
  }

  setQuality() { /* kaliteden bağımsız */ }

  destroy() {
    for (const off of this._offs) off(); this._offs.length = 0;
    for (const e of this.list) { e.light.remove(); e.c.destroy(); e.shadow.destroy(); }
    this.list.length = 0; this.kids.clear();
    if (this.donkey) { this.donkey.c.destroy(); this.donkey.shadow.destroy(); this.donkey = null; }
  }
}
