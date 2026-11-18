// Hava durumu — PLAN.md §14. Günlük hava sabah 05:00'te tahminden çekilir; gün içinde 0–2 değişim olabilir.
// Tür: clear | cloudy | rain | storm | snow | fog. intensity 0..1, wind 0..1.
export const WEATHER_TYPES = ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog'];
export const WEATHER_NAMES_TR = { clear: 'Açık', cloudy: 'Bulutlu', rain: 'Yağmurlu', storm: 'Fırtınalı', snow: 'Karlı', fog: 'Sisli' };

// Mevsime göre günlük olasılıklar (toplam 1)
export const SEASON_WEATHER = {
  spring: { clear: 0.40, cloudy: 0.25, rain: 0.25, storm: 0.05, fog: 0.05, snow: 0 },
  summer: { clear: 0.60, cloudy: 0.18, rain: 0.12, storm: 0.08, fog: 0.02, snow: 0 },
  autumn: { clear: 0.30, cloudy: 0.30, rain: 0.25, storm: 0.05, fog: 0.10, snow: 0 },
  winter: { clear: 0.30, cloudy: 0.25, rain: 0.05, storm: 0.02, fog: 0.08, snow: 0.30 },
};
export const WIND = { clear: [0.05, 0.3], cloudy: [0.2, 0.5], rain: [0.3, 0.6], storm: [0.7, 1.0], snow: [0.1, 0.4], fog: [0, 0.1] };
export const INTENSITY = { clear: [0, 0], cloudy: [0.3, 0.8], rain: [0.4, 0.9], storm: [0.8, 1.0], snow: [0.4, 1.0], fog: [0.5, 1.0] };
export const PERSISTENCE = 0.45;    // ertesi gün aynı havanın tekrar etme şansı (sonra mevsim dağılımı)
export const FORECAST_DAYS = 3;
export const INTRADAY_CHANGE = 0.25; // gün içinde (öğleden sonra) bir kez değişme şansı

// Etkiler (FarmSystem/AnimalSystem okur). Yağmur toprağı sular: soil.js rainGainPerHour zaten var (rain 4, storm 6, snow 0.5).
export const EFFECTS = {
  storm: { cropDamageChance: 0.04, cropDamage: 15, animalHappiness: -10 },   // açık alan ekin, karo başına günlük
  snow:  { openFieldGrowthMult: 0, snowCoverPerHour: 0.04, meltPerHour: 0.03 },
  rain:  { puddlePerHour: 0.08, dryPerHour: 0.05 },                           // görsel birikinti (0..1)
  fog:   {},
};
