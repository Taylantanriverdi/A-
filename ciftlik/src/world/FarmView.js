// FarmView — Aşama 8 yapıları (sera, soğuk hava deposu, depo, silo, garaj) + traktör/biçerdöver sürüşü (PLAN §15).
// State'i YALNIZCA OKUR: state.placed (türler F8_TYPES), state.vehicles [{id,type,garageId}], state.workers (sürücü görünümü), state.weather.
// Olaylar: placed:changed, save:loaded, vehicle:run {type, tiles:[tileId], driverId?}, build:ghost, workers:changed.
// Sera: arka katman (ekinlerin altında) + ön cam katmanı (ekinlerin ÜSTÜNDE; ayak izi altındaki ekinler camın arkasından görünür).
// Garaj: içinde sahip olunan araçlar park hâlinde. Sürüş: garajdan çıkış → karolar sırayla → garaja dönüş. update'te bellek ayrılmaz.
import { depthForY, DEPTH, TILE_W, TILE_H } from '../core/constants.js';
import { genFarm8, F8, F8_TYPES, VEH, WHEEL_KEYS } from '../render/textures/farm8.js';
import { footOf } from './placedUtil.js';
import { PLACEABLES } from '../data/placeables.js';

const DROPS = 8;
const SPD_MOVE = 175, SPD_WORK = 105;

export default class FarmView {
  constructor(scene, state, bus, renderer) {
    this.scene = scene; this.state = state; this.bus = bus; this.renderer = renderer;
    this.lots = new Map(); this.list = []; this.dirty = true; this.poll = 0; this.t = 0; this._offs = []; this.liftId = null; this._initial = true;
    this.runs = { tractor: null, harvester: null }; this.vis = { tractor: null, harvester: null };
    this._foot = { x: 0, y: 0 }; this.wet = 0;
  }

  create() {
    genFarm8(this.scene);
    const on = (n, f) => this._offs.push(this.bus.on(n, f, this));
    on('placed:changed', () => { this.dirty = true; });
    on('save:loaded', () => { this.dirty = true; this._initial = true; });
    on('workers:changed', () => { this.dirty = true; });
    on('build:ghost', (p) => { this.liftId = p && p.moving != null ? p.moving : null; });
    on('vehicle:run', (p) => this._run(p));
    this.sync();
  }

  get fx() { return this.renderer.buildings?.fx || null; }

  // ------------------------------------------------------------------ yapılar
  _build(p) {
    const s = this.scene, R = this.renderer, L = F8[p.type], d = PLACEABLES[p.type];
    const f = footOf(p.type, p.tx, p.ty, this._foot);
    const lv = { id: p.id, type: p.type, tx: p.tx, ty: p.ty, fx: f.x, fy: f.y, c: null, back: null, parts: [], shadow: null, glows: [], lights: [], fan: null, drops: null, glare: null,
      park: { tractor: null, harvester: null }, popT: -1, lift: 0, seen: true, ph: this.list.length * 1.7, bottom: (p.ty + (d ? d.h : 3)) * TILE_H, dirty: false };
    if (p.type === 'greenhouse') lv.back = s.add.image(f.x, f.y, L.back).setOrigin(L.ox / L.w, L.oy / L.h).setDepth(DEPTH.SHADOW + 0.6);
    lv.c = s.add.container(f.x, f.y);
    if (p.type === 'greenhouse') {
      lv.c.setDepth(depthForY(lv.bottom) + 0.4);
      lv.c.add(s.add.image(0, 0, L.front).setOrigin(L.ox / L.w, L.oy / L.h));
      lv.glare = s.add.image(0, -100, 'f8_glare').setBlendMode('ADD').setAlpha(0); lv.c.add(lv.glare);
      lv.drops = [];
      for (let i = 0; i < DROPS; i++) { const im = s.add.image(0, 0, 'f8_drop').setVisible(false); lv.c.add(im); lv.drops.push({ im, x: 0, y: -168, v: 20, w: 0 }); this._resetDrop(lv.drops[i], true, i); }
      lv.parts = [lv.back, lv.c];
    } else if (p.type === 'garage') {
      lv.c.setDepth(depthForY(f.y));
      lv.c.add(lv.back = s.add.image(0, 0, L.back).setOrigin(L.ox / L.w, L.oy / L.h)); // iç mekân (konteynerin içinde; üstteki 'back' alanı kullanılmaz)
      lv.parkLayer = s.add.container(0, 0); lv.c.add(lv.parkLayer);
      lv.c.add(s.add.image(0, 0, L.front).setOrigin(L.ox / L.w, L.oy / L.h));
      lv.parts = [lv.c];
    } else {
      lv.c.setDepth(depthForY(f.y));
      lv.c.add(s.add.image(0, 0, L.key).setOrigin(L.ox / L.w, L.oy / L.h));
      if (p.type === 'coldStorage') { lv.fan = s.add.image(L.fan[0], L.fan[1], 'f8_fan'); lv.c.add(lv.fan); }
      lv.parts = [lv.c];
    }
    lv.shadow = R.shadows.register(lv.c, { footX: f.x, footY: f.y - 1, height: L.height, width: L.shw, shadowKey: L.shadowKey || L.key });
    for (const [wx, wy, col, rad, inten, gs] of L.win) {
      const glow = s.add.image(f.x + wx, f.y + wy, 'prop_lantern_glow').setScale(gs);
      R.lighting.addEmissive(glow, inten + 0.2); lv.glows.push(glow);
      lv.lights.push(R.lights.addPoint({ x: f.x + wx, y: f.y + wy + 10, radius: rad, color: col, intensity: inten, nightOnly: true, flicker: 0.05 }));
    }
    return lv;
  }

