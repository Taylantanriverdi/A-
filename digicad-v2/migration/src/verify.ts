import { canonical } from './canonical';
import { getAt, isObj, SECRET_RE, NESTED_ARRAY_KEY, RESERVED_KEY_PREFIX, ID_COERCE_KEYS, entriesOf, type PlannedDoc } from './transform';

/**
 * BAĞIMSIZ kayıp denetimi: dönüşüm koduna güvenmez. Ham kaynak JSON'daki (sourcePath) kaydı alır ve
 * HEDEFTEKİ belgede (dry-run'da plan, execute'ta Firestore'dan geri okunan) her alanın bulunduğunu kontrol eder.
 * Yalnızca belgelenmiş dönüşümlere izin verir: gizli alan atma (hekim/teknisyen üst düzey), yasak anahtar öneki,
 * iç içe dizi sarma, kimlik alanlarında sayı->metin, techIds metne çevirme. Hedefte EK alanlar serbesttir.
 */
const mapKey = (k: string): string => (k === '' ? 'x(bos)' : /^__.*__$/.test(k) ? RESERVED_KEY_PREFIX + k : k);

function cover(src: unknown, tgt: unknown, path: string, out: string[]): void {
  if (src === null || src === undefined) return; // RTDB'de null = yok
  if (Array.isArray(src)) {
    if (!Array.isArray(tgt)) { out.push(`${path}: dizi bekleniyordu`); return; }
    if (tgt.length !== src.length) out.push(`${path}: dizi uzunluğu ${src.length} -> ${tgt.length}`);
    src.forEach((x, i) => {
      if (Array.isArray(x)) { const w = tgt[i]; if (!isObj(w) || !(NESTED_ARRAY_KEY in w)) out.push(`${path}[${i}]: iç içe dizi sarmalı yok`); else cover(x, w[NESTED_ARRAY_KEY], `${path}[${i}]`, out); }
      else cover(x, tgt[i], `${path}[${i}]`, out);
    });
    return;
  }
  if (isObj(src)) {
    if (!isObj(tgt)) { out.push(`${path}: nesne bekleniyordu`); return; }
    for (const [k, v] of Object.entries(src)) {
      if (v === null || v === undefined) continue;
      const tk = mapKey(k);
      if (!Object.prototype.hasOwnProperty.call(tgt, tk)) { out.push(`${path}.${k}: alan hedefte yok`); continue; }
      cover(v, tgt[tk], `${path}.${k}`, out);
    }
    return;
  }
  if (src !== tgt) out.push(`${path}: değer farklı (${JSON.stringify(src)} -> ${JSON.stringify(tgt)})`);
}

// Üst düzey sarmalayıcı: anahtar adını bilen sürüm
function coverTop(src: Json2, tgt: Json2, collection: string, out: string[]): void {
  for (const [k, v] of Object.entries(src)) {
    if (v === null || v === undefined) continue;
    if ((collection.endsWith('/doctors') || collection.endsWith('/technicians')) && SECRET_RE.test(k)) continue; // bilinçli taşınmayan
    const tk = k === '_legacy' ? '_legacy_kaynak' : mapKey(k);
    if (!Object.prototype.hasOwnProperty.call(tgt, tk)) { out.push(`${k}: alan hedefte yok`); continue; }
    const tv = tgt[tk];
    if (ID_COERCE_KEYS.includes(k) && (typeof v === 'number' || typeof v === 'string') && String(v) === String(tv)) continue;
    if (k === 'techIds') {
      const vals = Array.isArray(v) ? v : isObj(v) ? Object.values(v) : [v];
      const t = new Set(Array.isArray(tv) ? tv.map(String) : []);
      for (const x of vals) if (x != null && x !== '' && !t.has(String(x))) out.push(`techIds elemanı kayıp: ${String(x)}`);
      continue;
    }
    cover(v, tv, k, out);
  }
}
type Json2 = Record<string, unknown>;

/** Bir planlanan belge için kayıp alanları döndürür (boş = tam kapsama). */
export function lostFields(root: unknown, d: PlannedDoc, target: Json2 | undefined): string[] {
  if (!target) return ['belge hedefte yok'];
  const raw = getAt(root, d.sourcePath);
  if (raw === undefined || raw === null) return [`kaynak kayıt bulunamadı: ${d.sourcePath.join('/')}`];
  const out: string[] = [];
  if (d.cover === 'list') {
    const items = entriesOf(raw).map(([, v]) => v); const t = target.items;
    if (!Array.isArray(t)) return ['items dizisi yok'];
    items.forEach((x, i) => { if (canonical(x) !== canonical(t[i])) { const w: string[] = []; cover(x, t[i], `items[${i}]`, w); if (w.length) out.push(...w); } });
    return out;
  }
  if (!isObj(raw)) return [`kaynak kayıt nesne değil: ${d.sourcePath.join('/')}`];
  const src: Json2 = { ...raw };
  if (d.cover === 'thread') delete src.messages;
  if (d.cover === 'settings') delete src.id;
  coverTop(src, target, d.collection, out);
  return out;
}
