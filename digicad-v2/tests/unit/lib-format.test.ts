// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isoToLocalDate, todayLocal, monthLocal, isOverdue, statusLabel, statusOptions, normStatus, isKnownStatus, safeName, uniqueNames, jobInfoText, JOB_STATUSES, TECH_STATUSES } from '../../src/lib/format';
import { parseTeethDetailed, formatTeeth, toothChart, FDI } from '../../src/lib/teeth';
import * as calc from '../../src/admin/calc';

describe('Europe/Istanbul tarih yardımcıları (src/lib/format.ts)', () => {
  it('UTC gece yarısına yakın an İstanbul yerel gününe çevrilir (UTC kayması yok)', () => {
    expect(isoToLocalDate('2026-03-01T22:30:00Z')).toBe('2026-03-02'); // 01:30 İstanbul
    expect(isoToLocalDate('2026-03-01T20:59:00Z')).toBe('2026-03-01');
    expect(isoToLocalDate('2026-03-05')).toBe('2026-03-05'); expect(isoToLocalDate('')).toBe(''); expect(isoToLocalDate('abc')).toBe('');
    expect(todayLocal(new Date('2026-12-31T21:30:00Z'))).toBe('2027-01-01'); expect(monthLocal('2026-12-31T21:30:00Z')).toBe('2027-01');
  });
  it('admin/calc aynı yardımcıları yeniden dışa açar (tek kaynak)', () => {
    expect(calc.isoToLocalDate).toBe(isoToLocalDate); expect(calc.todayLocal).toBe(todayLocal); expect(calc.safeName).toBe(safeName); expect(calc.uniqueNames).toBe(uniqueNames); expect(calc.jobInfoText).toBe(jobInfoText);
  });
  it('isOverdue: yalnızca YYYY-AA-GG biçimli teslim tarihi; eski gg.aa.yyyy biçimi yanlışlıkla gecikmiş sayılmaz', () => {
    expect(isOverdue('2020-01-01', '2026-01-01')).toBe(true); expect(isOverdue('2030-01-01', '2026-01-01')).toBe(false);
    expect(isOverdue('01.03.2025', '2026-01-01')).toBe(false); expect(isOverdue(undefined)).toBe(false);
  });
});

describe('eski durum değerleri', () => {
  it("'Bekleyen' kanonik 'Bekliyor'a eşlenir; bilinmeyen değer çökmeden gösterilir", () => {
    expect(normStatus('Bekleyen')).toBe('Bekliyor'); expect(normStatus('Gönderildi')).toBe('Gönderildi'); expect(normStatus(undefined)).toBe('');
    expect(statusLabel('Bekleyen')).toContain('Bekleyen'); expect(statusLabel('Gönderildi')).toBe('• Gönderildi'); expect(statusLabel('')).toBe('—'); expect(statusLabel(null)).toBe('—');
    expect(isKnownStatus('Bekliyor')).toBe(true); expect(isKnownStatus('Gönderildi')).toBe(false);
  });
  it('statusOptions: bilinmeyen mevcut değer başa eklenir; bilinen için fazladan seçenek yok', () => {
    expect(statusOptions('Bekliyor').map(([v]) => v)).toEqual([...JOB_STATUSES]);
    const o = statusOptions('Gönderildi'); expect(o[0][0]).toBe('Gönderildi'); expect(o[0][1]).toContain('(eski)'); expect(o.length).toBe(JOB_STATUSES.length + 1);
    expect(statusOptions('Tamamlandı', TECH_STATUSES)[0][0]).toBe('Tamamlandı');
  });
});

describe('diş şeması (tek kaynak: src/lib/teeth.ts)', () => {
  it('süt dişleri geçerli, geçersizler rest olarak döner; formatTeeth', () => {
    expect(parseTeethDetailed('11 12, 55;99 x')).toEqual({ teeth: [11, 12, 55], rest: ['99', 'x'] }); expect(formatTeeth([21, '11'])).toBe('11, 21');
    expect(calc.parseTeeth).toBe(parseTeethDetailed); expect(calc.FDI).toBe(FDI);
  });
  it('toothChart: seçer/temizler, readonly düğmeleri kapalı', () => {
    const seen: number[][] = []; const c = toothChart([11], (t) => seen.push(t));
    const b = (n: string) => [...c.el.querySelectorAll('button.tooth')].find((x) => x.textContent === n) as HTMLButtonElement;
    b('12').click(); expect(c.get()).toEqual([11, 12]); expect(seen.at(-1)).toEqual([11, 12]);
    c.set([21]); expect(c.get()).toEqual([21]); (c.el.querySelector('.btn.ghost') as HTMLButtonElement).click(); expect(c.get()).toEqual([]);
    const ro = toothChart([11], undefined, true); expect((ro.el.querySelector('button.tooth') as HTMLButtonElement).disabled).toBe(true);
  });
});
