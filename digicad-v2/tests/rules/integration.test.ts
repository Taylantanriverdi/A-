import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { initializeTestEnvironment, assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';
import { buildPlan } from '../../migration/src/transform';
import { jobEditPatch, statusPatch } from '../../src/admin/calc';

// Bölümler arası entegrasyon: çöp filtresi, eski iş sohbetleri (job_*), eski durum değerleri, kapalı dönem, dosya adı kara listesi.
let env: RulesTestEnvironment;
const L = 'labs/digicad';
const MFA = { firebase: { sign_in_provider: 'custom' as const, sign_in_second_factor: 'totp' } };
const ctx = (uid: string, claims: Record<string, unknown>) => env.authenticatedContext(uid, claims);
const admin = () => ctx('adm', { role: 'admin', lab: 'digicad', ...MFA }).firestore();
const drA = () => ctx('dA', { role: 'doctor', doctorId: '1', lab: 'digicad' }).firestore();
const drB = () => ctx('dB', { role: 'doctor', doctorId: '2', lab: 'digicad' }).firestore();
const tech = () => ctx('t1', { role: 'tech', techId: '7', lab: 'digicad' }).firestore();
const tech8 = () => ctx('t8', { role: 'tech', techId: '8', lab: 'digicad' }).firestore();
const bytes = new Uint8Array([1, 2, 3]);
const zip = { contentType: 'application/zip' };

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
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, `${L}/jobs/100`), { doctorId: '1', techIds: ['7'], status: 'Bekliyor', patient: 'A', deleted: false });
    await setDoc(doc(db, `${L}/jobs/101`), { doctorId: '1', techIds: ['7'], status: 'Bekliyor', patient: 'Silinmis', deleted: true });
    await setDoc(doc(db, `${L}/jobs/102`), { doctorId: '1', techIds: ['7'], status: 'Bekliyor', patient: 'Eski (deleted alanı yok)' });
    await setDoc(doc(db, `${L}/jobs/103`), { doctorId: '2', techIds: ['8'], status: 'Bekliyor', patient: 'B', deleted: false });
    await setDoc(doc(db, `${L}/jobs/104`), { doctorId: '', techIds: ['7'], status: 'Bekliyor', patient: 'Hekimsiz eski', _legacy: { workspace: 'digicad', key: '104' } });
    await setDoc(doc(db, `${L}/jobs/105`), { doctorId: '1', techIds: ['7'], status: 'Gönderildi', patient: 'Bilinmeyen durum' });
    await setDoc(doc(db, `${L}/jobs/106`), { doctorId: '1', techIds: ['7'], status: 'Tamamlandı', patient: 'Kapali', price: 100, qty: 2, currency: 'TRY', closureId: 'c1' });
    await setDoc(doc(db, `${L}/threads/job_100`), { id: 'job_100', _legacy: { workspace: 'digicad', key: 'job_100' } });
    await setDoc(doc(db, `${L}/threads/job_100/messages/m1`), { text: 'eski', senderRole: 'technician', timestamp: '2025-01-01T00:00:00.000Z', _legacy: { key: 'm1' } });
    await setDoc(doc(db, `${L}/threads/job_101/messages/m1`), { text: 'silinmiş iş', senderRole: 'doctor' });
    await setDoc(doc(db, `${L}/pendingJobs/p1`), { techId: '7', status: 'Onay Bekliyor', patient: 'P', deleted: true });
    await setDoc(doc(db, `${L}/pendingJobs/p2`), { techId: '7', status: 'Onay Bekliyor', patient: 'P2' });
    await setDoc(doc(db, `${L}/doctorSubmissions/s1`), { doctorId: '1', status: 'Yeni', patient: 'S', deleted: true });
    await setDoc(doc(db, `${L}/doctorSubmissions/s2`), { doctorId: '1', status: 'Yeni', patient: 'S2' });
  });
});

