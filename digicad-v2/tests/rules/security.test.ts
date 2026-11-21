import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteField } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';

// Denetim turunda bulunan açıkların regresyon testleri (Firestore + Storage).
let env: RulesTestEnvironment;
const L = 'labs/digicad';
const MFA = { firebase: { sign_in_second_factor: 'totp' } };
const fs = (uid: string, claims: Record<string, unknown>) => env.authenticatedContext(uid, claims).firestore();
const admin = () => fs('adm', { role: 'admin', lab: 'digicad', ...MFA });
const adminNoMfa = () => fs('adm', { role: 'admin', lab: 'digicad' });
const adminOtherLab = () => fs('adm2', { role: 'admin', lab: 'primer', ...MFA });
const drA = () => fs('dA', { role: 'doctor', doctorId: '1', lab: 'digicad' });
const drEmpty = () => fs('dE', { role: 'doctor', doctorId: '', lab: 'digicad' });
const tech = () => fs('t1', { role: 'tech', techId: '7', lab: 'digicad' });
const techEmpty = () => fs('tE', { role: 'tech', techId: '', lab: 'digicad' });
const bytes = new Uint8Array([1, 2, 3]);
const zip = { contentType: 'application/zip' };
const st = (uid: string, claims: Record<string, unknown>) => env.authenticatedContext(uid, claims).storage();

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-digicad',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
    storage: { rules: readFileSync('storage.rules', 'utf8') },
  });
});
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `${L}/jobs/100`), { doctorId: '1', techIds: ['7'], status: 'Bekliyor', patient: 'Ornek A', createdAt: 'c0', createdBy: 'adm', designFiles: [{ name: 'a' }], techNote: 'n' });
    await setDoc(doc(db, `${L}/jobs/102`), { doctorId: '1', techIds: ['7'], status: 'Tamamlandı', patient: 'Bitmis' });
    await setDoc(doc(db, `${L}/jobs/103`), { doctorId: '1', techIds: ['7'], status: 'Bekliyor', patient: 'Silinmis', deleted: true, deletedAt: 'x' });
    await setDoc(doc(db, `${L}/jobs/104`), { doctorId: '', techIds: [''], status: 'Bekliyor', patient: 'Bos hekim' });
    await setDoc(doc(db, `${L}/doctors/1`), { name: 'Dr Bir', authUid: 'dA' });
    await setDoc(doc(db, `${L}/pendingJobs/p1`), { techId: '7', status: 'Onay Bekliyor', patient: 'P', drName: 'X', createdAt: 'c0' });
    await setDoc(doc(db, `${L}/threads/dr_1/messages/m1`), { text: 'selam', senderUid: 'dA', senderRole: 'doctor' });
  });
});

describe('Yetki: yönetici MFA ve lab izolasyonu', () => {
  it('MFA olmayan admin token ı okuyamaz/yazamaz', async () => {
    await assertFails(getDoc(doc(adminNoMfa(), `${L}/jobs/100`)));
    await assertFails(updateDoc(doc(adminNoMfa(), `${L}/jobs/100`), { note: 'x', updatedBy: 'adm' }));
  });
  it('başka lab ın admini digicad verisine erişemez', async () => {
    await assertFails(getDoc(doc(adminOtherLab(), `${L}/jobs/100`)));
    await assertFails(getDoc(doc(adminOtherLab(), `${L}/payments/1`)));
    await assertFails(updateDoc(doc(adminOtherLab(), `${L}/jobs/100`), { note: 'x', updatedBy: 'adm2' }));
  });
  it('boş doctorId/techId claim i boş alanlı kayıtla eşleşmez', async () => {
    await assertFails(getDoc(doc(drEmpty(), `${L}/jobs/104`)));
    await assertFails(getDoc(doc(techEmpty(), `${L}/jobs/104`)));
  });
});

