import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where } from 'firebase/firestore';

let env: RulesTestEnvironment;
const L = 'labs/digicad';

const MFA = { firebase: { sign_in_second_factor: 'totp' } };
const admin = () => env.authenticatedContext('adm', { role: 'admin', lab: 'digicad', ...MFA }).firestore();
const drA = () => env.authenticatedContext('dA', { role: 'doctor', doctorId: '1', lab: 'digicad' }).firestore();
const drB = () => env.authenticatedContext('dB', { role: 'doctor', doctorId: '2', lab: 'digicad' }).firestore();
const tech = () => env.authenticatedContext('t1', { role: 'tech', techId: '7', lab: 'digicad' }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const noRole = () => env.authenticatedContext('x', {}).firestore();

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-digicad',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `${L}/jobs/100`), { doctorId: '1', techIds: ['7'], status: 'Bekliyor', patient: 'Ornek A' });
    await setDoc(doc(db, `${L}/jobs/101`), { doctorId: '2', techIds: ['8'], status: 'Bekliyor', patient: 'Ornek B' });
    await setDoc(doc(db, `${L}/payments/1`), { doctorId: '1', amount: 10 });
    await setDoc(doc(db, `${L}/doctors/1`), { name: 'Dr Bir' });
    await setDoc(doc(db, `${L}/doctors/2`), { name: 'Dr Iki' });
    await setDoc(doc(db, `${L}/auditLog/a1`), { x: 1 });
  });
});

describe('Firestore: kimlik doğrulama', () => {
  it('anonim/yetkisiz okuyamaz', async () => {
    await assertFails(getDoc(doc(anon(), `${L}/jobs/100`)));
    await assertFails(getDoc(doc(noRole(), `${L}/jobs/100`)));
  });
  it('anonim yazamaz', async () => {
    await assertFails(setDoc(doc(anon(), `${L}/jobs/9`), { doctorId: '1', status: 'Bekliyor' }));
  });
  it('tanımsız koleksiyon reddedilir (admin dahil)', async () => {
    await assertFails(setDoc(doc(admin(), `${L}/bilinmeyen/1`), { a: 1 }));
  });
});

describe('Firestore: hekim izolasyonu', () => {
  it('hekim kendi işini okur', async () => { await assertSucceeds(getDoc(doc(drA(), `${L}/jobs/100`))); });
  it('hekim başka hekimin işini okuyamaz', async () => { await assertFails(getDoc(doc(drA(), `${L}/jobs/101`))); });
  it('hekim filtresiz iş listesi çekemez, filtreli çeker', async () => {
    await assertFails(getDocs(collection(drA(), `${L}/jobs`)));
    await assertSucceeds(getDocs(query(collection(drA(), `${L}/jobs`), where('doctorId', '==', '1'))));
  });
  it('hekim iş yazamaz/güncelleyemez', async () => {
    await assertFails(updateDoc(doc(drA(), `${L}/jobs/100`), { status: 'Tamamlandı' }));
    await assertFails(setDoc(doc(drA(), `${L}/jobs/5`), { doctorId: '1', status: 'Bekliyor' }));
  });
  it('hekim finansı okuyamaz', async () => {
    await assertFails(getDoc(doc(drA(), `${L}/payments/1`)));
  });
  it('hekim başka hekimin profilini okuyamaz', async () => {
    await assertSucceeds(getDoc(doc(drA(), `${L}/doctors/1`)));
    await assertFails(getDoc(doc(drA(), `${L}/doctors/2`)));
  });
  it('hekim yalnızca kendi adına gönderim oluşturur', async () => {
    const ok = { doctorId: '1', status: 'Yeni', createdBy: 'dA', updatedBy: 'dA', patient: 'Ornek', files: [] };
    await assertSucceeds(setDoc(doc(drA(), `${L}/doctorSubmissions/s1`), ok));
    await assertFails(setDoc(doc(drB(), `${L}/doctorSubmissions/s2`), ok));
    await assertFails(setDoc(doc(drA(), `${L}/doctorSubmissions/s3`), { ...ok, status: 'Aktarıldı' }));
  });
  it('hekim başkasının gönderimini okuyamaz', async () => {
    await env.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), `${L}/doctorSubmissions/s9`), { doctorId: '2', status: 'Yeni' }); });
    await assertFails(getDoc(doc(drA(), `${L}/doctorSubmissions/s9`)));
  });
  it('hekim yalnızca kendi thread inde mesajlaşır', async () => {
    const msg = (uid: string) => ({ text: 'merhaba', senderUid: uid, senderRole: 'doctor' });
    await assertSucceeds(setDoc(doc(drA(), `${L}/threads/dr_1/messages/m1`), msg('dA')));
    await assertFails(setDoc(doc(drA(), `${L}/threads/dr_2/messages/m2`), msg('dA')));
    await assertFails(setDoc(doc(drA(), `${L}/threads/dr_1/messages/m3`), msg('baskasi')));
    await assertFails(getDoc(doc(drA(), `${L}/threads/dr_2/messages/m2`)));
  });
});

