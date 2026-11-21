import { formatTeeth } from './teeth';

export const fmtMoney = (n: unknown, cur = 'TRY'): string => {
  const v = Number(n) || 0;
  try { return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: cur || 'TRY' }).format(v); } catch { return v.toFixed(2) + ' ' + cur; }
};
export const fmtDate = (d: unknown): string => {
  if (!d) return '';
  const x = new Date(d as string);
  return isNaN(+x) ? String(d) : x.toLocaleDateString('tr-TR');
};
/** Laboratuvar saat dilimi: gün/ay sınırları UTC'ye değil İstanbul'a göredir (gece yarısı kayması olmaz). */
export const LAB_TZ = 'Europe/Istanbul';
/** 'YYYY-MM-DD' ise aynen; zaman damgası ise İstanbul yerel tarihi. Geçersizse ''. */
export function isoToLocalDate(v: unknown, tz: string = LAB_TZ): string {
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!s || isNaN(+d)) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export const todayLocal = (now: Date = new Date()): string => isoToLocalDate(now.toISOString());
export const monthLocal = (v: unknown): string => isoToLocalDate(v).slice(0, 7);
/** Eski adlar (bugün/ay) artık İstanbul saatine göredir. */
export const todayISO = (): string => todayLocal();
export const monthOf = monthLocal;
export const JOB_STATUSES = ['Bekliyor', 'Tasarımda', 'Üretimde', 'Makyajda', 'Tamamlama Onayı', 'Tamamlandı'] as const;
export const TECH_STATUSES = JOB_STATUSES.filter((s) => s !== 'Tamamlandı');
export const STATUS_ICONS: Record<string, string> = { Bekliyor: '⏳', Tasarımda: '🎨', Üretimde: '🔧', Makyajda: '💄', 'Tamamlama Onayı': '📨', Tamamlandı: '✅' };
/**
 * Göçle gelen eski veride bilinmeyen/eski yazımlı durum olabilir (ör. 'Bekleyen'): eski yazımlar kanonik değere eşlenir,
 * bilinmeyenler olduğu gibi (ikonsuz) gösterilir; arayüz çökmez, seçicide mevcut değer ayrıca listelenir.
 */
export const LEGACY_STATUS: Record<string, string> = { Bekleyen: 'Bekliyor' };
/** Eski yazım varyantını kanonik duruma çevirir (bilinmeyen değer aynen döner). */
export const normStatus = (s: unknown): string => { const raw = String(s ?? '').trim(); return LEGACY_STATUS[raw] ?? raw; };
export const isKnownStatus = (s: unknown): boolean => (JOB_STATUSES as readonly string[]).includes(String(s));
export const statusLabel = (s: unknown): string => {
  const raw = String(s ?? '').trim(); if (!raw) return '—';
  const k = LEGACY_STATUS[raw] ?? raw;
  return `${STATUS_ICONS[k] ?? '•'} ${raw}`;
};
/** Durum seçicisi seçenekleri: kanonik durumlar; mevcut değer bilinmiyorsa en başa eklenir (seçili kalsın, kaydederken sessizce değişmesin). */
export function statusOptions(current: unknown, list: readonly string[] = JOB_STATUSES): [string, string][] {
  const opts = list.map((x): [string, string] => [x, `${STATUS_ICONS[x] ?? ''} ${x}`.trim()]);
  const cur = String(current ?? '');
  return cur && !list.includes(cur) ? [[cur, `${STATUS_ICONS[LEGACY_STATUS[cur] ?? ''] ?? '•'} ${cur} (eski)`], ...opts] : opts;
}
export const fmtSize = (n: unknown): string => {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(0)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
};
export const trUpper = (s: unknown): string => String(s ?? '').toLocaleUpperCase('tr-TR');
export const fmtDateTime = (d: unknown): string => {
  if (!d) return '';
  const x = new Date(d as string);
  return isNaN(+x) ? String(d) : x.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
};
/** Teslim tarihi (YYYY-AA-GG) geçmiş mi? */
export const isOverdue = (dateout: unknown, today: string = todayLocal()): boolean => typeof dateout === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateout) && dateout.slice(0, 10) < today;

/* ---------- Dosya/ZIP adları ve iş bilgi metni (saf) ---------- */
export const safeName = (s: unknown, max = 80): string => String(s ?? '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, '_').replace(/^\.+/, '_').replace(/\s+/g, ' ').trim().slice(0, max) || 'dosya';
/** Aynı adlı dosyaları ZIP içinde ezmemek için benzersizleştirir: a.stl, a (2).stl */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = n.toLowerCase(); const c = (seen.get(k) ?? 0) + 1; seen.set(k, c);
    if (c === 1) return n;
    const dot = n.lastIndexOf('.'); return dot > 0 ? `${n.slice(0, dot)} (${c})${n.slice(dot)}` : `${n} (${c})`;
  });
}
export function jobInfoText(j: Record<string, any>, kind: 'scan' | 'design' = 'scan'): string {
  const teeth = formatTeeth(j.orderForm?.teeth);
  const files = (Array.isArray(kind === 'design' ? j.designFiles : j.files) ? (kind === 'design' ? j.designFiles : j.files) : []) as Record<string, any>[];
  return ['DIGICAD DENTAL LABORATUVAR — İŞ BİLGİSİ', '='.repeat(48), `Hekim         : ${j.drName ?? '—'}`, `Hasta         : ${j.patient ?? '—'}`, `İş Türü       : ${j.type ?? '—'}`, `Dişler        : ${teeth || '—'}`, `Diş Rengi     : ${j.toothColor ?? '—'}`,
    `Teslim Tarihi : ${j.dateout ? isoToLocalDate(j.dateout) : '—'}`, `Durum         : ${j.status ?? '—'}`, '', 'Notlar:', String(j.note || '—'), '', kind === 'design' ? 'Tasarım dosyaları:' : 'Tarama dosyaları:', ...(files.length ? files.map((f, k) => `  ${k + 1}. ${f.name}`) : ['  —'])].join('\r\n');
}
