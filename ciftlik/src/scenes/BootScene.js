// BootScene — prosedürel dokuları üretir, koyu fonda ince altın ilerleme çubuğu gösterir, ardından World.
import Phaser from 'phaser';
import { generateTextures } from '../render/textures/index.js';

const BG = 0x05060c;
const GOLD = 0xf2b84b;
const CREAM = '#f5ecd9';

export default class BootScene extends Phaser.Scene {
  constructor(app) {
    super({ key: 'Boot' });
    this.app = app;
  }

  create() {
    const dpr = this.registry.get('dpr') || 1;
    const W = this.scale.width, H = this.scale.height;
    this.cameras.main.setBackgroundColor(BG);
    const barW = Math.min(320 * dpr, W * 0.6);
    const barH = Math.max(2, Math.round(2 * dpr));
    const x0 = (W - barW) / 2, y0 = H * 0.56;

    const title = this.add.text(W / 2, y0 - 34 * dpr, 'Altın Saat Çiftliği', {
      fontFamily: 'Georgia, "Times New Roman", serif', fontSize: `${Math.round(22 * dpr)}px`, color: CREAM,
    }).setOrigin(0.5).setAlpha(0);
    const track = this.add.rectangle(x0, y0, barW, barH, 0xffffff, 0.08).setOrigin(0, 0.5);
    const bar = this.add.rectangle(x0, y0, 1, barH, GOLD, 1).setOrigin(0, 0.5);
    const glow = this.add.rectangle(x0, y0, 1, barH * 5, GOLD, 0.12).setOrigin(0, 0.5);
    this.tweens.add({ targets: title, alpha: 0.9, duration: 500, ease: 'Sine.easeOut' });

    const prog = { v: 0, shown: 0 };
    const draw = () => {
      const w = Math.max(1, barW * prog.shown);
      bar.width = w; glow.width = w;
    };

    // Bir kare çiz, sonra senkron doku üretimini yap.
    this.time.delayedCall(60, () => {
      try {
        generateTextures(this, (p) => { prog.v = Phaser.Math.Clamp(Number(p) || 0, 0, 1); });
      } catch (e) {
        console.error('[boot] generateTextures', e);
      }
      prog.v = 1;
      this.tweens.add({
        targets: prog, shown: 1, duration: 380, ease: 'Sine.easeInOut', onUpdate: draw,
        onComplete: () => {
          this.tweens.add({ targets: [title, track, bar, glow], alpha: 0, duration: 260, delay: 80 });
          this.time.delayedCall(360, () => this.scene.start('World'));
        },
      });
    });
    this.tweens.add({ targets: prog, shown: 0.35, duration: 300, ease: 'Sine.easeOut', onUpdate: draw });
  }
}