describe('Çöp kutusu: hekim/teknisyen göremez', () => {
  it('tek belge okuma: çöpteki reddedilir, alanı olmayan (göç verisi) ve false olan okunur', async () => {
    await assertFails(getDoc(doc(drA(), `${L}/jobs/101`)));
    await assertSucceeds(getDoc(doc(drA(), `${L}/jobs/102`)));
    await assertSucceeds(getDoc(doc(drA(), `${L}/jobs/100`)));
    await assertFails(getDoc(doc(tech(), `${L}/jobs/101`)));
    await assertSucceeds(getDoc(doc(tech(), `${L}/jobs/102`)));
    await assertFails(getDoc(doc(tech(), `${L}/pendingJobs/p1`)));
    await assertSucceeds(getDoc(doc(tech(), `${L}/pendingJobs/p2`)));
    await assertFails(getDoc(doc(drA(), `${L}/doctorSubmissions/s1`)));
    await assertSucceeds(getDoc(doc(drA(), `${L}/doctorSubmissions/s2`)));
  });
  it('admin çöptekini de okur', async () => {
    await assertSucceeds(getDoc(doc(admin(), `${L}/jobs/101`)));
  });
  it('ön yüzün sorguları (doctorId/techIds + deleted==false) izinlidir ve çöpü içermez', async () => {
    const d = await assertSucceeds(getDocs(query(collection(drA(), `${L}/jobs`), where('doctorId', '==', '1'), where('deleted', '==', false))));
    const ids = d.docs.map((x) => x.id).sort().join();
    // yalnızca deleted:false yazılı kayıt (100); çöp (101) ve alanı olmayanlar (102,105,106) listede çıkmaz
    if (ids !== '100') throw new Error(`beklenmeyen sorgu sonucu: ${ids}`);
    await assertSucceeds(getDocs(query(collection(tech(), `${L}/jobs`), where('techIds', 'array-contains', '7'), where('deleted', '==', false))));
    await assertSucceeds(getDocs(query(collection(tech(), `${L}/pendingJobs`), where('techId', '==', '7'), where('deleted', '==', false))));
    await assertSucceeds(getDocs(query(collection(drA(), `${L}/doctorSubmissions`), where('doctorId', '==', '1'), where('deleted', '==', false))));
  });
  it('çöp filtresi olmayan sorgu çöp kaydı sızdıramaz (reddedilir)', async () => {
    await assertFails(getDocs(query(collection(drA(), `${L}/jobs`), where('doctorId', '==', '1'))));
    await assertFails(getDocs(query(collection(tech(), `${L}/jobs`), where('techIds', 'array-contains', '7'))));
  });
});

