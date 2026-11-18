// Aktif olay çarpanları — saf okuyucular (PLAN §14). Farm/Animal/Placement bunları state.events'ten okur; bellek ayırmaz.
const num = (v) => typeof v === 'number' && Number.isFinite(v);

/** Aktif olayların data[key] değerlerinin çarpımı (yoksa 1). */
export function evMult(state, key) {
  const a = state?.events?.active;
  if (!Array.isArray(a) || a.length === 0) return 1;
  let m = 1;
  for (let i = 0; i < a.length; i++) { const d = a[i] && a[i].data; if (d && num(d[key]) && d[key] > 0) m *= d[key]; }
  return m;
}

/** Aktif olayların data[key] değerlerinin en büyüğü (yoksa 0). */
export function evMax(state, key) {
  const a = state?.events?.active;
  if (!Array.isArray(a) || a.length === 0) return 0;
  let m = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] && a[i].data; if (d && num(d[key]) && d[key] > m) m = d[key]; }
  return m;
}

/** Aktif olay kind'ı var mı? */
export function evActive(state, kind) {
  const a = state?.events?.active;
  if (!Array.isArray(a)) return false;
  for (let i = 0; i < a.length; i++) if (a[i] && a[i].kind === kind) return true;
  return false;
}

/** İnşaat bedeli çarpanı (teşvik aktifken 1 - indirim). */
export function buildCostMult(state) { return 1 - Math.min(0.9, evMax(state, 'buildDiscount')); }
