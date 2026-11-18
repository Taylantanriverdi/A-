// Renderer — katmanların kurulumu ve her kare güncellenmesi (PLAN §2, §7). State'i yalnızca OKUR.
// Ekran uzayı katmanları kameranın preRender'ından hemen sonra yerleşir (takip/zoom gecikmesi olmaz).
import Phaser from 'phaser';
import { SEASON_GRADE } from '../data/palette.js';
import { generateTextures } from './textures/index.js';
import { getSun, getMoon } from './sunModel.js';
import { View } from './View.js';
import { createDaySample, sampleDay, copyRgb, mixRgb, clamp, smoothstep, lerp } from './util.js';
import SkyLayer from './SkyLayer.js';
import ParallaxLayer from './ParallaxLayer.js';
import GroundLayer from './GroundLayer.js';
import ShadowSystem from './ShadowSystem.js';
import Lighting from './Lighting.js';
import Decor from './Decor.js';
import HorizonLayer from './HorizonLayer.js';
import Particles from './Particles.js';
import FieldView from '../world/FieldView.js';
import MarketStall from '../world/MarketStall.js';
import BuildingView from '../world/BuildingView.js';
import AnimalView from '../world/AnimalView.js';
import SaleFX from './SaleFX.js';
import GradePipeline from './postfx/GradePipeline.js';
import BloomPipeline from './postfx/BloomPipeline.js';
import { createLook } from './postfx/CinematicPipeline.js';

const CLOUDINESS = { clear: 0, sunny: 0, partly: 0.3, cloudy: 0.65, overcast: 0.8, rain: 0.9, storm: 1, snow: 0.8, fog: 0.7 };
const GREY = [0.62, 0.64, 0.7];
const QUALITY = {
  high: { bloom: true, bloomStrength: 0.85, bloomPasses: 3, grain: 0.04 },
  medium: { bloom: true, bloomStrength: 0.45, bloomPasses: 2, grain: 0.04 },
  low: { bloom: false, bloomStrength: 0, bloomPasses: 0, grain: 0 },
};

export default class Renderer {
  constructor(scene, state, bus) {
    this.scene = scene; this.state = state; this.bus = bus;
    this.view = new View();
    this.quality = 'high';
    this.webgl = false;
    this.env = {
      t: 0, dt: 0, day: createDaySample(), sun: { visible: false, dir: 0, elevationDeg: 0, intensity: 0 }, moon: { visible: false, dir: 0, elevationDeg: 0, intensity: 0 },
      ambient: [1, 1, 1], season: 'spring', cal: null, wind: 0.2, cloud: 0, twilight: 0, stars: 0, skyLayer: null,
    };
    this._wind = 0.2; this._dpr = 1; this._ready = false; this._offs = [];
    this.look = createLook();
    this.letter = { cur: 0, from: 0, to: 0, t0: 0, dur: 1 };
    this.fade = { a: 0, hold: 0 };
    this.fpsAcc = { frames: 0, ms: 0 };
    // Açık uçlu API'ler (sonraki aşamalar için) — create() öncesinde de mevcut
    this.shadowSystem = new ShadowSystem(scene);
    this.lighting = new Lighting(scene);
    this.shadows = { register: (obj, opts) => this.shadowSystem.register(obj, opts) };
    this.lights = { addPoint: (p) => this.lighting.addPoint(p) };
  }

