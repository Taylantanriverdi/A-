import { h } from '../lib/dom';
import { FDI, parseTeeth } from './calc';

export interface ToothChart { el: HTMLElement; get: () => number[]; set: (t: number[]) => void }
/** FDI diş şeması seçici (4 çeyrek). `readonly` ise yalnızca gösterir. Düğmeler gerçek <button>; klavye/ekran okuyucu uyumlu. */
export function toothChart(initial: unknown, onChange?: (t: number[]) => void, readonly = false): ToothChart {
  const sel = new Set<number>(parseTeeth(initial).teeth); const btns = new Map<number, HTMLButtonElement>();
  const sync = (): void => { btns.forEach((b, n) => { const on = sel.has(n); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); info.textContent = sel.size ? `${[...sel].sort((a, b) => a - b).join(', ')} (${sel.size} diş)` : 'Diş seçilmedi'; };
  const quad = (nums: readonly number[], cls: string) => h('div', { class: `tq ${cls}` }, nums.map((n) => {
    const b = h('button', { type: 'button', class: 'tooth', 'aria-pressed': 'false', 'aria-label': `Diş ${n}`, disabled: readonly, on: { click: () => { if (sel.has(n)) sel.delete(n); else sel.add(n); sync(); onChange?.([...sel].sort((a, c) => a - c)); } } }, String(n));
    btns.set(n, b); return b;
  }));
  const info = h('div', { class: 'muted tinfo' });
  const clear = h('button', { type: 'button', class: 'btn ghost', on: { click: () => { sel.clear(); sync(); onChange?.([]); } } }, 'Temizle');
  const el = h('div', { class: 'tchart' }, h('div', { class: 'tgrid' }, quad(FDI.ur, 'ur'), quad(FDI.ul, 'ul'), quad(FDI.br, 'br'), quad(FDI.bl, 'bl')), h('div', { class: 'row' }, info, readonly ? null : clear));
  sync();
  return { el, get: () => [...sel].sort((a, b) => a - b), set: (t) => { sel.clear(); parseTeeth(t).teeth.forEach((n) => sel.add(n)); sync(); } };
}
