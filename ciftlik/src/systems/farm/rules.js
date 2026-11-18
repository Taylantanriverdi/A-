// STUB — gameplay-dev gerçek uygulamayla değiştirecek. İmzalar PLAN.md §8.
export function canApply(state, action, season) { return { ok: true }; }
export function tileInfo(state, tileId, now) {
  const t = state.tiles?.[tileId];
  if (!t) return null;
  return { soil: { moisture: t.moisture, n: t.n, p: t.p, k: t.k, ph: t.ph }, crop: null, weeds: t.weeds ?? 0, history: t.history ?? [], warnings: [] };
}
export function cropVisual(tile) {
  const c = tile?.crop;
  return c ? { cropId: c.id, stage: c.stage, wither: c.health < 40, dead: !!c.dead, pest: c.pest, disease: c.disease, weeds: tile.weeds } : null;
}
