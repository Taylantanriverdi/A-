import { h, link, type Child } from './dom';
import { btn, guard } from './ui';
import { openFile } from './files';
import { fmtSize } from './format';

export type FileLike = { name?: unknown; path?: unknown; url?: unknown; size?: unknown };

/** Dosya listesi: Storage yolu olanlar kimlikli indirme adresiyle, eski arşiv bağlantıları (url) güvenli bağlantı olarak. */
export function fileChips(files: unknown, empty = '—'): Child {
  const list = (Array.isArray(files) ? files : []) as FileLike[];
  if (!list.length) return h('span', { class: 'muted' }, empty);
  return h('div', { class: 'chips' }, list.map((f) => {
    const label = `📎 ${String(f.name ?? 'dosya')}${f.size ? ` (${fmtSize(f.size)})` : ''}`;
    return f.path ? btn(label, () => void guard(() => openFile(String(f.path))), 'btn ghost') : link(String(f.url ?? '#'), label);
  }));
}

export const STAGES = [['approval', 'Onay bekliyor', '📨'], ['production', 'Üretimde', '🔧'], ['done', 'Tamamlandı', '✅']] as const;
export type Stage = (typeof STAGES)[number][0];

/** Hekim için sadeleştirilmiş aşama göstergesi (Onay → Üretim → Tamam). */
export function stageStepper(stage: Stage, sub?: string): HTMLElement {
  const idx = STAGES.findIndex((s) => s[0] === stage);
  return h('div', { class: 'stepper-wrap' }, h('div', { class: 'stepper' }, STAGES.map(([k, label, icon], i) =>
    h('div', { class: `step ${i < idx ? 'done' : i === idx ? 'cur' : ''}`, 'data-stage': k }, h('span', { class: 'dot' }, i < idx ? '✓' : icon), h('span', null, label)))),
  sub ? h('small', { class: 'muted' }, sub) : null);
}

/** Sekme çubuğu (düğme listesi); etkin sekme vurgulanır. */
export function tabBar(tabs: [string, string][], current: string, onPick: (id: string) => void): HTMLElement {
  return h('div', { class: 'tabs', role: 'tablist' }, tabs.map(([id, label]) => h('button', { class: `tab ${id === current ? 'active' : ''}`, role: 'tab', 'aria-selected': String(id === current), type: 'button', on: { click: () => onPick(id) } }, label)));
}

export const empty = (msg: string): HTMLElement => h('p', { class: 'muted empty' }, msg);