  create() {
    const s = this.scene;
    generateTextures(s); // idempotent
    this.webgl = s.sys.game.renderer.type === Phaser.WEBGL;
    this.sky = new SkyLayer(s); this.sky.create(); this.env.skyLayer = this.sky;
    this.parallax = new ParallaxLayer(s); this.parallax.create();
    this.ground = new GroundLayer(s); this.ground.create();
    this.horizon = new HorizonLayer(s); this.horizon.create();
    this.lighting.create();
    this.decor = new Decor(s, this.shadows, this.lighting); this.decor.create();
    this.particles = new Particles(s); this.particles.create();
    // tarla karoları + ekinler + imleç + tarım efektleri (state.tiles'tan; yalnızca okur)
    try { this.field = new FieldView(s, this.state, this.bus, this); } catch (e) { console.error('[render] FieldView', e); this.field = null; }
    // pazar tezgâhı + satış/alış/seviye efektleri (Aşama 3)
    try { this.stall = new MarketStall(s, this.state, this.bus, this); this.stall.create(); } catch (e) { console.error('[render] MarketStall', e); this.stall = null; }
    // kümes/ahır/kovan + hayvanlar (Aşama 4)
    try { this.buildings = new BuildingView(s, this.state, this.bus, this); this.buildings.create(); } catch (e) { console.error('[render] BuildingView', e); this.buildings = null; }
    try { this.animals = new AnimalView(s, this.state, this.bus, this, this.buildings); this.animals.create(); } catch (e) { console.error('[render] AnimalView', e); this.animals = null; }
    try { this.saleFx = new SaleFX(s, this.bus, this.webgl); this.saleFx.create(); } catch (e) { console.error('[render] SaleFX', e); this.saleFx = null; }
    // kararma katmanı (uyku geçişi) + Canvas letterbox
    this.cTop = s.add.container(0, 0).setScrollFactor(0).setDepth(1000);
    this.fadeRect = s.add.rectangle(0, 0, 10, 10, 0x05060c).setOrigin(0, 0).setAlpha(0).setVisible(false);
    this.cTop.add(this.fadeRect);
    if (!this.webgl) {
      this.barTop = s.add.rectangle(0, 0, 10, 10, 0x000000).setOrigin(0, 0);
      this.barBot = s.add.rectangle(0, 0, 10, 10, 0x000000).setOrigin(0, 1);
      this.cTop.add([this.barTop, this.barBot]);
    }
    this._setupPostFX();
    // olaylar
    const on = (n, f) => this._offs.push(this.bus.on(n, f, this));
    on('settings:quality', (p) => p && p.level && this.setQuality(p.level));
    on('cinematic:letterbox', (p) => this._letterbox(p));
    on('time:slept', () => { this.fade.a = 1; this.fade.hold = 0.35; });
    // ekran katmanlarını kamera preRender'ından sonra yerleştir
    const cam = s.cameras.main; this._cam = cam;
    const self = this; const orig = cam.preRender;
    this._origPreRender = orig;
    cam.preRender = function patchedPreRender() { orig.apply(this, arguments); try { self._layout(); } catch (e) { if (!self._layoutErr) { self._layoutErr = true; console.error('[render] layout', e); } } };
    this._ready = true;
    this.setQuality(this.quality);
  }

  _setupPostFX() {
    this.fx = null;
    if (!this.webgl) return;
    try {
      const pm = this.scene.sys.renderer.pipelines;
      for (const [n, C] of [['CiftlikGrade', GradePipeline], ['CiftlikBloom', BloomPipeline]]) if (!pm.postPipelineClasses.has(n)) pm.addPostPipeline(n, C);
      this.fx = { mode: null, pipe: null };
    } catch (e) {
      console.warn('[render] PostFX devre dışı', e); this.fx = null;
    }
  }

  /** Kaliteye göre tek kamera geçişi: bloom'lu (high/medium) veya yalnız grade+sinematik (low). */
  _applyPostFX(bloom) {
    if (!this.fx) return;
    const mode = bloom ? 'CiftlikBloom' : 'CiftlikGrade';
    if (this.fx.mode === mode) return;
    try {
      const cam = this.scene.cameras.main;
      if (this.fx.pipe) cam.removePostPipeline(this.fx.pipe);
      cam.setPostPipeline(mode);
      const pipe = cam.postPipelines.find((p) => p instanceof (bloom ? BloomPipeline : GradePipeline));
      if (!pipe) throw new Error('pipeline yok');
      pipe.look = this.look; this.fx.pipe = pipe; this.fx.mode = mode; this.fx.bloom = bloom ? pipe : null;
    } catch (e) {
      console.warn('[render] PostFX devre dışı', e); this.fx = null;
    }
  }

