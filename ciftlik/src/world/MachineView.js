// MachineView — atölye arsaları ve binaları + eşek sundurması (PLAN §11 "Görsel").
// State'i YALNIZCA OKUR: state.machines [{type, condition, queue, output}]. Olaylar: machines:changed, building:built (pop + toz),
// machine:done (sandıkta parıltı), save:loaded, tile:hover (boş arsa vurgusu). Nesneler bir kez kurulur; update'te bellek ayrılmaz.
// Boşta: değirmen yavaş döner; kuyrukta iş varsa hızlı. Fırın/konserve çalışırken duman/buhar. Gece pencere ışığı. condition<50 yıpranmış.
import { depthForY, DEPTH, TILE_W, TILE_H } from '../core/constants.js';
import { MACHINES } from '../data/recipes.js';
import { DONKEY } from '../data/workers.js';
import { genMachines, MCH, MLOT, MLOT_KEY, MLOT_HL, mSignKey, SAILS, WHEEL, SHED } from '../render/textures/machines.js';

const SMOKE_N = 22;
const SOOT = [[-0.28, -52], [0.2, -34], [-0.02, -76]];

export default class MachineView {
  constructor(scene, state, bus, renderer) {
    this.scene = scene; this.state = state; this.bus = bus; this.renderer = renderer;
    this.lots = []; this.byType = new Map(); this.dirty = true; this.poll = 0; this.t = 0; this.hoverLot = null;
    this.pending = new Set(); this._offs = []; this.smoke = []; this.sCur = 0; this.shed = null;
  }

  create() {
    const s = this.scene;
    genMachines(s); // idempotent
    for (const type of Object.keys(MACHINES)) {
      const lot = MACHINES[type].lot, wt = lot.x1 - lot.x0 + 1, ht = lot.y1 - lot.y0 + 1;
      const px = lot.x0 * TILE_W, py = lot.y0 * TILE_H, W = wt * TILE_W, H = ht * TILE_H, botY = py + H;
      const lv = { type, lot, px, py, W, H, botY, fx: px + W / 2, fy: botY - 10, hover: 0, ph: this.lots.length * 1.9, m: null, bv: null, popT: -1, smokeT: 0, spd: 0, busy: false, cond: 100, crateN: 0, wearN: -1 };
      const dep = depthForY(botY);
      lv.patch = s.add.image(px - MLOT.x, py - MLOT.t, MLOT_KEY).setOrigin(0, 0).setDepth(DEPTH.GROUND + 1); // zemin düzlemi: üzerinde yürüyenler (Çırak) yamanın önünde kalır
      lv.hl = s.add.image(px - MLOT.x, py - MLOT.t, MLOT_HL).setOrigin(0, 0).setBlendMode('ADD').setAlpha(0).setVisible(false).setDepth(DEPTH.GROUND + 1.1);
      lv.sign = s.add.image(px + 20, botY + 3, mSignKey(type)).setOrigin(19 / 38, 50 / 52).setDepth(depthForY(botY + 3));
      this.lots.push(lv); this.byType.set(type, lv);
    }
    for (let i = 0; i < SMOKE_N; i++) {
      const im = s.add.image(0, 0, 'mch_smoke').setVisible(false).setDepth(DEPTH.WEATHER + 1);
      this.smoke.push({ im, on: false, vx: 0, vy: 0, life: 0, max: 1, s0: 0.3, s1: 1, a: 0.5 });
    }
    this._buildShed();
    const on = (n, f) => this._offs.push(this.bus.on(n, f, this));
    on('machines:changed', () => { this.dirty = true; });
    on('save:loaded', () => { this.dirty = true; });
    on('machine:done', (p) => { this.dirty = true; this._done(p); });
    on('building:built', (p) => {
      const id = p && (p.lotId || p.type);
      if (id && MACHINES[id]) { this.pending.add(id); this.dirty = true; }
    });
    on('tile:hover', (p) => {
      this.hoverLot = null; if (!p) return;
      for (const lv of this.lots) { const l = lv.lot; if (!lv.m && p.tx >= l.x0 && p.tx <= l.x1 && p.ty >= l.y0 && p.ty <= l.y1) { this.hoverLot = lv; break; } }
    });
    this.sync(true);
  }

