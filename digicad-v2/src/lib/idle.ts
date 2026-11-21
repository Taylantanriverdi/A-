/** Hareketsizlik zaman aşımı: etkinlik olmadan `limitMs` geçerse `onTimeout` çağrılır (uyku/askıdan dönüşte de denetlenir). */
export interface IdleOpts {
  limitMs: number;
  onTimeout: () => void;
  /** Sona ermeden bu kadar ms önce uyarı. */
  warnMs?: number;
  onWarn?: (msLeft: number) => void;
  now?: () => number;
  checkEveryMs?: number;
  target?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
}
export const IDLE_LIMITS = { admin: 20 * 60_000, other: 30 * 60_000 } as const;
const EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;

export function startIdleWatch(o: IdleOpts): () => void {
  const now = o.now ?? Date.now; const target = o.target ?? document;
  let last = now(); let warned = false; let done = false;
  const bump = () => { last = now(); warned = false; };
  const check = () => {
    if (done) return;
    const idle = now() - last;
    if (idle >= o.limitMs) { done = true; stop(); o.onTimeout(); return; }
    if (o.warnMs && !warned && o.limitMs - idle <= o.warnMs) { warned = true; o.onWarn?.(o.limitMs - idle); }
  };
  const onVis = () => { if (target.visibilityState === 'visible') check(); };
  EVENTS.forEach((e) => target.addEventListener(e, bump, { passive: true } as AddEventListenerOptions));
  target.addEventListener('visibilitychange', onVis);
  const timer = setInterval(check, o.checkEveryMs ?? 15_000);
  function stop(): void {
    clearInterval(timer);
    EVENTS.forEach((e) => target.removeEventListener(e, bump));
    target.removeEventListener('visibilitychange', onVis);
  }
  return () => { done = true; stop(); };
}
