// Ekran uzayı yardımcıları. Phaser kamerasında scrollFactor 0 nesneler de zoom'lanır; ekran
// katmanları bir Container içinde tutulur ve container 1/zoom ölçeklenerek aygıt pikseli koordinatına oturtulur.
import { HORIZON_Y } from '../core/constants.js';

export class View {
  constructor() {
    this.W = 1; this.H = 1; this.zoom = 1; this.uz = 1; this.dpr = 1;
    this.midX = 0; this.midY = 0; this.hY = 0; this.left = 0; this.top = 0; this.right = 0; this.bottom = 0;
  }
  /** Kamera son durumundan (preRender sonrası) değerleri okur. */
  read(cam, dpr) {
    this.W = cam.width; this.H = cam.height; this.zoom = cam.zoom; this.dpr = dpr > 0 ? dpr : 1;
    this.uz = this.zoom / this.dpr;
    this.midX = cam.scrollX + this.W * cam.originX;
    this.midY = cam.scrollY + this.H * cam.originY;
    const hw = this.W / (2 * this.zoom), hh = this.H / (2 * this.zoom);
    this.left = this.midX - hw; this.right = this.midX + hw; this.top = this.midY - hh; this.bottom = this.midY + hh;
    this.hY = this.H / 2 + (HORIZON_Y - this.midY) * this.zoom;
    return this;
  }
  /** Bu container'ın çocukları artık aygıt pikseli ekran koordinatı kullanır. */
  fit(container) {
    const z = this.zoom;
    container.setScale(1 / z);
    container.setPosition(this.W / 2 - this.W / (2 * z), this.H / 2 - this.H / (2 * z));
  }
}

export function screenContainer(scene, depth) {
  const c = scene.add.container(0, 0);
  c.setScrollFactor(0); c.setDepth(depth);
  return c;
}
