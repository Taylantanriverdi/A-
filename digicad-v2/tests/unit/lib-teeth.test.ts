// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { parseTeeth, jawOf, jawLabel, toothPicker, ALL_TEETH, UPPER_TEETH, LOWER_TEETH } from '../../src/lib/teeth';

describe('FDI', () => {
  it('32 diş, üst ve alt ayrık', () => { expect(ALL_TEETH.length).toBe(32); expect(UPPER_TEETH.length).toBe(16); expect(new Set(ALL_TEETH).size).toBe(32); expect(UPPER_TEETH.slice(0, 3)).toEqual([18, 17, 16]); expect(LOWER_TEETH.slice(8, 10)).toEqual([31, 32]); });
  it('parseTeeth geçersizleri ve tekrarları atar', () => { expect(parseTeeth('21, 11;12 11 99 0 x 49 18')).toEqual([11, 12, 18, 21]); expect(parseTeeth('')).toEqual([]); });
  it('jawOf', () => { expect(jawOf([11, 12])).toBe('ust'); expect(jawOf([31])).toBe('alt'); expect(jawOf([11, 31])).toBe('her'); expect(jawOf([])).toBe(''); expect(jawLabel('her')).toMatch(/iki/); expect(jawLabel('?')).toBe(''); });
});
describe('toothPicker', () => {
  it('tıklama seçer/kaldırır, onChange çağrılır, hızlı düğmeler çalışır', () => {
    const sel = new Set<number>(); const onChange = vi.fn(); const el = toothPicker(sel, onChange);
    const b11 = [...el.querySelectorAll('button.tooth')].find((b) => b.textContent === '11') as HTMLButtonElement;
    b11.click(); expect([...sel]).toEqual([11]); expect(b11.classList.contains('on')).toBe(true); expect(b11.getAttribute('aria-pressed')).toBe('true');
    b11.click(); expect(sel.size).toBe(0);
    const quick = (t: string) => ([...el.querySelectorAll('button:not(.tooth)')].find((b) => b.textContent === t) as HTMLButtonElement).click();
    quick('Üst çene'); expect(sel.size).toBe(16); quick('Alt çene'); expect(sel.size).toBe(32); quick('Temizle'); expect(sel.size).toBe(0);
    expect(onChange).toHaveBeenCalledTimes(5);
  });
});
