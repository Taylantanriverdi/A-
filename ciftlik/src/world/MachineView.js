// MachineView — atölyeler + eşek sundurması (PLAN §11 "Görsel", §12 serbest yerleşim).
// State'i YALNIZCA OKUR: state.machines [{id:'m_<placedId>', placedId, type, condition, queue, output}] + state.placed.
// Kayıt↔görünüm eşleşmesi placedId ile (eski kayıt: placedId ?? lotId ?? type); aynı türden birden çok atölye olabilir.
// Olaylar: placed:changed (ekle/taşı/yok et; kayma), machines:changed, machine:done, save:loaded, build:ghost (kalkık nesne).
// Boşta: değirmen yavaş döner; kuyrukta iş varsa hızlı. Fırın/konserve çalışırken duman/buhar. Gece pencere ışığı. condition<50 yıpranmış.
import { depthForY, DEPTH } from '../core/constants.js';
import { genMachines, MCH, SAILS, WHEEL, SHED } from '../render/textures/machines.js';
import { locate, footOf, findPlaced, firstPlacedOfType, SLIDE_TIME } from './placedUtil.js';

const SMOKE_N = 22;
const SOOT = [[-0.28, -52], [0.2, -34], [-0.02, -76]];

export default class MachineView {
  constructor(scene, state, bus, renderer) {
    this.scene = scene; this.state = state; this.bus = bus; this.renderer = renderer;
    this.lots = []; this.byKey = new Map(); this.dirty = true; this.poll = 0; this.t = 0; this._initial = true;
    this._offs = []; this.smoke = []; this.sCur = 0; this.shed = null; this.liftId = null;
    this._loc = { placedId: null, tx: 0, ty: 0, w: 1, h: 1, legacy: false }; this._foot = { x: 0, y: 0 };
  }

  create() {
    const s = this.scene;
    genMachines(s); // idempotent
    for (let i = 0; i < SMOKE_N; i++) {
      const im = s.add.image(0, 0, 'mch_smoke').setVisible(false).setDepth(DEPTH.WEATHER + 1);
      this.smoke.push({ im, on: false, vx: 0, vy: 0, life: 0, max: 1, s0: 0.3, s1: 1, a: 0.5 });
    }
    const on = (n, f) => this._offs.push(this.bus.on(n, f, this));
    on('machines:changed', () => { this.dirty = true; });
    on('placed:changed', () => { this.dirty = true; });
    on('building:built', () => { this.dirty = true; });
    on('save:loaded', () => { this.dirty = true; this._initial = true; });
    on('machine:done', (p) => { this.dirty = true; this._done(p); });
    on('build:ghost', (p) => { this.liftId = p && p.moving != null ? p.moving : null; });
    this.sync(true);
  }

  // ------------------------------------------------------------------ eşek sundurması (placed 'shed')
  _buildShed(p) {
    const s = this.scene, R = this.renderer;
    const f = footOf('shed', p.tx, p.ty, this._foot);
    const c = s.add.container(f.x, f.y).setDepth(depthForY(f.y - 44));
    const body = s.add.image(0, 0, SHED.key).setOrigin(SHED.ox / SHED.w, SHED.oy / SHED.h);
    c.add(body);
    const sd = { c, body, shadow: null, glow: null, light: null, placedId: p.id, tx: p.tx, ty: p.ty, fx: f.x, fy: f.y, sx: 0, sy: 0, tfx: f.x, tfy: f.y, slideT: -1, lift: 0, popT: -1 };
    sd.shadow = R.shadows.register(c, { footX: f.x, footY: f.y - 1, height: SHED.height, width: SHED.shw, shadowKey: SHED.key });
    sd.glow = s.add.image(f.x + 70, f.y - 62, 'prop_lantern_glow').setScale(0.42); R.lighting.addEmissive(sd.glow, 0.7);
    sd.light = R.lights.addPoint({ x: f.x + 70, y: f.y - 50, radius: 64, color: 0xffd08a, intensity: 0.5, nightOnly: true, flicker: 0.05 });
    this.shed = sd;
    return sd;
  }
  _destroyShed() {
    const sd = this.shed; if (!sd) return;
    sd.shadow?.remove(); sd.light?.remove();
    const pts = this.renderer.lighting?.points; if (pts) { const i = pts.findIndex((it) => it.im === sd.glow); if (i >= 0) pts.splice(i, 1); }
    sd.glow.destroy(); sd.c.destroy(); this.shed = null;
  }
  _repShed(sd) {
    sd.c.setPosition(sd.fx, sd.fy - sd.lift * 7).setDepth(depthForY(sd.fy - 44));
    sd.shadow?.set({ footX: sd.fx, footY: sd.fy - 1 });
    sd.glow.setPosition(sd.fx + 70, sd.fy - 62); sd.light.set({ x: sd.fx + 70, y: sd.fy - 50 });
  }

