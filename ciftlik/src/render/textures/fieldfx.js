// Tarla efekt dokuları (PLAN §8 "Görsel"): toz/sis bulutu, su damlası + sıçrama halkası, toprak topağı,
// gübre granülü, yaprak, karo imleci. Hepsi küçük; FieldView nesne havuzuyla kullanır.
import { makeCanvas, register, radial } from './canvas.js';
import { TileNoise } from './noise.js';
import { TILE_W, TILE_H } from '../../core/constants.js';

function puff(scene, key, rgb, seed, maxA) {
  if (scene.textures.exists(key)) return;
  const s = 48; const { canvas, ctx } = makeCanvas(s, s);
  const img = ctx.createImageData(s, s); const d = img.data; const n = new TileNoise(seed, 6, 6);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const u = (x + 0.5) / s * 2 - 1, v = (y + 0.5) / s * 2 - 1;
    const r = Math.sqrt(u * u + v * v) + (n.fbm(x / s, y / s, 3) - 0.5) * 0.45;
    const a = Math.max(0, 1 - r); const i = (y * s + x) * 4;
    const lit = 1 + (-u - v) * 0.08; // sol-üst hafif aydınlık
    d[i] = Math.min(255, rgb[0] * lit); d[i + 1] = Math.min(255, rgb[1] * lit); d[i + 2] = Math.min(255, rgb[2] * lit);
    d[i + 3] = a * a * (3 - 2 * a) * maxA * 255;
  }
  ctx.putImageData(img, 0, 0); register(scene, key, canvas);
}

export function genFieldFx(scene) {
  puff(scene, 'fx_puff', [214, 186, 146], 71, 0.85);   // toprak tozu
  puff(scene, 'fx_mist', [236, 244, 236], 72, 0.75);   // ilaç sisi (WebGL'de tint)
  if (!scene.textures.exists('fx_drop')) {
    const { canvas, ctx } = makeCanvas(8, 16);
    const g = ctx.createLinearGradient(0, 0, 0, 16); g.addColorStop(0, 'rgba(190,225,255,0)'); g.addColorStop(0.5, 'rgba(190,225,255,0.7)'); g.addColorStop(1, 'rgba(235,248,255,1)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(4, 0); ctx.quadraticCurveTo(7.5, 11, 4, 15.5); ctx.quadraticCurveTo(0.5, 11, 4, 0); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(3.2, 12, 1, 0, Math.PI * 2); ctx.fill();
    register(scene, 'fx_drop', canvas);
  }
  if (!scene.textures.exists('fx_ring')) {
    const w = 32, h = 16; const { canvas, ctx } = makeCanvas(w, h);
    ctx.strokeStyle = 'rgba(220,240,255,0.95)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.ellipse(16, 8, 13, 5.5, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.ellipse(16, 8, 9, 3.6, 0, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
    register(scene, 'fx_ring', canvas);
  }
  if (!scene.textures.exists('fx_clod')) {
    const { canvas, ctx } = makeCanvas(10, 9);
    ctx.fillStyle = radial(ctx, 3.5, 3, 6, [[0, '#b08356'], [0.55, '#7a5332'], [1, '#4a301c']]);
    ctx.beginPath(); ctx.ellipse(5, 4.5, 4.2, 3.4, 0.3, 0, Math.PI * 2); ctx.fill();
    register(scene, 'fx_clod', canvas);
  }
  if (!scene.textures.exists('fx_granule')) {
    const { canvas, ctx } = makeCanvas(6, 6);
    ctx.fillStyle = radial(ctx, 2.2, 2, 3.5, [[0, '#ffffff'], [0.5, '#e8e8e8'], [1, '#9a9a9a']]);
    ctx.beginPath(); ctx.arc(3, 3, 2.6, 0, Math.PI * 2); ctx.fill();
    register(scene, 'fx_granule', canvas);
  }
  if (!scene.textures.exists('fx_leaf')) {
    const { canvas, ctx } = makeCanvas(12, 7);
    const g = ctx.createLinearGradient(0, 0, 12, 7); g.addColorStop(0, '#a8cf5e'); g.addColorStop(1, '#4f7f30');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0.5, 3.5); ctx.quadraticCurveTo(6, -1.5, 11.5, 3.5); ctx.quadraticCurveTo(6, 8.5, 0.5, 3.5); ctx.fill();
    ctx.strokeStyle = 'rgba(230,250,180,0.5)'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(1, 3.5); ctx.lineTo(11, 3.5); ctx.stroke();
    register(scene, 'fx_leaf', canvas);
  }
  // karo imleci: tint'e dayanmayan, önceden renklendirilmiş kopyalar (Canvas renderer'da da renkli)
  cursor(scene, 'fx_tilecursor', [255, 255, 255], 0.2, false);
  cursor(scene, 'fx_tilecursor_n', [255, 244, 228], 0.18, false);
  cursor(scene, 'fx_tilecursor_ok', [255, 236, 190], 0.22, false);
  cursor(scene, 'fx_tilecursor_bad', [255, 92, 72], 0.32, true);
}

/** Yumuşak parlayan yuvarlatılmış çerçeve + hafif iç dolgu; `bad` → çapraz çizgili kırmızı dolgu. */
function cursor(scene, key, rgb, fill, bad) {
  if (scene.textures.exists(key)) return;
  const m = 10, w = TILE_W + m * 2, h = TILE_H + m * 2; const { canvas, ctx } = makeCanvas(w, h);
  const c = (a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
  const rr = (inset, rad) => { ctx.beginPath(); ctx.roundRect(m + inset, m + inset, TILE_W - inset * 2, TILE_H - inset * 2, rad); };
  ctx.save(); ctx.filter = 'blur(3px)'; ctx.strokeStyle = c(0.75); ctx.lineWidth = 4; rr(1, 10); ctx.stroke(); ctx.restore();
  ctx.strokeStyle = c(0.95); ctx.lineWidth = bad ? 2.2 : 1.6; rr(1.5, 9); ctx.stroke();
  const g = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, TILE_W * 0.6);
  g.addColorStop(0, c(fill * 0.25)); g.addColorStop(1, c(fill));
  ctx.fillStyle = g; rr(2.5, 8); ctx.fill();
  if (bad) {
    ctx.save(); rr(2.5, 8); ctx.clip();
    ctx.strokeStyle = c(0.22); ctx.lineWidth = 2;
    for (let x = -TILE_H; x < TILE_W + TILE_H; x += 9) { ctx.beginPath(); ctx.moveTo(m + x, m + TILE_H); ctx.lineTo(m + x + TILE_H, m); ctx.stroke(); }
    ctx.restore();
  }
  register(scene, key, canvas, { margin: m });
}
