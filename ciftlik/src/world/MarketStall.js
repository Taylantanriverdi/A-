// MarketStall — pazar tezgâhı (PLAN §9 "Görsel"). State'i YALNIZCA OKUR.
// • Çizgili kumaş tente: saçak şerit şerit (STRIPES kare) rüzgârda dalgalanır (global env.wind).
// • Ahşap tezgâh, önünde 3 sandık: envanterdeki (category 'crop') en çok bulunan 3 ürünün ikonları yığın hâlinde;
//   `inventory:changed` ile kirlenir, bir sonraki karede yeniden hesaplanır. Ürün yoksa sandıklar boş.
// • Yazısız tabela (terazi + sikke), gece tente altında sıcak fener (lights API + emisif çekirdek → bloom).
// • Gölge (shadows API, birleşik silüet), depthForY. `tile:hover` tezgâh karolarındayken sıcak kenar ışığı.
// Tüm görüntüler create'te bir kez kurulur; update'te bellek ayırma yok.
import { depthForY } from '../core/constants.js';
import { firstPlacedOfType, footOf, SLIDE_TIME } from './placedUtil.js';
import { ITEMS } from '../data/items.js';
import { CROP_ATLAS } from '../render/textures/crops.js';
import { genMarket, STALL_LAYOUT as S, STRIPES, STRIPE_W, CRATE_LIP } from '../render/textures/market.js';
import { STALL } from '../render/layout.js';

const ICONS_PER_CRATE = 6;
// Yığın yuvaları (sandık ayağına göre, ikon merkezi): arka/üst önce çizilir, ön sıra en son.
const SLOTS = [[0, CRATE_LIP - 17, 0.82], [-8, CRATE_LIP - 10, 0.86], [8, CRATE_LIP - 10, 0.86], [-15, CRATE_LIP - 3, 0.9], [0, CRATE_LIP - 2, 0.9], [15, CRATE_LIP - 3, 0.9]];
const FILL_ORDER = [3, 4, 5, 1, 2, 0]; // az ürün → önce ön sıra dolar
const ICON_SCALE = 0.62;

export default class MarketStall {
  constructor(scene, state, bus, renderer) {
    this.scene = scene; this.state = state; this.bus = bus; this.renderer = renderer;
    this.x = STALL.x; this.y = STALL.y; this.tiles = STALL.tiles; // STALL (layout.js) çalışma anında yerleştirmeye göre güncellenir (SaleFX/FieldView okur)
    this.placedId = null; this.slideT = -1; this.sx = 0; this.sy = 0; this.tx2 = 0; this.ty2 = 0; this.liftId = null; this.lift = 0; this.absent = false; this._foot = { x: 0, y: 0 };
    this.dirty = true; this.hover = 0; this.hoverT = 0; this.press = 0; this.t = 0;
    this._top = [null, null, null]; this._cnt = [0, 0, 0]; this._shown = ['', '', ''];
    this._offs = [];
  }

  create() {
    const s = this.scene;
    genMarket(s); // idempotent
    const c = s.add.container(this.x, this.y).setDepth(depthForY(this.y));
    this.c = c;
    const img = (L, dx = L.dx || 0, dy = L.dy || 0) => s.add.image(dx, dy, L.key).setOrigin(L.ox / L.w, L.oy / L.h);
    this.body = img(S.body);
    // fener (tente altında asılı) — salınım pivotu kanca
    this.lantern = img(S.lantern);
    this.awning = img(S.awning);
    c.add([this.body, this.lantern, this.awning]);
    // saçak şeritleri: pivot üst kenar
    this.strips = [];
    for (let i = 0; i < STRIPES; i++) {
      const im = s.add.image(-STRIPES * STRIPE_W / 2 + STRIPE_W * (i + 0.5), S.valance.dy, S.valance.key, `v${i}`).setOrigin(0.5, 0);
      this.strips.push(im); c.add(im);
    }
    // sandıklar + ikon yığınları
    this.crates = [];
    const hasAtlas = s.textures.exists(CROP_ATLAS);
    for (const cp of S.crates) {
      const back = img(S.crateBack, cp.dx, cp.dy);
      c.add(back);
      const icons = [];
      for (let k = 0; k < ICONS_PER_CRATE; k++) {
        const [ix, iy, sc] = SLOTS[k];
        const im = hasAtlas ? s.add.image(cp.dx + ix, cp.dy + iy, CROP_ATLAS, 0) : s.add.image(cp.dx + ix, cp.dy + iy, '__DEFAULT');
        im.setScale(ICON_SCALE * sc).setRotation(((k * 37) % 11 - 5) * 0.05).setVisible(false);
        icons.push(im); c.add(im);
      }
      const front = img(S.crateFront, cp.dx, cp.dy);
      c.add(front);
      this.crates.push({ back, front, icons });
    }
    this.sign = img(S.sign); c.add(this.sign);
    // hover kenar ışığı (ADD; Canvas'ta 'lighter')
    const hlTex = s.textures.get('prop_stall_hl'); const hm = hlTex.customData || {}; const hs = hlTex.getSourceImage();
    this.hl = s.add.image(0, 0, 'prop_stall_hl').setOrigin(hm.footX / hs.width, hm.footY / hs.height).setBlendMode('ADD').setAlpha(0).setVisible(false);
    c.add(this.hl);
    // gölge (birleşik silüet)
    this.shadow = this.renderer.shadows.register(c, { footX: this.x, footY: this.y - 2, height: 236, width: 230, shadowKey: 'prop_stall_sil' });
    // gece ışıkları: fener çekirdeği (emisif, bloom) + tente altına yayılan sıcak ışık
    const L = this.renderer.lighting;
    this.glow = s.add.image(this.x + S.lantern.dx, this.y + S.lantern.dy + 24, 'prop_lantern_glow').setScale(0.7);
    L.addEmissive(this.glow, 0.95);
    this.lights = [
      this.renderer.lights.addPoint({ x: this.x + S.lantern.dx, y: this.y + S.lantern.dy + 24, radius: 40, color: 0xffe0a0, intensity: 0.9, nightOnly: true, flicker: 0.08 }),
      this.renderer.lights.addPoint({ x: this.x + 24, y: this.y - 64, radius: 200, color: 0xffa858, intensity: 0.5, nightOnly: true, flicker: 0.05 }),
    ];
    // olaylar
    const on = (n, f) => this._offs.push(this.bus.on(n, f, this));
    on('inventory:changed', () => { this.dirty = true; });
    on('placed:changed', () => this._syncPlaced(false));
    on('build:ghost', (p) => { this.liftId = p && p.moving != null ? p.moving : null; });
    on('save:loaded', () => { this.dirty = true; });
    on('tile:hover', (p) => { this.hover = p && this._isStallTile(p.tx, p.ty) ? 1 : 0; });
    on('tile:tap', (p) => { if (p && this._isStallTile(p.tx, p.ty)) this.press = 1; });
    this._refreshGoods();
    this._syncPlaced(true);
  }

