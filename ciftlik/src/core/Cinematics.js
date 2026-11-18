// Cinematics — oyun olaylarını sinematik kamera çekimlerine çeviren veri odaklı kural tablosu.
// Sistemler kamerayı bilmez; bu modül bus'ı dinler ve `camera:cinematic` yayar (CameraDirector oynatır).
// Yeni kural eklemek için RULES'a satır ekle (ör. Aşama 5 bina açılışı: event 'building:built').
import { TILE_W, TILE_H } from './constants.js';

/** Karo (tx, ty) merkezinin dünya koordinatı. */
export function tileCenter(tx, ty) {
  return { x: (tx + 0.5) * TILE_W, y: (ty + 0.5) * TILE_H };
}

/**
 * Kural: { event, when(payload) → boolean, shot: {zoom, duration, letterbox}, target(payload) → {x,y}|null, reason }
 * target null dönerse çekim yapılmaz.
 */
export const RULES = [
  {
    event: 'farm:milestone',
    when: (p) => p && p.kind === 'firstHarvest',
    target: (p) => (Number.isFinite(p.tx) && Number.isFinite(p.ty) ? tileCenter(p.tx, p.ty) : null),
    shot: { zoom: 1.5, duration: 2200, letterbox: true },
    reason: 'firstHarvest',
  },
];

export default class Cinematics {
  /**
   * @param {{on:Function, emit:Function}} bus
   * @param {Array} [rules]
   */
  constructor(bus, rules = RULES) {
    this.bus = bus;
    this._offs = [];
    const byEvent = new Map();
    for (const r of rules) {
      if (!byEvent.has(r.event)) byEvent.set(r.event, []);
      byEvent.get(r.event).push(r);
    }
    for (const [event, list] of byEvent) {
      this._offs.push(bus.on(event, (p) => this._handle(list, p)));
    }
  }

  _handle(list, p) {
    for (const r of list) {
      if (r.when && !r.when(p)) continue;
      const target = r.target ? r.target(p) : null;
      if (!target) continue;
      this.bus.emit('camera:cinematic', {
        target, zoom: r.shot.zoom, duration: r.shot.duration, letterbox: !!r.shot.letterbox,
        reason: typeof r.reason === 'function' ? r.reason(p) : r.reason,
      });
      return; // olay başına tek çekim
    }
  }

  destroy() {
    for (const off of this._offs) { try { off(); } catch { /* yok say */ } }
    this._offs.length = 0;
  }
}