  _build(lv) {
    const s = this.scene, L = MCH[lv.type], R = this.renderer;
    const c = s.add.container(lv.fx, lv.fy).setDepth(depthForY(lv.fy));
    const body = s.add.image(0, 0, L.key).setOrigin(L.ox / L.w, L.oy / L.h);
    c.add(body);
    let sails = null, wheel = null;
    if (L.hub) { sails = s.add.image(L.hub[0], L.hub[1], SAILS.key); c.add(sails); }
    if (L.wheel) { wheel = s.add.image(L.wheel[0], L.wheel[1], WHEEL.key); c.add(wheel); }
    const soot = [];
    for (let i = 0; i < SOOT.length; i++) { const im = s.add.image(SOOT[i][0] * L.shw, SOOT[i][1], `mch_soot${i}`).setOrigin(0.5, 0).setScale(1.15).setVisible(false); soot.push(im); c.add(im); }
    const crate = s.add.image(L.crate[0], L.crate[1], 'mch_crate').setOrigin(20 / 40, 33 / 38).setVisible(false);
    c.add(crate);
    const bv = { c, body, sails, wheel, soot, crate, shadow: null, lights: [], glows: [] };
    bv.shadow = R.shadows.register(c, { footX: lv.fx, footY: lv.fy - 1, height: L.height, width: L.shw, shadowKey: L.key });
    for (const [wx, wy] of L.win) {
      const gx = lv.fx + wx, gy = lv.fy + wy;
      const glow = s.add.image(gx, gy, 'prop_lantern_glow').setScale(0.5);
      R.lighting.addEmissive(glow, 0.75); bv.glows.push(glow);
      bv.lights.push(R.lights.addPoint({ x: gx, y: gy + 10, radius: 62, color: lv.type === 'bakery' ? 0xffb060 : 0xffd08a, intensity: 0.55, nightOnly: true, flicker: 0.05 }));
    }
    lv.bv = bv; lv.wearN = -1; lv.crateN = 0;
    return bv;
  }

  _unbuild(lv) {
    const bv = lv.bv; if (!bv) return;
    bv.shadow?.remove(); for (const l of bv.lights) l.remove();
    const pts = this.renderer.lighting?.points;
    for (const g of bv.glows) { if (pts) { const i = pts.findIndex((it) => it.im === g); if (i >= 0) pts.splice(i, 1); } g.destroy(); }
    bv.c.destroy(); lv.bv = null;
  }

  _reposition(lv) {
    const bv = lv.bv; if (!bv) return;
    const L = MCH[lv.type];
    bv.c.setPosition(lv.fx, lv.fy - lv.lift * 7).setDepth(depthForY(lv.fy));
    bv.shadow?.set({ footX: lv.fx, footY: lv.fy - 1 });
    for (let i = 0; i < L.win.length; i++) {
      bv.glows[i].setPosition(lv.fx + L.win[i][0], lv.fy + L.win[i][1]);
      bv.lights[i].set({ x: lv.fx + L.win[i][0], y: lv.fy + L.win[i][1] + 10 });
    }
  }