  _buildShed() {
    const s = this.scene, R = this.renderer, sh = DONKEY.shed;
    const fx = (sh.x0 + sh.x1 + 1) * TILE_W / 2, fy = (sh.y1 + 1) * TILE_H - 8;
    const c = s.add.container(fx, fy).setDepth(depthForY(fy - 44));
    const body = s.add.image(0, 0, SHED.key).setOrigin(SHED.ox / SHED.w, SHED.oy / SHED.h);
    c.add(body);
    const sd = { c, body, shadow: null, glow: null, light: null };
    sd.shadow = R.shadows.register(c, { footX: fx, footY: fy - 1, height: SHED.height, width: SHED.shw, shadowKey: SHED.key });
    const gx = fx + 70, gy = fy - 62;
    sd.glow = s.add.image(gx, gy, 'prop_lantern_glow').setScale(0.42); R.lighting.addEmissive(sd.glow, 0.7);
    sd.light = R.lights.addPoint({ x: gx, y: gy + 12, radius: 64, color: 0xffd08a, intensity: 0.5, nightOnly: true, flicker: 0.05 });
    this.shed = sd;
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

  sync(initial = false) {
    this.dirty = false;
    const arr = Array.isArray(this.state?.machines) ? this.state.machines : [];
    for (const lv of this.lots) lv.m = null;
    for (let i = 0; i < arr.length; i++) { const m = arr[i]; const lv = m && this.byType.get(m.type); if (lv) lv.m = m; }
    for (const lv of this.lots) {
      const m = lv.m;
      lv.patch.setVisible(!m); lv.sign.setVisible(!m);
      if (!m) { lv.hl.setVisible(false); if (lv.bv) this._unbuild(lv); continue; }
      if (!lv.bv) { this._build(lv); if (!initial && this.pending.has(lv.type)) this._pop(lv); }
      this.pending.delete(lv.type);
      const bv = lv.bv; bv.c.setVisible(true);
      const q = m.queue, cond = Number.isFinite(m.condition) ? m.condition : 100;
      lv.cond = cond; lv.busy = Array.isArray(q) && q.length > 0 && cond >= 20;
      // yıpranma: koyu ton + is lekeleri
      const wear = cond < 20 ? 2 : cond < 50 ? 1 : 0;
      if (wear !== lv.wearN) {
        lv.wearN = wear;
        bv.body.setTint(wear === 2 ? 0xa89c8c : wear === 1 ? 0xd2c8b8 : 0xffffff);
        const n = wear === 2 ? 3 : wear === 1 ? 2 : 0;
        for (let i = 0; i < bv.soot.length; i++) bv.soot[i].setVisible(i < n);
      }
      // çıktı sandığı
      let qty = 0; const out = m.output;
      if (out) for (const k in out) { const st = out[k]; if (Array.isArray(st)) for (let i = 0; i < st.length; i++) qty += st[i] && st[i].qty > 0 ? st[i].qty : 0; }
      lv.crateN = qty; bv.crate.setVisible(qty > 0);
    }
  }

  _pop(lv) {
    lv.popT = 0; lv.bv.c.setScale(0.001).setAlpha(0);
    const fx = this.renderer.buildings?.fx; if (!fx) return;
    const w = MCH[lv.type].shw * 0.5;
    fx.dust(lv.fx, lv.fy + 2, w, 12); fx.sparkle(lv.fx, lv.fy - 10, w * 1.6, MCH[lv.type].height * 0.9, 12);
  }

  _done(p) {
    const lv = p && this.byType.get(p.machineId && String(p.machineId).replace(/^m_/, ''));
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
    if (!this.lots.length) return;
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
    for (let i = 0; i < this.lots.length; i++) {
      const lv = this.lots[i];
      if (lv.px + lv.W + 220 < v.x || lv.px - 220 > v.right || lv.botY + 60 < v.y || lv.botY - 340 > v.bottom) continue;
      if (!lv.m) {
        const hv = this.hoverLot === lv ? 1 : 0;
        lv.hover += (hv - lv.hover) * Math.min(1, dt * 9);
        const a = lv.hover * (0.55 + 0.25 * Math.sin(t * 4.2)) * (0.8 + 0.3 * (1 - light));
        lv.hl.setVisible(a > 0.01).setAlpha(Math.min(1, a));
        lv.sign.rotation = Math.sin(t * 1.4 + lv.ph) * (0.015 + wind * 0.05) - wind * 0.03 + lv.hover * Math.sin(t * 6) * 0.03;
        continue;
      }
      const bv = lv.bv; if (!bv) continue;
      if (lv.popT >= 0) {
        lv.popT += dt; const k = lv.popT / 0.85;
        if (k >= 1) { lv.popT = -1; bv.c.setScale(1).setAlpha(1); }
        else { const s = Math.max(0.001, 1 - Math.exp(-5.5 * k) * Math.cos(k * Math.PI * 3.1)); bv.c.setScale(0.9 + 0.1 * Math.min(1.1, s), s).setAlpha(Math.min(1, k * 6)); }
      }
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
    for (const lv of this.lots) { this._unbuild(lv); lv.patch?.destroy(); lv.hl?.destroy(); lv.sign?.destroy(); }
    this.lots.length = 0;
    for (const it of this.smoke) it.im.destroy(); this.smoke.length = 0;
    const sd = this.shed;
    if (sd) {
      sd.shadow?.remove(); sd.light?.remove();
      const pts = this.renderer.lighting?.points; if (pts) { const i = pts.findIndex((it) => it.im === sd.glow); if (i >= 0) pts.splice(i, 1); }
      sd.glow.destroy(); sd.c.destroy(); this.shed = null;
    }
  }
}
