import { h, type Child } from './dom';

/** FDI diş numaraları (üst: 18→11 | 21→28, alt: 48→41 | 31→38). */
const seq = (from: number, to: number): number[] => { const r: number[] = []; for (let i = from; from <= to ? i <= to : i >= to; from <= to ? i++ : i--) r.push(i); return r; };
export const UPPER_TEETH: readonly number[] = [...seq(18, 11), ...seq(21, 28)];
export const LOWER_TEETH: readonly number[] = [...seq(48, 41), ...seq(31, 38)];
export const ALL_TEETH: readonly number[] = [...UPPER_TEETH, ...LOWER_TEETH];

export const isTooth = (n: number): boolean => ALL_TEETH.includes(n);

/** "11, 12 21;22" → [11,12,21,22] (geçersizler ve tekrarlar atılır, sıralı). */
export function parseTeeth(text: string): number[] {
  const out = new Set<number>();
  for (const t of text.split(/[\s,;]+/)) { const n = Number(t); if (t && Number.isInteger(n) && isTooth(n)) out.add(n); }
  return [...out].sort((a, b) => a - b);
}

export type Jaw = '' | 'ust' | 'alt' | 'her';
/** Seçili dişlerden çene: yalnızca üst → 'ust', yalnızca alt → 'alt', ikisi → 'her'. */
export function jawOf(teeth: Iterable<number>): Jaw {
  let up = false; let lo = false;
  for (const t of teeth) { if (UPPER_TEETH.includes(t)) up = true; else if (LOWER_TEETH.includes(t)) lo = true; }
  return up && lo ? 'her' : up ? 'ust' : lo ? 'alt' : '';
}
export const jawLabel = (j: unknown): string => (j === 'ust' ? 'Üst çene' : j === 'alt' ? 'Alt çene' : j === 'her' ? 'Her iki çene' : '');

/** Tıklanabilir FDI diş şeması. `selected` yerinde güncellenir; her değişimde `onChange` çağrılır. */
export function toothPicker(selected: Set<number>, onChange: () => void): HTMLElement {
  const btns = new Map<number, HTMLButtonElement>();
  const paint = () => { btns.forEach((b, n) => { const on = selected.has(n); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); };
  const change = () => { paint(); onChange(); };
  const mk = (n: number) => { const b = h('button', { type: 'button', class: 'tooth', 'aria-label': `Diş ${n}`, 'aria-pressed': 'false', on: { click: () => { if (selected.has(n)) selected.delete(n); else selected.add(n); change(); } } }, String(n)); btns.set(n, b); return b; };
  const row = (nums: readonly number[]) => h('div', { class: 'teeth-row' }, nums.map(mk) as Child[]);
  const setJaw = (nums: readonly number[], on: boolean) => () => { nums.forEach((n) => (on ? selected.add(n) : selected.delete(n))); change(); };
  const quick = (t: string, fn: () => void) => h('button', { type: 'button', class: 'btn ghost', on: { click: fn } }, t);
  const el = h('div', { class: 'teeth' }, row(UPPER_TEETH), row(LOWER_TEETH),
    h('div', { class: 'row' }, quick('Üst çene', setJaw(UPPER_TEETH, true)), quick('Alt çene', setJaw(LOWER_TEETH, true)), quick('Temizle', () => { selected.clear(); change(); })));
  paint();
  return el;
}