describe('Firestore: teknisyen', () => {
  it('yalnızca atanmış işi okur', async () => {
    await assertSucceeds(getDoc(doc(tech(), `${L}/jobs/100`)));
    await assertFails(getDoc(doc(tech(), `${L}/jobs/101`)));
  });
  it('izinli alanı günceller', async () => {
    await assertSucceeds(updateDoc(doc(tech(), `${L}/jobs/100`), { status: 'Üretimde', techNote: 'not', updatedAt: 'x', updatedBy: 't1' }));
  });
  it('izinsiz alanı güncelleyemez (fiyat, hekim, techIds)', async () => {
    await assertFails(updateDoc(doc(tech(), `${L}/jobs/100`), { price: 1 }));
    await assertFails(updateDoc(doc(tech(), `${L}/jobs/100`), { doctorId: '2' }));
    await assertFails(updateDoc(doc(tech(), `${L}/jobs/100`), { techIds: ['7', '8'] }));
    await assertFails(updateDoc(doc(tech(), `${L}/jobs/100`), { deletedAt: 'x' }));
  });
  it('doğrudan Tamamlandı yapamaz', async () => {
    await assertFails(updateDoc(doc(tech(), `${L}/jobs/100`), { status: 'Tamamlandı' }));
    await assertSucceeds(updateDoc(doc(tech(), `${L}/jobs/100`), { status: 'Tamamlama Onayı', updatedBy: 't1' }));
  });
  it('başkasının işini güncelleyemez', async () => {
    await assertFails(updateDoc(doc(tech(), `${L}/jobs/101`), { status: 'Üretimde', updatedBy: 't1' }));
  });
  it('finansı okuyamaz', async () => { await assertFails(getDoc(doc(tech(), `${L}/payments/1`))); });
  it('kendi adına bekleyen iş oluşturur, başkası adına oluşturamaz', async () => {
    await assertSucceeds(setDoc(doc(tech(), `${L}/pendingJobs/p1`), { techId: '7', status: 'Onay Bekliyor', patient: 'Ornek', createdBy: 't1', updatedBy: 't1' }));
    await assertFails(setDoc(doc(tech(), `${L}/pendingJobs/p2`), { techId: '8', status: 'Onay Bekliyor', patient: 'Ornek', createdBy: 't1', updatedBy: 't1' }));
  });
});

describe('Firestore: admin ve silme yasağı', () => {
  it('admin okur/yazar', async () => {
    await assertSucceeds(getDoc(doc(admin(), `${L}/payments/1`)));
    await assertSucceeds(updateDoc(doc(admin(), `${L}/jobs/100`), { price: 50, deletedAt: 'x', deletedBy: 'adm', updatedBy: 'adm' }));
  });
  it('admin dahil kimse fiziksel silemez', async () => {
    for (const p of ['jobs/100', 'payments/1', 'doctors/1']) {
      await assertFails(deleteDoc(doc(admin(), `${L}/${p}`)));
      await assertFails(deleteDoc(doc(drA(), `${L}/${p}`)));
      await assertFails(deleteDoc(doc(tech(), `${L}/${p}`)));
    }
  });
  it('admin geçersiz durumlu iş yazamaz', async () => {
    await assertFails(updateDoc(doc(admin(), `${L}/jobs/100`), { status: 'Uydurma', updatedBy: 'adm' }));
  });
  it('auditLog istemciden yazılamaz, yalnızca admin okur', async () => {
    await assertFails(setDoc(doc(admin(), `${L}/auditLog/a2`), { x: 1 }));
    await assertSucceeds(getDoc(doc(admin(), `${L}/auditLog/a1`)));
    await assertFails(getDoc(doc(drA(), `${L}/auditLog/a1`)));
  });
  it('history istemciden yazılamaz', async () => {
    await assertFails(setDoc(doc(admin(), `${L}/jobs/100/history/h1`), { x: 1 }));
  });
  it('başka lab claim li kullanıcı erişemez', async () => {
    const other = env.authenticatedContext('o', { role: 'doctor', doctorId: '1', lab: 'primer' }).firestore();
    await assertFails(getDoc(doc(other, `${L}/jobs/100`)));
  });
});
