import { h, type Child } from '../lib/dom';
import { fmtMoney } from '../lib/format';
import { guard, input } from '../lib/ui';
import { CURRENCIES, fromCents, type Cur, type Sums } from './calc';

/** Tekrar tıklamaya karşı korumalı eylem düğmesi: iş bitene dek devre dışı (çift kayıt/çift gönderim olmaz). */
export function abtn(text: string, fn: () => Promise<unknown> | void, cls = 'btn', okMsg?: string): HTMLButtonElement {
  const b = h('button', { class: cls, type: 'button' }, text);
  b.addEventListener('click', () => {
    if (b.disabled) return;
    b.disabled = true;
    void guard(async () => { await fn(); }, okMsg).finally(() => { b.disabled = false; });
  });
  return b;
}
export const money = (cents: number, cur: Cur = 'TRY'): string => fmtMoney(fromCents(cents), cur);
/** Çok para birimli toplam: yalnızca sıfırdan farklı olanlar; hiç yoksa ₺0. */
export function fmtSums(s: Sums, always = false): string {
  const parts = CURRENCIES.filter((c) => s[c] !== 0 || (always && c === 'TRY')).map((c) => money(s[c], c));
  return parts.length ? parts.join(' · ') : money(0);
}
export const sumsNode = (s: Sums, cls = ''): Child => h('span', { class: cls }, fmtSums(s));
export const curOptions: [string, string][] = [['TRY', '₺ TRY'], ['USD', '$ USD'], ['EUR', '€ EUR']];
export const trLower = (v: unknown): string => String(v ?? '').toLocaleLowerCase('tr-TR');
export function searchInput(placeholder: string, onInput: (q: string) => void, value = ''): HTMLInputElement {
  const i = input('q', 'search', value, { placeholder, 'aria-label': placeholder });
  i.addEventListener('input', () => onInput(trLower(i.value.trim())));
  return i;
}
/** Metin isteyen küçük pencere yerine tarayıcı istemi (reddetme sebebi vb.). İptal → null. */
export const ask = (msg: string, def = ''): string | null => window.prompt(msg, def);
export const sure = (msg: string): boolean => window.confirm(msg);
export const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);  
