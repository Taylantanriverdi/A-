// Gece İstilası (K29) — canavar ve asker görünümü. State'i yalnızca okur.
// state.defense.monsters [{id,type,x,y,hp,state}], state.defense.soldiers [{id,type,x,y,hp,state,towerId}] (dünya px).
// Aile dostu: vurulunca beyaz flaş, ölünce duman + sikke parıltısı; kan yok.
import { depthForY, DEPTH } from '../core/constants.js';
import { MON, monKey, SOL, solKey } from '../render/textures/defense.js';
import { MONSTERS } from '../data/defense.js';

const POOL = 32;

export default class CombatView {
  constructor(scene, state, bus, renderer) {
    this.scene = scene; this.state = state; this.bus = bus; this.r = renderer;
    this.mons = new Map(); this.sols = new Map(); this.mPool = []; this.sPool = []; this.fx = [];
    this.offs = [];
  }

  create() {
    const s = this.scene;
    for (let i = 0; i < POOL; i++) {
      const im = s.add.image(0, 0, monKey('zombie', 0)).setVisible(false);
      const eyes = s.add.image(0, 0, 'rd_eyes').setVisible(false).setBlendMode('ADD');
      const sh = s.add.ellipse(0, 0, 40, 12, 0x000000, 0.28).setVisible(false);
      this.mPool.push({ im, eyes, sh, flash: 0, x: 0, y: 0, ph: Math.random() * 6 });
    }
    for (let i = 0; i < 8; i++) {
      const im = s.add.image(0, 0, solKey('guard', 'w0')).setVisible(false);
      const sh = s.add.ellipse(0, 0, 40, 12, 0x000000, 0.28).setVisible(false);
      const star = s.add.image(0, 0, 'rd_star').setVisible(false).setBlendMode('ADD');
      this.sPool.push({ im, sh, star, x: 0, y: 0, ph: Math.random() * 6, lastX: 0 });
    }
    for (let i = 0; i < 24; i++) this.fx.push({ im: s.add.image(0, 0, 'rd_smoke').setVisible(false), t: 0, life: 0, kind: '' });
    // Baskın gecesi ekran tonu (kamera sabit, MULTIPLY)
    this.tint = s.add.rectangle(0, 0, 10, 10, 0x6a4a9a, 1).setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH.LIGHT + 0.5)
      .setBlendMode('MULTIPLY').setAlpha(0).setVisible(false);
    this.tintA = 0;
    const b = this.bus;
    this.offs.push(b.on('defense:hit', (p) => { if (p) this._hit(p); }));
    this.offs.push(b.on('monster:killed', (p) => { if (p) { this._puff(p.x, p.y, 'rd_smoke', 0.9, 1.2); this._puff(p.x, p.y - 30, 'rd_star', 0.6, 0.9); } }));
  }

  _hit(p) {
    for (const m of this.mons.values()) if (Math.abs(m.x - p.x) < 30 && Math.abs(m.y - p.y) < 30) { m.flash = 0.18; break; }
    this._puff(p.x, p.y - 30, 'rd_hit', 0.25, 0.6);
  }

  _puff(x, y, key, life, sc) {
    const f = this.fx.find((q) => q.life <= 0); if (!f) return;
    f.im.setTexture(key).setPosition(x, y).setVisible(true).setDepth(depthForY(y) + 0.2).setScale(sc).setAlpha(1)
      .setBlendMode(key === 'rd_smoke' ? 'NORMAL' : 'ADD');
    f.t = 0; f.life = life; f.sc = sc; f.kind = key;
  }

  update(env) {
    const D = this.state.defense, on = this.state.settings?.raids === true && D;
    const dt = env.dt || 0.016, t = env.t || 0;
    // ekran tonu: baskın sürerken koyu mor-mavi
    const active = !!(on && (D.monsters?.length || D.wavesLeft > 0));
    this.tintA += ((active ? (D.bloodMoon ? 0.34 : 0.26) : 0) - this.tintA) * Math.min(1, dt * 1.2);
    const cam = this.scene.cameras.main;
    if (this.tintA > 0.005) { this.tint.setVisible(true).setSize(cam.width, cam.height).setAlpha(this.tintA).setFillStyle(D?.bloodMoon ? 0x8a4a6a : 0x6a5a9a); }
    else this.tint.setVisible(false);

    this._syncMonsters(on ? D.monsters || [] : [], t, dt);
    this._syncSoldiers(on ? D.soldiers || [] : [], t, dt);
    for (const f of this.fx) {
      if (f.life <= 0) continue;
      f.t += dt; const k = f.t / f.life;
      if (k >= 1) { f.life = 0; f.im.setVisible(false); continue; }
      f.im.setAlpha(1 - k).setScale(f.sc * (1 + k * (f.kind === 'rd_smoke' ? 0.8 : 0.4)));
      if (f.kind === 'rd_smoke') f.im.y -= dt * 18;
    }
  }

  _syncMonsters(list, t, dt) {
    const seen = new Set();
    for (const m of list) {
      seen.add(m.id);
      let v = this.mons.get(m.id);
      if (!v) { v = this.mPool.pop(); if (!v) continue; v.x = m.x; v.y = m.y; v.flash = 0; this.mons.set(m.id, v); }
      const def = MON[m.type] || MON.zombie;
      const k = Math.min(1, dt * 8); const dx = m.x - v.x; v.x += dx * k; v.y += (m.y - v.y) * k;
      const moving = m.state !== 'attack';
      const f = Math.floor((t * (m.type === 'skeleton' ? 7 : 4.5) + v.ph) % def.n);
      const atk = m.state === 'attack' ? Math.sin(t * 9 + v.ph) * 0.12 : 0;
      v.im.setTexture(monKey(m.type, moving ? f : 0)).setOrigin(def.ox / def.w, def.oy / def.h).setVisible(true)
        .setPosition(v.x, v.y + (m.type === 'ghost' ? -10 + Math.sin(t * 2 + v.ph) * 6 : 0)).setDepth(depthForY(v.y))
        .setRotation(atk).setFlipX(dx < -0.2 ? true : dx > 0.2 ? false : v.im.flipX)
        .setAlpha(m.type === 'ghost' ? 0.72 : 1).setScale(0.62);
      if (v.flash > 0) { v.flash -= dt; v.im.setTintFill(0xffffff); } else v.im.clearTint();
      const eyeY = v.y - def.oy * 0.62 * 0.78 + (m.type === 'ghost' ? -10 + Math.sin(t * 2 + v.ph) * 6 : 0);
      v.eyes.setVisible(true).setPosition(v.x + (v.im.flipX ? -3 : 3), eyeY).setTint(MONSTERS[m.type] ? def.eyeCol : 0xffffff)
        .setScale(0.55).setAlpha(0.7 + 0.3 * Math.sin(t * 5 + v.ph)).setDepth(depthForY(v.y) + 0.05);
      v.sh.setVisible(m.type !== 'ghost').setPosition(v.x, v.y + 2).setDepth(depthForY(v.y) - 0.05);
    }
    for (const [id, v] of this.mons) if (!seen.has(id)) { v.im.setVisible(false); v.eyes.setVisible(false); v.sh.setVisible(false); this.mons.delete(id); this.mPool.push(v); }
  }

  _syncSoldiers(list, t, dt) {
    const seen = new Set();
    for (const s of list) {
      if (s.state === 'sleep' || s.towerId) { continue; } // uyurken evde, kulede DefenseView okçuyu çizer
      seen.add(s.id);
      let v = this.sols.get(s.id);
      if (!v) { v = this.sPool.pop(); if (!v) continue; v.x = s.x; v.y = s.y; this.sols.set(s.id, v); }
      const k = Math.min(1, dt * 8); const dx = s.x - v.x; v.x += dx * k; v.y += (s.y - v.y) * k;
      const moving = Math.abs(dx) + Math.abs(s.y - v.y) > 0.3;
      let pose = 'w0';
      if (s.state === 'down') pose = 'down';
      else if (s.state === 'fight') pose = Math.sin(t * 8 + v.ph) > 0 ? 'a0' : 'a1';
      else if (moving) pose = `w${Math.floor((t * 6 + v.ph) % 4)}`;
      v.im.setTexture(solKey(s.type, pose)).setOrigin(SOL.ox / SOL.w, SOL.oy / SOL.h).setVisible(true)
        .setPosition(v.x, v.y).setDepth(depthForY(v.y)).setScale(0.55)
        .setFlipX(dx < -0.2 ? true : dx > 0.2 ? false : v.im.flipX);
      v.sh.setVisible(true).setPosition(v.x, v.y + 2).setDepth(depthForY(v.y) - 0.05);
      v.star.setVisible(s.state === 'down').setPosition(v.x + Math.cos(t * 3) * 10, v.y - 52 + Math.sin(t * 3) * 3).setDepth(depthForY(v.y) + 0.1).setScale(0.8);
    }
    for (const [id, v] of this.sols) if (!seen.has(id)) { v.im.setVisible(false); v.sh.setVisible(false); v.star.setVisible(false); this.sols.delete(id); this.sPool.push(v); }
  }

  setQuality() {}

  destroy() {
    for (const o of this.offs) o && o();
    for (const v of [...this.mPool, ...this.mons.values()]) { v.im.destroy(); v.eyes.destroy(); v.sh.destroy(); }
    for (const v of [...this.sPool, ...this.sols.values()]) { v.im.destroy(); v.sh.destroy(); v.star.destroy(); }
    for (const f of this.fx) f.im.destroy();
    this.tint?.destroy();
  }
}
