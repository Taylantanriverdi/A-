// STUB — visual-dev bu dosyayı gerçek uygulamayla değiştirecek. API sözleşmesi PLAN.md §7.
export default class Renderer {
  constructor(scene, state, bus) { this.scene = scene; this.state = state; this.bus = bus; }
  create() {
    const g = this.scene.add.graphics();
    g.fillStyle(0x6fa8dc).fillRect(0, -700, 5120, 700);
    g.fillStyle(0x7fae55).fillRect(0, 0, 5120, 1056);
  }
  update(frame) {}
  setQuality(level) {}
  destroy() {}
}
