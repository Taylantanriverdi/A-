// FieldView — tarla karolarını ve ekinleri state.tiles'tan çizer (PLAN §2, §8 "Görsel"). State'i YALNIZCA OKUR.
// • Toprak: parça (chunk) başına bir RenderTexture; yalnızca `farm:changed` ile gelen (ve görsel imzası değişen)
//   karolar silinip yeniden basılır. Komşu maskesi → organik, birleşik tarla kenarı. Nem 3 kademe, ot 0–3 tutam.
// • Ekinler: karo başına havuzlanmış Image (atlas karesi), depthForY, rüzgârla salınım (pivot taban), stage ≥ 3 gölge,
//   zararlı böcekler, hastalık (tint'siz sarı lekeli kare + leke katmanı; WebGL'de hafif evre için ek tint). Kamera dışındakiler gizlenir ve hesaplanmaz.
// • İmleç: tile:hover / son tile:tap karosunda nefes alan çerçeve; seçili alet canApply ile geçerli/geçersiz.
// • Efektler: farm:result (ok) / farm:harvested → nesne havuzlu parçacıklar. update'te bellek ayırma yok.
import Phaser from 'phaser';
import { TILE_W, TILE_H, DEPTH, depthForY } from '../core/constants.js';
import { CROPS } from '../data/crops.js';
import { ITEMS } from '../data/items.js';
import { canApply, cropVisual } from '../systems/farm/rules.js';
import { genSoil, SOIL_ATLAS, SOIL_MISC, SOIL_ERASE, SOIL_BLEED, soilFrame, bleedFrame, N, E, S, W, WEED_FRAMES, BIT_FRAMES } from '../render/textures/soil.js';
import { genFarm8 } from '../render/textures/farm8.js';
import { genCrops, CROP_ATLAS, CROP_CELL, CROP_SCALE, SHAPE_META, cropFrame } from '../render/textures/crops.js';
import { genFieldFx } from '../render/textures/fieldfx.js';
import { STALL } from '../render/layout.js';

const CHUNK_TX = 16, CHUNK_TY = 12;
const CW = CHUNK_TX * TILE_W, CH = CHUNK_TY * TILE_H;
const SOIL_DEPTH = DEPTH.GROUND + 0.3;      // çim süslerinin (tutam/çiçek/taş) üstünde
const WET_DEPTH = DEPTH.GROUND + 0.35;
const CURSOR_DEPTH = DEPTH.SHADOW + 0.5;
const FOOT_DY = 33;                          // karo üst kenarından ekin ayağına
const TOOL_ACTION = { hoe: 'plow', seed: 'plant', water: 'water', fertilize: 'fertilize', treat: 'treat', weed: 'weed', harvest: 'harvest' };
const FX_MAX = { high: 220, medium: 150, low: 80 };
const FX_MUL = { high: 1, medium: 0.7, low: 0.4 };
const SH_TEX_W = 32, SH_TEX_H = 64, FORESHORTEN = 0.56;
const WATER_DEFER = 0.65;                    // s — ıslaklık lekesi yayılırken toprak dokusu geç değişir
const CURSOR_TEX = { n: 'fx_tilecursor_n', ok: 'fx_tilecursor_ok', bad: 'fx_tilecursor_bad' }; // önceden renklendirilmiş (tint yok → Canvas'ta da)
const SICK_AT = 0.35;                        // bu hastalık düzeyinden itibaren sarı lekeli kare

const hexInt = (h) => (typeof h === 'string' ? parseInt(h.slice(1), 16) : 0xffffff);
function mixInt(a, b, t) {
  const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t);
  const g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t);
  const bl = (a & 255) + (((b & 255) - (a & 255)) * t);
  return ((r | 0) << 16) | ((g | 0) << 8) | (bl | 0);
}
const moistLevel = (m) => (m >= 50 ? 2 : m >= 28 ? 1 : 0);
const weedCount = (w) => (!(w > 0.12) ? 0 : w < 0.4 ? 1 : w < 0.7 ? 2 : 3);
function hash2(tx, ty) { let h = (Math.imul(tx, 73856093) ^ Math.imul(ty, 19349663)) >>> 0; h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0; return (h ^ (h >>> 15)) >>> 0; }