describe('Eski iş sohbetleri job_{işId}', () => {
  const msg = (uid: string, role: string) => ({ text: 'merhaba', senderUid: uid, senderRole: role, timestamp: 't' });
  it('işin hekimi okur ve yazar; başka hekim erişemez', async () => {
    await assertSucceeds(getDoc(doc(drA(), `${L}/threads/job_100/messages/m1`)));
    await assertSucceeds(setDoc(doc(drA(), `${L}/threads/job_100/messages/n1`), msg('dA', 'doctor')));
    await assertFails(getDoc(doc(drB(), `${L}/threads/job_100/messages/m1`)));
    await assertFails(setDoc(doc(drB(), `${L}/threads/job_100/messages/n2`), msg('dB', 'doctor')));
  });
  it('atanmış teknisyen erişir, atanmamış erişemez', async () => {
    await assertSucceeds(getDoc(doc(tech(), `${L}/threads/job_100/messages/m1`)));
    await assertSucceeds(setDoc(doc(tech(), `${L}/threads/job_100/messages/n3`), msg('t1', 'tech')));
    await assertFails(getDoc(doc(tech8(), `${L}/threads/job_100/messages/m1`)));
    await assertFails(setDoc(doc(tech8(), `${L}/threads/job_100/messages/n4`), msg('t8', 'tech')));
  });
  it('mesaj listesi sorgusu (orderBy timestamp) işin sahibine izinli', async () => {
    await assertSucceeds(getDocs(query(collection(drA(), `${L}/threads/job_100/messages`))));
    await assertFails(getDocs(query(collection(drB(), `${L}/threads/job_100/messages`))));
  });
  it('çöpteki veya olmayan işin sohbeti açılmaz', async () => {
    await assertFails(getDoc(doc(drA(), `${L}/threads/job_101/messages/m1`)));
    await assertFails(setDoc(doc(drA(), `${L}/threads/job_999/messages/n5`), msg('dA', 'doctor')));
  });
  it('rol sahteciliği ve başka thread yolu reddedilir', async () => {
    await assertFails(setDoc(doc(drA(), `${L}/threads/job_100/messages/n6`), msg('dA', 'admin')));
    await assertFails(setDoc(doc(drA(), `${L}/threads/job_100/messages/n7`), { ...msg('dA', 'doctor'), filePath: 'labs/digicad/chat/job_103/a.png' }));
    await assertSucceeds(setDoc(doc(drA(), `${L}/threads/job_100/messages/n8`), { ...msg('dA', 'doctor'), filePath: 'labs/digicad/chat/job_100/a.png', fileName: 'a.png' }));
  });
  it('göçle gelen konuşma belgesine (id/_legacy alanları var) updatedAt yazılabilir; keyfi alan yazılamaz; alan silinemez', async () => {
    await assertSucceeds(setDoc(doc(drA(), `${L}/threads/job_100`), { updatedAt: 'x' }, { merge: true }));
    await assertFails(setDoc(doc(drA(), `${L}/threads/job_100`), { updatedAt: 'x', evil: 1 }, { merge: true }));
    await assertFails(setDoc(doc(drA(), `${L}/threads/job_100`), { updatedAt: 'x' })); // set() ile id/_legacy kaybı
    await assertSucceeds(setDoc(doc(admin(), `${L}/threads/job_100`), { updatedAt: 'x' }, { merge: true }));
  });
  it('admin her iş sohbetini görür ve yazar', async () => {
    await assertSucceeds(getDoc(doc(admin(), `${L}/threads/job_101/messages/m1`)));
    await assertSucceeds(setDoc(doc(admin(), `${L}/threads/job_103/messages/n9`), msg('adm', 'admin')));
  });
  it('sohbet eki (Storage) iş sohbeti üyesine açık, diğerlerine kapalı', async () => {
    const s = (uid: string, c: Record<string, unknown>) => ctx(uid, c).storage();
    await assertSucceeds(uploadBytes(ref(s('dA', { role: 'doctor', doctorId: '1', lab: 'digicad' }), 'labs/digicad/chat/job_100/p.png'), bytes, { contentType: 'image/png' }));
    await assertSucceeds(getBytes(ref(s('t1', { role: 'tech', techId: '7', lab: 'digicad' }), 'labs/digicad/chat/job_100/p.png')));
    await assertFails(getBytes(ref(s('dB', { role: 'doctor', doctorId: '2', lab: 'digicad' }), 'labs/digicad/chat/job_100/p.png')));
    await assertFails(uploadBytes(ref(s('dB', { role: 'doctor', doctorId: '2', lab: 'digicad' }), 'labs/digicad/chat/job_100/q.png'), bytes, { contentType: 'image/png' }));
  });
});

describe('Eski durum değerleri ve hekimsiz eski iş', () => {
  it("'Bekleyen' (eski yazım varyantı) kabul edilir; uydurma değer yeni yazımda reddedilir", async () => {
    await assertSucceeds(updateDoc(doc(admin(), `${L}/jobs/100`), { status: 'Bekleyen', updatedBy: 'adm' }));
    await assertFails(updateDoc(doc(admin(), `${L}/jobs/100`), { status: 'Uydurma', updatedBy: 'adm' }));
  });
  it('göçle gelen bilinmeyen durum, değer aynı kaldıkça güncellemeyi engellemez; başka bilinmeyen değere geçilemez', async () => {
    await assertSucceeds(updateDoc(doc(admin(), `${L}/jobs/105`), { note: 'düzenlendi', updatedBy: 'adm' }));
    await assertSucceeds(updateDoc(doc(admin(), `${L}/jobs/105`), { status: 'Bekliyor', updatedBy: 'adm' }));
    await assertFails(updateDoc(doc(admin(), `${L}/jobs/102`), { status: 'Gönderildi', updatedBy: 'adm' }));
  });
  it('yeni iş hekimsiz (doctorId boş) oluşturulamaz', async () => {
    const base = { status: 'Bekliyor', patient: 'Y', updatedBy: 'adm', createdBy: 'adm', createdAt: 'c' };
    await assertFails(setDoc(doc(admin(), `${L}/jobs/200`), { ...base, doctorId: '' }));
    await assertSucceeds(setDoc(doc(admin(), `${L}/jobs/201`), { ...base, doctorId: '1' }));
  });
  it('göçle gelen hekimsiz eski iş güncellenebilir (hekim ataması dahil), ama _legacy silinemez', async () => {
    await assertSucceeds(updateDoc(doc(admin(), `${L}/jobs/104`), { note: 'x', updatedBy: 'adm' }));
    await assertSucceeds(updateDoc(doc(admin(), `${L}/jobs/104`), { doctorId: '1', updatedBy: 'adm' }));
    await assertFails(setDoc(doc(admin(), `${L}/jobs/104`), { doctorId: '', techIds: ['7'], status: 'Bekliyor', patient: 'Hekimsiz eski', updatedBy: 'adm' }));
  });
  it('teknisyen eski bilinmeyen durumdaki işin durumunu kanonik bir değere çekebilir', async () => {
    await assertSucceeds(updateDoc(doc(tech(), `${L}/jobs/105`), { status: 'Tasarımda', updatedBy: 't1' }));
  });
});

