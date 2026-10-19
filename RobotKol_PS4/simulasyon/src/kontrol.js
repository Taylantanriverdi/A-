// ESP32 kodundaki (RobotKol_PS4.ino) kontrol döngüsünün birebir JavaScript karşılığı.
// Sabitler derleme sırasında .ino dosyasından okunur (ayarlar_uretilen.js).
import { AYAR } from './ayarlar_uretilen.js';

export const EKSENLER = AYAR.eksenler;

export function cubukNorm(v) {               // stickToNorm: v = -128..127
  const a = Math.abs(v);
  if (a < AYAR.STICK_DEAD) return 0;
  let n = Math.min(1, (a - AYAR.STICK_DEAD) / (127 - AYAR.STICK_DEAD));
  n = AYAR.EXPO * n * n * n + (1 - AYAR.EXPO) * n;
  return v < 0 ? -n : n;
}

export function tetikNorm(v) {               // triggerToNorm: v = 0..255
  if (v < AYAR.TRIG_DEAD) return 0;
  return (v - AYAR.TRIG_DEAD) / (255 - AYAR.TRIG_DEAD);
}

const sinirla = (x, a, b) => Math.min(b, Math.max(a, x));

export class KolDenetleyici {
  constructor() {
    this.hedef = EKSENLER.map(e => e.home);
    this.anlik = EKSENLER.map(e => e.home);
    this.hizSeviye = 1;
    this.homing = false;
  }
  get dongu() { return AYAR.LOOP_MS / 1000; }

  // Bir kontrol döngüsü (loop() gövdesi). hiz: 6 eksen için -1..1
  adim(dt, hiz) {
    dt = Math.min(dt, 0.05);
    if (hiz.some(v => v !== 0)) this.homing = false;
    const olcek = AYAR.SPEED_LEVELS[this.hizSeviye];
    EKSENLER.forEach((e, i) => {
      if (this.homing) this.hedef[i] = e.home;
      else this.hedef[i] += hiz[i] * e.yon * e.hiz * olcek * dt;
      this.hedef[i] = sinirla(this.hedef[i], e.min, e.max);
      const enFazla = e.hiz * dt;
      const adim = sinirla((this.hedef[i] - this.anlik[i]) * AYAR.SMOOTHING, -enFazla, enFazla);
      if (Math.abs(adim) > 0.01) this.anlik[i] += adim;
    });
  }
  ayarla(i, derece) {                         // 'A i derece' komutu
    const e = EKSENLER[i];
    this.homing = false;
    this.hedef[i] = sinirla(derece, e.min, e.max);
  }
  baslangic() { this.homing = true; }        // 'H'
  durdur() {                                 // 'X'
    this.homing = false;
    this.hedef = this.anlik.slice();
  }
  hiz(n) { if (n >= 0 && n <= 2) this.hizSeviye = n; }
  hedefteMi(tolerans = 0.6) { return this.anlik.every((a, i) => Math.abs(a - this.hedef[i]) < tolerans); }
}