export default class FieldView {
  constructor(scene, state, bus, renderer) {
    this.scene = scene; this.state = state; this.bus = bus; this.renderer = renderer;
    genSoil(scene); genFieldFx(scene); genCrops(scene); genFarm8(scene); // idempotent (açılışta generateTextures zaten üretir)
    this.quality = 'high';
    this.chunks = new Map();     // chunkKey → RenderTexture
    this.recs = new Map();       // tileId → kayıt
    this.cropList = [];          // ekinli kayıtlar (yoğun dizi)
    this.dirty = new Set(); this.deferred = new Map(); this._soilQ = []; this._full = true; this._tilesRef = null;
    this.pools = { crop: [], sh: [], ov: [] };
    this.t = 0;
    this.marks = new Map(); this.markPool = []; this._markDirty = true; this._markT = 0; this.hint = null; this.hintN = 0; this.hintIms = [];
    for (let i = 0; i < 16; i++) this.hintIms.push(scene.add.image(0, 0, 'f8_ah').setDepth(DEPTH.GROUND + 0.55).setVisible(false));
    // imleç
    this.cursor = scene.add.image(0, 0, CURSOR_TEX.n).setDepth(CURSOR_DEPTH).setVisible(false);
    this.cursorGlow = scene.add.image(0, 0, CURSOR_TEX.n).setDepth(DEPTH.LIGHT + 1).setBlendMode('ADD').setVisible(false);
    this.hover = null; this.tap = null; this.hadHover = false; this.tool = 'hand'; this.itemId = null;
    this.valid = null; this._cx = 0; this._cy = 0; this._cTile = null; this._checkT = 0;
    this._act = { type: 'plow', tileId: '', itemId: undefined };
    // efekt havuzu
    this.fx = []; this.fxFree = [];
    for (let i = 0; i < FX_MAX.high; i++) {
      const im = scene.add.image(0, 0, 'fx_puff').setVisible(false);
      const p = { im, on: false, kind: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, drag: 0, age: 0, life: 1, s0: 1, s1: 1, a0: 1, rot: 0, vr: 0, bounce: 0, add: false, i };
      this.fx.push(p); this.fxFree.push(p);
    }
    this.fxActive = [];
    this._offs = [];
    const on = (n, f) => this._offs.push(bus.on(n, f, this));
    on('farm:changed', (p) => {
      this._markDirty = true;
      const ids = p && p.tileIds;
      if (!Array.isArray(ids)) { this._full = true; return; }
      for (let i = 0; i < ids.length; i++) this.dirty.add(ids[i]);
    });
    on('farm:areaHint', (p) => {
      const t = p && Array.isArray(p.tiles) && p.tiles.length ? p.tiles : null;
      this.hint = t; this.hintN = 0;
      if (t) for (let i = 0; i < t.length && i < 16; i++) {
        const k = String(t[i]).split(','); const im = this.hintIms[i]; im.setPosition(+k[0] * TILE_W + TILE_W / 2, +k[1] * TILE_H + TILE_H / 2).setVisible(true); this.hintN++;
      }
      for (let i = this.hintN; i < 16; i++) this.hintIms[i].setVisible(false);
    });
    on('farm:result', (p) => { if (p && p.ok) this._effect(p); });
    on('farm:harvested', (p) => this._harvestIcon(p));
    on('tile:hover', (p) => { this.hadHover = true; this.hover = p && p.tileId ? p : null; this._checkCursor(); });
    on('tile:tap', (p) => { if (p && p.tileId) { this.tap = p; this._checkCursor(); } });
    on('tool:select', (p) => { this.tool = (p && p.tool) || 'hand'; this.itemId = p && p.itemId ? p.itemId : null; this._checkCursor(); });
  }

  setQuality(level) {
    if (!FX_MAX[level]) return;
    this.quality = level;
    if (level === 'low') for (const c of this.cropList) this._setShadow(c, false);
    else for (const c of this.cropList) this._setShadow(c, c.stage >= 3);
  }

  // ------------------------------------------------------------------ karo işleme
  _tile(tx, ty) { const t = this.state.tiles; return t ? t[`${tx},${ty}`] : undefined; }
  _isPlowed(tx, ty) { const t = this._tile(tx, ty); return !!t && t.state === 'plowed'; }

  _rebuild() {
    for (const rt of this.chunks.values()) rt.clear();
    for (const rec of this.recs.values()) if (rec.crop) this._releaseCrop(rec);
    this.recs.clear(); this.dirty.clear(); this.deferred.clear();
    const tiles = this.state.tiles;
    if (tiles) for (const id in tiles) this.dirty.add(id);
  }

  _processDirty() {
    if (this.dirty.size === 0) return;
    const now = this.t;
    for (const id of this.dirty) {
      const until = this.deferred.get(id);
      if (until !== undefined) { if (now < until) continue; this.deferred.delete(id); }
      this.dirty.delete(id);
      this._processTile(id);
    }
    if (this._soilQ.length) this._flushSoil();
  }

