// Sinematik son aşama GLSL'i: vinyet (gece güçlü), animasyonlu film greni, letterbox (yükseklik %10).
// Ayrı bir tam ekran geçişi maliyetinden kaçınmak için Grade/Bloom son geçişine gömülür.
export const CINE_UNIFORMS = `
uniform vec2 uRes;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;
uniform float uLetterbox;
uniform vec3 uVigColor;
`;

export const CINE_GLSL = `
float cineHash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}
vec3 cinematic(vec3 c, vec2 uv) {
  vec2 d = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float v = smoothstep(0.35, 1.05, length(d));
  c = mix(c, c * uVigColor, v * uVignette * 1.6);
  float n = cineHash(floor(uv * uRes / 1.5) + fract(uTime * 0.731) * 917.0) - 0.5;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c += n * uGrain * (1.15 - l * 0.6);
  float bar = uLetterbox * 0.1;
  float px = 1.0 / uRes.y;
  c *= smoothstep(bar - px, bar + px, uv.y) * smoothstep(bar - px, bar + px, 1.0 - uv.y);
  return c;
}
`;

/** Ortak "görünüm" parametreleri (Renderer her kare doldurur). */
export function createLook() {
  return { sat: 1, contrast: 1, warmth: 0, hue: 0, exposure: 1, lift: [0, 0, 0], vignette: 0.3, grain: 0.04, time: 0, letterbox: 0, vigColor: [0.1, 0.07, 0.15] };
}

/** Grade + sinematik uniform'larını verilen shader'a yazar. */
export function applyLook(p, shader, look) {
  p.set1f('uSat', look.sat, shader); p.set1f('uContrast', look.contrast, shader); p.set1f('uWarmth', look.warmth, shader);
  p.set1f('uHue', look.hue, shader); p.set1f('uExposure', look.exposure, shader); p.set3f('uLift', look.lift[0], look.lift[1], look.lift[2], shader);
  p.set2f('uRes', p.renderer.width, p.renderer.height, shader);
  p.set1f('uVignette', look.vignette, shader); p.set1f('uGrain', look.grain, shader); p.set1f('uTime', look.time, shader);
  p.set1f('uLetterbox', look.letterbox, shader); p.set3f('uVigColor', look.vigColor[0], look.vigColor[1], look.vigColor[2], shader);
}