  _unbuild(lv) {
    lv.shadow?.remove(); for (const l of lv.lights) l.remove();
    const pts = this.renderer.lighting?.points;
    for (const g of lv.glows) { if (pts) { const i = pts.findIndex((it) => it.im === g); if (i >= 0) pts.splice(i, 1); } g.destroy(); }
    for (const k in lv.park) if (lv.park[k]) this._killVeh(lv.park[k]);
    if (lv.back && lv.type === 'greenhouse') lv.back.destroy();
    lv.c.destroy();
  }

  _reposition(lv) {
    const L = F8[lv.type], y = lv.fy - lv.lift * 7;
    lv.c.setPosition(lv.fx, y); if (lv.type === 'greenhouse') lv.back.setPosition(lv.fx, y);
    lv.c.setDepth(lv.type === 'greenhouse' ? depthForY((lv.ty + (PLACEABLES.greenhouse.h)) * TILE_H) + 0.4 : depthForY(lv.fy));
    lv.shadow?.set({ footX: lv.fx, footY: lv.fy - 1 });
    for (let i = 0; i < L.win.length; i++) { lv.glows[i].setPosition(lv.fx + L.win[i][0], lv.fy + L.win[i][1]); lv.lights[i].set({ x: lv.fx + L.win[i][0], y: lv.fy + L.win[i][1] + 10 }); }
  }

