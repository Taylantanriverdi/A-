// LandView — organik arazi (K26/K27). state.land.parcels [{id, owned}] YALNIZCA okunur; olaylar: land:changed, save:loaded.
// 1) Sahip olunan karoların DIŞ sınırı boyunca ahşap çit (köşe/direk tabanlı: FenceView atlas parçaları, havuzlu Image).
// 2) Sahipsiz parseller: düşük çözünürlüklü, bulanıklaştırılmış maske dokusu (soluk örtü) + komşu sahipsiz parseller arası ince iz.
// 3) Parsel merkezinde "SATILIK" tabelası (tıklayınca `land:signClick {parcelId}`).
// update'te bellek ayrılmaz; yeniden kurulum yalnız land:changed / save:loaded'da.
import { DEPTH, TILE_W, TILE_H, WORLD_TILES_X as NX, WORLD_TILES_Y as NY, depthForY } from '../core/constants.js';
import { PARCELS, parcelAt, tilesOfParcel, parcelInfo, blockedKind } from '../data/land.js';
import { genFarm8 } from '../render/textures/farm8.js';
import { genPlaced, FENCE, fenceFrame } from '../render/textures/placed.js';

const RES = 4, MARGIN = 6;               // maske: karo başına 4 px, kenarda 6 px pay
const VEIL_A = 0.55, FADE = 1.2;
const VK = (vx, vy) => vx + vy * 128;
const IDS = Object.keys(PARCELS);

export default class LandView {
  constructor(scene, state, bus, renderer) {
    this.scene = scene; this.state = state; this.bus = bus; this.renderer = renderer;
    this.owned = new Uint8Array(NX * NY); this.pid = new Int8Array(NX * NY);
    this.signs = new Map(); this.fading = [];
    this.cells = new Map(); this.free = []; this.fenceCells = []; this.vm = new Map();
    this.dirty = true; this.poll = 0; this._offs = []; this.veil = null; this.fade = 1; this.curTex = 0; this._init = true;
    this.line = null; this.sig = '';
  }

  create() {
    genFarm8(this.scene); genPlaced(this.scene);
    const s = this.scene;
    for (let i = 0; i < NY * NX; i++) { const id = parcelAt(i % NX, (i / NX) | 0); this.pid[i] = id ? IDS.indexOf(id) : -1; }
    const W = NX * RES + MARGIN * 2, H = NY * RES + MARGIN * 2;
    this.cv = [0, 1].map((i) => s.textures.createCanvas('land_veil' + i, W, H));
    this.vimg = this.cv.map((t, i) => s.add.image(-MARGIN / RES * TILE_W, -MARGIN / RES * TILE_H, 'land_veil' + i).setOrigin(0, 0)
      .setDisplaySize(W / RES * TILE_W, H / RES * TILE_H).setDepth(DEPTH.GROUND + 0.9).setAlpha(0));
    this.line = s.add.graphics().setDepth(DEPTH.GROUND + 0.92).setAlpha(0);
    const on = (n, f) => this._offs.push(this.bus.on(n, f, this));
    on('land:changed', () => { this.dirty = true; });
    on('save:loaded', () => { this.dirty = true; this._init = true; });
    this.sync();
  }

  _ownedId(id) {
    const p = this.state?.land?.parcels; if (!p) return id === 'P1';
    if (Array.isArray(p)) { for (let i = 0; i < p.length; i++) if (p[i] && p[i].id === id) return !!p[i].owned; return id === 'P1'; }
    return !!(p[id] && p[id].owned);
  }
  _own(tx, ty) { return tx >= 0 && ty >= 0 && tx < NX && ty < NY && this.owned[tx + ty * NX] === 1; }
  _inW(tx, ty) { return tx >= 0 && ty >= 0 && tx < NX && ty < NY; }
  _gap(tx, ty) { return blockedKind(tx + ',' + ty) === 'path'; }
  /** (ax,ay)-(bx,by) komşu iki karo arasında çit kenarı var mı */
  _edge(ax, ay, bx, by) {
    if (!this._inW(ax, ay) || !this._inW(bx, by)) return false;
    if (this._own(ax, ay) === this._own(bx, by)) return false;
    return !(this._gap(ax, ay) || this._gap(bx, by));
  }
  _mask(vx, vy) {
    let m = 0;
    if (this._edge(vx - 1, vy - 1, vx, vy - 1)) m |= 1;   // kuzey (dikey kenar)
    if (this._edge(vx, vy - 1, vx, vy)) m |= 2;           // doğu (yatay kenar)
    if (this._edge(vx - 1, vy, vx, vy)) m |= 4;           // güney
    if (this._edge(vx - 1, vy - 1, vx - 1, vy)) m |= 8;   // batı
    return m;
  }

