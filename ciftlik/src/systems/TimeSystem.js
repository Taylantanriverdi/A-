// TimeSystem — oyun zamanını ilerletir, zaman olaylarını yayar. Phaser import ETMEZ.
import { SPEEDS, MIN_PER_DAY, DAYS_PER_SEASON } from '../core/constants.js';
import { calendar } from '../core/timeUtils.js';

const SLEEP_FROM_HOUR = 22;
const WAKE_HOUR = 6;

let registryRef = null;

const TimeSystem = {
  id: 'time',

  init(state, bus, registry) {
    registryRef = registry || null;

    bus.on('time:speed', (p) => {
      const speed = Number(p?.speed);
      if (!SPEEDS.includes(speed)) return;
      if (state.time.speed !== speed) state.time.speed = speed;
      bus.emit('time:speedChanged', { speed });
    });

    bus.on('time:sleep', () => {
      const from = state.time.totalMinutes;
      const cal = calendar(from);
      if (!(cal.hour >= SLEEP_FROM_HOUR || cal.hour < WAKE_HOUR)) {
        bus.emit('toast', { text: 'Uyumak için henüz erken — 22:00\'den sonra yatabilirsin.', kind: 'info' });
        return;
      }
      const dayIndex = Math.floor(from / MIN_PER_DAY);
      const to = (cal.hour >= SLEEP_FROM_HOUR ? dayIndex + 1 : dayIndex) * MIN_PER_DAY + WAKE_HOUR * 60;
      const n = to - from;
      if (registryRef) {
        // Sistemler (ekin büyümesi vb.) aradaki her dakikayı yaşar; zaman olayları susturulur.
        registryRef.advance(n, true);
        registryRef.resetFraction();
      } else {
        state.time.totalMinutes = to;
      }
      const now = calendar(state.time.totalMinutes);
      const d0 = dayIndex;
      const d1 = Math.floor(state.time.totalMinutes / MIN_PER_DAY);
      if (d1 !== d0) {
        bus.emit('time:day', now);
        if (Math.floor(d1 / DAYS_PER_SEASON) !== Math.floor(d0 / DAYS_PER_SEASON)) bus.emit('time:season', now);
      }
      bus.emit('time:hour', now);
      bus.emit('time:minute', now);
      bus.emit('time:slept', { from, to: state.time.totalMinutes });
    });
  },

  tickMinute(state, bus, ctx) {
    state.time.totalMinutes += 1;
    if (!ctx.silent) bus.emit('time:minute', calendar(state.time.totalMinutes));
  },

  onHour(state, bus, ctx) { if (!ctx.silent) bus.emit('time:hour', ctx.now); },
  onDay(state, bus, ctx) { if (!ctx.silent) bus.emit('time:day', ctx.now); },
  onSeason(state, bus, ctx) { if (!ctx.silent) bus.emit('time:season', ctx.now); },
};

export default TimeSystem;
