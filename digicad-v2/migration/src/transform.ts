import { canonical, hashRecord } from './canonical';

export const KNOWN_WORKSPACES: Record<string, string> = { digicad: 'digicad', primer: 'primer' };
export const RECORD_COLLECTIONS = ['doctors', 'technicians', 'jobs', 'pendingJobs', 'payments', 'expenses', 'sales', 'orderForms', 'doctorSubmissions', 'statementClosures'] as const;
/** Taşınmayan gizli alanlar (düz metin şifre/PIN); büyük/küçük harf duyarsız, yalnızca hekim/teknisyen kaydının üst düzeyinde. */
export const SECRET_RE = /^(pass|password|passwd|pwd|pin|sifre|şifre|parola)$/i;
/** Gizli olabilecek ama TAŞINAN alanlar için uyarı kalıbı. */
const SUSPECT_RE = /pass|pwd|sifre|şifre|parola|secret|apikey|api_key/i;
export const NESTED_ARRAY_KEY = '_nestedArray';
export const RESERVED_KEY_PREFIX = 'x';
/** Firestore 1 MiB sınırının altında güvenlik payı. */
export const MAX_DOC_BYTES = 1_000_000;
const MAX_DEPTH = 19;
/** Üst düzeyde tür dönüşümü (sayı -> metin) uygulanabilen kimlik alanları; doğrulama bunlarda String() eşitliğini kabul eder. */
export const ID_COERCE_KEYS = ['techId', 'doctorId'];
const LEGACY_ROOT_KEYS = [...RECORD_COLLECTIONS, 'mailFilters', 'chats'];

export interface PlannedDoc {
  path: string; collection: string; data: Record<string, unknown>; hash: string; sourceKey: string;
  /** Kaynak JSON içindeki konum (bağımsız doğrulama bu yoldan ham veriyi okur). */
  sourcePath: string[]; cover: 'doc' | 'thread' | 'list' | 'settings';
}
export interface Unmigrated { path: string; reason: string; leaves: number }
export interface Plan {
  docs: PlannedDoc[];
  errors: string[];
  warnings: string[];
  skipped: { what: string; reason: string }[];
  unmigrated: Unmigrated[];
  strippedSecrets: number;
  sourceCounts: Record<string, number>; // "lab/koleksiyon" -> kaynak kayıt sayısı
  legacyRoot: { included: number; found: number };
  leaf: { total: number; accounted: number };
}
export interface PlanOptions { includeLegacyRoot?: boolean; ignoreLegacyRoot?: boolean; ignoreUnknown?: boolean }
type Json = Record<string, unknown>;
export const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);

/** RTDB'nin dizi/obje ikiliğini tek biçime indirger: [key, value][] (null/boş atlanır). */
export function entriesOf(node: unknown): [string, unknown][] {
  if (node == null) return [];
  if (Array.isArray(node)) return node.map((v, i): [string, unknown] => [String(i), v]).filter(([, v]) => v != null);
  if (isObj(node)) return Object.entries(node).filter(([, v]) => v != null);
  return [];
}
export function getAt(root: unknown, segs: string[]): unknown {
  let cur: unknown = root;
  for (const s of segs) {
    if (Array.isArray(cur)) cur = cur[Number(s)];
    else if (isObj(cur) && Object.prototype.hasOwnProperty.call(cur, s)) cur = cur[s];
    else return undefined;
  }
  return cur;
}
export function countLeaves(v: unknown): number {
  if (v == null) return 0;
  if (Array.isArray(v)) return v.reduce<number>((a, x) => a + countLeaves(x), 0);
  if (isObj(v)) return Object.values(v).reduce<number>((a, x) => a + countLeaves(x), 0);
  return 1;
}

// ---- Firestore uyumluluğu -------------------------------------------------
interface Ctx { errors: string[]; renamed: string[]; nested: string[]; where: string }
const wellFormed = (s: string): boolean => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
const reservedKey = (k: string) => k === '' || /^__.*__$/.test(k);
const fixKey = (k: string, top: boolean): string => (k === '' ? 'x(bos)' : reservedKey(k) ? RESERVED_KEY_PREFIX + k : top && k === '_legacy' ? '_legacy_kaynak' : k);