  _setPos(x, y) {
    this.x = x; this.y = y; STALL.x = x; STALL.y = y;
    const T = this.tiles, tx0 = Math.round(x / 64 - 1.5), ty0 = Math.round((y + 18) / 44 - 2);
    T.x0 = tx0; T.x1 = tx0 + 2; T.y0 = ty0; T.y1 = ty0 + 1;
    this.c.setPosition(x, y - this.lift * 7).setDepth(depthForY(y));
    this.shadow?.set({ footX: x, footY: y - 2 });
    const lx = x + S.lantern.dx, ly = y + S.lantern.dy;
    this.lights[0].set({ x: lx, y: ly + 24 }); this.lights[1].set({ x: x + 24, y: y - 64 });
    this.glow.setPosition(lx, ly + 24);
  }

  /** state.placed'teki 'stall' nesnesine göre konum (yoksa varsayılan; placed dizisi varsa ve tezgâh yoksa gizli). */
  _syncPlaced(initial) {
    if (!this.c) return;
    const pl = this.state && this.state.placed;
    if (!Array.isArray(pl)) return;
    const p = firstPlacedOfType(this.state, 'stall');
    this.absent = !p;
    this.c.setVisible(!!p); this.glow.setVisible(!!p);
    this.lights[0].set({ intensity: p ? 0.9 : 0 }); this.lights[1].set({ intensity: p ? 0.5 : 0 });
    if (!p) return;
    this.placedId = p.id;
    const f = footOf('stall', p.tx, p.ty, this._foot);
    if (initial) { this._setPos(f.x, f.y); return; }
    if (Math.abs(f.x - this.x) > 0.5 || Math.abs(f.y - this.y) > 0.5) {
      this.sx = this.x; this.sy = this.y;
      this.tx2 = f.x; this.ty2 = f.y; this.slideT = 0;
    }
  }

  _isStallTile(tx, ty) {
    const T = this.tiles;
    return tx >= T.x0 && tx <= T.x1 && ty >= T.y0 && ty <= T.y1;
  }

  /** Envanterdeki en çok bulunan 3 ürün (category 'crop'); bellek ayırmadan sabit dizilere yazar. */
  _refreshGoods() {
    this.dirty = false;
    const top = this._top, cnt = this._cnt;
    top[0] = top[1] = top[2] = null; cnt[0] = cnt[1] = cnt[2] = 0;
    const items = this.state?.inventory?.items;
    if (items) {
      for (const id in items) {
        const def = ITEMS[id]; if (!def || def.category !== 'crop') continue;
        const stacks = items[id]; let n = 0;
        if (Array.isArray(stacks)) for (let i = 0; i < stacks.length; i++) n += stacks[i]?.qty > 0 ? stacks[i].qty : 0;
        else if (typeof stacks === 'number') n = stacks;
        if (n <= 0) continue;
        for (let k = 0; k < 3; k++) {
          if (n > cnt[k]) {
            for (let j = 2; j > k; j--) { top[j] = top[j - 1]; cnt[j] = cnt[j - 1]; }
            top[k] = id; cnt[k] = n; break;
          }
        }
      }
    }
    const tex = this.scene.textures.exists(CROP_ATLAS) ? this.scene.textures.get(CROP_ATLAS) : null;
    // en çok bulunan ortadaki (öndeki) sandığa: sıra 1 → orta, 2 → sol, 3 → sağ
    const order = [1, 0, 2];
    for (let k = 0; k < 3; k++) {
      const crate = this.crates[order[k]]; const id = top[k];
      const crop = id ? (ITEMS[id].crop || id) : null;
      const frame = crop ? `${crop}_icon` : null;
      const ok = !!(tex && frame && tex.has(frame));
      const n = ok ? Math.min(ICONS_PER_CRATE, Math.max(1, Math.ceil(cnt[k] / 4))) : 0;
      for (let i = 0; i < ICONS_PER_CRATE; i++) {
        const im = crate.icons[FILL_ORDER[i]];
        if (i < n) { if (this._shown[k] !== frame) im.setFrame(frame); im.setVisible(true); }
        else im.setVisible(false);
      }
      this._shown[k] = ok ? frame : '';
    }
  }