  _drawVeil(tex) {
    const c = tex.getContext(), W = tex.width, H = tex.height;
    c.clearRect(0, 0, W, H); c.filter = 'none';
    c.fillStyle = '#b9bcae';
    // sahipsiz karolar + dünya dışı pay (kenarda solma olmasın)
    for (let ty = -2; ty < NY + 2; ty++) for (let tx = -2; tx < NX + 2; tx++) {
      const ix = Math.min(NX - 1, Math.max(0, tx)), iy = Math.min(NY - 1, Math.max(0, ty));
      if (this.owned[ix + iy * NX]) continue;
      c.fillRect(MARGIN + tx * RES, MARGIN + ty * RES, RES, RES);
    }
    let ok = true;
    try { const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H; const t = tmp.getContext('2d'); t.filter = 'blur(3px)';
      if (t.filter !== 'blur(3px)') ok = false; else { t.drawImage(tex.getSourceImage(), 0, 0); c.clearRect(0, 0, W, H); c.drawImage(tmp, 0, 0); } } catch (e) { ok = false; }
    tex.refresh();
  }

  _drawLines() {
    const g = this.line; g.clear(); g.lineStyle(3, 0x5c5f40, 0.2);
    for (let ty = 0; ty < NY; ty++) for (let tx = 0; tx < NX; tx++) {
      const i = tx + ty * NX; if (this.owned[i] || this.pid[i] < 0) continue;
      if (tx + 1 < NX && !this.owned[i + 1] && this.pid[i + 1] !== this.pid[i]) this._dash(g, (tx + 1) * TILE_W, ty * TILE_H, 0, TILE_H);
      if (ty + 1 < NY && !this.owned[i + NX] && this.pid[i + NX] !== this.pid[i]) this._dash(g, tx * TILE_W, (ty + 1) * TILE_H, TILE_W, 0);
    }
  }
  _dash(g, x, y, dx, dy) {
    const n = 4, wob = ((x * 7 + y * 13) % 5) - 2;
    for (let k = 0; k < n; k += 2) { g.beginPath(); g.moveTo(x + dx * k / n + (dy ? wob : 0), y + dy * k / n + (dx ? wob : 0)); g.lineTo(x + dx * (k + 1) / n + (dy ? wob : 0), y + dy * (k + 1) / n + (dx ? wob : 0)); g.strokePath(); }
  }

  _acquire() {
    let im = this.free.pop();
    if (!im) im = this.scene.add.image(0, 0, FENCE.key, fenceFrame(0)).setOrigin(FENCE.footX / FENCE.fw, FENCE.footY / FENCE.fh);
    return im.setVisible(true).setScale(1).setAlpha(1);
  }

  _syncFence(initial) {
    // gereken tepe noktaları
    const need = this.vm; need.clear();
    for (let vy = 0; vy <= NY; vy++) for (let vx = 0; vx <= NX; vx++) { const m = this._mask(vx, vy); if (m) need.set(VK(vx, vy), m); }
    for (const [k, c] of this.cells) {
      const m = need.get(k);
      if (m === undefined) { c.im.setVisible(false); this.free.push(c.im); this.cells.delete(k); const i = this.fenceCells.indexOf(c); if (i >= 0) this.fenceCells.splice(i, 1); }
      else if (m !== c.mask) { c.mask = m; c.im.setTexture(FENCE.key, fenceFrame(m)); }
    }
    for (const [k, m] of need) {
      if (this.cells.has(k)) continue;
      const vx = k % 128, vy = (k - vx) / 128, y = vy * TILE_H, im = this._acquire();
      im.setTexture(FENCE.key, fenceFrame(m)).setPosition(vx * TILE_W, y).setDepth(depthForY(y));
      const c = { type: 'fence', im, mask: m, popT: initial ? -1 : 0 };
      if (!initial) im.setScale(1, 0.01);
      this.cells.set(k, c); this.fenceCells.push(c);
    }
  }