  sync(initial = false) {
    this.dirty = false;
    if (this._initial) { initial = true; this._initial = false; }
    const arr = Array.isArray(this.state?.machines) ? this.state.machines : [];
    const loc = this._loc, foot = this._foot, fx = this.renderer.buildings?.fx;
    for (let i = 0; i < this.lots.length; i++) this.lots[i].seen = false;
    for (let i = 0; i < arr.length; i++) {
      const m = arr[i]; if (!m || !MCH[m.type] || !locate(this.state, m, 'machine', loc)) continue;
      const key = loc.placedId;
      footOf(m.type, loc.tx, loc.ty, foot);
      if (loc.legacy) { foot.x = (loc.tx + loc.w / 2) * 64; foot.y = (loc.ty + loc.h) * 44 - 10; }
      let lv = this.byKey.get(key);
      if (!lv) {
        lv = { type: m.type, key, placedId: key, m, tx: loc.tx, ty: loc.ty, fx: foot.x, fy: foot.y, ph: this.lots.length * 1.9, bv: null, popT: -1, smokeT: 0, spd: 0,
          busy: false, cond: 100, crateN: 0, wearN: -1, seen: true, slideT: -1, sx: 0, sy: 0, tfx: foot.x, tfy: foot.y, lift: 0 };
        this.lots.push(lv); this.byKey.set(key, lv);
        this._build(lv);
        if (!initial) this._pop(lv);
      } else {
        lv.m = m; lv.seen = true;
        if (loc.tx !== lv.tx || loc.ty !== lv.ty) {
          lv.tx = loc.tx; lv.ty = loc.ty; lv.sx = lv.fx; lv.sy = lv.fy; lv.tfx = foot.x; lv.tfy = foot.y; lv.slideT = 0;
          if (fx) fx.dust(lv.fx, lv.fy + 2, MCH[lv.type].shw * 0.3, 5);
        }
      }
      const bv = lv.bv; bv.c.setVisible(true);
      const q = m.queue, cond = Number.isFinite(m.condition) ? m.condition : 100;
      lv.cond = cond; lv.busy = Array.isArray(q) && q.length > 0 && cond >= 20;
      // yıpranma: koyu ton + is lekeleri
      const wear = cond < 20 ? 2 : cond < 50 ? 1 : 0;
      if (wear !== lv.wearN) {
        lv.wearN = wear;
        bv.body.setTint(wear === 2 ? 0xa89c8c : wear === 1 ? 0xd2c8b8 : 0xffffff);
        const n = wear === 2 ? 3 : wear === 1 ? 2 : 0;
        for (let k = 0; k < bv.soot.length; k++) bv.soot[k].setVisible(k < n);
      }
      // çıktı sandığı
      let qty = 0; const out = m.output;
      if (out) for (const k in out) { const st = out[k]; if (Array.isArray(st)) for (let j = 0; j < st.length; j++) qty += st[j] && st[j].qty > 0 ? st[j].qty : 0; }
      lv.crateN = qty; bv.crate.setVisible(qty > 0);
    }
    for (let i = this.lots.length - 1; i >= 0; i--) {
      const lv = this.lots[i]; if (lv.seen) continue;
      if (fx && lv.bv) fx.dust(lv.fx, lv.fy + 2, MCH[lv.type].shw * 0.4, 8);
      this._unbuild(lv); this.byKey.delete(lv.key); this.lots.splice(i, 1);
    }
    // eşek sundurması
    const sp = firstPlacedOfType(this.state, 'shed');
    if (!sp) { if (this.shed) this._destroyShed(); }
    else if (!this.shed) { const sd = this._buildShed(sp); if (!initial) { sd.c.setScale(0.001).setAlpha(0); sd.popT = 0; if (fx) fx.dust(sd.fx, sd.fy + 2, 60, 10); } }
    else if (sp.tx !== this.shed.tx || sp.ty !== this.shed.ty) {
      const sd = this.shed; footOf('shed', sp.tx, sp.ty, foot);
      sd.placedId = sp.id; sd.tx = sp.tx; sd.ty = sp.ty; sd.sx = sd.fx; sd.sy = sd.fy; sd.tfx = foot.x; sd.tfy = foot.y; sd.slideT = 0;
      if (fx) fx.dust(sd.fx, sd.fy + 2, 40, 5);
    } else this.shed.placedId = sp.id;
  }