  _letterbox(p) {
    const L = this.letter;
    L.from = L.cur; L.to = clamp(Number(p?.amount) || 0, 0, 1); L.t0 = this.env.t; L.dur = Math.max(0.05, (Number(p?.duration) || 600) / 1000);
  }

  setQuality(level) {
    if (!QUALITY[level]) return;
    this.quality = level;
    if (!this._ready) return;
    const q = QUALITY[level];
    this.particles.setQuality(level);
    this.shadowSystem.setQuality(level);
    this.field?.setQuality(level);
    this.saleFx?.setQuality(level);
    this._applyPostFX(q.bloom);
    if (this.fx && this.fx.bloom) { this.fx.bloom.strength = q.bloomStrength; this.fx.bloom.passes = q.bloomPasses; }
    this.look.grain = q.grain;
  }

  update(frame) {
    if (!this._ready || !frame) return;
    const env = this.env;
    const dt = clamp((frame.delta || 16.7) / 1000, 0, 0.25);
    env.t = (frame.time || 0) / 1000; env.dt = dt;
    this._dpr = frame.dpr > 0 ? frame.dpr : (this.scene.registry.get('dpr') || 1);
    const cal = frame.cal; env.cal = cal; env.season = cal?.season || 'spring';
    const hour = (((frame.totalMinutes || 0) % 1440) + 1440) % 1440 / 60;
    sampleDay(hour, env.day);
    getSun(hour, env.sun); getMoon(hour, env.moon);
    // hava: bulutluluk ve rüzgâr (yalnızca okunur)
    const w = this.state?.weather || {};
    const cloudT = clamp((CLOUDINESS[w.type] ?? 0) * (w.type && w.type !== 'clear' ? 0.6 + 0.4 * (w.intensity ?? 0.6) : 1), 0, 1);
    env.cloud = lerp(env.cloud, cloudT, Math.min(1, dt * 0.5));
    const wt = clamp(Number.isFinite(w.wind) ? w.wind : 0.2, 0, 1);
    this._wind = lerp(this._wind, wt, Math.min(1, dt * 0.6));
    const gust = 0.8 + 0.2 * Math.sin(env.t * 0.43) * Math.sin(env.t * 0.17 + 1);
    env.wind = clamp(this._wind * gust, 0, 1);
    // ambient: bulutlu havada gri ve koyu
    copyRgb(env.day.ambient, env.ambient);
    if (env.cloud > 0.01) { mixRgb(env.ambient, GREY, env.cloud * 0.45, env.ambient); for (let i = 0; i < 3; i++) env.ambient[i] *= 1 - env.cloud * 0.18; }
    const e = env.sun.elevationDeg;
    env.twilight = smoothstep(-11, -1, e) * (1 - smoothstep(5, 22, e)) * (1 - env.cloud * 0.7);
    env.stars = clamp((0.42 - env.day.light) / 0.22, 0, 1) * (1 - env.cloud);

    this.sky.update(env);
    this.parallax.update(env);
    this.ground.update(env);
    this.horizon.update(env, this.parallax.forestBottom);
    this.lighting.update(env);
    this.shadowSystem.update(env);
    this.decor.update(env);
    if (this.field) { try { this.field.update(frame); } catch (e) { if (!this._fieldErr) { this._fieldErr = true; console.error('[render] FieldView.update', e); } } }
    if (this.stall) { try { this.stall.update(env); } catch (e) { if (!this._stallErr) { this._stallErr = true; console.error('[render] MarketStall.update', e); } } }
    if (this.buildings) { try { this.buildings.update(env); } catch (e) { if (!this._bldErr) { this._bldErr = true; console.error('[render] BuildingView.update', e); } } }
    if (this.animals) { try { this.animals.update(env); } catch (e) { if (!this._aniErr) { this._aniErr = true; console.error('[render] AnimalView.update', e); } } }
    this.saleFx?.update(env);
    this.particles.update(env);
    this._updateFX(env, dt);
    this._fps(frame.delta || 16.7);
  }

