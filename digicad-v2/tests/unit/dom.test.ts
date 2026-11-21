// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { h, safeUrl, safeFileName, mount, link } from '../../src/lib/dom';

describe('h() XSS koruması', () => {
  const evil = `x');alert(1)//`;
  it('eski açık: dosya adı metin olarak çizilir, öznitelik/olay üretmez', () => {
    const el = h('div', null, h('button', null, `📎 ${evil}`));
    expect(el.innerHTML).not.toContain('onclick');
    expect(el.querySelector('button')!.textContent).toContain(evil);
    expect(el.querySelectorAll('script').length).toBe(0);
  });
  it('HTML etiketi içeren veri etiket olmaz', () => {
    const el = h('p', null, '<img src=x onerror=alert(1)><script>alert(1)</script>');
    expect(el.querySelector('img')).toBeNull(); expect(el.querySelector('script')).toBeNull();
    expect(el.textContent).toContain('<img');
  });
  it('on* ve style öznitelikleri reddedilir', () => {
    expect(() => h('div', { onclick: 'alert(1)' })).toThrow();
    expect(() => h('div', { onerror: 'x' })).toThrow();
    expect(() => h('div', { style: 'x' })).toThrow();
    expect(() => h('iframe', { srcdoc: '<script>' })).toThrow();
  });
  it('olaylar addEventListener ile bağlanır', () => {
    let n = 0; const b = h('button', { on: { click: () => { n++; } } }, 'x'); b.click(); expect(n).toBe(1); expect(b.getAttribute('onclick')).toBeNull();
  });
  it('javascript:/data: URL engellenir', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('#'); expect(safeUrl(' JaVaScRiPt:alert(1)')).toBe('#');
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('#'); expect(safeUrl('//evil.com')).toBe('#');
    expect(safeUrl('https://ok.example/a')).toBe('https://ok.example/a');
    expect(h('a', { href: 'javascript:alert(1)' }).getAttribute('href')).toBe('#');
    expect(link('javascript:1', 'x').rel).toContain('noopener');
  });
  it('dosya adı temizlenir', () => {
    expect(safeFileName('../../etc/passwd')).not.toContain('/'); expect(safeFileName('a\u0000b\\c')).toBe('a_b_c'); expect(safeFileName('')).toBe('dosya');
  });
  it('mount eski içeriği temizler; null/false atlanır', () => {
    const r = h('div', null, 'eski'); mount(r, null, false, 'yeni', 0); expect(r.textContent).toBe('yeni0');
  });
});
