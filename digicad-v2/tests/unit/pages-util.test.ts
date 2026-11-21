import { describe, expect, it } from 'vitest';
import { filterRows, splitJobs, stageOf, linkedJobs, techStats, composeQuickNote, subStatusLabel, uniqueSorted, array, live } from '../../src/pages/_util';

const J = (o: Record<string, unknown>) => ({ id: String(Math.random()), ...o });
describe('pages/_util', () => {
  it('array/live', () => { expect(array(5)).toEqual([]); expect(array([1])).toEqual([1]); expect(live([J({ deleted: true }), J({})]).length).toBe(1); });
  it('filterRows: Türkçe büyük/küçük harf, hasta/iş/hekim araması ve tarih aralığı', () => {
    const rows = [J({ patient: 'IŞIK', type: 'Zirkonya', drName: 'Ali', dateout: '2026-05-10' }), J({ patient: 'Can', type: 'Kron', drName: 'Veli', dateout: '2026-06-01' }), J({ patient: 'x', dateout: '' })];
    expect(filterRows(rows, { q: 'ışık' }).length).toBe(1); expect(filterRows(rows, { q: 'veli' }).length).toBe(1); expect(filterRows(rows, { q: 'kron' }).length).toBe(1);
    expect(filterRows(rows, { from: '2026-05-15' }).map((r) => r.patient)).toEqual(['Can']); expect(filterRows(rows, { to: '2026-05-31' }).map((r) => r.patient)).toEqual(['IŞIK']);
    expect(filterRows(rows, {}).length).toBe(3);
  });
  it('splitJobs: silinenler dışlanır, devam edenler teslime göre, tamamlananlar yeniden eskiye', () => {
    const { ongoing, done } = splitJobs([J({ patient: 'b', status: 'Bekliyor', dateout: '2026-02-01' }), J({ patient: 'a', status: 'Üretimde', dateout: '2026-01-01' }), J({ patient: 'n', status: 'Bekliyor' }), J({ patient: 'd', status: 'Bekliyor', deleted: true }),
      J({ patient: 'c1', status: 'Tamamlandı', completedAt: '2026-03-01' }), J({ patient: 'c2', status: 'Tamamlandı', completedAt: '2026-04-01' })]);
    expect(ongoing.map((j) => j.patient)).toEqual(['a', 'b', 'n']); expect(done.map((j) => j.patient)).toEqual(['c2', 'c1']);
  });
  it('stageOf: Yeni→onay, Reddedildi, Aktarıldı+işler→üretim/tamam', () => {
    expect(stageOf({ id: '1', status: 'Yeni' }, []).stage).toBe('approval'); expect(stageOf({ id: '1', status: 'Reddedildi' }, []).stage).toBe('rejected');
    expect(stageOf({ id: '1', status: 'Aktarıldı' }, []).stage).toBe('approval');
    const jobs = [J({ sourceDoctorSubmissionId: 1, status: 'Tamamlandı' }), J({ sourceDoctorSubmissionId: '1', status: 'Üretimde' }), J({ sourceDoctorSubmissionId: 2, status: 'Bekliyor' }), J({ sourceDoctorSubmissionId: 1, status: 'Bekliyor', deleted: true })];
    expect(linkedJobs({ id: '1' }, jobs).length).toBe(2);
    expect(stageOf({ id: '1', status: 'Aktarıldı' }, jobs)).toEqual({ stage: 'production', sub: 'Üretimde — 1/2 tamam' });
    expect(stageOf({ id: '1', status: 'Aktarıldı' }, [jobs[0]]).stage).toBe('done');
    expect(linkedJobs({ id: '1' }, [J({ sourceDoctorSubmissionId: null })]).length).toBe(0);
  });
  it('techStats geciken/bugün/tamamlanan', () => {
    const jobs = [J({ status: 'Bekliyor', dateout: '2026-01-01' }), J({ status: 'Bekliyor', dateout: '2026-06-10' }), J({ status: 'Bekliyor', dateout: '2026-07-01' }), J({ status: 'Tamamlandı', dateout: '2026-01-01' }), J({ status: 'Bekliyor', deleted: true, dateout: '2026-01-01' })];
    expect(techStats(jobs, '2026-06-10')).toEqual({ total: 3, overdue: 1, today: 1, done: 1 });
  });
  it('composeQuickNote: şemada olmayan alanlar nota eklenir, 5000 ile sınırlı', () => {
    expect(composeQuickNote({ note: ' acil ', teeth: [11, 12], color: 'A2' })).toBe('Dişler: 11,12 | Renk: A2 | acil'); expect(composeQuickNote({})).toBe(''); expect(composeQuickNote({ note: 'x'.repeat(6000) }).length).toBe(5000);
  });
  it('subStatusLabel/uniqueSorted', () => { expect(subStatusLabel({ id: '1', status: 'Yeni', seenAt: 'x' })).toMatch(/incelendi/); expect(subStatusLabel({ id: '1', status: 'Aktarıldı' })).toBe('Aktarıldı'); expect(uniqueSorted(['b', 'a', '', null, 'b', 'ç'])).toEqual(['a', 'b', 'ç']); });
});