/** Değeri Firestore'un kabul edeceği biçime getirir; HİÇBİR değeri sessizce atmaz (iç içe dizi sarılır, yasak anahtar yeniden adlandırılır, olmayanlar hata verir). */
export function sanitize(v: unknown, path: string, ctx: Ctx, depth = 0, top = false): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) ctx.errors.push(`${ctx.where}: sonsuz/NaN sayı (${path})`);
    else if (Number.isInteger(v) && !Number.isSafeInteger(v)) ctx.errors.push(`${ctx.where}: ${path} güvenli tam sayı sınırını aşıyor (kesinlik kaybı; kaynak dosyada metin yapın)`);
    return v;
  }
  if (typeof v === 'string') { if (!wellFormed(v)) ctx.errors.push(`${ctx.where}: ${path} geçersiz Unicode (tek başına vekil karakter)`); return v; }
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'object') { ctx.errors.push(`${ctx.where}: ${path} desteklenmeyen tür ${typeof v}`); return null; }
  if (depth > MAX_DEPTH) { ctx.errors.push(`${ctx.where}: ${path} iç içe nesne derinliği Firestore sınırını (20) aşıyor`); return null; }
  if (Array.isArray(v)) {
    return v.map((x, i) => {
      if (Array.isArray(x)) { ctx.nested.push(`${path}[${i}]`); return { [NESTED_ARRAY_KEY]: sanitize(x, `${path}[${i}]`, ctx, depth + 2) }; }
      return sanitize(x, `${path}[${i}]`, ctx, depth + 1);
    });
  }
  const out: Json = {};
  for (const [k, val] of Object.entries(v as Json)) {
    const nk = fixKey(k, top);
    if (nk !== k) ctx.renamed.push(`${path}.${k} -> ${nk}`);
    if (Object.prototype.hasOwnProperty.call(out, nk)) { ctx.errors.push(`${ctx.where}: ${path}.${k} yeniden adlandırma çakışması`); continue; }
    Object.defineProperty(out, nk, { value: sanitize(val, `${path}.${k}`, ctx, depth + 1), enumerable: true, writable: true, configurable: true });
  }
  return out;
}
const validDocId = (k: string) => k.length > 0 && Buffer.byteLength(k) <= 1500 && !k.includes('/') && k !== '.' && k !== '..' && !/^__.*__$/.test(k) && wellFormed(k);

export function transformRecord(collection: string, key: string, rec: Json, ws: string, ctx?: Ctx): { data: Json; stripped: number; suspect: string[] } {
  const c: Ctx = ctx ?? { errors: [], renamed: [], nested: [], where: `${ws}/${collection}/${key}` };
  const src: Json = { ...rec };
  let stripped = 0; const suspect: string[] = [];
  if (collection === 'doctors' || collection === 'technicians') for (const f of Object.keys(src)) if (SECRET_RE.test(f)) { delete src[f]; stripped++; }
  for (const f of Object.keys(src)) if (SUSPECT_RE.test(f)) suspect.push(f);
  const data = sanitize(src, '', c, 0, true) as Json;
  if (data.id == null) data.id = isNaN(Number(key)) ? key : Number(key);
  if (['jobs', 'pendingJobs', 'orderForms', 'payments', 'doctorSubmissions', 'statementClosures'].includes(collection)) {
    const dr = data.doctorId ?? data.drId;
    if (dr !== undefined && dr !== null) data.doctorId = String(dr);
    else if (collection === 'jobs' || collection === 'pendingJobs') data.doctorId = ''; // validJob kuralı doctorId metni ister
    if (collection === 'jobs' || collection === 'pendingJobs') {
      const ti = Array.isArray(data.techIds) ? data.techIds : isObj(data.techIds) ? Object.values(data.techIds) : undefined;
      data.techIds = ti ? (ti as unknown[]).filter((x) => x != null && x !== '').map(String) : data.techId != null && data.techId !== '' ? [String(data.techId)] : [];
    }
    // Kurallar pendingJobs.techId'yi metinle karşılaştırır (resource.data.techId == myTechId()).
    if (collection === 'pendingJobs' && data.techId != null && typeof data.techId !== 'string') data.techId = String(data.techId);
  }
  // Hekim/teknisyen portalları çöpü `where('deleted','==',false)` ile süzer (kurallar sorguda bunu şart koşar): alanı olmayan eski kayıt listede çıkmazdı.
  // Alan yoksa false yazılır (eski uygulama silinmemişi alansız tutardı; silinmişi deleted:true).
  if (['jobs', 'pendingJobs', 'doctorSubmissions'].includes(collection) && data.deleted == null) data.deleted = false;
  const legacy: Json = { workspace: ws, key };
  if (collection === 'jobs' && (data.status == null || data.status === '')) { data.status = 'Bekliyor'; legacy.defaultedStatus = true; } // eski kod durumu olmayan işi açık sayardı; kurallar durum ister
  if (c.renamed.length) legacy.renamedKeys = c.renamed;
  if (c.nested.length) legacy.nestedArrays = c.nested;
  data._legacy = legacy;
  return { data, stripped, suspect };
}

