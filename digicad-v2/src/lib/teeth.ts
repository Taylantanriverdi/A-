import { h, type Child } from './dom';

/** FDI diş numaraları (üst: 18→11 | 21→28, alt: 48→41 | 31→38). */
const seq = (from: number, to: number): number[] => { const r: number[] = []; for (let i = from; from <= to ? i <= to : i >= to; from <= to ? i++ : i--) r.push(i); return r; };
export const UPPER_TEETH: readonly number[] = [...seq(18, 11), ...seq(21, 28)];
export const LOWER_TEETH: readonly number[] = [...seq(48, 41), ...seq(31, 38)];
export const ALL_TEETH: readonly number[] = [...UPPER_TEETH, ...LOWER_TEETH];

export const isTooth = (n: number): boolean => ALL_TEETH.includes(n);

/** FDI çeyrekleri (admin diş şeması: ur/ul üst, br/bl alt). */
export const FDI = { ur: [18, 17, 16, 15, 14, 13, 12, 11], ul: [21, 22, 23, 24, 25, 26, 27, 28], br: [48, 47, 46, 45, 44, 43, 42, 41], bl: [31, 32, 33, 34, 35, 36, 37, 38] } as const;
/** Süt dişleri (51-55, 61-65, 71-75, 81-85) de eski kayıtlarda geçerli sayılır. */
const VALID_TEETH = new Set<number>([...ALL_TEETH, 51, 52, 53, 54, 55, 61, 62, 63, 64, 65, 71, 72, 73, 74, 75, 81, 82, 83, 84, 85]);
/** Diş listesi/metni ayrıştırır: geçerli (kalıcı+süt) FDI numaraları sıralı + tanınmayan parçalar `rest` (kayıp olmasın diye gösterilir). */
export function parseTeethDetailed(v: unknown): { teeth: number[]; rest: string[] } {
  const toks = Array.isArray(v) ? v.map(String) : String(v ?? '').split(/[,;\s]+/);
  const set = new Set<number>(); const rest: string[] = [];
  for (const raw of toks) { const t = raw.trim(); if (!t) continue; const n = Number(t); if (/^\d{2}$/.test(t) && VALID_TEETH.has(n)) set.add(n); else rest.push(t); }
  return { teeth: [...set].sort((a, b) => a - b), rest };
}
export const formatTeeth = (t: unknown): string => parseTeethDetailed(t).teeth.join(', ');

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

export interface ToothChart { el: HTMLElement; get: () => number[]; set: (t: number[]) => void }
/** Admin diş şeması seçici (4 çeyrek). `readonly` ise yalnızca gösterir. Düğmeler gerçek <button>; klavye/ekran okuyucu uyumlu. */
export function toothChart(initial: unknown, onChange?: (t: number[]) => void, readonly = false): ToothChart {
  const sel = new Set<number>(parseTeethDetailed(initial).teeth); const btns = new Map<number, HTMLButtonElement>();
  const sync = (): void => { btns.forEach((b, n) => { const on = sel.has(n); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); info.textContent = sel.size ? `${[...sel].sort((a, b) => a - b).join(', ')} (${sel.size} diş)` : 'Diş seçilmedi'; };
  const quad = (nums: readonly number[], cls: string) => h('div', { class: `tq ${cls}` }, nums.map((n) => {
    const b = h('button', { type: 'button', class: 'tooth', 'aria-pressed': 'false', 'aria-label': `Diş ${n}`, disabled: readonly, on: { click: () => { if (sel.has(n)) sel.delete(n); else sel.add(n); sync(); onChange?.([...sel].sort((a, c) => a - c)); } } }, String(n));
    btns.set(n, b); return b;
  }));
  const info = h('div', { class: 'muted tinfo' });
  const clear = h('button', { type: 'button', class: 'btn ghost', on: { click: () => { sel.clear(); sync(); onChange?.([]); } } }, 'Temizle');
  const el = h('div', { class: 'tchart' }, h('div', { class: 'tgrid' }, quad(FDI.ur, 'ur'), quad(FDI.ul, 'ul'), quad(FDI.br, 'br'), quad(FDI.bl, 'bl')), h('div', { class: 'row' }, info, readonly ? null : clear));
  sync();
  return { el, get: () => [...sel].sort((a, b) => a - b), set: (t) => { sel.clear(); parseTeethDetailed(t).teeth.forEach((n) => sel.add(n)); sync(); } };
}
