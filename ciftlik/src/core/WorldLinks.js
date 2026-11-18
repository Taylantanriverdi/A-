// WorldLinks — dünyadaki tıklanabilir yapıları (karo bölgeleri) UI eylemlerine bağlayan küçük kural tablosu.
// Cinematics gibi: bus'ı dinler, yalnızca olay yayar; sistemleri veya UI'yi doğrudan çağırmaz.
// Yeni bağlantı (ör. Aşama 5 bina tıklaması) için LINKS'e satır ekle.
import { BUILDINGS } from '../data/buildings.js';
import { MACHINES } from '../data/recipes.js';
import { DONKEY } from '../data/workers.js';

/**
 * Bağlantı: { id, area: {x0, x1, y0, y1} (karo, uçlar dahil), emit: [olay, yük] , tools?: ['hand', ...] }
 * tools verilmezse her alette tetiklenir (alet seçiliyken farm:action üretmemek UI'nin işi).
 */
export const LINKS = [
  {
    id: 'marketStall', // PLAN §9: pazar tezgâhı, karo 42–44 × 18–19 (visual-dev MarketStall çizer)
    area: { x0: 42, x1: 44, y0: 18, y1: 19 },
    event: 'ui:open',
    payload: { panel: 'market', source: 'marketStall' },
  },
  // Aşama 4: bina arsaları (data/buildings.js lots) → bina paneli (boşsa inşa teklifi)
  ...Object.entries(BUILDINGS).flatMap(([type, b]) => b.lots.map((l) => ({
    id: l.id,
    area: { x0: l.x0, x1: l.x1, y0: l.y0, y1: l.y1 },
    event: 'ui:open',
    payload: { panel: 'building', buildingType: type, lotId: l.id, source: 'lot' },
  }))),
  // Aşama 5: atölye arsaları → makine paneli (boşsa inşa teklifi); eşek sundurması → çalışan paneli
  ...Object.entries(MACHINES).map(([type, m]) => ({
    id: `machine_${type}`,
    area: { ...m.lot },
    event: 'ui:open',
    payload: { panel: 'machine', machine: type, source: 'lot' },
  })),
  { id: 'donkeyShed', area: { ...DONKEY.shed }, event: 'ui:open', payload: { panel: 'worker', source: 'shed' } },
];

const STROKE_GAP_MS = 400; // bundan kısa aralıkla gelen tile:tap'ler boyama darbesi sayılır
const REOPEN_MS = 600;     // aynı bağlantı bu süre içinde tekrar tetiklenmez

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

export default class WorldLinks {
  /**
   * @param {{on:Function, emit:Function}} bus
   * @param {Array} [links]
   */
  constructor(bus, links = LINKS) {
    this.bus = bus;
    this.links = links;
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
    for (const l of this.links) {
      const a = l.area;
      if (tx >= a.x0 && tx <= a.x1 && ty >= a.y0 && ty <= a.y1) return l;
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
    if (link.tools && !link.tools.includes(this.tool)) return;
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
