// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startIdleWatch, IDLE_LIMITS } from '../../src/lib/idle';

describe('startIdleWatch', () => {
  let t = 0; const now = () => t;
  beforeEach(() => { vi.useFakeTimers(); t = 0; });
  afterEach(() => { vi.useRealTimers(); });

  it('hareketsizlikte onTimeout çağrılır, bir kez', () => {
    const onTimeout = vi.fn(); startIdleWatch({ limitMs: 60_000, onTimeout, now, checkEveryMs: 1000 });
    t = 59_000; vi.advanceTimersByTime(1000); expect(onTimeout).not.toHaveBeenCalled();
    t = 61_000; vi.advanceTimersByTime(1000); expect(onTimeout).toHaveBeenCalledTimes(1);
    t = 200_000; vi.advanceTimersByTime(5000); expect(onTimeout).toHaveBeenCalledTimes(1);
  });
  it('etkinlik sayacı sıfırlar', () => {
    const onTimeout = vi.fn(); startIdleWatch({ limitMs: 60_000, onTimeout, now, checkEveryMs: 1000 });
    t = 50_000; document.dispatchEvent(new Event('keydown'));
    t = 100_000; vi.advanceTimersByTime(1000); expect(onTimeout).not.toHaveBeenCalled();
    t = 111_000; vi.advanceTimersByTime(1000); expect(onTimeout).toHaveBeenCalledTimes(1);
  });
  it('bitimden önce bir kez uyarır', () => {
    const onWarn = vi.fn(); startIdleWatch({ limitMs: 60_000, warnMs: 10_000, onWarn, onTimeout: () => undefined, now, checkEveryMs: 1000 });
    t = 49_000; vi.advanceTimersByTime(1000); expect(onWarn).not.toHaveBeenCalled();
    t = 51_000; vi.advanceTimersByTime(1000); t = 52_000; vi.advanceTimersByTime(1000); expect(onWarn).toHaveBeenCalledTimes(1);
  });
  it('durdurulunca çağrılmaz', () => {
    const onTimeout = vi.fn(); const stop = startIdleWatch({ limitMs: 1000, onTimeout, now, checkEveryMs: 100 }); stop(); t = 10_000; vi.advanceTimersByTime(1000); expect(onTimeout).not.toHaveBeenCalled();
  });
  it('uykudan dönüşte (visibilitychange) hemen denetler', () => {
    const onTimeout = vi.fn(); startIdleWatch({ limitMs: 1000, onTimeout, now, checkEveryMs: 10_000_000 });
    t = 5000; document.dispatchEvent(new Event('visibilitychange')); expect(onTimeout).toHaveBeenCalled();
  });
  it('yönetici sınırı diğerlerinden kısa', () => { expect(IDLE_LIMITS.admin).toBeLessThan(IDLE_LIMITS.other); });
});
