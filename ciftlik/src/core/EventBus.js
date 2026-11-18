// Tek global olay yolu. Olay adları PLAN.md §1 "EventBus olay sözleşmesi" tablosunda.
class EventBus {
  constructor() { this.map = new Map(); }
  on(name, fn, ctx) {
    if (!this.map.has(name)) this.map.set(name, []);
    this.map.get(name).push({ fn, ctx });
    return () => this.off(name, fn, ctx);
  }
  once(name, fn, ctx) {
    const off = this.on(name, (p) => { off(); fn.call(ctx, p); });
    return off;
  }
  off(name, fn, ctx) {
    const list = this.map.get(name);
    if (!list) return;
    const i = list.findIndex((l) => l.fn === fn && (ctx === undefined || l.ctx === ctx));
    if (i >= 0) list.splice(i, 1);
  }
  emit(name, payload) {
    const list = this.map.get(name);
    if (!list || list.length === 0) return;
    for (const l of list.slice()) {
      try { l.fn.call(l.ctx, payload); } catch (e) { console.error(`[bus] ${name}`, e); }
    }
  }
}
export const bus = new EventBus();
export default bus;