describe('Veri bütünlüğü: admin yazımları', () => {
  it('updatedBy başkasının uid i olamaz (denetim izi sahteciliği)', async () => {
    await assertFails(updateDoc(doc(admin(), `${L}/jobs/100`), { note: 'x', updatedBy: 'baskasi' }));
    await assertFails(updateDoc(doc(admin(), `${L}/jobs/100`), { note: 'x' }));
    await assertSucceeds(updateDoc(doc(admin(), `${L}/jobs/100`), { note: 'x', updatedBy: 'adm' }));
  });
  it('set() ile (merge olmadan) mevcut alanlar silinemez', async () => {
    await assertFails(setDoc(doc(admin(), `${L}/jobs/100`), { doctorId: '1', status: 'Bekliyor', updatedBy: 'adm' }));
    await assertFails(setDoc(doc(admin(), `${L}/doctors/1`), { name: 'Dr Bir', updatedBy: 'adm' }));
  });
  it('deleteField() ile alan kaldırılamaz', async () => {
    await assertFails(updateDoc(doc(admin(), `${L}/jobs/100`), { patient: deleteField(), updatedBy: 'adm' }));
    await assertFails(updateDoc(doc(admin(), `${L}/doctors/1`), { authUid: deleteField(), updatedBy: 'adm' }));
  });
  it('createdAt/createdBy değiştirilemez', async () => {
    await assertFails(updateDoc(doc(admin(), `${L}/jobs/100`), { createdBy: 'x', updatedBy: 'adm' }));
    await assertFails(updateDoc(doc(admin(), `${L}/jobs/100`), { createdAt: 'x', updatedBy: 'adm' }));
  });
  it('yumuşak silme ve geri alma yalnızca admin (geri alınabilir)', async () => {
    await assertFails(updateDoc(doc(drA(), `${L}/jobs/103`), { deleted: false, deletedAt: null }));
    await assertFails(updateDoc(doc(tech(), `${L}/jobs/103`), { deleted: false, deletedAt: null, updatedBy: 't1' }));
    await assertSucceeds(updateDoc(doc(admin(), `${L}/jobs/103`), { deleted: false, deletedAt: null, deletedBy: null, updatedBy: 'adm' }));
  });
  it('deleted alanı bool olmak zorunda', async () => {
    await assertFails(updateDoc(doc(admin(), `${L}/jobs/100`), { deleted: 'evet', updatedBy: 'adm' }));
  });
  it('finans kaydı da alan kaybettirilemez / sahte updatedBy', async () => {
    await env.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), `${L}/payments/9`), { doctorId: '1', amount: 5, createdAt: 'c' }); });
    await assertFails(setDoc(doc(admin(), `${L}/payments/9`), { amount: 6, updatedBy: 'adm' }));
    await assertFails(updateDoc(doc(admin(), `${L}/payments/9`), { amount: 6, updatedBy: 'baskasi' }));
    await assertSucceeds(updateDoc(doc(admin(), `${L}/payments/9`), { amount: 6, updatedBy: 'adm' }));
  });
});

describe('Teknisyen: alan ve durum sınırları', () => {
  it('status/techNote/designFiles alanlarını silemez', async () => {
    await assertFails(updateDoc(doc(tech(), `${L}/jobs/100`), { status: deleteField(), updatedBy: 't1' }));
    await assertFails(updateDoc(doc(tech(), `${L}/jobs/100`), { techNote: deleteField(), updatedBy: 't1' }));
    await assertFails(updateDoc(doc(tech(), `${L}/jobs/100`), { designFiles: deleteField(), updatedBy: 't1' }));
  });
  it('mevcut tasarım dosyası kayıtlarını kısaltamaz/değiştiremez', async () => {
    await assertFails(updateDoc(doc(tech(), `${L}/jobs/100`), { designFiles: [], updatedBy: 't1' }));
    await assertSucceeds(updateDoc(doc(tech(), `${L}/jobs/100`), { designFiles: [{ name: 'a' }, { name: 'b' }], updatedBy: 't1' }));
  });
  it('designFiles/techNote tip denetimi', async () => {
    await assertFails(updateDoc(doc(tech(), `${L}/jobs/100`), { designFiles: 'x', updatedBy: 't1' }));
    await assertFails(updateDoc(doc(tech(), `${L}/jobs/100`), { techNote: 'a'.repeat(5001), updatedBy: 't1' }));
  });
  it('Tamamlandı işi yeniden açamaz / not ekleyemez', async () => {
    await assertFails(updateDoc(doc(tech(), `${L}/jobs/102`), { status: 'Bekliyor', updatedBy: 't1' }));
    await assertFails(updateDoc(doc(tech(), `${L}/jobs/102`), { techNote: 'x', updatedBy: 't1' }));
  });
  it('silinmiş (çöp kutusundaki) işi güncelleyemez', async () => {
    await assertFails(updateDoc(doc(tech(), `${L}/jobs/103`), { techNote: 'x', updatedBy: 't1' }));
  });
  it('updatedBy sahteciliği yapamaz', async () => {
    await assertFails(updateDoc(doc(tech(), `${L}/jobs/100`), { techNote: 'x', updatedBy: 'adm' }));
    await assertFails(updateDoc(doc(tech(), `${L}/jobs/100`), { techNote: 'x' }));
  });
  it('bekleyen işe fazladan alan / sahte createdBy ekleyemez', async () => {
    const ok = { techId: '7', status: 'Onay Bekliyor', patient: 'P', createdBy: 't1', updatedBy: 't1' };
    await assertSucceeds(setDoc(doc(tech(), `${L}/pendingJobs/n1`), ok));
    await assertFails(setDoc(doc(tech(), `${L}/pendingJobs/n2`), { ...ok, price: 9999 }));
    await assertFails(setDoc(doc(tech(), `${L}/pendingJobs/n3`), { ...ok, techIds: ['7'], doctorId: '2' }));
    await assertFails(setDoc(doc(tech(), `${L}/pendingJobs/n4`), { ...ok, createdBy: 'admin-uid' }));
    await assertFails(setDoc(doc(tech(), `${L}/pendingJobs/p1`), ok)); // mevcut kaydı ezemez (update=admin)
  });
  it('bekleyen iş kaydında admin alan kaybettiremez', async () => {
    await assertFails(setDoc(doc(admin(), `${L}/pendingJobs/p1`), { status: 'Onaylandı', updatedBy: 'adm' }));
    await assertSucceeds(updateDoc(doc(admin(), `${L}/pendingJobs/p1`), { status: 'Onaylandı', updatedBy: 'adm' }));
  });
});