describe('Kapalı dönem (closureId dolu) iş koruması', () => {
  it('hekim/fiyat/adet/para birimi değiştirilemez', async () => {
    await assertFails(updateDoc(doc(admin(), `${L}/jobs/106`), { doctorId: '2', updatedBy: 'adm' }));
    await assertFails(updateDoc(doc(admin(), `${L}/jobs/106`), { price: 1, updatedBy: 'adm' }));
    await assertFails(updateDoc(doc(admin(), `${L}/jobs/106`), { qty: 9, updatedBy: 'adm' }));
    await assertFails(updateDoc(doc(admin(), `${L}/jobs/106`), { currency: 'USD', updatedBy: 'adm' }));
  });
  it('diğer alanlar (not) ve dönem kapatmayı geri alma (closureId:null) serbest; geri alındıktan sonra fiyat değişir', async () => {
    await assertSucceeds(updateDoc(doc(admin(), `${L}/jobs/106`), { note: 'n', updatedBy: 'adm' }));
    await assertSucceeds(updateDoc(doc(admin(), `${L}/jobs/106`), { closureId: null, updatedBy: 'adm' }));
    await assertSucceeds(updateDoc(doc(admin(), `${L}/jobs/106`), { price: 150, updatedBy: 'adm' }));
  });
});

describe('Storage: tehlikeli dosya adı uzantıları', () => {
  const adminSt = () => ctx('a3', { role: 'admin', lab: 'digicad', ...MFA }).storage();
  beforeEach(async () => { await env.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), `${L}/jobs/100`), { doctorId: '1', techIds: ['7'], status: 'Bekliyor' }); }); });
  it('octet-stream olsa bile .html/.svg/.js/.exe/.xml ve çift uzantılı adlar reddedilir', async () => {
    const oct = { contentType: 'application/octet-stream' };
    for (const n of ['x.html', 'X.HTM', 'a.svg', 'b.js', 'c.exe', 'd.xml', 'e.html.zip', 'f.ps1', 'g.hta']) {
      await assertFails(uploadBytes(ref(adminSt(), `labs/digicad/jobFiles/100/${n}`), bytes, oct));
    }
  });
  it('geçerli tarama dosyaları (stl/zip/pdf/png/ply, noktalı adlar) kabul edilir', async () => {
    const oct = { contentType: 'application/octet-stream' };
    for (const n of ['a.stl', 'b.ply', 'c.dcm', 'ust.cene.v2.stl', 'html-notu.stl', 'xmlcalisma.zip']) {
      await assertSucceeds(uploadBytes(ref(adminSt(), `labs/digicad/jobFiles/100/${n}`), bytes, oct));
    }
    await assertSucceeds(uploadBytes(ref(adminSt(), 'labs/digicad/jobFiles/100/n.pdf'), bytes, { contentType: 'application/pdf' }));
  });
  it('hekim gönderimi ve sohbet eki için de geçerli', async () => {
    const dr = ctx('dA', { role: 'doctor', doctorId: '1', lab: 'digicad' }).storage();
    await assertFails(uploadBytes(ref(dr, 'labs/digicad/submissions/1/evil.html'), bytes, { contentType: 'application/octet-stream' }));
    await assertFails(uploadBytes(ref(dr, 'labs/digicad/chat/dr_1/evil.svg.png'), bytes, { contentType: 'image/png' }));
    await assertSucceeds(uploadBytes(ref(dr, 'labs/digicad/submissions/1/ok.stl'), bytes, { contentType: 'application/octet-stream' }));
  });
});

