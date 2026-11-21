export const fmtMoney = (n: unknown, cur = 'TRY'): string => {
  const v = Number(n) || 0;
  try { return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: cur || 'TRY' }).format(v); } catch { return v.toFixed(2) + ' ' + cur; }
};
export const fmtDate = (d: unknown): string => {
  if (!d) return '';
  const x = new Date(d as string);
  return isNaN(+x) ? String(d) : x.toLocaleDateString('tr-TR');
};
export const todayISO = (): string => new Date().toISOString().slice(0, 10);
export const monthOf = (d: unknown): string => String(d ?? '').slice(0, 7);
export const JOB_STATUSES = ['Bekliyor', 'Tasarımda', 'Üretimde', 'Makyajda', 'Tamamlama Onayı', 'Tamamlandı'] as const;
export const TECH_STATUSES = JOB_STATUSES.filter((s) => s !== 'Tamamlandı');
export const STATUS_ICONS: Record<string, string> = { Bekliyor: '⏳', Tasarımda: '🎨', Üretimde: '🔧', Makyajda: '💄', 'Tamamlama Onayı': '📨', Tamamlandı: '✅' };
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
export const isOverdue = (dateout: unknown, today: string = todayISO()): boolean => typeof dateout === 'string' && dateout.length >= 10 && dateout.slice(0, 10) < today;
