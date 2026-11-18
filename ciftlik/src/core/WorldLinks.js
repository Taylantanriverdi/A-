// WorldLinks — dünyadaki tıklanabilir yapıları (karo bölgeleri) UI eylemlerine bağlayan küçük kural tablosu.
// Cinematics gibi: bus'ı dinler, yalnızca olay yayar; sistemleri veya UI'yi doğrudan çağırmaz.
// Yeni bağlantı (ör. Aşama 5 bina tıklaması) için LINKS'e satır ekle.
import { PLACEABLES } from '../data/placeables.js';

// PLAN §12: bağlantılar statik değildir. Dokunulan karodaki placed nesnenin PLACEABLES[type].link paneli açılır
// (`ui:open {...link, placedId, source:'placed'}`). Nesne ayak izi state.placed'ten bulunur.

const STROKE_GAP_MS = 400; // bundan kısa aralıkla gelen tile:tap'ler boyama darbesi sayılır
const REOPEN_MS = 600;     // aynı bağlantı bu süre içinde tekrar tetiklenmez

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

export default class WorldLinks {
  /**
   * @param {{on:Function, emit:Function}} bus
   * @param {object} state GameState (state.placed okunur)
   */
  constructor(bus, state) {
    this.bus = bus;
    this.state = state;
    this.tool = 'hand';
    this.lastTapAt = -Infinity;
    this.lastTapLink = null; // son tile:tap'in düştüğü bağlantı (null = bağlantı dışı)
    this.firedAt = new Map();
    this._offs = [
      bus.on('tool:select', (p) => { if (p && typeof p.tool === 'string') this.tool = p.tool; }),
      bus.on('tile:tap', (p) => this._onTap(p)),
    ];
  }

  /** (tx, ty) karosundaki bağlantı ya da null. */
  linkAt(tx, ty) {
    const list = this.state && this.state.placed;
    if (!Array.isArray(list)) return null;
    for (const p of list) {
      const def = PLACEABLES[p.type];
      if (!def || !def.link) continue;
      if (tx >= p.tx && tx < p.tx + def.w && ty >= p.ty && ty < p.ty + def.h) {
        return { id: p.id, event: 'ui:open', payload: { ...def.link, placedId: p.id, source: 'placed' } };
      }
    }
    return null;
  }

  _onTap(p) {
    if (!p || !Number.isFinite(p.tx) || !Number.isFinite(p.ty)) return;
    const t = now();
    const link = this.linkAt(p.tx, p.ty);
    // Alet seçiliyken sürükleyerek boyama sırasında tezgâhın üstünden geçmek paneli açmasın:
    // darbe içindeki (kısa aralıklı) ve bağlantı dışından gelen tap'ler yok sayılır.
    const inStroke = this.tool !== 'hand' && t - this.lastTapAt < STROKE_GAP_MS && this.lastTapLink !== link;
    this.lastTapAt = t;
    this.lastTapLink = link;
    if (!link || inStroke) return;
    if (this.tool === 'build') return; // İnşa modunda dokunuş yerleştirme içindir, panel açmaz
    const prev = this.firedAt.get(link.id);
    if (prev !== undefined && t - prev < REOPEN_MS) return;
    this.firedAt.set(link.id, t);
    this.bus.emit(link.event, { ...link.payload, tool: this.tool });
  }

  destroy() {
    for (const off of this._offs) { try { off(); } catch { /* yok say */ } }
    this._offs.length = 0;
  }
}