  _processTile(id) {
    const tiles = this.state.tiles;
    const tile = tiles ? tiles[id] : undefined;
    let rec = this.recs.get(id);
    if (!tile || typeof tile !== 'object') {
      if (!rec) return;
      if (rec.plowed) { rec.plowed = false; this._markNeighbors(rec.tx, rec.ty); }
      if (rec.sig !== 0) { rec.sig = 0; this._soilQ.push(rec); }
      if (rec.crop) this._releaseCrop(rec);
      this.recs.delete(id);
      return;
    }
    if (!rec) {
      let tx = tile.tx, ty = tile.ty;
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) { const k = String(id).split(','); tx = +k[0]; ty = +k[1]; }
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
      rec = { id, tx, ty, plowed: false, sig: 0, mask: 0, lv: 0, wc: 0, bn: 0, be: 0, bs: 0, bw: 0, crop: null };
      this.recs.set(id, rec);
    }
    const plowed = tile.state === 'plowed';
    const lv = plowed ? moistLevel(+tile.moisture || 0) : 0;
    if (plowed !== rec.plowed || lv !== rec.lv) { rec.plowed = plowed; rec.lv = lv; this._markNeighbors(rec.tx, rec.ty); }
    let sig = 0;
    if (plowed) {
      const tx = rec.tx, ty = rec.ty;
      const tn = this._tile(tx, ty - 1), te = this._tile(tx + 1, ty), ts = this._tile(tx, ty + 1), tw = this._tile(tx - 1, ty);
      const pn = !!tn && tn.state === 'plowed', pe = !!te && te.state === 'plowed', ps = !!ts && ts.state === 'plowed', pw = !!tw && tw.state === 'plowed';
      const mask = (pn ? N : 0) | (pe ? E : 0) | (ps ? S : 0) | (pw ? W : 0);
      // daha ıslak komşudan sızıntı kademesi (yalnızca sürülmüş komşular)
      const bl = (p, t) => { if (!p) return 0; const l = moistLevel(+t.moisture || 0); return l > lv ? l : 0; };
      const bn = bl(pn, tn), be = bl(pe, te), bs = bl(ps, ts), bw = bl(pw, tw);
      const wc = weedCount(+tile.weeds || 0);
      rec.mask = mask; rec.wc = wc; rec.bn = bn; rec.be = be; rec.bs = bs; rec.bw = bw;
      sig = 1 | (mask << 1) | (lv << 5) | (wc << 7) | (bn << 9) | (be << 11) | (bs << 13) | (bw << 15);
    }
    if (sig !== rec.sig) { rec.sig = sig; this._soilQ.push(rec); }
    this._updateCrop(rec, tile);
  }

  _markNeighbors(tx, ty) {
    this.dirty.add(`${tx},${ty - 1}`); this.dirty.add(`${tx + 1},${ty}`);
    this.dirty.add(`${tx},${ty + 1}`); this.dirty.add(`${tx - 1},${ty}`);
  }

  _chunk(tx, ty, create) {
    const cx = Math.floor(tx / CHUNK_TX), cy = Math.floor(ty / CHUNK_TY);
    const key = cx * 4096 + cy;
    let rt = this.chunks.get(key);
    if (!rt && create) {
      rt = this.scene.add.renderTexture(cx * CW, cy * CH, CW, CH).setOrigin(0, 0).setDepth(SOIL_DEPTH);
      rt.__cx = cx; rt.__cy = cy;
      this.chunks.set(key, rt);
    }
    return rt;
  }

  /** Kuyruktaki karoları parça başına iki toplu geçişle yeniden basar: silgi, sonra toprak + kırıntı + ot. */
  _flushSoil() {
    const q = this._soilQ;
    q.sort((a, b) => (Math.floor(a.tx / CHUNK_TX) - Math.floor(b.tx / CHUNK_TX)) || (Math.floor(a.ty / CHUNK_TY) - Math.floor(b.ty / CHUNK_TY)));
    let i = 0;
    while (i < q.length) {
      const first = q[i];
      const ckx = Math.floor(first.tx / CHUNK_TX), cky = Math.floor(first.ty / CHUNK_TY);
      let j = i; while (j < q.length && Math.floor(q[j].tx / CHUNK_TX) === ckx && Math.floor(q[j].ty / CHUNK_TY) === cky) j++;
      let anyPlowed = false; for (let k = i; k < j; k++) if (q[k].sig) { anyPlowed = true; break; }
      const rt = this._chunk(first.tx, first.ty, anyPlowed);
      if (rt) {
        const dt = rt.texture; const ox = ckx * CHUNK_TX, oy = cky * CHUNK_TY;
        try {
          dt.beginDraw(); dt._eraseMode = true;
          for (let k = i; k < j; k++) dt.batchDrawFrame(SOIL_ERASE, undefined, (q[k].tx - ox) * TILE_W, (q[k].ty - oy) * TILE_H);
          dt.endDraw(true); dt._eraseMode = false;
          dt.beginDraw();
          for (let k = i; k < j; k++) { const r = q[k]; if (r.sig) this._drawSoil(dt, r, (r.tx - ox) * TILE_W, (r.ty - oy) * TILE_H); }
          dt.endDraw(false);
        } catch (e) {
          dt._eraseMode = false;
          if (!this._soilErr) { this._soilErr = true; console.warn('[field] toprak çizimi', e); }
        }
      }
      i = j;
    }
    q.length = 0;
  }

  _drawSoil(dt, r, lx, ly) {
    dt.batchDrawFrame(SOIL_ATLAS, soilFrame(r.mask, r.lv), lx, ly);
    if (r.bn) dt.batchDrawFrame(SOIL_BLEED, bleedFrame(r.mask, r.bn, 0), lx, ly);
    if (r.be) dt.batchDrawFrame(SOIL_BLEED, bleedFrame(r.mask, r.be, 1), lx, ly);
    if (r.bs) dt.batchDrawFrame(SOIL_BLEED, bleedFrame(r.mask, r.bs, 2), lx, ly);
    if (r.bw) dt.batchDrawFrame(SOIL_BLEED, bleedFrame(r.mask, r.bw, 3), lx, ly);
    let h = hash2(r.tx, r.ty);
    const rnd = () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 4294967296; };
    const nb = (h & 3) === 0 ? 0 : (h & 3) === 3 ? 2 : 1;
    for (let k = 0; k < nb; k++) dt.batchDrawFrame(SOIL_MISC, `bit${Math.floor(rnd() * BIT_FRAMES)}`, lx + 14 + rnd() * 30, ly + 10 + rnd() * 22, r.lv === 2 ? 0.7 : 1);
    // ot tutamları: yuvalar karo içinde (komşu silgisi kesmesin)
    const slots = [[10, 22], [40, 26], [24, 38], [46, 40], [8, 40]];
    for (let k = 0; k < r.wc; k++) {
      const s = slots[(k + (r.tx & 1) * 2 + (r.ty & 1)) % slots.length];
      dt.batchDrawFrame(SOIL_MISC, `weed${Math.floor(rnd() * WEED_FRAMES)}`, lx + s[0] + rnd() * 4 - 2, ly + s[1] - 19);
    }
  }

  // ------------------------------------------------------------------ ekin nesneleri
  _img(pool, key, frame) {
    const im = pool.pop();
    if (im) { im.setTexture(key, frame).setVisible(true).setAlpha(1).setRotation(0).setScale(1).clearTint(); return im; }
    return this.scene.add.image(0, 0, key, frame);
  }
  _free(pool, im) { if (!im) return; im.setVisible(false); pool.push(im); }

  _acquireCrop(rec) {
    const x = rec.tx * TILE_W + TILE_W / 2, y = rec.ty * TILE_H + FOOT_DY;
    const im = this._img(this.pools.crop, CROP_ATLAS, undefined);
    im.setOrigin(CROP_CELL.footX / CROP_CELL.w, CROP_CELL.footY / CROP_CELL.h).setPosition(x, y).setDepth(depthForY(y));
    const c = {
      rec, im, sh: null, ov: null, sp: null, x, y, frame: '', id: '', stage: -1, flex: 0, h: 0, w: 0, vis: true,
      ph: x * 0.013 + rec.ty * 0.41, bugPh: (hash2(rec.tx, rec.ty) & 1023) / 163, pop: 0, popK: 0, pest: 0, disease: 0, idx: this.cropList.length,
    };
    this.cropList.push(c); rec.crop = c;
    if (!this._fullPass) { c.pop = 0.45; c.popK = 1; } // yeni ekim: büyüyerek belirir
    return c;
  }

  _releaseCrop(rec) {
    const c = rec.crop; if (!c) return;
    this._free(this.pools.crop, c.im);
    this._free(this.pools.sh, c.sh); this._free(this.pools.ov, c.ov); this._free(this.pools.ov, c.sp);
    c.sh = c.ov = c.sp = null;
    const L = this.cropList, last = L.pop();
    if (last !== c) { L[c.idx] = last; last.idx = c.idx; }
    rec.crop = null;
  }

  _setShadow(c, want) {
    if (want && !c.sh) { c.sh = this._img(this.pools.sh, 'crop_sh', undefined).setOrigin(0.5, 1).setDepth(DEPTH.SHADOW).setPosition(c.x, c.y - 1); c.sh.setVisible(c.vis); }
    else if (!want && c.sh) { this._free(this.pools.sh, c.sh); c.sh = null; }
  }

  _updateCrop(rec, tile) {
    let v = null;
    if (tile.crop) { try { v = cropVisual(tile); } catch { v = null; } }
    const def = v && CROPS[v.cropId];
    if (!def) { if (rec.crop) this._releaseCrop(rec); return; }
    const c = rec.crop || this._acquireCrop(rec);
    const stage = Math.max(0, Math.min(4, v.stage | 0));
    const dead = !!v.dead, wither = !!v.wither && !dead;
    const dis = +v.disease || 0;
    const frame = cropFrame(v.cropId, stage, wither, dead, dis > SICK_AT);
    if (c.frame !== frame) {
      if (c.frame && !c.pop) { c.pop = 0.3; c.popK = 0; } // aşama değişimi: küçük sıçrama
      c.im.setFrame(frame); c.frame = frame;
    }
    c.id = v.cropId; c.stage = stage;
    const meta = SHAPE_META[def.shape] || SHAPE_META.bush;
    c.flex = stage === 0 ? 0 : dead ? 0.12 : wither ? meta.flex * 0.45 : meta.flex;
    c.h = (dead ? Math.max(14, Math.min(46, meta.h[stage] * 0.62 + 6)) : meta.h[stage] * (wither ? 0.72 : 1)) * CROP_SCALE; c.w = meta.w[stage] * CROP_SCALE;
    c.pest = +v.pest || 0; c.disease = +v.disease || 0;
    // hastalık: SICK_AT üstü tint'siz sarı lekeli kare (+ leke katmanı) iki renderer'da da görünür;
    // tint yalnızca WebGL'de ek bir ton (hafif evre 0.2–SICK_AT ve solgun+hastalık) — Canvas'ta yok sayılır.
    if (c.disease > 0.2 && !dead) c.im.setTint(mixInt(0xffffff, 0xcfc070, Math.min(1, (c.disease - 0.2) / 0.6) * 0.6 + 0.15));
    else c.im.clearTint();
    this._setShadow(c, stage >= 3 && this.quality !== 'low');
    // zararlılar
    if (c.pest > 0.2 && stage >= 1 && !dead) {
      const f = c.pest > 0.7 ? 'bugs2' : c.pest > 0.45 ? 'bugs1' : 'bugs0';
      if (!c.ov) c.ov = this._img(this.pools.ov, 'crop_bugs', f).setOrigin(0.5, 0.5);
      else c.ov.setFrame(f);
      c.ov.setDepth(depthForY(c.y) + 0.002).setVisible(c.vis);
    } else if (c.ov) { this._free(this.pools.ov, c.ov); c.ov = null; }
    if (c.disease > SICK_AT && stage >= 1 && !dead) {
      if (!c.sp) c.sp = this._img(this.pools.ov, 'crop_bugs', 'spots').setOrigin(0.5, 0.5);
      const s = (0.8 + c.w / 40) * 0.72;
      c.sp.setScale(s * 1.1, s * 0.9).setAlpha(Math.min(0.95, 0.3 + c.disease)).setDepth(depthForY(c.y) + 0.001).setPosition(c.x, c.y - Math.min(c.h * 0.45, 16)).setVisible(c.vis);
    } else if (c.sp) { this._free(this.pools.ov, c.sp); c.sp = null; }
  }

  // ------------------------------------------------------------------ her kare
  update(frame) {
    const env = this.renderer && this.renderer.env;
    this.t = env ? env.t : (frame && frame.time ? frame.time / 1000 : 0);
    this.wt = env && env.wt != null ? env.wt : this.t; // K28: rüzgâr saati
    const dt = env ? env.dt : 0.016;
    if (this.state.tiles !== this._tilesRef) { this._tilesRef = this.state.tiles; this._full = true; }
    if (this._full) { this._full = false; this._fullPass = true; this._rebuild(); this._processDirty(); this._fullPass = false; this._checkCursor(); }
    else if (this.dirty.size) { const had = this._cTile && this.dirty.has(this._cTile.tileId); this._processDirty(); if (had) this._checkCursor(); }
    const t = this.t, wind = env ? env.wind : 0.2;
    // görünür alan (önceki karenin worldView'ı; yeterli)
    const wv = this.scene.cameras.main.worldView;
    const L = wv.x - 70, R = wv.right + 70, T = wv.y - 16, B = wv.bottom + 120;
    const amp = 0.022 + wind * 0.1, f = 1.0 + wind * 1.9, lean = wind * 0.07;
    // gölge yönü: ShadowSystem ile aynı (konteyner basıklığı tek görüntüye katlanır)
    const ss = this.renderer && this.renderer.shadowSystem;
    const sr = ss ? ss.rot : Math.PI, slen = ss ? ss.len : 1, sa = ss ? Math.min(0.72, ss.alpha * 1.8) : 0.3; // yumuşak leke: silüet gölgesinden seyrek → daha yüksek alfa
    const sx = Math.sin(sr), sy = Math.cos(sr) * FORESHORTEN;
    const shRot = Math.atan2(sx, sy), shK = Math.sqrt(sx * sx + sy * sy) * slen / SH_TEX_H;
    const shVis = sa > 0.006;
    const list = this.cropList;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const vis = c.x > L && c.x < R && c.y > T && c.y < B;
      if (vis !== c.vis) {
        c.vis = vis; c.im.setVisible(vis);
        if (c.sh) c.sh.setVisible(vis && shVis); if (c.ov) c.ov.setVisible(vis); if (c.sp) c.sp.setVisible(vis);
      }
      if (!vis) continue;
      let rot = 0;
      if (c.flex > 0) {
        const a = this.wt * f - c.ph;
        rot = ((Math.sin(a) * 0.72 + Math.sin(a * 2.27 + c.ph * 1.7) * 0.28) * amp + lean) * c.flex;
      }
      c.im.rotation = rot;
      if (c.pop > 0) {
        c.pop = Math.max(0, c.pop - dt);
        let s;
        if (c.popK) { const k = 1 - c.pop / 0.45; s = k < 0.6 ? 0.2 + 0.95 * (k / 0.6) : 1.15 - 0.15 * ((k - 0.6) / 0.4); } // büyüyerek belirme
        else { const k = 1 - c.pop / 0.3; s = 1 + Math.sin(k * Math.PI) * 0.09; }
        c.im.setScale(c.pop > 0 ? s : 1);
      }
      if (c.sh) {
        c.sh.setVisible(shVis);
        if (shVis) { c.sh.rotation = shRot + rot * 0.6; c.sh.scaleY = Math.max(0.05, c.h * shK); c.sh.scaleX = Math.max(0.2, c.w * 0.62 / SH_TEX_W); c.sh.alpha = sa; }
      }
      if (c.ov) {
        // böcekler: yavaş gezinme + kısa sıçramalar + hafif dönme
        const hop = Math.max(0, Math.sin(t * 2.6 + c.bugPh * 3));
        c.ov.setPosition(c.x + Math.sin(t * 1.3 + c.bugPh) * 3 + Math.sin(rot) * c.h * 0.5, c.y - Math.min(c.h * 0.5, 22) - 2 + Math.sin(t * 0.9 + c.bugPh * 2) * 1.5 - hop * hop * 1.2);
        c.ov.rotation = Math.sin(t * 1.7 + c.bugPh * 1.3) * 0.18;
      }
    }
    this._updateCursor(dt, env);
    this._updateFx(dt, wind);
  }

  // ------------------------------------------------------------------ imleç
  _cursorTarget() {
    if (this.tool === 'build') return null;
    if (this.hint && (this.tool === 'tractor' || this.tool === 'harvester')) return null; // 3×3 alan vurgusu varken tek karo imleci yok // inşa modunda tarla imleci yok (hayalet gösterilir)
    const t = this.hover || (this.hadHover ? null : this.tap);
    // tezgâh karolarında genel imleç yok — orada yalnızca MarketStall'un kendi vurgusu
    if (t) { const S = STALL.tiles; if (t.tx >= S.x0 && t.tx <= S.x1 && t.ty >= S.y0 && t.ty <= S.y1) return null; }
    return t;
  }

  _checkCursor() {
    const tgt = this._cursorTarget();
    this._checkT = 0;
    const type = TOOL_ACTION[this.tool];
    if (!tgt || !type) { this.valid = null; return; }
    const a = this._act; a.type = type; a.tileId = tgt.tileId; a.itemId = this.itemId || undefined;
    let res = null;
    try { res = canApply(this.state, a, (this.renderer && this.renderer.env && this.renderer.env.season) || 'spring'); } catch { res = null; }
    this.valid = !!(res && res.ok);
  }

  _syncMarks(dt) {
    this._markT += dt;
    if (!this._markDirty && this._markT < 1.5) return;
    this._markDirty = false; this._markT = 0;
    const tiles = this.state.tiles; if (!tiles) return;
    for (const m of this.marks.values()) m.seen = false;
    for (const id in tiles) {
      const mk = tiles[id] && tiles[id].mark; if (!mk) continue;
      let m = this.marks.get(id);
      if (!m) {
        const k = id.split(','); const x = +k[0] * TILE_W, y = +k[1] * TILE_H;
        m = this.markPool.pop() || { fr: this.scene.add.image(0, 0, 'f8_mk_plow').setOrigin(0, 0).setDepth(DEPTH.GROUND + 0.4), ic: this.scene.add.image(0, 0, 'f8_hoe').setDepth(DEPTH.GROUND + 0.42) };
        m.fr.setPosition(x, y).setVisible(true); m.ic.setPosition(x + TILE_W / 2, y + TILE_H / 2).setVisible(true); m.plan = ''; m.item = ''; this.marks.set(id, m);
      }
      m.seen = true;
      const plan = mk.plan === 'plant' ? 'plant' : 'plow', item = mk.itemId || '';
      if (m.plan !== plan || m.item !== item) {
        m.plan = plan; m.item = item;
        m.fr.setTexture(plan === 'plant' ? 'f8_mk_plant' : 'f8_mk_plow');
        if (plan === 'plant') { let h = 0; for (let i = 0; i < item.length; i++) h = (h * 31 + item.charCodeAt(i)) | 0; const c = Phaser.Display.Color.HSLToColor(((h >>> 0) % 360) / 360, 0.55, 0.62).color; m.ic.setTexture('f8_seed').setTint(c); }
        else m.ic.setTexture('f8_hoe').clearTint();
      }
    }
    for (const [id, m] of this.marks) if (!m.seen) { m.fr.setVisible(false); m.ic.setVisible(false); this.marks.delete(id); this.markPool.push(m); }
  }

  _updateCursor(dt, env) {
    this._syncMarks(dt);
    if (this.hintN) { const a = 0.55 + 0.25 * Math.sin(this.t * 4); for (let i = 0; i < this.hintN; i++) this.hintIms[i].setAlpha(a); }
    const tgt = this._cursorTarget();
    const im = this.cursor, gl = this.cursorGlow;
    if (!tgt) { if (im.visible) { im.setVisible(false); gl.setVisible(false); } this._cTile = null; return; }
    const tx = tgt.tx * TILE_W + TILE_W / 2, ty = tgt.ty * TILE_H + TILE_H / 2;
    if (this._cTile !== tgt || !im.visible) {
      if (!im.visible || !this._cTile) { this._cx = tx; this._cy = ty; }
      this._cTile = tgt;
    }
    this._checkT += dt; if (this._checkT > 0.5) this._checkCursor();
    const k = Math.min(1, dt * 22);
    this._cx += (tx - this._cx) * k; this._cy += (ty - this._cy) * k;
    const br = 0.5 + 0.5 * Math.sin(this.t * 3.4);
    const key = this.valid === null ? CURSOR_TEX.n : this.valid ? CURSOR_TEX.ok : CURSOR_TEX.bad;
    if (im.texture.key !== key) { im.setTexture(key); gl.setTexture(key); }
    const a = (this.valid === null ? 0.5 : 0.62) + br * 0.3;
    const s = 1 + br * 0.03;
    im.setVisible(true).setPosition(this._cx, this._cy).setScale(s).setAlpha(a);
    const night = this.renderer && this.renderer.lighting ? this.renderer.lighting.night : 0;
    if (night > 0.05) gl.setVisible(true).setPosition(this._cx, this._cy).setScale(s).setAlpha(a * night * 0.45);
    else if (gl.visible) gl.setVisible(false);
  }

  // ------------------------------------------------------------------ efektler
  _p(key, frame, x, y, z, life) {
    const max = FX_MAX[this.quality] || FX_MAX.high;
    if (this.fxActive.length >= max) return null;
    const p = this.fxFree.pop(); if (!p) return null;
    p.on = true; p.kind = 0; p.x = x; p.y = y; p.z = z; p.vx = 0; p.vy = 0; p.vz = 0; p.g = 0; p.drag = 0;
    p.age = 0; p.life = life; p.s0 = 1; p.s1 = 1; p.a0 = 1; p.rot = 0; p.vr = 0; p.bounce = 0; p.sy = 1; p.ease = 0;
    const im = p.im;
    im.setTexture(key, frame).setVisible(true).setAlpha(0).setRotation(0).setScale(1).clearTint().setBlendMode(0).setOrigin(0.5, 0.5);
    this.fxActive.push(p);
    return p;
  }

  _n(n) { return Math.max(1, Math.round(n * (FX_MUL[this.quality] || 1))); }

  _effect(p) {
    const id = p.tileId; if (typeof id !== 'string') return;
    const k = id.split(','); const tx = +k[0], ty = +k[1];
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
    const cx = tx * TILE_W + TILE_W / 2, cy = ty * TILE_H + TILE_H / 2 + 4;
    const R = Math.random;
    switch (p.type) {
      case 'plow':
        for (let i = 0, n = this._n(7); i < n; i++) { const q = this._p('fx_puff', undefined, cx + (R() - 0.5) * 50, cy + (R() - 0.5) * 26, 3 + R() * 5, 0.9 + R() * 0.6); if (!q) break; q.kind = 1; q.vx = (R() - 0.5) * 30; q.vz = 10 + R() * 16; q.drag = 1.5; q.s0 = 0.35 + R() * 0.2; q.s1 = 1.1 + R() * 0.5; q.a0 = 0.6 + R() * 0.2; q.sy = 0.75; }
        for (let i = 0, n = this._n(7); i < n; i++) this._clod(cx, cy, 1);
        break;
      case 'plant':
        for (let i = 0, n = this._n(6); i < n; i++) this._clod(cx, cy + 4, 0.6);
        for (let i = 0, n = this._n(2); i < n; i++) { const q = this._p('fx_puff', undefined, cx + (R() - 0.5) * 16, cy + 6, 2, 0.7); if (!q) break; q.kind = 1; q.vz = 8; q.s0 = 0.25; q.s1 = 0.6; q.a0 = 0.45; q.sy = 0.7; }
        break;
      case 'water': {
        for (let i = 0, n = this._n(12); i < n; i++) { const q = this._p('fx_drop', undefined, cx + (R() - 0.5) * 46, cy + (R() - 0.5) * 24, 30 + R() * 30, 2); if (!q) break; q.kind = 2; q.vz = -40 - R() * 50; q.g = 420; q.vx = (R() - 0.5) * 10; q.s0 = q.s1 = 0.8 + R() * 0.4; q.a0 = 0.9; q.age = -R() * 0.25; }
        const w = this._p('fx_wetblob', undefined, cx, cy - 4, 0, WATER_DEFER * 2.2); if (w) { w.kind = 5; w.a0 = 0.85; w.im.setDepth(WET_DEPTH); }
        // toprak dokusu leke yayıldıktan sonra değişsin
        this.deferred.set(id, this.t + WATER_DEFER); this.dirty.add(id);
        break; }
      case 'fertilize': {
        const col = hexInt(ITEMS[p.itemId] && ITEMS[p.itemId].color);
        for (let i = 0, n = this._n(16); i < n; i++) { const q = this._p('fx_granule', undefined, cx + (R() - 0.5) * 14, cy + (R() - 0.5) * 8, 26 + R() * 10, 1.6); if (!q) break; q.kind = 3; q.vx = (R() - 0.5) * 80; q.vy = (R() - 0.5) * 36; q.vz = 20 + R() * 50; q.g = 300; q.bounce = 0.3; q.s0 = q.s1 = 0.7 + R() * 0.5; q.a0 = 1; q.im.setTint(mixInt(col, 0xffffff, 0.15 + R() * 0.25)); }
        break; }
      case 'treat': {
        const col = mixInt(hexInt(ITEMS[p.itemId] && ITEMS[p.itemId].color), 0xffffff, 0.62);
        for (let i = 0, n = this._n(7); i < n; i++) { const q = this._p('fx_mist', undefined, cx + (R() - 0.5) * 40, cy + (R() - 0.5) * 18, 8 + R() * 16, 1.6 + R() * 0.7); if (!q) break; q.kind = 1; q.vx = (R() - 0.5) * 14; q.vz = 2 + R() * 6; q.drag = 0.8; q.s0 = 0.5; q.s1 = 1.5 + R() * 0.5; q.a0 = 0.5 + R() * 0.15; q.age = -R() * 0.3; q.im.setTint(col); }
        break; }
      case 'weed':
        for (let i = 0, n = this._n(8); i < n; i++) { const q = this._p('fx_leaf', undefined, cx + (R() - 0.5) * 30, cy + (R() - 0.5) * 16, 4, 1.3 + R() * 0.5); if (!q) break; q.kind = 4; q.vx = (R() - 0.5) * 60; q.vz = 50 + R() * 50; q.g = 110; q.drag = 1.2; q.vr = (R() - 0.5) * 14; q.s0 = q.s1 = 0.8 + R() * 0.5; q.a0 = 1; q.im.setTint(mixInt(0x9bbd52, 0x5d8a35, R())); }
        for (let i = 0, n = this._n(2); i < n; i++) { const q = this._p('fx_puff', undefined, cx + (R() - 0.5) * 20, cy + 4, 2, 0.8); if (!q) break; q.kind = 1; q.vz = 8; q.s0 = 0.3; q.s1 = 0.8; q.a0 = 0.4; q.sy = 0.7; }
        break;
      case 'harvest': {
        const rec = this.recs.get(id); const c = rec && rec.crop;
        const fx = c ? c.x : cx, fy = c ? c.y : ty * TILE_H + FOOT_DY;
        if (c && c.frame) { // ekin "pop": şişip küçülerek kalkar
          const g = this._p(CROP_ATLAS, c.frame, fx, fy, 0, 0.5);
          if (g) { g.kind = 6; g.a0 = 1; g.im.setOrigin(CROP_CELL.footX / CROP_CELL.w, CROP_CELL.footY / CROP_CELL.h); c.im.setVisible(false); c.vis = false; }
        }
        for (let i = 0, n = this._n(12); i < n; i++) { const q = this._p('fx_spark', undefined, fx + (R() - 0.5) * 34, fy - 4 + (R() - 0.5) * 8, 6 + R() * 26, 0.7 + R() * 0.6); if (!q) break; q.kind = 7; q.vx = (R() - 0.5) * 30; q.vz = 16 + R() * 34; q.drag = 1.6; q.s0 = 0.18 + R() * 0.16; q.s1 = 0.02; q.a0 = 1; q.add = true; q.im.setBlendMode(1).setTint(R() < 0.5 ? 0xffe8a0 : 0xfff6dc); }
        for (let i = 0, n = this._n(3); i < n; i++) { const q = this._p('fx_puff', undefined, fx + (R() - 0.5) * 24, fy + 2, 2, 0.8); if (!q) break; q.kind = 1; q.vz = 10; q.s0 = 0.3; q.s1 = 0.9; q.a0 = 0.35; q.sy = 0.7; }
        break; }
      default: break;
    }
  }

  _clod(cx, cy, sc) {
    const R = Math.random;
    const q = this._p('fx_clod', undefined, cx + (R() - 0.5) * 36, cy + (R() - 0.5) * 18, 2, 1.1 + R() * 0.4); if (!q) return;
    q.kind = 3; q.vx = (R() - 0.5) * 70; q.vy = (R() - 0.5) * 20; q.vz = 50 + R() * 70 * sc; q.g = 380; q.bounce = 0.25; q.vr = (R() - 0.5) * 10; q.s0 = q.s1 = (0.6 + R() * 0.6) * sc; q.a0 = 1;
  }

  _harvestIcon(p) {
    if (!p) return;
    const cropId = p.cropId || (ITEMS[p.itemId] && ITEMS[p.itemId].crop) || p.itemId;
    if (!CROPS[cropId]) return;
    let tx = p.tx, ty = p.ty;
    if (!Number.isFinite(tx) && typeof p.tileId === 'string') { const k = p.tileId.split(','); tx = +k[0]; ty = +k[1]; }
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
    const x = tx * TILE_W + TILE_W / 2, y = ty * TILE_H + FOOT_DY;
    const q = this._p(CROP_ATLAS, `${cropId}_icon`, x, y, 26, 1.5);
    if (q) { q.kind = 8; q.a0 = 1; q.im.setDepth(DEPTH.LIGHT + 2); }
    const g = this._p('fx_glow', undefined, x, y, 26, 0.9);
    if (g) { g.kind = 9; g.a0 = 0.5; g.add = true; g.im.setBlendMode(1).setTint(0xffe2a0).setDepth(DEPTH.LIGHT + 1.9); }
  }

  _updateFx(dt, wind) {
    const A = this.fxActive;
    for (let i = A.length - 1; i >= 0; i--) {
      const p = A[i];
      p.age += dt;
      const im = p.im;
      if (p.age < 0) { im.setAlpha(0); continue; } // gecikmeli başlangıç
      const k = p.age / p.life;
      if (k >= 1) { this._kill(p, i); continue; }
      // hareket
      if (p.drag) { const d = Math.max(0, 1 - p.drag * dt); p.vx *= d; p.vy *= d; if (p.kind !== 4) p.vz *= d; }
      p.vz -= p.g * dt;
      p.x += (p.vx + (p.kind === 1 || p.kind === 4 ? wind * 22 : 0)) * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.z <= 0 && p.g > 0) {
        p.z = 0;
        if (p.kind === 2) { this._splash(p.x, p.y); this._kill(p, i); continue; }
        if (p.bounce > 0 && p.vz < -20) { p.vz = -p.vz * p.bounce; p.vx *= 0.5; p.vy *= 0.5; p.vr *= 0.5; } else { p.vz = 0; p.vx *= 0.8; p.vy *= 0.8; p.vr *= 0.8; }
      }
      p.rot += p.vr * dt;
      let a = p.a0, s = p.s0 + (p.s1 - p.s0) * (1 - (1 - k) * (1 - k));
      let sy = 1, yOff = 0;
      switch (p.kind) {
        case 1: a *= Math.min(1, k * 6) * (1 - k) * (1 - k); sy = p.sy; break;                  // toz/sis
        case 2: a *= Math.min(1, (p.age) * 10); break;                                          // damla
        case 3: a *= k < 0.75 ? 1 : (1 - k) / 0.25; break;                                       // topak/granül
        case 4: p.vx += Math.sin(p.age * 9 + p.i) * 60 * dt; p.vz = Math.max(p.vz, -28); a *= k < 0.7 ? 1 : (1 - k) / 0.3; sy = 0.6 + 0.4 * Math.abs(Math.sin(p.age * 7 + p.i)); break; // yaprak
        case 5: { const g = Math.min(1, p.age / WATER_DEFER); const e = 1 - (1 - g) * (1 - g); s = 0.25 + 0.8 * e; const fade = p.age < WATER_DEFER ? 1 : Math.max(0, 1 - (p.age - WATER_DEFER) / (p.life - WATER_DEFER)); a *= Math.min(1, p.age / 0.15) * fade; break; } // ıslaklık
        case 6: { const t = p.age; if (t < 0.12) s = 1 + 0.28 * (t / 0.12); else { const u = (t - 0.12) / (p.life - 0.12); s = 1.28 * (1 - u * u); yOff = -u * 14; a *= 1 - u * u; } break; } // pop
        case 7: a *= Math.min(1, k * 8) * (1 - k); break;                                        // parıltı
        case 8: { const u = Math.min(1, p.age / 0.25); s = u < 1 ? 1.15 * Math.sin(u * Math.PI * 0.5) / Math.sin(Math.PI * 0.5) : 1.15 - 0.15 * Math.min(1, (p.age - 0.25) / 0.2); yOff = -46 * (1 - (1 - k) * (1 - k)); a *= k < 0.7 ? 1 : (1 - k) / 0.3; s *= 0.95; break; } // ikon
        case 9: { yOff = -46 * (1 - (1 - k) * (1 - k)); s = 0.25 + 0.15 * Math.sin(k * Math.PI); a *= Math.sin(k * Math.PI); break; }
        default: a *= 1 - k;
      }
      im.x = p.x; im.y = p.y - p.z + yOff;
      im.rotation = p.rot;
      im.scaleX = s; im.scaleY = s * sy;
      im.alpha = a;
      if (p.kind !== 8 && p.kind !== 9 && !p.add) im.depth = p.kind === 5 ? WET_DEPTH : depthForY(p.y) + 0.02;
      else if (p.kind === 7) im.depth = DEPTH.LIGHT + 2;
    }
  }

  _splash(x, y) {
    const r = this._p('fx_ring', undefined, x, y, 0, 0.45);
    if (r) { r.kind = 1; r.s0 = 0.25; r.s1 = 0.9; r.a0 = 0.85; r.sy = 1; }
    if (Math.random() < 0.5) {
      const d = this._p('fx_granule', undefined, x, y, 1, 0.5);
      if (d) { d.kind = 3; d.vx = (Math.random() - 0.5) * 50; d.vz = 40 + Math.random() * 30; d.g = 400; d.s0 = d.s1 = 0.5; d.a0 = 0.8; d.im.setTint(0xcfe9ff); }
    }
  }

  _kill(p, i) {
    p.on = false; p.im.setVisible(false); p.add = false;
    const A = this.fxActive, last = A.pop();
    if (last !== p) A[i] = last;
    this.fxFree.push(p);
  }

  destroy() {
    for (const off of this._offs) off(); this._offs.length = 0;
    for (const rt of this.chunks.values()) rt.destroy(); this.chunks.clear();
    for (const c of this.cropList) { c.im.destroy(); c.sh?.destroy(); c.ov?.destroy(); c.sp?.destroy(); }
    this.cropList.length = 0;
    for (const k of Object.keys(this.pools)) { for (const im of this.pools[k]) im.destroy(); this.pools[k].length = 0; }
    for (const p of this.fx) p.im.destroy();
    this.cursor.destroy(); this.cursorGlow.destroy();
    for (const m of this.marks.values()) { m.fr.destroy(); m.ic.destroy(); } for (const m of this.markPool) { m.fr.destroy(); m.ic.destroy(); } for (const im of this.hintIms) im.destroy();
    this.recs.clear();
  }
}
