// Ortak sabitler — PLAN.md §1–2. Değiştirmek beyin onayı gerektirir.
export const TILE_W = 64;
export const TILE_H = 44;
export const WORLD_TILES_X = 80;
export const WORLD_TILES_Y = 24;
export const WORLD_W = TILE_W * WORLD_TILES_X; // 5120
export const WORLD_H = TILE_H * WORLD_TILES_Y; // 1056 (zemin düzlemi)
// Zemin düzlemi dünya y=0'dan başlar; ufuk ve gökyüzü negatif y bölgesindedir.
export const HORIZON_Y = 0;
export const SKY_H = 700; // ufkun üstünde görünür gökyüzü/arka plan yüksekliği

// Başlangıç parseli P1 (karo koordinatı)
export const P1 = { x: 32, y: 6, w: 16, h: 12 };

export const MIN_PER_DAY = 1440;
export const DAYS_PER_SEASON = 28;
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const SEASON_NAMES_TR = { spring: 'İlkbahar', summer: 'Yaz', autumn: 'Sonbahar', winter: 'Kış' };
export const REAL_SEC_PER_DAY = 600;
export const REAL_MS_PER_GAME_MIN = (REAL_SEC_PER_DAY * 1000) / MIN_PER_DAY; // ~416.67
export const MAX_STEPS_PER_FRAME = 240;
export const SPEEDS = [0, 1, 2, 4];

export const START_MINUTES = 6 * 60; // 1. gün 06:00
export const SAVE_KEY = 'altin-saat-ciftligi:save:v1';
export const SAVE_VERSION = 1;

// Render derinlikleri (PLAN.md §2 katman tablosu)
export const DEPTH = {
  SKY: 0, CELESTIAL: 5, MOUNTAINS: 10, CLOUDS: 15, HILLS: 20, FOREST: 25, FOG: 30,
  GROUND: 40, SHADOW: 45, OBJECTS: 50, WEATHER: 70, FOREGROUND: 80, LIGHT: 90,
};