function chooseTrees(root: Json, plan: Plan): { trees: { ws: string; seg: string[]; direct: boolean }[]; legacy: { key: string; seg: string[] }[]; strayKeys: string[] } {
  const hasDb = isObj(root.db);
  const dbSeg = hasDb ? ['db'] : [];
  const dbNode = (hasDb ? root.db : root) as Json;
  const trees: { ws: string; seg: string[]; direct: boolean }[] = [];
  for (const ws of Object.keys(KNOWN_WORKSPACES)) if (isObj(dbNode[ws])) trees.push({ ws, seg: [...dbSeg, ws], direct: false });
  const hasLegacyKeys = [...RECORD_COLLECTIONS, 'settings', 'mailFilters', 'chats', 'pass'].some((k) => dbNode[k] != null);
  const legacy: { key: string; seg: string[] }[] = [];
  if (!trees.some((t) => t.ws === 'digicad') && hasLegacyKeys) {
    // Eski kök yapı (db/doctors...) ve db/digicad yok: eski uygulama bunu digicad'a taşırdı.
    trees.unshift({ ws: 'digicad', seg: dbSeg, direct: true });
    plan.warnings.push('db/digicad yok, eski kök yapı (db/doctors, db/jobs ...) digicad çalışma alanı olarak ele alındı.');
  } else if (hasLegacyKeys) {
    for (const k of LEGACY_ROOT_KEYS) if (dbNode[k] != null) legacy.push({ key: k, seg: [...dbSeg, k] });
  }
  if (hasDb && root.chats != null) legacy.push({ key: 'chats', seg: ['chats'] });
  const strayKeys = Object.keys(root).filter((k) => root[k] != null && (hasDb ? !['db', 'meta', 'chats'].includes(k) : !['meta'].includes(k) && !Object.keys(KNOWN_WORKSPACES).includes(k) && ![...RECORD_COLLECTIONS, 'settings', 'mailFilters', 'chats', 'pass'].includes(k)));
  return { trees, legacy, strayKeys };
}