  _pop(lv) {
    lv.popT = 0; lv.bv.c.setScale(0.001).setAlpha(0);
    const fx = this.renderer.buildings?.fx; if (!fx) return;
    const w = MCH[lv.type].shw * 0.5;
    fx.dust(lv.fx, lv.fy + 2, w, 12); fx.sparkle(lv.fx, lv.fy - 10, w * 1.6, MCH[lv.type].height * 0.9, 12);
  }

  _done(p) {
    if (!p) return;
    let lv = null;
    for (let i = 0; i < this.lots.length; i++) { const l = this.lots[i]; if (l.m && l.m.id === p.machineId) { lv = l; break; } }
    if (!lv) lv = this.byKey.get(p.machineId) || null;
    if (!lv || !lv.bv) return;
    const fx = this.renderer.buildings?.fx; if (fx) fx.sparkle(lv.fx + MCH[lv.type].crate[0], lv.fy - 16, 26, 16, 6);
  }

  _puff(x, y, wind, big) {
    const it = this.smoke[this.sCur]; this.sCur = (this.sCur + 1) % SMOKE_N;
    it.on = true; it.life = it.max = 2.2 + Math.random() * 1.2; it.vx = 6 + wind * 34 + (Math.random() - 0.5) * 6; it.vy = -(14 + Math.random() * 8);
    it.s0 = big ? 0.3 : 0.22; it.s1 = big ? 1.25 : 0.85; it.a = 0.55;
    it.im.setPosition(x + (Math.random() - 0.5) * 4, y).setScale(it.s0).setAlpha(it.a).setVisible(true);
  }

