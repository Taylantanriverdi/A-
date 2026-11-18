// Sanat yönetimi: gün içi color grading anahtar kareleri (PLAN.md §2).
// hour: ondalıklı saat. Aralar yumuşak (smoothstep) interpolasyonla karıştırılır; 24:00 → 04:30'a sarar.
// skyTop/skyBottom: gök gradyanı. ambient: MULTIPLY ton. sun: ışık rengi (null → yok).
// fog: 0–1 sis yoğunluğu. shadowAlpha: gölge opaklığı. light: genel parlaklık 0–1 (gece lambaları bu değer düştükçe yanar).
export const DAY_KEYS = [
  { hour: 0.0,  name: 'night',    skyTop: '#050816', skyBottom: '#121a3a', ambient: '#2f3b6e', sun: '#9fb4ff', fog: 0.30, shadowAlpha: 0.10, light: 0.18 },
  { hour: 4.5,  name: 'predawn',  skyTop: '#0b1026', skyBottom: '#2a2f55', ambient: '#3a4470', sun: '#9fb4ff', fog: 0.30, shadowAlpha: 0.08, light: 0.24 },
  { hour: 6.5,  name: 'sunrise',  skyTop: '#3b4a8a', skyBottom: '#ff9e6b', ambient: '#d9a48e', sun: '#ffb37a', fog: 0.70, shadowAlpha: 0.20, light: 0.62 },
  { hour: 9.0,  name: 'morning',  skyTop: '#6fa8dc', skyBottom: '#d6ecf7', ambient: '#f4f0e6', sun: '#fff1d6', fog: 0.15, shadowAlpha: 0.30, light: 0.92 },
  { hour: 13.0, name: 'noon',     skyTop: '#4f95e0', skyBottom: '#c4e3ff', ambient: '#ffffff', sun: '#ffffff', fog: 0.00, shadowAlpha: 0.38, light: 1.00 },
  { hour: 17.5, name: 'golden',   skyTop: '#5b7fc4', skyBottom: '#ffc27a', ambient: '#ffdca6', sun: '#ffb347', fog: 0.10, shadowAlpha: 0.32, light: 0.88 },
  { hour: 19.5, name: 'sunset',   skyTop: '#2c2f6b', skyBottom: '#ff6f61', ambient: '#d98c7c', sun: '#ff7a4d', fog: 0.20, shadowAlpha: 0.18, light: 0.58 },
  { hour: 21.0, name: 'dusk',     skyTop: '#141a3d', skyBottom: '#4a3a6b', ambient: '#6c6ca6', sun: null,      fog: 0.25, shadowAlpha: 0.00, light: 0.32 },
];

// Güneş: 06:00 doğar (doğu), 13:00 tepe, 20:00 batar (batı). Ay: 20:30–05:30.
export const SUN = { rise: 6.0, noon: 13.0, set: 20.0, maxElevationDeg: 62 };
export const MOON = { rise: 20.5, set: 5.5, maxElevationDeg: 45 };

// Mevsim grading'i — gün paletinin üstüne uygulanır.
// saturation: çarpan, hueShift: derece, warmth: -1 (soğuk) .. +1 (sıcak), contrast: çarpan
export const SEASON_GRADE = {
  spring: { saturation: 1.10, hueShift: 0,   warmth: 0.05,  contrast: 1.00, foliage: ['#5fa84a', '#7cc35a', '#9bd46a'] },
  summer: { saturation: 1.05, hueShift: 0,   warmth: 0.18,  contrast: 1.08, foliage: ['#3f8a3a', '#5aa043', '#78b84e'] },
  autumn: { saturation: 1.02, hueShift: -12, warmth: 0.22,  contrast: 1.03, foliage: ['#c46a2b', '#e0913a', '#a8432a'] },
  winter: { saturation: 0.65, hueShift: 6,   warmth: -0.25, contrast: 0.95, foliage: ['#4d6b5a', '#6a8576', '#8aa094'] },
};

// Sabit dünya paleti (doku üreticileri için temel tonlar)
export const WORLD = {
  mountainFar: '#7d8fb8', mountainNear: '#5a6f9a',
  hill: '#6f9a5a', forest: '#2f5a3a', forestDark: '#1f3f2b',
  grass: '#7fae55', grassDark: '#5f8f40', soil: '#7a5536', soilWet: '#4f3522', path: '#c9a878',
  wood: '#8a5a3a', roof: '#a8463a', wall: '#e8d8b8', water: '#5f9ccf',
  shadow: '#1a1630',
};
