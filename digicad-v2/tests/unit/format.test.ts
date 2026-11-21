import { describe, expect, it, vi } from 'vitest';
vi.mock('../../src/lib/firebase', () => ({ db: {}, auth: {}, storage: {}, functions: {} }));
import { withIds, jobTotal } from '../../src/admin/state';
describe('withIds', () => {
  it('eski drId/techId alanlarını koruyup doctorId/techIds ekler', () => {
    const j = withIds({ id: 1, drId: 5, techId: 7, patient: 'x' });
    expect(j).toMatchObject({ drId: 5, techId: 7, doctorId: '5', techIds: ['7'] });
    expect(withIds({ drId: 5, techId: null }).techIds).toEqual([]);
  });
  it('tutar', () => { expect(jobTotal({ id: '1', price: 10, qty: 3 })).toBe(30); });
});