  sync() {
    this.dirty = false;
    const initial = this._initial; this._initial = false;
    const arr = Array.isArray(this.state?.placed) ? this.state.placed : [];
    for (let i = 0; i < this.list.length; i++) this.list[i].seen = false;
    let firstGarage = null;
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i]; if (!p || !F8[p.type] || !F8_TYPES.includes(p.type)) continue;
      let lv = this.lots.get(p.id);
      const f = footOf(p.type, p.tx, p.ty, this._foot);
      if (!lv) {
        lv = this._build(p); this.lots.set(p.id, lv); this.list.push(lv);
        if (!initial) this._pop(lv);
      } else if (lv.tx !== p.tx || lv.ty !== p.ty) {
        lv.tx = p.tx; lv.ty = p.ty; lv.fx = f.x; lv.fy = f.y; lv.bottom = (p.ty + PLACEABLES[p.type].h) * TILE_H; this._reposition(lv);
        this.fx?.dust(lv.fx, lv.fy + 2, F8[lv.type].shw * 0.3, 6);
      }
      lv.seen = true;
      if (p.type === 'garage' && !firstGarage) firstGarage = lv;
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const lv = this.list[i]; if (lv.seen) continue;
      this.fx?.dust(lv.fx, lv.fy + 2, F8[lv.type].shw * 0.4, 8);
      this._unbuild(lv); this.lots.delete(lv.id); this.list.splice(i, 1);
    }
    // garajdaki park hâlindeki araçlar
    const vs = Array.isArray(this.state?.vehicles) ? this.state.vehicles : [];
    for (let i = 0; i < this.list.length; i++) {
      const lv = this.list[i]; if (lv.type !== 'garage') continue;
      for (const type of ['tractor', 'harvester']) {
        let has = false;
        for (let k = 0; k < vs.length; k++) { const v = vs[k]; if (v && v.type === type && (v.garageId === lv.id || (lv === firstGarage && !this.lots.has(v.garageId)))) { has = true; break; } }
        if (has && !lv.park[type]) { lv.park[type] = this._mkVeh(type, lv.parkLayer, F8.garage.slot[type][0], F8.garage.slot[type][1], 0.78, false); }
        else if (!has && lv.park[type]) { this._killVeh(lv.park[type]); lv.park[type] = null; }
      }
    }
  }

  _pop(lv) {
    lv.popT = 0;
    for (const o of lv.parts) o.setScale(0.001).setAlpha(0);
    const w = F8[lv.type].shw * 0.5;
    this.fx?.dust(lv.fx, lv.fy + 2, w, 12); this.fx?.sparkle(lv.fx, lv.fy - 10, w * 1.6, F8[lv.type].height * 0.9, 12);
  }

  _resetDrop(d, init, i) {
    const G = F8.greenhouse;
    d.x = G.glass.x0 + 10 + ((i * 97 + (Math.random() * 60)) % (G.glass.x1 - G.glass.x0 - 20)); d.v = 16 + Math.random() * 26; d.w = 0.6 + Math.random() * 0.5;
    d.y = init ? G.dropY[0] + Math.random() * (G.dropY[1] - G.dropY[0]) : G.dropY[0] + Math.random() * 20;
  }

  // ------------------------------------------------------------------ araçlar
  _mkVeh(type, parent, x, y, scale, withShadow) {
    const s = this.scene, V = VEH[type];
    const c = s.add.container(x, y);
    const rwk = WHEEL_KEYS[V.rw[2]], fwk = WHEEL_KEYS[V.fw[2]];
    const fw = s.add.image(V.fw[0] - V.ox, V.fw[1] - V.oy, fwk).setScale(0.5);
    const rw = s.add.image(V.rw[0] - V.ox, V.rw[1] - V.oy, rwk).setScale(0.5);
    const body = s.add.image(0, 0, V.body).setOrigin(V.ox / V.w, V.oy / V.h).setScale(0.5);
    c.add([fw, rw, body]);
    let reel = null;
    if (V.reel) { reel = s.add.image(V.reel[0] - V.ox, V.reel[1] - V.oy, 'f8_reel').setScale(0.5); c.add(reel); }
    const drv = s.add.image(V.driver[0] - V.ox, V.driver[1] - V.oy + 4, 'f8_drv_0').setScale(0.5).setVisible(false);
    const over = s.add.image(0, 0, V.over).setOrigin(V.ox / V.w, V.oy / V.h).setScale(0.5);
    c.add([drv, over]);
    c.setScale(scale);
    if (parent) parent.add(c);
    const o = { type, c, fw, rw, body, reel, drv, over, shadow: null, drvLook: -1 };
    if (withShadow) o.shadow = this.renderer.shadows.register(c, { footX: x, footY: y - 1, height: V.height, width: V.shw, shadowKey: V.body });
    return o;
  }
  _killVeh(o) { o.shadow?.remove(); o.c.destroy(); }

  _setDriver(o, id) {
    let look = -1;
    if (id != null) { const ws = this.state?.workers; if (Array.isArray(ws)) for (let i = 0; i < ws.length; i++) if (ws[i] && ws[i].id === id) { look = (((ws[i].look | 0) % 4) + 4) % 4; break; } }
    if (look !== o.drvLook) { o.drvLook = look; if (look >= 0) o.drv.setTexture('f8_drv_' + look).setVisible(true); else o.drv.setVisible(false); }
  }

  /** WorkerView: bu çalışan şu an araç kullanıyor mu (figürü gizlenir). */
  isDriving(id) {
    const a = this.runs.tractor, b = this.runs.harvester;
    return !!((a && a.driverId === id) || (b && b.driverId === id));
  }

  _garageFor(type) {
    const vs = Array.isArray(this.state?.vehicles) ? this.state.vehicles : [];
    for (let i = 0; i < vs.length; i++) if (vs[i] && vs[i].type === type && this.lots.has(vs[i].garageId)) return this.lots.get(vs[i].garageId);
    for (let i = 0; i < this.list.length; i++) if (this.list[i].type === 'garage') return this.list[i];
    return null;
  }

  _run(p) {
    if (!p || !VEH[p.type] || !Array.isArray(p.tiles) || !p.tiles.length) return;
    const type = p.type; let r = this.runs[type];
    const pts = [];
    for (let i = 0; i < p.tiles.length; i++) { const k = String(p.tiles[i]).split(','); const tx = +k[0], ty = +k[1]; if (Number.isFinite(tx) && Number.isFinite(ty)) pts.push((tx + 0.5) * TILE_W, (ty + 0.5) * TILE_H + 12); }
    if (!pts.length) return;
    if (r && !r.returning) { for (let i = 0; i < pts.length; i++) r.q.push(pts[i]); if (p.driverId != null) r.driverId = p.driverId; return; }
    const g = this._garageFor(type), slot = F8.garage.slot[type];
    let sx, sy, ex, ey;
    if (g) { sx = g.fx + slot[0]; sy = g.fy + slot[1]; ex = sx; ey = g.fy + 40; }
    else { sx = pts[0] - 220; sy = pts[1]; ex = sx; ey = sy; }
    if (r && r.returning) { sx = r.x; sy = r.y; ex = r.ex; ey = r.ey; } // geri dönerken yeni iş: bulunduğu yerden devam
    if (!r) {
      const veh = this.vis[type] || (this.vis[type] = this._mkVeh(type, null, sx, sy, 1, true));
      r = { type, veh, x: sx, y: sy, q: [], qi: 0, ret: [], returning: false, dir: 1, ex, ey, sx, sy, driverId: null, rot: 0, dustT: 0, smokeT: 0, g: g ? g.id : null };
      this.runs[type] = r; veh.c.setVisible(true);
    }
    r.q.length = 0; r.qi = 0; r.returning = false; r.ex = ex; r.ey = ey; r.sx = sx; r.sy = sy;
    r.q.push(ex, ey); for (let i = 0; i < pts.length; i++) r.q.push(pts[i]);
    r.driverId = p.driverId != null ? p.driverId : null;
    this._setDriver(r.veh, r.driverId);
    this.fx?.dust(r.x, r.y, 20, 4);
  }

  _stepRun(r, dt, t) {
    const V = VEH[r.type], o = r.veh, q = r.q;
    let remain = dt;
    if (r.qi >= q.length) {
      if (!r.returning) { r.returning = true; q.length = 0; r.qi = 0; q.push(r.ex, r.ey, r.sx, r.sy); }
      else { this._endRun(r); return; }
    }
    const tx = q[r.qi], ty = q[r.qi + 1];
    const working = !r.returning && r.qi >= 2;
    const spd = working ? SPD_WORK : SPD_MOVE;
    const dx = tx - r.x, dy = ty - r.y, dist = Math.hypot(dx, dy), step = spd * remain;
    if (dist <= step) { r.x = tx; r.y = ty; r.qi += 2; } else { r.x += dx / dist * step; r.y += dy / dist * step; }
    const moved = Math.min(dist, step);
    if (Math.abs(dx) > 0.6) r.dir = dx > 0 ? 1 : -1;
    r.rot += moved / V.rw[2];
    const bob = Math.sin(t * 22) * (working ? 0.7 : 0.4);
    o.c.setPosition(r.x, r.y + bob).setScale(r.dir, 1).setDepth(depthForY(r.y));
    o.shadow?.set({ footX: r.x, footY: r.y - 1 });
    o.rw.rotation = r.rot; o.fw.rotation = r.rot * V.rw[2] / V.fw[2];
    if (o.reel) o.reel.rotation += dt * (working ? 6 : 2.5);
    // parçacıklar
    const fx = this.fx; if (!fx) return;
    r.dustT -= dt; r.smokeT -= dt;
    if (r.dustT <= 0 && moved > 0) {
      r.dustT = working ? 0.07 : 0.12;
      fx.spawn('fx_dust', r.x - r.dir * 30, r.y - 2, -r.dir * (16 + Math.random() * 14), -6 - Math.random() * 8, 0.8 + Math.random() * 0.4, 0.3, 0.8, working ? 0.7 : 0.45, false, 0);
      if (r.type === 'harvester' && working) {
        const hx = r.x + r.dir * (V.reel[0] - V.ox), hy = r.y - (V.oy - V.reel[1]);
        for (let i = 0; i < 2; i++) fx.spawn('f8_straw', hx + (Math.random() - 0.5) * 18, hy - 4, -r.dir * (30 + Math.random() * 40), -40 - Math.random() * 30, 0.7 + Math.random() * 0.4, 0.9, 0.6, 0.95, false, 120, (Math.random() - 0.5) * 6);
      }
    }
    if (r.smokeT <= 0) {
      r.smokeT = 0.24;
      const sxp = r.type === 'tractor' ? r.x + r.dir * 31.8 : r.x - r.dir * 34, syp = r.type === 'tractor' ? r.y - 60 : r.y - 78;
      fx.spawn('mch_smoke', sxp, syp, r.dir * 6 + (Math.random() - 0.5) * 6, -22 - Math.random() * 8, 1.1, 0.18, 0.6, working ? 0.5 : 0.32, false, 0);
    }
  }

  _endRun(r) {
    r.veh.c.setVisible(false); r.veh.shadow?.set({ footX: -9999, footY: -9999 });
    this.runs[r.type] = null; this.fx?.dust(r.x, r.y, 18, 4);
  }

  // ------------------------------------------------------------------ kare
  update(env) {
    const dt = env.dt, t = env.t; this.t = t;
    this.poll += dt;
    if (this.dirty || this.poll > 0.6) { this.poll = 0; this.sync(); }
    // sürüşler
    for (const type of ['tractor', 'harvester']) { const r = this.runs[type]; if (r) this._stepRun(r, dt, t); }
    if (!this.list.length) return;
    const v = this.scene.cameras.main.worldView;
    const wt = this.state?.weather?.type;
    const wetT = wt === 'rain' || wt === 'storm' ? 1 : 0;
    this.wet += (wetT - this.wet) * Math.min(1, dt * 0.8);
    const sunK = env.sun.visible ? env.day.light * (1 - env.cloud) : 0;
    for (let i = 0; i < this.list.length; i++) {
      const lv = this.list[i];
      const lt = this.liftId != null && this.liftId === lv.id ? 1 : 0;
      if (lt !== lv.lift) {
        lv.lift += (lt - lv.lift) * Math.min(1, dt * 12); if (Math.abs(lt - lv.lift) < 0.01) lv.lift = lt;
        this._reposition(lv); for (const o of lv.parts) o.setAlpha(1 - 0.45 * lv.lift);
      }
      if (lv.popT >= 0) {
        lv.popT += dt; const k = lv.popT / 0.85;
        if (k >= 1) { lv.popT = -1; for (const o of lv.parts) o.setScale(1).setAlpha(1 - 0.45 * lv.lift); }
        else { const s = Math.max(0.001, 1 - Math.exp(-5.5 * k) * Math.cos(k * Math.PI * 3.1)); for (const o of lv.parts) o.setScale(0.9 + 0.1 * Math.min(1.1, s), s).setAlpha(Math.min(1, k * 6)); }
      }
      if (lv.fx + 260 < v.x || lv.fx - 260 > v.right || lv.fy + 60 < v.y || lv.fy - 330 > v.bottom) continue;
      if (lv.fan) lv.fan.rotation += dt * 7;
      if (lv.type === 'greenhouse') {
        const G = F8.greenhouse;
        // yansıma: güneşin yönüne göre kayan parıltı
        lv.glare.setAlpha(Math.min(0.55, sunK * 0.6)).setX(Math.max(-150, Math.min(150, env.sun.dir * 150 + Math.sin(t * 0.07 + lv.ph) * 12)));
        // yağmur damlaları camdan kayar
        for (let k = 0; k < DROPS; k++) {
          const d = lv.drops[k];
          if (this.wet < 0.05) { if (d.im.visible) d.im.setVisible(false); continue; }
          d.y += d.v * dt * (1 + env.wind * 0.6);
          if (d.y > G.dropY[1]) this._resetDrop(d, false, k);
          d.im.setVisible(true).setPosition(d.x + Math.sin(d.y * 0.1 + k) * 0.8, d.y).setAlpha(this.wet * d.w).setScale(0.8 + d.w * 0.3);
        }
      }
      if (lv.type === 'garage') {
        for (const type of ['tractor', 'harvester']) { const pk = lv.park[type]; if (pk) { const out = !!this.runs[type]; if (pk.c.visible === out) pk.c.setVisible(!out); } }
      }
    }
  }

  setQuality() { /* kaliteden bağımsız */ }

  destroy() {
    for (const off of this._offs) off(); this._offs.length = 0;
    for (const lv of this.list) this._unbuild(lv);
    this.list.length = 0; this.lots.clear();
    for (const k of ['tractor', 'harvester']) if (this.vis[k]) { this._killVeh(this.vis[k]); this.vis[k] = null; this.runs[k] = null; }
  }
}