  _updateFX(env, dt) {
    // letterbox kayarak
    const L = this.letter;
    const k = clamp((env.t - L.t0) / L.dur, 0, 1); const ek = k * k * (3 - 2 * k);
    L.cur = L.from + (L.to - L.from) * ek;
    // uyku kararması
    const F = this.fade;
    if (F.hold > 0) F.hold -= dt; else if (F.a > 0) F.a = Math.max(0, F.a - dt / 1.4);
    if (!this.fx) return;
    const sg = SEASON_GRADE[env.season] || SEASON_GRADE.spring;
    const light = env.day.light;
    const night = clamp((0.62 - light) / 0.42, 0, 1);
    const golden = env.twilight * 0.6 + env.sun.intensity * (1 - smoothstep(10, 35, env.sun.elevationDeg)) * 0.5;
    const g = this.look;
    g.sat = sg.saturation * 0.94 * (1 - 0.3 * night) * (1 + 0.05 * golden) * (1 - env.cloud * 0.2);
    g.contrast = sg.contrast * (1 + 0.05 * golden) * (1 - 0.05 * night);
    g.warmth = sg.warmth * 0.6 + golden * 0.22 - night * 0.22;
    g.hue = sg.hueShift * Math.PI / 180;
    g.exposure = 1.0 + night * 0.06;
    const winter = env.season === 'winter' ? 1 : 0;
    g.lift[0] = 0.012 * night + 0.012 * golden; g.lift[1] = 0.018 * night + 0.005 * golden + 0.004 * winter; g.lift[2] = 0.05 * night + 0.02 * winter;
    const c = this.look;
    c.vignette = 0.27 + 0.13 * night; c.time = env.t; c.letterbox = L.cur;
    c.vigColor[0] = 0.12 - night * 0.06; c.vigColor[1] = 0.08 - night * 0.03; c.vigColor[2] = 0.16;
    if (this.fx.bloom) this.fx.bloom.threshold = 0.75 - night * 0.1; // gece pencere/ateş böceği parlaması daha kolay
  }

  _fps(deltaMs) {
    const a = this.fpsAcc; a.frames++; a.ms += deltaMs;
    if (a.ms >= 1000) {
      const fps = Math.round(this.scene.game.loop.actualFps || (a.frames * 1000 / a.ms));
      a.frames = 0; a.ms = 0;
      this.bus.emit('fps', { fps });
    }
  }

  _layout() {
    if (!this._ready) return;
    const v = this.view.read(this._cam, this._dpr);
    const env = this.env;
    this.sky.layout(v, env);
    this.parallax.layout(v, env);
    this.lighting.layout(v);
    this.particles.layout(v, env);
    this.saleFx?.layout(v);
    // üst katman: kararma + Canvas letterbox
    v.fit(this.cTop);
    const F = this.fade;
    this.fadeRect.setVisible(F.a > 0.001).setAlpha(F.a).setSize(v.W, v.H);
    if (this.barTop) {
      const bh = v.H * 0.1 * this.letter.cur;
      this.barTop.setVisible(bh > 0.5).setSize(v.W, Math.max(1, bh)).setPosition(0, 0);
      this.barBot.setVisible(bh > 0.5).setSize(v.W, Math.max(1, bh)).setPosition(0, v.H);
    }
  }

  destroy() {
    this._ready = false;
    for (const off of this._offs) off(); this._offs.length = 0;
    if (this._cam && this._origPreRender) { delete this._cam.preRender; if (this._cam.preRender !== this._origPreRender) this._cam.preRender = this._origPreRender; }
    try { if (this.fx && this.fx.pipe) this._cam.removePostPipeline(this.fx.pipe); } catch { /* yok say */ }
    for (const m of [this.saleFx, this.animals, this.buildings, this.stall, this.field, this.particles, this.decor, this.shadowSystem, this.lighting, this.horizon, this.ground, this.parallax, this.sky]) { try { m?.destroy(); } catch { /* yok say */ } }
    this.cTop?.destroy();
  }
}