export function buildPlan(root: unknown, opts: PlanOptions = {}): Plan {
  const plan: Plan = { docs: [], errors: [], warnings: [], skipped: [], unmigrated: [], strippedSecrets: 0, sourceCounts: {}, legacyRoot: { included: 0, found: 0 }, leaf: { total: 0, accounted: 0 } };
  if (!isObj(root)) { plan.errors.push('Dışa aktarım bir JSON nesnesi olmalı.'); return plan; }
  const { trees, legacy, strayKeys } = chooseTrees(root, plan);
  if (!trees.length) plan.errors.push('Dışa aktarımda tanınan çalışma alanı (db/digicad veya db/primer) bulunamadı.');
  const seen = new Set<string>();
  const unknownErr = (path: string, leaves: number, reason: string) => {
    plan.unmigrated.push({ path, reason, leaves });
    const msg = `${path}: ${reason}, TAŞINMADI (${leaves} değer)`;
    if (opts.ignoreUnknown) plan.warnings.push(msg); else plan.errors.push(msg + ' — gözden geçirin veya --ignore-unknown ile bilerek yok sayın');
  };
  const add = (d: Omit<PlannedDoc, 'hash'>) => {
    if (seen.has(d.path)) { plan.errors.push(`Yinelenen hedef yol: ${d.path}`); return; }
    seen.add(d.path);
    const bytes = Buffer.byteLength(JSON.stringify(d.data));
    if (bytes > MAX_DOC_BYTES) plan.errors.push(`${d.path}: belge ${bytes} bayt, Firestore 1 MiB sınırını aşıyor`);
    plan.docs.push({ ...d, hash: hashRecord(d.data) });
  };
  const countFor = (k: string, n = 1) => { plan.sourceCounts[k] = (plan.sourceCounts[k] ?? 0) + n; };
  const addRecord = (lab: string, ws: string, c: string, key: string, v: unknown, seg: string[]) => {
    if (!isObj(v)) { plan.errors.push(`${lab}/${c}/${key}: kayıt nesne değil`); return; }
    if (!validDocId(key)) { plan.errors.push(`${lab}/${c}/${key}: geçersiz belge kimliği (anahtar)`); return; }
    const ctx: Ctx = { errors: [], renamed: [], nested: [], where: `${lab}/${c}/${key}` };
    const { data, stripped, suspect } = transformRecord(c, key, v, ws, ctx);
    plan.errors.push(...ctx.errors); plan.strippedSecrets += stripped;
    if (ctx.nested.length) plan.warnings.push(`${lab}/${c}/${key}: iç içe dizi ${ctx.nested.length} yerde {${NESTED_ARRAY_KEY}} ile sarıldı (Firestore desteklemez): ${ctx.nested.join(', ')}`);
    if (ctx.renamed.length) plan.warnings.push(`${lab}/${c}/${key}: ${ctx.renamed.length} yasak alan adı yeniden adlandırıldı (${ctx.renamed.join(', ')})`);
    if (suspect.length) plan.warnings.push(`${lab}/${c}/${key}: olası gizli alan(lar) TAŞINDI: ${suspect.join(', ')} — elle inceleyin`);
    add({ path: `labs/${lab}/${c}/${key}`, collection: `${lab}/${c}`, data, sourceKey: key, sourcePath: seg, cover: 'doc' });
  };
  const addThread = (lab: string, ws: string, tid: string, t: unknown, seg: string[]) => {
    if (!validDocId(tid) || !isObj(t)) { plan.errors.push(`${lab}/chats/${tid}: geçersiz konuşma`); return; }
    countFor(`${lab}/threads`);
    const { messages, ...rest } = t;
    const tctx: Ctx = { errors: [], renamed: [], nested: [], where: `${lab}/threads/${tid}` };
    const tdata = sanitize(rest, '', tctx, 0, true) as Json; plan.errors.push(...tctx.errors);
    tdata.id = tid; tdata._legacy = { workspace: ws, key: tid };
    add({ path: `labs/${lab}/threads/${tid}`, collection: `${lab}/threads`, data: tdata, sourceKey: tid, sourcePath: seg, cover: 'thread' });
    if (messages != null && typeof messages !== 'object') { plan.errors.push(`${lab}/chats/${tid}/messages: beklenmeyen tür`); return; }
    for (const [mid, m] of entriesOf(messages)) {
      countFor(`${lab}/threads/messages`);
      if (!isObj(m) || !validDocId(mid)) { plan.errors.push(`${lab}/chats/${tid}/messages/${mid}: geçersiz mesaj`); continue; }
      const ctx: Ctx = { errors: [], renamed: [], nested: [], where: `${lab}/threads/${tid}/messages/${mid}` };
      const data = sanitize(m, '', ctx, 0, true) as Json; plan.errors.push(...ctx.errors);
      if (data.id == null) data.id = isNaN(Number(mid)) ? mid : Number(mid);
      const legacy: Json = { workspace: ws, key: mid };
      if (data.timestamp == null) { // yeni uygulama timestamp'e göre sıralar; yoksa mesaj görünmez olur
        const ms = Number(m.id ?? mid); const iso = Number.isFinite(ms) && ms > 1e11 && ms < 4e12 ? new Date(ms).toISOString() : undefined;
        if (iso) { data.timestamp = iso; legacy.derivedTimestamp = true; } else plan.warnings.push(`${ctx.where}: timestamp yok ve türetilemedi (mesaj sıralamada görünmeyebilir)`);
      }
      if (ctx.renamed.length) legacy.renamedKeys = ctx.renamed;
      if (ctx.nested.length) legacy.nestedArrays = ctx.nested;
      data._legacy = legacy;
      add({ path: `labs/${lab}/threads/${tid}/messages/${mid}`, collection: `${lab}/threads/messages`, data, sourceKey: `${tid}/${mid}`, sourcePath: [...seg, 'messages', mid], cover: 'doc' });
    }
  };
  const knownTop = new Set<string>([...RECORD_COLLECTIONS, 'settings', 'mailFilters', 'chats', 'pass']);

  for (const { ws, seg, direct } of trees) {
    const lab = KNOWN_WORKSPACES[ws];
    const tree = getAt(root, seg) as Json;
    plan.leaf.total += countLeaves(Object.fromEntries(Object.entries(tree).filter(([k]) => !(direct && Object.keys(KNOWN_WORKSPACES).includes(k)))));
    for (const c of RECORD_COLLECTIONS) {
      const node = tree[c];
      if (node != null && typeof node !== 'object') { plan.errors.push(`${lab}/${c}: beklenmeyen tür (${typeof node}); nesne/dizi olmalı`); continue; }
      const ents = entriesOf(node);
      plan.sourceCounts[`${lab}/${c}`] = ents.length;
      for (const [key, v] of ents) { addRecord(lab, ws, c, key, v, [...seg, c, key]); plan.leaf.accounted += countLeaves(v); }
    }
    if (tree.settings != null) {
      if (!isObj(tree.settings)) plan.errors.push(`${lab}/settings: nesne değil`);
      else {
        plan.sourceCounts[`${lab}/settings`] = 1;
        const ctx: Ctx = { errors: [], renamed: [], nested: [], where: `${lab}/settings` };
        const data = sanitize(tree.settings, '', ctx, 0, true) as Json; plan.errors.push(...ctx.errors);
        const legacyS: Json = { workspace: ws, key: 'settings' };
        if (data.id !== undefined) legacyS.originalId = data.id;
        if (ctx.renamed.length) legacyS.renamedKeys = ctx.renamed; if (ctx.nested.length) legacyS.nestedArrays = ctx.nested;
        data.id = 'main'; data._legacy = legacyS;
        add({ path: `labs/${lab}/settings/main`, collection: `${lab}/settings`, data, sourceKey: 'settings', sourcePath: [...seg, 'settings'], cover: 'settings' });
        plan.leaf.accounted += countLeaves(tree.settings);
      }
    } else plan.sourceCounts[`${lab}/settings`] = 0;
    if (tree.mailFilters != null) {
      if (typeof tree.mailFilters !== 'object') plan.errors.push(`${lab}/mailFilters: dizi/nesne değil`);
      else {
        const ents = entriesOf(tree.mailFilters); const ctx: Ctx = { errors: [], renamed: [], nested: [], where: `${lab}/mailFilters` };
        const items = ents.map(([, v]) => sanitize(v, '', ctx)); plan.errors.push(...ctx.errors);
        const legacyM: Json = { workspace: ws, key: 'mailFilters', shape: Array.isArray(tree.mailFilters) ? 'array' : 'object' };
        if (!Array.isArray(tree.mailFilters)) legacyM.keys = ents.map(([k]) => k);
        if (ctx.nested.length) legacyM.nestedArrays = ctx.nested;
        plan.sourceCounts[`${lab}/mailFilters`] = 1;
        add({ path: `labs/${lab}/mailFilters/main`, collection: `${lab}/mailFilters`, data: { id: 'main', items, _legacy: legacyM }, sourceKey: 'mailFilters', sourcePath: [...seg, 'mailFilters'], cover: 'list' });
        plan.leaf.accounted += countLeaves(tree.mailFilters);
      }
    } else plan.sourceCounts[`${lab}/mailFilters`] = 0;
    if (tree.chats != null && typeof tree.chats !== 'object') plan.errors.push(`${lab}/chats: beklenmeyen tür`);
    plan.sourceCounts[`${lab}/threads`] ??= 0; plan.sourceCounts[`${lab}/threads/messages`] ??= 0;
    for (const [tid, t] of entriesOf(tree.chats)) { addThread(lab, ws, tid, t, [...seg, 'chats', tid]); plan.leaf.accounted += countLeaves(t); }
    if (tree.pass != null) { plan.skipped.push({ what: `${lab}/pass`, reason: 'Düz metin yönetici şifresi/PIN taşınmaz' }); plan.leaf.accounted += countLeaves(tree.pass); }
    for (const k of Object.keys(tree)) {
      if (tree[k] == null || knownTop.has(k) || (direct && Object.keys(KNOWN_WORKSPACES).includes(k))) continue;
      const leaves = countLeaves(tree[k]); plan.leaf.accounted += leaves;
      unknownErr(`${[...seg, k].join('/')}`, leaves, 'tanınmayan üst düzey anahtar');
    }
  }

  // ---- Eski kök yapı (db/doctors ... ) db/digicad ile birlikte duruyorsa: yalnızca digicad'da OLMAYAN kayıtlar kayıp riskidir ----
  const dig = trees.find((t) => t.ws === 'digicad');
  for (const { key, seg } of legacy) {
    const node = getAt(root, seg);
    if (key === 'mailFilters') {
      const dTree = dig ? (getAt(root, dig.seg) as Json) : {};
      const have = new Set(entriesOf(dTree.mailFilters).map(([, v]) => canonical(v)));
      const only = entriesOf(node).map(([, v]) => v).filter((v) => !have.has(canonical(v)));
      plan.leaf.total += countLeaves(node);
      if (only.length) { plan.legacyRoot.found += only.length; plan.warnings.push(`eski kök ${seg.join('/')}: digicad'da olmayan ${only.length} mail filtresi var (${opts.includeLegacyRoot ? 'birleştirildi' : '--include-legacy-root ile eklenir'})`);
        if (opts.includeLegacyRoot) { const m = plan.docs.find((d) => d.path === 'labs/digicad/mailFilters/main'); const ctx: Ctx = { errors: [], renamed: [], nested: [], where: 'legacy mailFilters' };
          if (m) { (m.data.items as unknown[]).push(...only.map((v) => sanitize(v, '', ctx))); m.hash = hashRecord(m.data); plan.legacyRoot.included += only.length; } } }
      plan.leaf.accounted += countLeaves(node);
      continue;
    }
    plan.leaf.total += countLeaves(node);
    plan.leaf.accounted += countLeaves(node);
    const target = dig ? (getAt(root, dig.seg) as Json)[key] : undefined;
    const haveIds = new Set(entriesOf(target).map(([k]) => k));
    let only = 0;
    for (const [k, v] of entriesOf(node)) {
      if (haveIds.has(k)) continue;
      only++; plan.legacyRoot.found++;
      if (!opts.includeLegacyRoot) continue;
      if (key === 'chats') { countFor('digicad/threads', 0); addThread('digicad', 'root', k, v, [...seg, k]); plan.legacyRoot.included++; }
      else { countFor(`digicad/${key}`); addRecord('digicad', 'root', key, k, v, [...seg, k]); plan.legacyRoot.included++; }
    }
    if (only) {
      const msg = `eski kök ${seg.join('/')}: digicad'da bulunmayan ${only} kayıt var (eski uygulama bunları görmezdi)`;
      if (opts.includeLegacyRoot) plan.warnings.push(msg + ' — --include-legacy-root ile EKLENDİ');
      else if (opts.ignoreLegacyRoot) plan.warnings.push(msg + ' — --ignore-legacy-root ile bilerek YOK SAYILDI');
      else plan.errors.push(msg + ' — kayıp riski: --include-legacy-root ile ekleyin veya kaynağı inceleyip --ignore-legacy-root ile bilerek yok sayın');
    }
  }
  // chats içindeki mesaj sayısı kök chats için de sayılmalı
  if (isObj(root.meta)) for (const [k, v] of Object.entries(root.meta)) {
    if (v == null) continue;
    if (k === 'pass') plan.skipped.push({ what: 'meta/pass', reason: 'Eski yönetici şifresi taşınmaz' });
    else if (k === 'migratedToWorkspaces' || k === 'migrationDate') plan.skipped.push({ what: `meta/${k}`, reason: 'Eski göç bayrağı, yeni sistemde anlamsız' });
    else unknownErr(`meta/${k}`, countLeaves(v), 'tanınmayan meta anahtarı');
  }
  for (const k of strayKeys) unknownErr(k, countLeaves(root[k]), 'tanınmayan kök anahtar');
  if (plan.leaf.total !== plan.leaf.accounted) plan.errors.push(`Değer muhasebesi tutmuyor: kaynakta ${plan.leaf.total} değer, hesaplanan ${plan.leaf.accounted} (sessiz kayıp şüphesi)`);
  return plan;
}
export { canonical };