describe('Hekim gönderimi: sahiplik', () => {
  const ok = { id: 's1', doctorId: '1', drId: '1', status: 'Yeni', createdBy: 'dA', updatedBy: 'dA', patient: 'P', jobType: 'Kron', files: [] };
  it('drId başka hekimi gösteremez (siparişe aktarmada kaydı çalma)', async () => {
    await assertSucceeds(setDoc(doc(drA(), `${L}/doctorSubmissions/s1`), ok));
    await assertFails(setDoc(doc(drA(), `${L}/doctorSubmissions/s2`), { ...ok, drId: '2' }));
  });
  it('fazladan/yetkisiz alan eklenemez', async () => {
    await assertFails(setDoc(doc(drA(), `${L}/doctorSubmissions/s3`), { ...ok, price: 0 }));
    await assertFails(setDoc(doc(drA(), `${L}/doctorSubmissions/s4`), { ...ok, deleted: true }));
  });
  it('alan tipleri: teeth liste, jobType uzunluk', async () => {
    await assertFails(setDoc(doc(drA(), `${L}/doctorSubmissions/s5`), { ...ok, teeth: 'x' }));
    await assertFails(setDoc(doc(drA(), `${L}/doctorSubmissions/s6`), { ...ok, jobType: 'a'.repeat(201) }));
    await assertFails(setDoc(doc(drA(), `${L}/doctorSubmissions/s7`), { ...ok, notes: 'a'.repeat(5001) }));
  });
  it('updatedBy sahte olamaz', async () => {
    await assertFails(setDoc(doc(drA(), `${L}/doctorSubmissions/s8`), { ...ok, updatedBy: 'baskasi' }));
  });
});