  update(env) {
    const dt = env.dt, t = env.t; this.t = t;
    this.poll += dt;
    if (this.dirty || this.poll > 0.5) { this.poll = 0; this.sync(); }
    const wind = env.wind, light = env.day.light;
    // duman parçacıkları
    for (let i = 0; i < SMOKE_N; i++) {
      const it = this.smoke[i]; if (!it.on) continue;
      it.life -= dt;
      if (it.life <= 0) { it.on = false; it.im.setVisible(false); continue; }
      const k = 1 - it.life / it.max;
      it.im.x += (it.vx + Math.sin(t * 1.7 + i) * 3) * dt; it.im.y += it.vy * dt; it.vy *= 1 - dt * 0.25;
      it.im.setScale(it.s0 + (it.s1 - it.s0) * k).setAlpha(it.a * (k < 0.12 ? k / 0.12 : 1 - (k - 0.12) / 0.88));
    }
    const v = this.scene.cameras.main.worldView;
    const sd = this.shed;
    if (sd) {
      let mv = false;
      if (sd.slideT >= 0) { sd.slideT += dt / SLIDE_TIME; const k = Math.min(1, sd.slideT), e = k * k * (3 - 2 * k); sd.fx = sd.sx + (sd.tfx - sd.sx) * e; sd.fy = sd.sy + (sd.tfy - sd.sy) * e; mv = true; if (k >= 1) sd.slideT = -1; }
      const lt = this.liftId != null && this.liftId === sd.placedId ? 1 : 0;
      if (lt !== sd.lift) { sd.lift += (lt - sd.lift) * Math.min(1, dt * 12); if (Math.abs(lt - sd.lift) < 0.01) sd.lift = lt; mv = true; }
      if (sd.popT >= 0) {
        sd.popT += dt; const k = sd.popT / 0.85;
        if (k >= 1) { sd.popT = -1; sd.c.setScale(1).setAlpha(1 - 0.45 * sd.lift); }
        else { const s = Math.max(0.001, 1 - Math.exp(-5.5 * k) * Math.cos(k * Math.PI * 3.1)); sd.c.setScale(0.9 + 0.1 * Math.min(1.1, s), s).setAlpha(Math.min(1, k * 6)); }
      } else if (sd.lift > 0 || sd.c.alpha !== 1) sd.c.setAlpha(1 - 0.45 * sd.lift);
      if (mv) this._repShed(sd);
    }
    for (let i = 0; i < this.lots.length; i++) {
      const lv = this.lots[i];
      const bv = lv.bv; if (!bv) continue;
      let moved = false;
      if (lv.slideT >= 0) {
        lv.slideT += dt / SLIDE_TIME; const k = Math.min(1, lv.slideT), e = k * k * (3 - 2 * k);
        lv.fx = lv.sx + (lv.tfx - lv.sx) * e; lv.fy = lv.sy + (lv.tfy - lv.sy) * e; moved = true;
        if (k >= 1) lv.slideT = -1;
      }
      const lt = this.liftId != null && this.liftId === lv.placedId ? 1 : 0;
      if (lt !== lv.lift) { lv.lift += (lt - lv.lift) * Math.min(1, dt * 12); if (Math.abs(lt - lv.lift) < 0.01) lv.lift = lt; moved = true; }
      if (moved) this._reposition(lv);
      if (lv.fx + 260 < v.x || lv.fx - 260 > v.right || lv.fy + 60 < v.y || lv.fy - 340 > v.bottom) continue;
      if (lv.popT >= 0) {
        lv.popT += dt; const k = lv.popT / 0.85;
        if (k >= 1) { lv.popT = -1; bv.c.setScale(1).setAlpha(1 - 0.45 * lv.lift); }
        else { const s = Math.max(0.001, 1 - Math.exp(-5.5 * k) * Math.cos(k * Math.PI * 3.1)); bv.c.setScale(0.9 + 0.1 * Math.min(1.1, s), s).setAlpha(Math.min(1, k * 6)); }
      } else if (lv.lift > 0 || bv.c.alpha !== 1) bv.c.setAlpha(1 - 0.45 * lv.lift);
      const L = MCH[lv.type], busy = lv.busy;
      if (bv.sails) {
        const tgt = lv.cond < 20 ? 0 : busy ? 1.5 + wind * 1.4 : 0.2 + wind * 0.9;
        lv.spd += (tgt - lv.spd) * Math.min(1, dt * 1.6);
        bv.sails.rotation += lv.spd * dt;
      }
      if (bv.wheel) {
        lv.spd += ((busy ? 4.2 : 0) - lv.spd) * Math.min(1, dt * 2.2);
        bv.wheel.rotation += lv.spd * dt;
      }
      if (L.smoke && busy) {
        lv.smokeT -= dt;
        if (lv.smokeT <= 0) { lv.smokeT = lv.type === 'bakery' ? 0.45 : 0.6; this._puff(lv.fx + L.smoke[0], lv.fy + L.smoke[1], wind, lv.type === 'bakery'); }
      }
      if (bv.crate.visible) bv.crate.setScale(1 + Math.sin(t * 3 + lv.ph) * 0.03);
    }
  }

  setQuality() { /* kaliteden bağımsız */ }

  destroy() {
    for (const off of this._offs) off(); this._offs.length = 0;
    for (const lv of this.lots) this._unbuild(lv);
    this.lots.length = 0; this.byKey.clear();
    for (const it of this.smoke) it.im.destroy(); this.smoke.length = 0;
    this._destroyShed();
  }
}