  _buildSign(id) {
    const s = this.scene, inf = parcelInfo(id), sx = (inf.center.tx + 0.5) * TILE_W, sy = (inf.center.ty + 0.5) * TILE_H + 6;
    const sign = s.add.image(sx, sy, 'f8_sign').setOrigin(32 / 64, 80 / 84).setDepth(depthForY(sy) + 0.02);
    sign.setInteractive({ useHandCursor: true });
    sign.on('pointerdown', () => this.bus.emit('land:signClick', { parcelId: id }));
    const sh = s.add.image(sx, sy - 1, 'fx_ao').setDisplaySize(36, 11).setAlpha(0.28).setDepth(DEPTH.SHADOW + 0.01);
    return { id, sign, sh, a: 0, ph: id.charCodeAt(1) * 1.3, leaving: false };
  }

  sync() {
    this.dirty = false;
    const initial = this._init; this._init = false;
    let sig = '';
    for (const id of IDS) sig += this._ownedId(id) || id === 'P1' ? '1' : '0';
    if (sig === this.sig && !initial) return;
    this.sig = sig;
    this.owned.fill(0);
    for (let i = 0; i < IDS.length; i++) if (sig[i] === '1') { for (const [tx, ty] of tilesOfParcel(IDS[i])) this.owned[tx + ty * NX] = 1; }
    // örtü: pasif dokuyu yeniden çiz, çapraz geçiş
    const nt = initial ? this.curTex : 1 - this.curTex;
    this._drawVeil(this.cv[nt]); this.vold = this.curTex; this.curTex = nt; this.fade = initial ? 1 : 0;
    if (initial) { this.vimg[nt].setAlpha(VEIL_A); this.vimg[1 - nt].setAlpha(0); }
    this._drawLines(); this.line.setAlpha(initial ? 1 : this.line.alpha);
    this._syncFence(initial);
    for (let i = 0; i < IDS.length; i++) {
      const id = IDS[i], own = sig[i] === '1', g = this.signs.get(id);
      if (!own && !g) { const ng = this._buildSign(id); this.signs.set(id, ng); if (initial) ng.a = 1; this._applySign(ng); }
      else if (own && g && !g.leaving) { g.leaving = true; this.fading.push(g); }
    }
  }

  _applySign(g) { g.sign.setAlpha(g.a); g.sh.setAlpha(0.28 * g.a); }

  update(env) {
    const dt = env.dt;
    this.poll += dt; if (this.dirty || this.poll > 1) { this.poll = 0; this.sync(); }
    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + dt / FADE); const k = this.fade * this.fade * (3 - 2 * this.fade);
      this.vimg[this.curTex].setAlpha(VEIL_A * k); this.vimg[1 - this.curTex].setAlpha(VEIL_A * (1 - k));
    }
    for (const g of this.signs.values()) {
      if (g.a < 1 && !g.leaving) { g.a = Math.min(1, g.a + dt * 1.2); this._applySign(g); }
      if (g.a > 0) g.sign.setRotation(Math.sin(env.t * 1.3 + g.ph) * 0.015 * (0.4 + env.wind));
    }
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const g = this.fading[i]; g.a -= dt * 0.7;
      if (g.a <= 0) { g.sign.destroy(); g.sh.destroy(); this.signs.delete(g.id); this.fading.splice(i, 1); }
      else this._applySign(g);
    }
    const L = this.fenceCells;
    for (let i = 0; i < L.length; i++) {
      const c = L[i]; if (c.popT < 0) continue;
      c.popT += dt / 0.35; const k = Math.min(1, c.popT);
      const s = k >= 1 ? 1 : Math.max(0.01, 1 - Math.exp(-6 * k) * Math.cos(k * Math.PI * 2.4));
      c.im.setScale(1, s); if (k >= 1) c.popT = -1;
    }
  }

  setQuality() {}

  destroy() {
    for (const off of this._offs) off(); this._offs.length = 0;
    for (const g of this.signs.values()) { g.sign.destroy(); g.sh.destroy(); }
    for (const c of this.cells.values()) c.im.destroy();
    for (const im of this.free) im.destroy();
    this.vimg?.forEach((i) => i.destroy()); this.line?.destroy();
    this.signs.clear(); this.cells.clear(); this.free.length = 0; this.fading.length = 0; this.fenceCells.length = 0;
  }
}