describe('Mesajlaşma: alan kısıtları', () => {
  const msg = { text: 'merhaba', senderUid: 'dA', senderRole: 'doctor', timestamp: 't' };
  it('thread belgesine keyfi alan yazılamaz', async () => {
    await assertSucceeds(setDoc(doc(drA(), `${L}/threads/dr_1`), { updatedAt: 'x' }, { merge: true }));
    await assertFails(setDoc(doc(drA(), `${L}/threads/dr_1`), { updatedAt: 'x', isAdminThread: true }, { merge: true }));
  });
  it('mesaja fazladan alan (deletedAt dahil) eklenemez', async () => {
    await assertSucceeds(setDoc(doc(drA(), `${L}/threads/dr_1/messages/ok1`), msg));
    await assertFails(setDoc(doc(drA(), `${L}/threads/dr_1/messages/x1`), { ...msg, deletedAt: 'x' }));
    await assertFails(setDoc(doc(drA(), `${L}/threads/dr_1/messages/x2`), { ...msg, junk: 'x' }));
  });
  it('ek dosya yolu yalnızca kendi thread klasörü', async () => {
    await assertSucceeds(setDoc(doc(drA(), `${L}/threads/dr_1/messages/f1`), { ...msg, filePath: 'labs/digicad/chat/dr_1/a.png', fileName: 'a.png' }));
    await assertFails(setDoc(doc(drA(), `${L}/threads/dr_1/messages/f2`), { ...msg, filePath: 'labs/digicad/chat/dr_2/a.png' }));
    await assertFails(setDoc(doc(drA(), `${L}/threads/dr_1/messages/f3`), { ...msg, filePath: 'labs/digicad/jobFiles/100/a.zip' }));
  });
  it('mevcut mesaj üzerine yazılamaz; hekim güncelleyemez', async () => {
    await assertFails(setDoc(doc(drA(), `${L}/threads/dr_1/messages/m1`), msg));
    await assertFails(updateDoc(doc(drA(), `${L}/threads/dr_1/messages/m1`), { deletedAt: 'x', deletedBy: 'dA' }));
  });
  it('admin mesajı yalnızca kendi uid iyle yumuşak siler/geri alır', async () => {
    await assertFails(updateDoc(doc(admin(), `${L}/threads/dr_1/messages/m1`), { deletedAt: 'x', deletedBy: 'baskasi' }));
    await assertSucceeds(updateDoc(doc(admin(), `${L}/threads/dr_1/messages/m1`), { deletedAt: 'x', deletedBy: 'adm' }));
    await assertSucceeds(updateDoc(doc(admin(), `${L}/threads/dr_1/messages/m1`), { deletedAt: null, deletedBy: null }));
  });
});

describe('Storage: MFA, lab izolasyonu, silinmiş/tamamlanmış iş', () => {
  beforeAll(async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      const db = c.firestore();
      await setDoc(doc(db, `${L}/jobs/100`), { doctorId: '1', techIds: ['7'], status: 'Bekliyor' });
      await setDoc(doc(db, `${L}/jobs/102`), { doctorId: '1', techIds: ['7'], status: 'Tamamlandı' });
      await setDoc(doc(db, `${L}/jobs/103`), { doctorId: '1', techIds: ['7'], status: 'Bekliyor', deleted: true });
      await setDoc(doc(db, `${L}/jobs/104`), { doctorId: '', techIds: [''], status: 'Bekliyor' });
    });
  });
  it('MFA siz admin ve başka lab admini yükleyemez', async () => {
    await assertFails(uploadBytes(ref(st('a', { role: 'admin', lab: 'digicad' }), 'labs/digicad/jobFiles/100/m1.zip'), bytes, zip));
    await assertFails(uploadBytes(ref(st('a2', { role: 'admin', lab: 'primer', ...MFA }), 'labs/digicad/jobFiles/100/m2.zip'), bytes, zip));
    await assertSucceeds(uploadBytes(ref(st('a3', { role: 'admin', lab: 'digicad', ...MFA }), 'labs/digicad/jobFiles/100/m3.zip'), bytes, zip));
  });
  it('teknisyen tamamlanmış veya çöpteki işe dosya yükleyemez', async () => {
    const t = st('t1', { role: 'tech', techId: '7', lab: 'digicad' });
    await assertFails(uploadBytes(ref(t, 'labs/digicad/jobFiles/102/t.zip'), bytes, zip));
    await assertFails(uploadBytes(ref(t, 'labs/digicad/jobFiles/103/t.zip'), bytes, zip));
    await assertSucceeds(uploadBytes(ref(t, 'labs/digicad/jobFiles/100/sec_t.zip'), bytes, zip));
  });
  it('boş claim boş alanlı işin dosyasına erişemez', async () => {
    await assertFails(uploadBytes(ref(st('tE', { role: 'tech', techId: '', lab: 'digicad' }), 'labs/digicad/jobFiles/104/t.zip'), bytes, zip));
    await assertFails(uploadBytes(ref(st('dE', { role: 'doctor', doctorId: '', lab: 'digicad' }), 'labs/digicad/submissions//t.zip'), bytes, zip));
  });
  it('SVG/JS içerik türleri reddedilir, sohbet 25 MB sınırı', async () => {
    const a = st('a3', { role: 'admin', lab: 'digicad', ...MFA });
    await assertFails(uploadBytes(ref(a, 'labs/digicad/jobFiles/100/x.svg'), bytes, { contentType: 'image/svg+xml' }));
    await assertFails(uploadBytes(ref(a, 'labs/digicad/jobFiles/100/x.js'), bytes, { contentType: 'application/javascript' }));
    await assertFails(uploadBytes(ref(a, 'labs/digicad/chat/dr_1/big.png'), new Uint8Array(26 * 1024 * 1024), { contentType: 'image/png' }));
  });
});
