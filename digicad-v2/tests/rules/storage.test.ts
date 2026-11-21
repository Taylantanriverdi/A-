import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';

let env: RulesTestEnvironment;
const bytes = new Uint8Array([1, 2, 3]);
const meta = (t: string) => ({ contentType: t });

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-digicad',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
    storage: { rules: readFileSync('storage.rules', 'utf8') },
  });
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), 'labs/digicad/jobs/100'), { doctorId: '1', techIds: ['7'], status: 'Bekliyor' });
    await uploadBytes(ref(c.storage(), 'labs/digicad/jobFiles/100/a.zip'), bytes, meta('application/zip'));
    await uploadBytes(ref(c.storage(), 'labs/digicad/submissions/1/s.zip'), bytes, meta('application/zip'));
  });
});
afterAll(async () => { await env.cleanup(); });

const st = (uid: string, claims: Record<string, unknown>) => env.authenticatedContext(uid, claims).storage();
const drA = () => st('dA', { role: 'doctor', doctorId: '1', lab: 'digicad' });
const drB = () => st('dB', { role: 'doctor', doctorId: '2', lab: 'digicad' });
const tech = () => st('t1', { role: 'tech', techId: '7', lab: 'digicad' });
const tech2 = () => st('t2', { role: 'tech', techId: '8', lab: 'digicad' });
const admin = () => st('adm', { role: 'admin', lab: 'digicad', firebase: { sign_in_second_factor: 'totp' } });

describe('Storage kuralları', () => {
  it('anonim okuyamaz/yazamaz', async () => {
    const s = env.unauthenticatedContext().storage();
    await assertFails(getBytes(ref(s, 'labs/digicad/jobFiles/100/a.zip')));
    await assertFails(uploadBytes(ref(s, 'labs/digicad/jobFiles/100/b.zip'), bytes, meta('application/zip')));
  });
  it('hekim kendi işinin dosyasını okur, başkası okuyamaz', async () => {
    await assertSucceeds(getBytes(ref(drA(), 'labs/digicad/jobFiles/100/a.zip')));
    await assertFails(getBytes(ref(drB(), 'labs/digicad/jobFiles/100/a.zip')));
  });
  it('atanmış teknisyen yükler, atanmamış yükleyemez', async () => {
    await assertSucceeds(uploadBytes(ref(tech(), 'labs/digicad/jobFiles/100/t.zip'), bytes, meta('application/zip')));
    await assertFails(uploadBytes(ref(tech2(), 'labs/digicad/jobFiles/100/t2.zip'), bytes, meta('application/zip')));
  });
  it('MIME sınırı: çalıştırılabilir/html reddedilir', async () => {
    await assertFails(uploadBytes(ref(admin(), 'labs/digicad/jobFiles/100/x.html'), bytes, meta('text/html')));
    await assertFails(uploadBytes(ref(admin(), 'labs/digicad/jobFiles/100/x.exe'), bytes, meta('application/x-msdownload')));
  });
  it('hekim yalnızca kendi gönderim klasörüne yükler', async () => {
    await assertSucceeds(uploadBytes(ref(drA(), 'labs/digicad/submissions/1/y.zip'), bytes, meta('application/zip')));
    await assertFails(uploadBytes(ref(drA(), 'labs/digicad/submissions/2/y.zip'), bytes, meta('application/zip')));
    await assertFails(getBytes(ref(drB(), 'labs/digicad/submissions/1/s.zip')));
  });
  it('üzerine yazma ve silme reddedilir (admin dahil)', async () => {
    await assertFails(uploadBytes(ref(admin(), 'labs/digicad/jobFiles/100/a.zip'), bytes, meta('application/zip')));
    await assertFails(deleteObject(ref(admin(), 'labs/digicad/jobFiles/100/a.zip')));
  });
  it('sohbet ekleri yalnızca ilgili thread', async () => {
    await assertSucceeds(uploadBytes(ref(drA(), 'labs/digicad/chat/dr_1/p.png'), bytes, meta('image/png')));
    await assertFails(uploadBytes(ref(drA(), 'labs/digicad/chat/dr_2/p.png'), bytes, meta('image/png')));
    await assertFails(uploadBytes(ref(drA(), 'labs/digicad/chat/dr_1/p.zip'), bytes, meta('application/zip')));
  });
});
