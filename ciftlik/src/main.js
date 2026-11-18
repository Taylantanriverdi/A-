// STUB — engine-dev bu dosyayı gerçek uygulamayla değiştirecek.
import Phaser from 'phaser';
import bus from './core/EventBus.js';
import { calendar } from './core/timeUtils.js';
import { START_MINUTES } from './core/constants.js';
import Renderer from './render/Renderer.js';
import { generateTextures } from './render/textures/index.js';
import { mountUI } from './ui/index.js';

const state = { version: 1, time: { totalMinutes: START_MINUTES, speed: 1 }, weather: { type: 'clear', intensity: 0, wind: 0.2 },
  finance: { money: 5000 }, settings: { quality: 'auto', sound: 0.8, music: 0.5 }, camera: null };

class WorldScene extends Phaser.Scene {
  constructor() { super('World'); }
  create() {
    generateTextures(this);
    this.renderer2 = new Renderer(this, state, bus); this.renderer2.create();
    this.cameras.main.centerOn(2560, 300);
  }
  update(time, delta) {
    state.time.totalMinutes += (delta / 416.67) * state.time.speed;
    this.renderer2.update({ time, delta, totalMinutes: state.time.totalMinutes, cal: calendar(state.time.totalMinutes) });
  }
}
new Phaser.Game({ type: Phaser.WEBGL, parent: 'game', backgroundColor: '#05060c',
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight }, scene: [WorldScene] });
mountUI({ state, bus, calendar, debug: true });
window.__game = { state, bus };
