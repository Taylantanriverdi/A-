import { describe, expect, it, vi } from 'vitest';
const fs = vi.hoisted(() => ({ setDoc: vi.fn(async () => undefined), updateDoc: vi.fn(async () => undefined), doc: vi.fn((_d: unknown, p: string, id: string) => ({ p, id })), where: vi.fn((...a: unknown[]) => ({ w: a })) }));
vi.mock('../../src/lib/firebase', () => ({ db: {}, auth: {}, storage: {}, functions: {} }));
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), doc: fs.doc, onSnapshot: vi.fn(), getDoc: vi.fn(), setDoc: fs.setDoc, updateDoc: fs.updateDoc, query: vi.fn(), where: fs.where, serverTimestamp: vi.fn(), writeBatch: vi.fn(), orderBy: vi.fn(), limit: vi.fn(),
}));
import { newId, put, patch, softDelete, hasItem, byField, colPath } from '../../src/lib/store';

const S = { user: { uid: 'u1' }, lab: 'digicad' } as never;
describe('store', () => {
  it('newId: 16 haneli sayısal (Number güvenli aralığı), rastgele son ek değişken', () => {
    const ids = Array.from({ length: 500 }, newId); for (const i of ids) { expect(i).toMatch(/^\d{16}$/); expect(Number.isSafeInteger(Number(i))).toBe(true); }
    expect(new Set(ids.map((i) => i.slice(-3))).size).toBeGreaterThan(100);
  });
  it('colPath', () => { expect(colPath('digicad', 'jobs')).toBe('labs/digicad/jobs'); });
  it('put: updatedBy her zaman, createdBy yalnızca yeni kayıtta; undefined alanlar atılır', async () => {
    await put(S, 'jobs', 5, { a: 1, b: undefined }); const [, body, opt] = fs.setDoc.mock.calls[0] as unknown as [unknown, Record<string, unknown>, unknown];
    expect(body).toMatchObject({ a: 1, updatedBy: 'u1' }); expect('b' in body).toBe(false); expect('createdBy' in body).toBe(false); expect(opt).toEqual({ merge: true });
    await put(S, 'jobs', 6, { a: 1 }, true); expect((fs.setDoc.mock.calls[1] as unknown as [unknown, Record<string, unknown>])[1]).toMatchObject({ createdBy: 'u1' });
  });
  it('patch updatedBy ekler; softDelete fiziksel silme değil', async () => {
    await patch(S, 'jobs', 1, { status: 'x' }); expect((fs.updateDoc.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1]).toMatchObject({ status: 'x', updatedBy: 'u1' });
    await softDelete(S, 'jobs', 1); expect((fs.updateDoc.mock.calls[1] as unknown as [unknown, Record<string, unknown>])[1]).toMatchObject({ deleted: true, deletedBy: 'u1' });
  });
  it('hasItem/byField sorgu kısıtları', () => { hasItem('techIds', '3'); byField('doctorId', '5'); expect(fs.where).toHaveBeenCalledWith('techIds', 'array-contains', '3'); expect(fs.where).toHaveBeenCalledWith('doctorId', '==', '5'); });
});
