// STUB — engine-dev gerçek uygulamayla değiştirecek. İmzalar PLAN.md §12.
import { P1_BLOCKED } from '../../data/land.js';
export function isBlocked(state, tx, ty, opts = {}) { return !!P1_BLOCKED[`${tx},${ty}`] && !(opts.walk && P1_BLOCKED[`${tx},${ty}`] === 'path'); }
export function canPlace(state, type, tx, ty, ignoreId) { return { ok: true }; }
export function objectAt(state, tx, ty) { return null; }
export function penOf(state, placedId) { return null; }
