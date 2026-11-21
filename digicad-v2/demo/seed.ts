/**
 * DEMO tohum verisi — TAMAMEN UYDURMADIR (kişi, hekim, klinik, telefon, e-posta, tutar; hiçbiri gerçek değildir).
 * Belge şeması uygulamanın beklediği alanlarla birebir aynıdır (src/admin/state.ts, calc.ts, pages*.ts, src/pages/*.ts).
 * Tarihler "bugün"e göre göreli üretilir; böylece demo her açıldığında güncel görünür.
 */
import { todayLocal } from '../src/lib/format';
import { planClosure, saleTotals, withIds, type R } from '../src/admin/calc';
import { Timestamp } from './mock/timestamp';

export const SEED_VERSION = 'demo-v1';
export const LAB = 'digicad';
export type SeedDoc = [path: string, id: string, data: R];

/* ---------- Tarih yardımcıları ---------- */
const T0 = todayLocal();
const addDays = (n: number): string => { const d = new Date(`${T0}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const p2 = (n: number): string => String(n).padStart(2, '0');
/** Göreli gün + saat → ISO zaman damgası (gelecekteki saatler "şimdi"yi aşmasın diye bugün için saat sınırlanır). */
const iso = (n: number, h = 9, m = 0): string => `${addDays(n)}T${p2(h)}:${p2(m)}:00.000Z`;
const ms = (isoStr: string): number => new Date(isoStr).getTime();

/* ---------- Kişiler ---------- */
interface Doc { id: string; name: string; clinic: string; phone: string; email: string; cur: 'TRY' | 'USD'; factor: number; autoTech: number | null; account: boolean }
const DOCTORS: Doc[] = [
  { id: '1750000000001', name: 'Dr. Elif Yılmaz', clinic: 'Yılmaz Diş Kliniği', phone: '0532 555 01 01', email: 'elif.yilmaz@ornek-klinik.example', cur: 'TRY', factor: 1, autoTech: 0, account: true },
  { id: '1750000000002', name: 'Dr. Mehmet Kaya', clinic: 'Kaya Ağız ve Diş Sağlığı', phone: '0533 555 02 02', email: 'mehmet.kaya@ornek-klinik.example', cur: 'TRY', factor: 0.92, autoTech: null, account: true },
  { id: '1750000000003', name: 'Dr. Zeynep Arslan', clinic: 'Estetik Ortodonti Merkezi', phone: '0535 555 03 03', email: 'zeynep.arslan@ornek-klinik.example', cur: 'TRY', factor: 1.1, autoTech: 1, account: false },
  { id: '1750000000004', name: 'Dr. Burak Demir', clinic: 'Demir Dental Studio', phone: '0536 555 04 04', email: 'burak.demir@ornek-klinik.example', cur: 'TRY', factor: 1.05, autoTech: null, account: false },
  { id: '1750000000005', name: 'Dr. Ayşe Nur Çelik', clinic: 'Çelik İmplant Merkezi', phone: '0537 555 05 05', email: 'aysenur.celik@ornek-klinik.example', cur: 'TRY', factor: 1.15, autoTech: null, account: false },
  { id: '1750000000006', name: 'Dr. Michael Berg', clinic: 'Berg Dental (Düsseldorf)', phone: '+49 211 555 0106', email: 'm.berg@dentalpark.example', cur: 'USD', factor: 1, autoTech: null, account: false },
];
interface Tech { id: string; name: string; spec: string; type: 'ic' | 'dis'; phone: string; email: string; account: boolean }
const TECHS: Tech[] = [
  { id: '1750000000101', name: 'Murat Aydın', spec: 'CAD/CAM Tasarım', type: 'ic', phone: '0541 555 11 11', email: 'murat.aydin@digicad-demo.example', account: true },
  { id: '1750000000102', name: 'Selin Özkan', spec: 'Seramik ve Makyaj', type: 'ic', phone: '0542 555 12 12', email: 'selin.ozkan@digicad-demo.example', account: false },
  { id: '1750000000103', name: 'Hakan Polat', spec: 'Frezeleme / Üretim', type: 'ic', phone: '0543 555 13 13', email: 'hakan.polat@digicad-demo.example', account: false },
  { id: '1750000000104', name: 'Gökhan Erdem', spec: 'Metal Alt Yapı (lazer sinter)', type: 'ic', phone: '0544 555 14 14', email: 'gokhan.erdem@digicad-demo.example', account: false },
  { id: '1750000000105', name: 'Ferhat Tunç', spec: 'Hareketli Protez (dış servis)', type: 'dis', phone: '0545 555 15 15', email: 'ferhat.tunc@ornek-servis.example', account: false },
];
/** Demo kimlikleri: hekim.html → ilk hekim, teknisyen.html → ilk teknisyen. */
export const DEMO_DOCTOR = { id: DOCTORS[0].id, name: DOCTORS[0].name, email: DOCTORS[0].email };
export const DEMO_TECH = { id: TECHS[0].id, name: TECHS[0].name, email: TECHS[0].email };
export const DOCTOR_EMAILS: { name: string; email: string }[] = DOCTORS.map((d) => ({ name: d.name, email: d.email }));

const ADMIN_UID = 'demo-admin';
const stamp = (created: string, by = ADMIN_UID): R => ({ createdAt: created, createdBy: by, updatedAt: created, updatedBy: by });

/* ---------- Fiyat listeleri ---------- */
const BASE_TRY: [string, number][] = [['Zirkonyum Kron', 1250], ['E.max Kron', 1600], ['Laminate Veneer', 2000], ['Porselen Metal Destekli Kron', 850], ['İmplant Üstü Kron', 2400], ['Zirkonyum Köprü', 1350], ['Hareketli Protez', 3500], ['Gece Plağı', 900], ['Geçici Kron (PMMA)', 350], ['Metal Alt Yapı', 600]];
const BASE_USD: [string, number][] = [['Zirkonyum Kron', 62], ['E.max Kron', 78], ['Laminate Veneer', 95], ['İmplant Üstü Kron', 115], ['Zirkonyum Köprü', 66], ['Geçici Kron (PMMA)', 18]];
const priceList = (d: Doc): R[] => (d.cur === 'USD' ? BASE_USD : BASE_TRY).map(([name, p], i) => ({ id: `${d.id}-p${i}`, name, price: d.cur === 'USD' ? p : Math.round((p * d.factor) / 50) * 50, currency: d.cur }));
const priceOf = (d: Doc, type: string): number => Number(priceList(d).find((x) => x.name === type)?.price ?? 1000);

/* ---------- İşler ---------- */
type St = 'Bekliyor' | 'Tasarımda' | 'Üretimde' | 'Makyajda' | 'Tamamlama Onayı' | 'Tamamlandı';
interface J { d: number; p: string; t: string; teeth: number[]; q: number; st: St; tech: number | null; out: number; cr: number; color: string; done?: number; mat?: string; note?: string; scan?: number; design?: number; src?: string; techNote?: string }
const JOBS: J[] = [
  // Bekliyor
  { d: 0, p: 'MERVE ŞAHİN', t: 'Zirkonyum Kron', teeth: [14], q: 1, st: 'Bekliyor', tech: 0, out: 6, cr: -1, color: 'A2', mat: 'Zirkon', scan: 2 },
  { d: 2, p: 'CAN ÖZDEMİR', t: 'Laminate Veneer', teeth: [13, 12, 11, 21, 22, 23], q: 6, st: 'Bekliyor', tech: 1, out: 9, cr: -1, color: 'BL2', mat: 'E.max', scan: 2, note: 'Hasta açık renk istiyor, fotoğraf eklendi.' },
  { d: 3, p: 'SEDA KORKMAZ', t: 'Gece Plağı', teeth: [], q: 1, st: 'Bekliyor', tech: null, out: 7, cr: 0, color: '', mat: 'Akrilik', scan: 2, note: 'Üst çene, sert plak.' },
  { d: 4, p: 'EMRE YILDIZ', t: 'İmplant Üstü Kron', teeth: [36], q: 1, st: 'Bekliyor', tech: null, out: 10, cr: 0, color: 'A3', mat: 'Zirkon', scan: 3, note: 'Scanbody + ölçü modeli yüklendi.' },
  { d: 1, p: 'HÜLYA AKBULUT', t: 'Porselen Metal Destekli Kron', teeth: [24, 25, 26], q: 3, st: 'Bekliyor', tech: 3, out: 5, cr: -2, color: 'A3.5', mat: 'Metal-seramik', scan: 1 },
  // Tasarımda
  { d: 0, p: 'OSMAN ÇETİN', t: 'Zirkonyum Kron', teeth: [46, 47], q: 2, st: 'Tasarımda', tech: 0, out: 4, cr: -4, color: 'A3', mat: 'Zirkon', scan: 2, design: 1 },
  { d: 5, p: 'KLAUS WEBER', t: 'Zirkonyum Köprü', teeth: [14, 15, 16], q: 3, st: 'Tasarımda', tech: 0, out: 3, cr: -5, color: 'A2', mat: 'Zirkon', scan: 2 },
  { d: 2, p: 'BEYZA TOPRAK', t: 'Laminate Veneer', teeth: [12, 11, 21, 22], q: 4, st: 'Tasarımda', tech: 1, out: 2, cr: -6, color: 'BL1', mat: 'E.max', scan: 2, design: 2 },
  { d: 4, p: 'İBRAHİM KURT', t: 'İmplant Üstü Kron', teeth: [26], q: 1, st: 'Tasarımda', tech: 2, out: 8, cr: -3, color: 'A3', mat: 'Zirkon', scan: 3 },
  { d: 0, p: 'GÜLSÜM AYDIN', t: 'E.max Kron', teeth: [15], q: 1, st: 'Tasarımda', tech: 0, out: -1, cr: -9, color: 'A1', mat: 'E.max', scan: 1, note: 'Acil: hasta yurt dışına gidiyor.' },
  // Üretimde
  { d: 0, p: 'FATMA ERDOĞAN', t: 'Zirkonyum Kron', teeth: [16, 17], q: 2, st: 'Üretimde', tech: 2, out: 1, cr: -8, color: 'A2', mat: 'Zirkon', scan: 2, design: 2, src: 's1' },
  { d: 1, p: 'MUSTAFA DOĞAN', t: 'Hareketli Protez', teeth: [], q: 1, st: 'Üretimde', tech: 4, out: 6, cr: -10, color: 'A3', mat: 'Akrilik', scan: 2, design: 1 },
  { d: 3, p: 'ZEHRA ÇAKIR', t: 'Zirkonyum Kron', teeth: [35, 36, 37], q: 3, st: 'Üretimde', tech: 2, out: -2, cr: -12, color: 'A2', mat: 'Zirkon', scan: 2, design: 1 },
  { d: 5, p: 'ANNA SCHMIDT', t: 'E.max Kron', teeth: [21], q: 1, st: 'Üretimde', tech: 2, out: 4, cr: -7, color: 'A1', mat: 'E.max', scan: 1, design: 1 },
  { d: 2, p: 'DENİZ ARSLAN', t: 'Geçici Kron (PMMA)', teeth: [11, 21], q: 2, st: 'Üretimde', tech: 2, out: 0, cr: -3, color: 'A2', mat: 'PMMA', scan: 1, design: 1 },
  { d: 4, p: 'KEMAL YILMAZ', t: 'Metal Alt Yapı', teeth: [44, 45, 46], q: 3, st: 'Üretimde', tech: 3, out: 3, cr: -9, color: 'A3.5', mat: 'CoCr', scan: 2, design: 1 },
  // Makyajda
  { d: 0, p: 'AYLİN KARACA', t: 'E.max Kron', teeth: [11], q: 1, st: 'Makyajda', tech: 1, out: 1, cr: -11, color: 'A1', mat: 'E.max', scan: 1, design: 1, techNote: 'Renk uyumu için hastadan fotoğraf istendi.' },
  { d: 2, p: 'TOLGA BAYRAM', t: 'Laminate Veneer', teeth: [13, 12, 11, 21, 22, 23], q: 6, st: 'Makyajda', tech: 1, out: 2, cr: -13, color: 'BL2', mat: 'E.max', scan: 2, design: 2 },
  { d: 1, p: 'NURAY SARI', t: 'Zirkonyum Kron', teeth: [14], q: 1, st: 'Makyajda', tech: 1, out: -3, cr: -14, color: 'A2', mat: 'Zirkon', scan: 1, design: 1 },
  { d: 3, p: 'ONUR ŞEN', t: 'Porselen Metal Destekli Kron', teeth: [16], q: 1, st: 'Makyajda', tech: 1, out: 4, cr: -9, color: 'A3', mat: 'Metal-seramik', scan: 1, design: 1, note: 'Önceki tamamlama onayı reddedildi: kontak sıkı.' },
  // Tamamlama Onayı
  { d: 0, p: 'SEVGİ UYSAL', t: 'Zirkonyum Kron', teeth: [24], q: 1, st: 'Tamamlama Onayı', tech: 0, out: 0, cr: -10, color: 'A2', mat: 'Zirkon', scan: 1, design: 1 },
  { d: 4, p: 'HAKAN BULUT', t: 'İmplant Üstü Kron', teeth: [46], q: 1, st: 'Tamamlama Onayı', tech: 2, out: 1, cr: -12, color: 'A3', mat: 'Zirkon', scan: 2, design: 1 },
  { d: 5, p: 'ERIK MÜLLER', t: 'Zirkonyum Kron', teeth: [11, 12], q: 2, st: 'Tamamlama Onayı', tech: 0, out: 0, cr: -9, color: 'A1', mat: 'Zirkon', scan: 2, design: 1 },
  // Tamamlandı
  { d: 0, p: 'ELİF KAYA', t: 'Zirkonyum Kron', teeth: [11, 21], q: 2, st: 'Tamamlandı', tech: 0, out: -3, cr: -8, color: 'A2', mat: 'Zirkon', scan: 2, design: 1, done: -3, src: 's2' },
  { d: 0, p: 'BURCU ÖZTÜRK', t: 'E.max Kron', teeth: [14], q: 1, st: 'Tamamlandı', tech: 1, out: -9, cr: -15, color: 'A1', mat: 'E.max', scan: 1, design: 1, done: -9 },
  { d: 2, p: 'MELİH AKSOY', t: 'Laminate Veneer', teeth: [12, 11, 21, 22], q: 4, st: 'Tamamlandı', tech: 1, out: -20, cr: -26, color: 'BL1', mat: 'E.max', scan: 2, design: 1, done: -20 },
  { d: 3, p: 'PINAR DEMİRCİ', t: 'Zirkonyum Kron', teeth: [36, 37], q: 2, st: 'Tamamlandı', tech: 2, out: -28, cr: -34, color: 'A3', mat: 'Zirkon', scan: 2, design: 1, done: -28 },
  { d: 4, p: 'SERKAN POLAT', t: 'İmplant Üstü Kron', teeth: [16], q: 1, st: 'Tamamlandı', tech: 2, out: -44, cr: -50, color: 'A2', mat: 'Zirkon', scan: 2, design: 1, done: -44 },
  { d: 0, p: 'AYŞE GÜL', t: 'Hareketli Protez', teeth: [], q: 1, st: 'Tamamlandı', tech: 4, out: -58, cr: -66, color: 'A3', mat: 'Akrilik', scan: 1, design: 1, done: -58 },
  { d: 5, p: 'THOMAS BRAUN', t: 'Zirkonyum Kron', teeth: [24, 25], q: 2, st: 'Tamamlandı', tech: 0, out: -72, cr: -80, color: 'A2', mat: 'Zirkon', scan: 2, design: 1, done: -72 },
  { d: 1, p: 'RECEP TEKİN', t: 'Porselen Metal Destekli Kron', teeth: [26, 27], q: 2, st: 'Tamamlandı', tech: 3, out: -100, cr: -108, color: 'A3', mat: 'Metal-seramik', scan: 1, design: 1, done: -100 },
  { d: 1, p: 'LEYLA ÇOBAN', t: 'Zirkonyum Kron', teeth: [11], q: 1, st: 'Tamamlandı', tech: 0, out: -110, cr: -118, color: 'A1', mat: 'Zirkon', scan: 1, design: 1, done: -110 },
  { d: 2, p: 'YASEMİN KARTAL', t: 'E.max Kron', teeth: [22], q: 1, st: 'Tamamlandı', tech: 1, out: -128, cr: -135, color: 'A1', mat: 'E.max', scan: 1, design: 1, done: -128 },
  { d: 0, p: 'ORHAN GÜNEŞ', t: 'Zirkonyum Kron', teeth: [46], q: 1, st: 'Tamamlandı', tech: 0, out: -150, cr: -160, color: 'A3', mat: 'Zirkon', scan: 1, design: 1, done: -150 },
];

const rnd8 = (n: number): string => (n * 2654435761 >>> 0).toString(16).padStart(8, '0');
const fileOf = (jobId: string, kind: 'scan' | 'design', i: number, patient: string, at: string): R => {
  const last = patient.split(' ').pop()!.toLocaleLowerCase('tr-TR').replace(/[^a-z0-9]/g, (c) => ({ ı: 'i', ş: 's', ğ: 'g', ü: 'u', ö: 'o', ç: 'c' } as Record<string, string>)[c] ?? '');
  const name = kind === 'scan' ? [`${last}_ust_cene.stl`, `${last}_alt_cene.stl`, `${last}_kapanis.stl`][i] : [`${last}_tasarim_v${i + 1}.zip`, `${last}_tasarim_onizleme.pdf`][i];
  return { name, path: `labs/${LAB}/jobFiles/${jobId}/${ms(at) + i}_${rnd8(ms(at) + i)}_${name}`, size: kind === 'scan' ? 4_200_000 + i * 1_130_000 : 1_800_000 + i * 640_000, uploadedBy: kind === 'scan' ? 'demo-doctor' : DEMO_TECH.id, uploadedAt: at };
};

export function buildSeed(): SeedDoc[] {
  const out: SeedDoc[] = [];
  const add = (coll: string, data: R): void => { out.push([`labs/${LAB}/${coll}`, String(data.id), data]); };
  const addSub = (path: string, id: string, data: R): void => { out.push([path, id, data]); };

  /* hekimler, teknisyenler */
  DOCTORS.forEach((d, i) => add('doctors', { id: d.id, name: d.name, phone: d.phone, email: d.email, spec: d.clinic, clinic: d.clinic, autoTechId: d.autoTech === null ? null : TECHS[d.autoTech].id, prices: priceList(d), ...(d.account ? { authUid: `demo-doctor-${d.id}` } : {}), deleted: false, ...stamp(iso(-300 + i)) }));
  TECHS.forEach((t, i) => add('technicians', { id: t.id, name: t.name, phone: t.phone, email: t.email, spec: t.spec, type: t.type, ...(t.account ? { authUid: `demo-tech-${t.id}` } : {}), deleted: false, ...stamp(iso(-300 + i)) }));

  /* hekim gönderimleri (tanım; bağlı işler aşağıda) */
  const subId = (n: number): string => String(ms(iso(-30 + n * 5, 10)) + n);
  const SUB_IDS: Record<string, string> = { s1: subId(1), s2: subId(2) };

  /* işler */
  const jobs: R[] = []; const jobIdOf = new Map<J, string>();
  JOBS.forEach((j, idx) => {
    const dr = DOCTORS[j.d]; const tech = j.tech === null ? null : TECHS[j.tech]; const created = iso(j.cr, 8 + (idx % 6), (idx * 7) % 60); const id = String(ms(created) + idx);
    jobIdOf.set(j, id);
    const price = priceOf(dr, j.t); const done = j.done !== undefined ? iso(j.done, 15, 30) : null;
    const files = Array.from({ length: j.scan ?? 0 }, (_, i) => fileOf(id, 'scan', i, j.p, created));
    const designAt = iso(Math.min(0, j.cr + 3), 14, 10);
    const designFiles = Array.from({ length: j.design ?? 0 }, (_, i) => fileOf(id, 'design', i, j.p, designAt));
    const teethTxt = j.teeth.length ? `DİŞLER: ${j.teeth.join(', ')}` : '';
    const note = [teethTxt, j.mat ? `MATERYAL: ${j.mat}` : '', j.note ?? ''].filter(Boolean).join('\n');
    const rec: R = withIds({
      id, drId: dr.id, doctorId: dr.id, drName: dr.name, patient: j.p, type: j.t, price, currency: dr.cur, qty: j.q, dateout: addDays(j.out), toothColor: j.color, status: j.st, deleted: false, note, files, designFiles,
      ...(designFiles.length ? { designFilesUpdatedAt: designAt } : {}),
      techId: tech?.id ?? null, techName: tech?.name ?? null, techIds: tech ? [tech.id] : [], dispatchNote: tech && j.st === 'Bekliyor' ? 'Öncelikli, lütfen bu hafta içinde başlayın.' : '',
      ...(j.techNote ? { techNote: j.techNote } : {}),
      orderForm: { teeth: j.teeth, material: j.mat ?? '', jobType: j.t, doctorName: dr.name, color: j.color, notes: j.note ?? '' },
      approvedAt: created, approvedFrom: idx % 3 === 0 ? 'pendingJobs' : 'orderForm', sourceType: 'manual', designSource: 'lab',
      sourceDoctorSubmissionId: j.src ? SUB_IDS[j.src] : null,
      ...(done ? { completedAt: done, completionApprovedBy: 'admin', completionApprovedAt: done } : {}),
      ...(j.p === 'ONUR ŞEN' ? { completionRejectedAt: iso(-2, 11), completionRejectReason: 'Komşu dişle kontak çok sıkı, tekrar ayarlayın.' } : {}),
      ...stamp(done ?? created),
    });
    jobs.push(rec);
  });
  // Silinmiş (çöp) örnek iş
  jobs.push(withIds({ id: String(ms(iso(-20, 9)) + 99), drId: DOCTORS[3].id, doctorId: DOCTORS[3].id, drName: DOCTORS[3].name, patient: 'DENEME HASTA', type: 'Zirkonyum Kron', price: 1300, currency: 'TRY', qty: 1, dateout: addDays(-10), toothColor: 'A2', status: 'Bekliyor', note: 'Yanlışlıkla girilen kayıt.', files: [], designFiles: [], techId: null, techName: null, techIds: [], deleted: true, deletedAt: iso(-19, 10), deletedBy: ADMIN_UID, ...stamp(iso(-20, 9)) }));

  /* ödemeler (tahsilat) — açık dönem bakiyeleri gerçekçi kalsın */
  const pays: R[] = []; let pseq = 0;
  const pay = (dIdx: number, dayOff: number, amount: number, note: string, collector: number | null = null): R => {
    const dr = DOCTORS[dIdx]; const date = addDays(dayOff); const id = String(ms(iso(dayOff, 11)) + 500 + pseq++);
    const p: R = { id, doctorId: dr.id, drId: dr.id, drName: dr.name, date, amount, currency: dr.cur, collectorId: collector === null ? null : TECHS[collector].id, collectorName: collector === null ? null : TECHS[collector].name, note, deleted: false, ...stamp(iso(dayOff, 11)) };
    pays.push(p); return p;
  };
  // Dr. Mehmet Kaya: dönem kapatma örneği (eski iki iş + iki tahsilat → devir)
  const kayaPay = [pay(1, -98, 1500, 'Nakit — 1. taksit'), pay(1, -84, 500, 'Havale')];
  // Diğer hekimler
  pay(0, -50, 4000, 'Nakit', 0); pay(0, -20, 3000, 'Havale/EFT'); pay(0, -2, 1000, 'Kart');
  pay(2, -15, 6000, 'Havale/EFT'); pay(3, -25, 2500, 'Nakit', 2); pay(4, -40, 2400, 'Havale/EFT'); pay(5, -65, 70, 'Wise transfer'); pay(5, -30, 30, 'Wise transfer'); pay(1, -12, 800, 'Nakit', 3);
  const deletedPay = pay(2, -6, 500, 'Hatalı giriş'); Object.assign(deletedPay, { deleted: true, deletedAt: iso(-5, 9), deletedBy: ADMIN_UID });

  // Dönem kapatma (Dr. Mehmet Kaya): kapanıştan önceki iki tamamlanmış iş + iki tahsilat
  const kayaJobs = jobs.filter((j) => j.doctorId === DOCTORS[1].id && j.status === 'Tamamlandı' && ms(`${j.completedAt}`) < ms(iso(-90)));
  const plan = planClosure({ doctor: { id: DOCTORS[1].id, name: DOCTORS[1].name }, jobs: kayaJobs, pays: kayaPay, carry: true, closeDate: addDays(-70), closureId: String(ms(iso(-70, 12)) + 7), now: iso(-70, 12) });
  const closureId = String(plan.closure.id);
  kayaJobs.forEach((j) => { j.closureId = closureId; });
  kayaPay.forEach((p) => { p.closureId = closureId; });
  add('statementClosures', { ...plan.closure, deleted: false, ...stamp(iso(-70, 12)) });
  plan.carryJobs.forEach((c) => jobs.push({ ...c, ...stamp(iso(-70, 12)) }));

  jobs.forEach((j) => add('jobs', j));
  pays.forEach((p) => add('payments', p));

  /* orderForms (sipariş formu arşivi) */
  JOBS.forEach((j) => {
    const id = jobIdOf.get(j)!; const dr = DOCTORS[j.d]; const rec = jobs.find((x) => x.id === id)!;
    add('orderForms', { id, createdAt: rec.createdAt, createdBy: ADMIN_UID, updatedAt: rec.createdAt, updatedBy: ADMIN_UID, drId: dr.id, doctorId: dr.id, drName: dr.name, patient: j.p, jobType: j.t, material: j.mat ?? '', color: j.color, qty: j.q, dateout: addDays(j.out), notes: j.note ?? '', teeth: j.teeth, price: rec.price, currency: dr.cur, pendingJobId: null, printed: j.cr < -4, printedAt: j.cr < -4 ? rec.createdAt : null, orderGroupId: null, orderGroupIndex: null, orderGroupTotal: null, deleted: false });
  });

  /* onay bekleyen işler */
  const pend = (n: number, o: R): void => { const at = iso(-n, 10, 20); const id = String(ms(at) + 300 + n); add('pendingJobs', { id, deleted: false, files: [], designFiles: [], techIds: [], techId: null, techName: '', qty: 1, currency: 'TRY', ...o, submittedAt: at, ...stamp(at) }); };
  pend(1, { drId: DOCTORS[2].id, doctorId: DOCTORS[2].id, drName: DOCTORS[2].name, patient: 'NİLAY GÜVEN', type: 'Zirkonyum Kron', price: priceOf(DOCTORS[2], 'Zirkonyum Kron'), qty: 3, dateout: addDays(8), toothColor: 'A2', note: 'DİŞLER: 11, 12, 21\nMATERYAL: Zirkon', status: 'Onay Bekliyor', source: 'siparis-formu', orderForm: { teeth: [11, 12, 21], material: 'Zirkon', jobType: 'Zirkonyum Kron', doctorName: DOCTORS[2].name, color: 'A2', notes: '' } });
  pend(2, { drName: 'Dr. Mehmet Kaya', patient: 'ŞULE TAŞKIN', type: 'Laminate Veneer', qty: 4, price: 0, dateout: addDays(12), note: 'Dişler: 12,11,21,22 | Renk: A1 | Hekim fotoğraf gönderecek. (Üst çene)', status: 'Onay Bekliyor', submittedBy: 'tech', techId: TECHS[0].id, techName: TECHS[0].name, techIds: [TECHS[0].id] });
  pend(3, { drName: 'Dr. Kerem Soylu', patient: 'MURAT BAŞ', type: 'Hareketli Protez', price: 0, dateout: addDays(14), note: 'Hekim kayıtlı değil (hızlı talep örneği).', status: 'Onay Bekliyor', submittedBy: 'tech', techId: TECHS[4].id, techName: TECHS[4].name, techIds: [TECHS[4].id] });
  pend(6, { drName: 'Dr. Burak Demir', patient: 'KADİR ÖNAL', type: 'Köprü', price: 0, dateout: addDays(3), note: 'Dişler: 34,35,36', status: 'Reddedildi', rejectReason: 'Hekim bilgisi eksik; lütfen tekrar gönderin.', rejectedAt: iso(-5, 9), submittedBy: 'tech', techId: TECHS[3].id, techName: TECHS[3].name, techIds: [TECHS[3].id] });

  /* hekimden gelen gönderimler */
  const sub = (key: string | null, n: number, dIdx: number, o: R): void => {
    const at = iso(-n, 10); const id = key ? SUB_IDS[key] : String(ms(at) + 40 + n); const dr = DOCTORS[dIdx];
    const files = (o.files as string[]).map((nm, i) => ({ name: nm, path: `labs/${LAB}/submissions/${dr.id}/${ms(at) + i}_${rnd8(ms(at) + i)}_${nm}`, size: 5_100_000 + i * 900_000, uploadedBy: `demo-doctor-${dr.id}`, uploadedAt: at }));
    const teeth = o.teeth as number[]; const jaw = teeth.every((t) => t < 30) ? 'upper' : teeth.every((t) => t >= 30) ? 'lower' : 'both';
    add('doctorSubmissions', { id, doctorId: dr.id, drId: dr.id, doctorName: dr.name, color: '', notes: '', source: 'hekim-portal', deleted: false, ...o, files, jaw, ...stamp(at, `demo-doctor-${dr.id}`) });
  };
  sub('s1', 12, 0, { patient: 'FATMA ERDOĞAN', jobType: 'Zirkonyum Kron', teeth: [16, 17], color: 'A2', notes: 'Alt yapı preparasyonu temiz, kontak zayıf bırakılmasın.', files: ['erdogan_ust.stl', 'erdogan_alt.stl'], status: 'Aktarıldı', transferredAt: iso(-12, 14), transferredJobIds: [jobIdOf.get(JOBS[10])!] });
  sub('s2', 11, 0, { patient: 'ELİF KAYA', jobType: 'Zirkonyum Kron', teeth: [11, 21], color: 'A2', notes: '', files: ['kaya_ust.stl'], status: 'Aktarıldı', transferredAt: iso(-11, 13), transferredJobIds: [jobIdOf.get(JOBS[23])!], seenAt: iso(-11, 11) });
  sub(null, 1, 0, { patient: 'DERYA KOÇ', jobType: 'E.max Kron', teeth: [24], color: 'A1', notes: 'Hasta cuma günü gelebilir.', files: ['koc_ust.stl', 'koc_kapanis.stl'], status: 'Yeni' });
  sub(null, 20, 0, { patient: 'VOLKAN TEKİN', jobType: 'Gece Plağı', teeth: [], color: '', notes: 'Eksik tarama.', files: ['tekin.zip'], status: 'Reddedildi', rejectReason: 'Alt çene taraması eksik, yeniden gönderin.', rejectedAt: iso(-19, 9) });
  sub(null, 2, 2, { patient: 'ALARA KILIÇ', jobType: 'Laminate Veneer', teeth: [13, 12, 11, 21, 22, 23], color: 'BL2', notes: 'Fotoğraflar PDF içinde.', files: ['kilic_tarama.zip', 'kilic_foto.pdf'], status: 'Yeni' });
  sub(null, 3, 4, { patient: 'RIZA ÖZKAN', jobType: 'İmplant Üstü Kron', teeth: [36], color: 'A3', notes: 'Scanbody dahil.', files: ['ozkan_implant.stl'], status: 'Yeni', seenAt: iso(-2, 15), seenBy: ADMIN_UID });
  sub(null, 4, 5, { patient: 'LUKAS FISCHER', jobType: 'Zirkonyum Köprü', teeth: [14, 15, 16], color: 'A2', notes: 'Please deliver by next Friday.', files: ['fischer_scan.stl'], status: 'Yeni' });

  /* giderler */
  let eseq = 0;
  const exp = (dayOff: number, category: 'Sabit' | 'Hizmet', subcategory: string, title: string, amount: number, o: R = {}): void => {
    const at = iso(dayOff, 12); const id = String(ms(at) + 700 + eseq++);
    add('expenses', { id, date: addDays(dayOff), category, subcategory, title, amount, currency: 'TRY', payment: 'Havale/EFT', vendor: '', note: '', spenderId: null, spenderName: '', deleted: false, ...o, ...stamp(at) });
  };
  for (let m = 0; m < 6; m++) {
    const base = -m * 30 - 3;
    exp(base, 'Sabit', 'Kira', 'Atölye kirası', 28000, { vendor: 'Örnek Gayrimenkul' });
    exp(base - 2, 'Sabit', 'Personel Maaşı', 'Personel maaşları', 142500 + m * 500);
    exp(base - 4, 'Sabit', 'Elektrik', 'Elektrik faturası', 3900 + ((m * 733) % 1500), { vendor: 'Örnek Enerji' });
    exp(base - 5, 'Sabit', 'İnternet / Telefon', 'İnternet ve telefon', 1250, { vendor: 'Örnek Telekom' });
    exp(base - 8, 'Hizmet', 'Malzeme / Tedarik', 'Zirkonya blok ve seramik malzeme', 9800 + ((m * 1211) % 7000), { vendor: 'Dental Tedarik A.Ş.', payment: m % 2 ? 'Kart' : 'Havale/EFT', spenderId: TECHS[2].id, spenderName: TECHS[2].name });
    exp(base - 10, 'Hizmet', 'Kargo / Nakliye', 'Hekim teslimat kargoları', 640 + m * 35, { vendor: 'Hızlı Kargo', payment: 'Nakit' });
    exp(base - 12, 'Hizmet', 'Yazılım Aboneliği', 'CAD yazılımı aboneliği', 89, { currency: 'USD', payment: 'Kart', vendor: 'ExampleCAD Inc.' });
  }
  exp(-34, 'Hizmet', 'Cihaz Tamiri', 'Frezeleme cihazı bakım ve parça değişimi', 6400, { vendor: 'Örnek Teknik Servis', note: 'Spindle bakımı' });
  exp(-18, 'Hizmet', 'Eğitim / Kurs', 'Seramik makyaj eğitimi', 3200, { payment: 'Kart' });
  exp(-9, 'Hizmet', 'Yemek', 'Atölye yemek gideri', 780, { payment: 'Nakit', spenderId: TECHS[1].id, spenderName: TECHS[1].name });
  exp(-7, 'Hizmet', 'Diğer Hizmet', 'Hatalı girilen gider', 100, { deleted: true, deletedAt: iso(-6, 9), deletedBy: ADMIN_UID });

  /* satışlar (servis / sarf formları) */
  const sale = (n: number, dayOff: number, o: R, items: R[], vat: number): void => {
    const at = iso(dayOff, 13); const t = saleTotals(items as never[], vat);
    add('sales', { id: String(ms(at) + 900 + n), formNo: `PT-${addDays(dayOff).replace(/-/g, '')}-${100 + n * 37}`, date: addDays(dayOff), type: 'Sarf', status: 'Tamamlandı', contact: '', email: '', phone: '', address: '', currency: 'TRY', payment: 'Havale/EFT', note: '', ...o, items, vat, ...t, deleted: false, ...stamp(at) });
  };
  sale(1, -4, { customer: 'Yılmaz Diş Kliniği', contact: 'Elif Yılmaz', type: 'Sarf', status: 'Gönderildi', phone: '0532 555 01 01' }, [{ name: 'Light-cure kompozit set', qty: 3, unit: 'Set', price: 420 }, { name: 'Diş rengi rehberi', qty: 1, unit: 'Adet', price: 650 }], 20);
  sale(2, -15, { customer: 'Kaya Ağız ve Diş Sağlığı', contact: 'Mehmet Kaya', type: 'Servis', payment: 'Nakit' }, [{ name: 'Ölçü modeli dijitalleştirme', qty: 5, unit: 'Adet', price: 180 }], 20);
  sale(3, -33, { customer: 'Demir Dental Studio', type: 'Karma', status: 'Beklemede' }, [{ name: 'Gece plağı malzemesi', qty: 2, unit: 'Paket', price: 380 }, { name: 'Teknik servis (yerinde)', qty: 2, unit: 'Saat', price: 500 }], 20);
  sale(4, -52, { customer: 'Berg Dental (Düsseldorf)', type: 'Sarf', currency: 'USD', payment: 'Havale/EFT' }, [{ name: 'Model ve nakliye paketi', qty: 1, unit: 'Set', price: 140 }], 0);
  sale(5, -71, { customer: 'Çelik İmplant Merkezi', type: 'Servis', status: 'İptal', note: 'Müşteri vazgeçti.' }, [{ name: 'Cerrahi kılavuz tasarımı', qty: 1, unit: 'Adet', price: 1500 }], 20);

  /* ayarlar, mail filtreleri */
  add('settings', { id: 'main', labName: 'DigiCAD Dental Laboratuvar (DEMO)', phone: '0212 555 00 00', address: 'Örnek Mah. Demo Sok. No: 1 Şişli / İstanbul', ...stamp(iso(-300)) });
  add('mailFilters', { id: 'main', items: ['elif.yilmaz@ornek-klinik.example', 'm.berg@dentalpark.example', '@ornek-klinik.example'], ...stamp(iso(-90)) });

  /* sohbetler */
  const thread = (tid: string, updated: string): void => add('threads', { id: tid, updatedAt: updated, ...stamp(updated) });
  type M = [who: 'admin' | 'doctor' | 'tech', dayOff: number, hour: number, text: string, extra?: R];
  const chat = (tid: string, msgs: M[], uid: { doctor?: string; tech?: string } = {}): void => {
    msgs.forEach(([who, dayOff, hour, text, extra], i) => {
      const at = iso(dayOff, hour, (i * 13) % 60); const role = who;
      addSub(`labs/${LAB}/threads/${tid}/messages`, `m${ms(at)}${i}`, { text, senderUid: who === 'admin' ? ADMIN_UID : who === 'doctor' ? (uid.doctor ?? 'demo-doctor') : (uid.tech ?? 'demo-tech'), senderRole: role, senderName: who === 'admin' ? 'Laboratuvar' : who === 'doctor' ? 'Hekim' : 'Teknisyen', timestamp: at, ...extra });
    });
    thread(tid, iso(msgs[msgs.length - 1][1], msgs[msgs.length - 1][2]));
  };
  const du = `demo-doctor-${DOCTORS[0].id}`; const tu = `demo-tech-${TECHS[0].id}`;
  chat(`dr_${DOCTORS[0].id}`, [['doctor', -3, 9, 'Günaydın, FATMA ERDOĞAN işinin teslim tarihi yarın görünüyor, yetişir mi?'], ['admin', -3, 10, 'Günaydın Dr. Hanım, üretimde. Yarın öğleden önce kuryeyle gönderiyoruz.'], ['doctor', -3, 10, 'Harika, teşekkürler. Bir de DERYA KOÇ için tarama yükledim, E.max olacak.'], ['admin', -2, 9, 'Gördük, bugün incelemeye alıyoruz.'], ['doctor', -1, 16, 'Rengi A1 yerine BL3 yapabilir miyiz? Hasta açık istiyor.']], { doctor: du });
  chat(`dr_${DOCTORS[2].id}`, [['doctor', -4, 14, 'Veneer işinde renk örneği fotoğrafı gönderdim.'], ['admin', -4, 15, 'Aldık, teknisyenimiz makyaj aşamasında dikkate alacak.']]);
  chat(`dr_${DOCTORS[5].id}`, [['doctor', -6, 8, 'Hello, could you confirm the delivery date for the zirconia bridge?'], ['admin', -6, 9, 'Hello Dr. Berg, it will ship on Thursday via express courier.']]);
  chat(`tech_${TECHS[0].id}`, [['admin', -2, 9, 'Murat, GÜLSÜM AYDIN işi acil, bugün tasarımı bitirebilir misin?'], ['tech', -2, 9, 'Tamam, öğleden sonra yüklerim.'], ['admin', -1, 10, 'Teşekkürler. Yeni işleri de kontrol et lütfen.']], { tech: tu });
  chat(`tech_${TECHS[1].id}`, [['tech', -3, 13, 'NURAY SARI işi için renk onayı bekliyorum.'], ['admin', -3, 14, 'Hekimden dönüş bekliyoruz, haber veririm.']]);
  const j0 = jobs.find((j) => j.patient === 'FATMA ERDOĞAN')!; const j1 = jobs.find((j) => j.patient === 'AYLİN KARACA')!;
  chat(`job_${j0.id}`, [['doctor', -7, 11, 'Preparasyon sınırı distalde derin, dikkatli olunmasını rica ederim.'], ['tech', -6, 9, 'Not aldık, tasarımda marjini ayrıca kontrol edeceğiz.'], ['admin', -6, 10, 'Tasarım onayı için görsel yüklenince haber verilecek.']], { doctor: du, tech: tu });
  chat(`job_${j1.id}`, [['tech', -2, 15, 'Makyaj aşamasında renk için fotoğraf lazım.'], ['doctor', -1, 9, 'Fotoğrafı akşam göndereceğim.']], { doctor: du, tech: tu });

  /* denetim kayıtları ve iş geçmişi */
  const aud = (n: number, dayOff: number, hour: number, o: R): void => { const at = Timestamp0(iso(dayOff, hour, n)); const id = `${ms(iso(dayOff, hour, n))}-${n}`; add('auditLog', { id, at, actor: ADMIN_UID, ...o }); };
  aud(1, -1, 17, { coll: 'jobs', docId: j0.id, kind: 'update', status: 'Üretimde' });
  aud(2, -1, 16, { coll: 'payments', docId: pays[2].id, kind: 'create' });
  aud(3, -2, 10, { coll: 'doctorSubmissions', docId: SUB_IDS.s1, kind: 'update', status: 'Aktarıldı' });
  aud(4, -2, 9, { coll: 'jobs', docId: j1.id, kind: 'update', status: 'Makyajda', actor: TECHS[1].id });
  aud(5, -3, 15, { coll: 'jobs', docId: jobs.find((j) => j.patient === 'ELİF KAYA')!.id, kind: 'update', status: 'Tamamlandı' });
  aud(6, -3, 3, { actor: 'system', kind: 'backup', status: 'ok', action: 'Günlük yedek (otomatik)' });
  aud(7, -4, 12, { coll: 'sales', docId: 'x', kind: 'create' });
  aud(8, -4, 3, { actor: 'system', kind: 'backup', status: 'ok', action: 'Günlük yedek (otomatik)' });
  aud(9, -5, 3, { actor: 'system', kind: 'backup', status: 'ok', action: 'Günlük yedek (otomatik)' });
  aud(10, -6, 11, { coll: 'doctors', docId: DOCTORS[1].id, kind: 'update' });
  aud(11, -7, 14, { coll: 'expenses', docId: 'y', kind: 'create' });
  aud(12, -8, 9, { coll: 'pendingJobs', docId: 'z', kind: 'update', status: 'Reddedildi' });
  [[j0, -12, 'Bekliyor'], [j0, -9, 'Tasarımda'], [j1, -6, 'Bekliyor'], [j1, -4, 'Tasarımda'], [j1, -2, 'Üretimde']].forEach(([j, dayOff, before], i) => {
    const jj = j as R; const at = iso(dayOff as number, 14, i);
    addSub(`labs/${LAB}/jobs/${jj.id}/history`, `h${ms(at)}`, { id: `h${ms(at)}`, at: Timestamp0(at), kind: 'status', actor: i % 2 ? TECHS[0].id : ADMIN_UID, before: { status: before, techName: jj.techName ?? '' } });
  });
  return out;
}

const Timestamp0 = (isoStr: string): Timestamp => Timestamp.fromMillis(new Date(isoStr).getTime());