describe('Storage: çöpteki işin dosyaları hekime/teknisyene kapalı', () => {
  it('çöpteki iş dosyası okunamaz; canlı iş okunur', async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await uploadBytes(ref(c.storage(), 'labs/digicad/jobFiles/100/a.zip'), bytes, zip);
      await uploadBytes(ref(c.storage(), 'labs/digicad/jobFiles/101/a.zip'), bytes, zip);
    });
    const dr = ctx('dA', { role: 'doctor', doctorId: '1', lab: 'digicad' }).storage();
    await assertSucceeds(getBytes(ref(dr, 'labs/digicad/jobFiles/100/a.zip')));
    await assertFails(getBytes(ref(dr, 'labs/digicad/jobFiles/101/a.zip')));
    const t = ctx('t1', { role: 'tech', techId: '7', lab: 'digicad' }).storage();
    await assertFails(getBytes(ref(t, 'labs/digicad/jobFiles/101/a.zip')));
  });
});

describe('Göç fixture belgesi: admin güncelleme yaması mevcut alanları (_legacy, {_nestedArray}, bilinmeyen alanlar) korur ve kurallardan geçer', () => {
  const root = JSON.parse(readFileSync('migration/test/fixtures/rtdb-export.fake.json', 'utf8'));
  const plan = buildPlan(root, { ignoreUnknown: true, includeLegacyRoot: true, ignoreLegacyRoot: true });
  const fx = (id: string) => plan.docs.find((d) => d.path === `labs/digicad/jobs/${id}`)!.data;
  it('jobEditPatch ile güncelleme (gerçek ön yüz yaması) başarılı; tüm alanlar korunur', async () => {
    const cur = { ...fx('1700000000100'), id: '1700000000100' } as Record<string, unknown>;
    await env.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), `${L}/jobs/1700000000100`), cur); });
    const patch = jobEditPatch(cur, { doctor: { id: String(cur.doctorId), name: 'Dr' }, patient: 'Yeni Ad', type: 'Kron', qty: 3, price: 10, currency: 'TRY', dateout: '2025-03-01', color: 'A2', note: 'n', tech: null, status: 'Tasarımda' }, '2026-01-01T00:00:00.000Z');
    const body = { ...patch, orderForm: { ...(cur.orderForm as object), teeth: [11] }, updatedBy: 'adm', updatedAt: 'x' };
    await assertSucceeds(updateDoc(doc(admin(), `${L}/jobs/1700000000100`), body));
    const snap = await assertSucceeds(getDoc(doc(admin(), `${L}/jobs/1700000000100`))); const d = snap.data()!;
    for (const k of Object.keys(cur)) if (!(k in d)) throw new Error(`alan kayboldu: ${k}`);
    if (JSON.stringify(d._legacy) !== JSON.stringify(cur._legacy) || JSON.stringify(d.teethMap) !== JSON.stringify(cur.teethMap)) throw new Error('göç alanları bozuldu');
  });
  it('bilinmeyen durumlu ve hekimsiz göç belgesi: durum yaması + hekim ataması geçer; alanları düşüren set() reddedilir', async () => {
    const cur = { ...fx('1700000000102'), id: '1700000000102' } as Record<string, unknown>; // status 'Beklemede', doctorId ''
    await env.withSecurityRulesDisabled(async (c) => { await setDoc(doc(c.firestore(), `${L}/jobs/1700000000102`), cur); });
    await assertSucceeds(updateDoc(doc(admin(), `${L}/jobs/1700000000102`), { note: 'x', updatedBy: 'adm' }));
    await assertSucceeds(updateDoc(doc(admin(), `${L}/jobs/1700000000102`), { ...(statusPatch(cur, 'Bekliyor', 'n') as object), doctorId: '1', updatedBy: 'adm' }));
    const { _legacy: _l, ...withoutLegacy } = cur; void _l;
    await assertFails(setDoc(doc(admin(), `${L}/jobs/1700000000102`), { ...withoutLegacy, updatedBy: 'adm' })); // ön yüz bunu yapmaz; kural yine de korur
  });
});
