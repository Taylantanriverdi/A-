import { h, type Child } from '../lib/dom';
import { printNode, table, type Col } from '../lib/ui';

/** Yazdırma çıktısı: başlık, alt başlık, (varsa) özet satırları ve tablo. Sayfada yalnızca #print-area basılır. */
export function printReport<T>(title: string, sub: string, cols: Col<T>[], rows: T[], summary: Child[] = []): void {
  printNode(h('div', { class: 'print-doc' }, h('h2', null, title), sub ? h('p', { class: 'muted' }, sub) : null, table(cols, rows, 'Kayıt yok'), summary.length ? h('div', { class: 'print-sum' }, summary.map((s) => h('p', null, s))) : null,
    h('p', { class: 'muted' }, `Yazdırma: ${new Date().toLocaleString('tr-TR')}`)));
}