  update(env) {
    if (!this.c || this.absent) return;
    if (this.dirty) this._refreshGoods();
    const t = env.t, dt = env.dt, w = env.wind;
    let mv = false;
    if (this.slideT >= 0) {
      this.slideT += dt / SLIDE_TIME; const k = Math.min(1, this.slideT), e = k * k * (3 - 2 * k);
      this.x = this.sx + (this.tx2 - this.sx) * e; this.y = this.sy + (this.ty2 - this.sy) * e; mv = true;
      if (k >= 1) { this.slideT = -1; this.x = this.tx2; this.y = this.ty2; const fx = this.renderer.buildings?.fx; if (fx) fx.dust(this.x, this.y + 2, 90, 8); }
    }
    const lt = this.liftId != null && this.liftId === this.placedId ? 1 : 0;
    if (lt !== this.lift) { this.lift += (lt - this.lift) * Math.min(1, dt * 12); if (Math.abs(lt - this.lift) < 0.01) this.lift = lt; mv = true; this.c.setAlpha(1 - 0.45 * this.lift); }
    if (mv) this._setPos(this.x, this.y);
    this.t = t;
    // hover: yumuşak geçiş + nefes alan kenar ışığı
    this.hoverT += (this.hover - this.hoverT) * Math.min(1, dt * 9);
    const ha = this.hoverT * (0.5 + 0.2 * Math.sin(t * 4.2)) * (0.75 + 0.35 * (1 - env.day.light));
    this.hl.setVisible(ha > 0.01).setAlpha(Math.min(1, ha));
    // dokunuş: küçük yaylı esneme
    if (this.press > 0) {
      this.press = Math.max(0, this.press - dt * 3.2);
      const k = this.press; const sq = Math.sin((1 - k) * Math.PI * 2.5) * k * 0.035;
      this.c.setScale(1 + sq * 0.6, 1 - sq);
    } else if (this.c.scaleY !== 1) this.c.setScale(1);
    // görünür değilse animasyonu atla
    const v = this.scene.cameras.main.worldView;
    if (this.x + 180 < v.x || this.x - 180 > v.right || this.y + 40 < v.y || this.y - 260 > v.bottom) return;
    // tente saçağı: şeritler boyunca ilerleyen dalga (pivot üst kenar)
    const amp = 0.02 + w * 0.12, fr = 1.6 + w * 2.6, gust = 0.6 + 0.4 * Math.sin(t * 0.7);
    for (let i = 0; i < STRIPES; i++) {
      const ph = t * fr - i * 0.55;
      const s1 = Math.sin(ph), s2 = Math.sin(ph * 1.9 + 1.3);
      const im = this.strips[i];
      im.rotation = (s1 * 0.7 + s2 * 0.3) * amp * gust - w * 0.05;
      im.scaleY = 1 - (0.5 + 0.5 * s1) * (0.05 + w * 0.12) * gust;
    }
    this.awning.scaleY = 1 + Math.sin(t * fr * 0.5) * 0.006 * (0.3 + w);
    // fener salınımı + emisif çekirdeği takip
    const rot = Math.sin(t * 1.7) * (0.02 + w * 0.1) + Math.sin(t * 3.1 + 1) * w * 0.03;
    this.lantern.rotation = rot;
    const lx = this.x + S.lantern.dx, ly = this.y + S.lantern.dy;
    this.glow.setPosition(lx - Math.sin(rot) * 24, ly + Math.cos(rot) * 24);
  }

  setQuality() { /* tezgâh kaliteden bağımsız; gölge çözünürlüğünü ShadowSystem yönetir */ }

  destroy() {
    for (const off of this._offs) off(); this._offs.length = 0;
    this.shadow?.remove(); for (const l of this.lights || []) l.remove();
    const pts = this.renderer.lighting?.points; if (pts && this.glow) { const i = pts.findIndex((it) => it.im === this.glow); if (i >= 0) pts.splice(i, 1); }
    this.glow?.destroy(); this.c?.destroy(); this.c = null;
  }
}
