import { h, mount, type Child } from './dom';
import { firebaseErrorMessage } from './checks';

export function toast(msg: string, kind: 'ok' | 'err' = 'ok'): void {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.appendChild(box); }
  const t = h('div', { class: `toast ${kind}` }, msg);
  box.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}
export const errMsg = (e: unknown): string => firebaseErrorMessage(e) ?? (e instanceof Error ? e.message : String(e));
export async function guard(fn: () => Promise<unknown>, okMsg?: string): Promise<boolean> {
  try { await fn(); if (okMsg) toast(okMsg); return true; } catch (e) { toast(errMsg(e), 'err'); return false; }
}

/** Düğmeyi işlem boyunca devre dışı bırakır (çift gönderimi önler). */
export async function withBusy(b: HTMLButtonElement, fn: () => Promise<unknown>, okMsg?: string): Promise<boolean> {
  const old = b.textContent; b.disabled = true;
  try { return await guard(fn, okMsg); } finally { b.disabled = false; b.textContent = old; }
}

export function modal(title: string, body: Child, actions: Child = null, onClose?: () => void): { close: () => void } {
  const back = h('div', { class: 'modal-back', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  const close = () => { if (!back.isConnected) return; document.removeEventListener('keydown', onKey); back.remove(); onClose?.(); };
  document.addEventListener('keydown', onKey);
  back.appendChild(h('div', { class: 'modal' }, h('div', { class: 'modal-h' }, h('b', null, title), h('button', { class: 'btn ghost', on: { click: close } }, '✕')), h('div', { class: 'modal-b' }, body), h('div', { class: 'modal-f' }, actions)));
  document.body.appendChild(back);
  return { close };
}

export interface Col<T> { head: string; cell: (r: T) => Child; cls?: string }
export function table<T>(cols: Col<T>[], rows: T[], empty = 'Kayıt yok'): HTMLElement {
  if (!rows.length) return h('p', { class: 'muted' }, empty);
  return h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
    h('thead', null, h('tr', null, cols.map((c) => h('th', null, c.head)))),
    h('tbody', null, rows.map((r) => h('tr', null, cols.map((c) => h('td', { class: c.cls }, c.cell(r))))))));
}

export const field = (label: string, input: HTMLElement): HTMLElement => h('label', { class: 'field' }, h('span', null, label), input);
export const input = (name: string, type = 'text', value: unknown = '', extra: Record<string, unknown> = {}): HTMLInputElement =>
  h('input', { name, type, value: value == null ? '' : String(value), ...extra });
export const textarea = (name: string, value = ''): HTMLTextAreaElement => h('textarea', { name, rows: 3 }, value);
export function select(name: string, options: [string, string][], value = ''): HTMLSelectElement {
  const s = h('select', { name }, options.map(([v, t]) => h('option', { value: v }, t)));
  s.value = value; return s;
}
export function btn(text: string, onClick: () => void, cls = 'btn'): HTMLButtonElement { return h('button', { class: cls, type: 'button', on: { click: onClick } }, text); }
export const val = (el: HTMLElement, name: string): string => (el.querySelector(`[name="${name}"]`) as HTMLInputElement | null)?.value.trim() ?? '';
export const badge = (text: string, kind = ''): HTMLElement => h('span', { class: `badge ${kind}` }, text);

/** Yazdırma: yeni pencere yok; mevcut sayfada yalnızca #print-area gösterilir (CSS @media print). */
export function printNode(node: HTMLElement): void {
  let area = document.getElementById('print-area');
  if (!area) { area = h('div', { id: 'print-area' }); document.body.appendChild(area); }
  mount(area, node);
  window.print();
}

export function shell(title: string, nav: Child, onLogout: () => void, who: string): { root: HTMLElement; main: HTMLElement } {
  const main = h('main', { class: 'main' });
  const root = h('div', { class: 'shell' },
    h('header', { class: 'top' }, h('b', null, title), h('span', { class: 'grow' }), h('span', { class: 'muted' }, who), h('button', { class: 'btn ghost', on: { click: onLogout } }, 'Çıkış')),
    h('div', { class: 'body' }, h('nav', { class: 'side' }, nav), main));
  return { root, main };
}
