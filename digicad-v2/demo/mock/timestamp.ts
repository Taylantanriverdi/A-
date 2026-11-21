/** DEMO — Firestore Timestamp taklidi. */
export class Timestamp {
  constructor(public seconds: number, public nanoseconds: number) {}
  static now(): Timestamp { return Timestamp.fromMillis(Date.now()); }
  static fromMillis(ms: number): Timestamp { return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6); }
  static fromDate(d: Date): Timestamp { return Timestamp.fromMillis(d.getTime()); }
  toMillis(): number { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); }
  toDate(): Date { return new Date(this.toMillis()); }
  toJSON(): { __ts: number } { return { __ts: this.toMillis() }; }
  isEqual(o: Timestamp): boolean { return o instanceof Timestamp && o.toMillis() === this.toMillis(); }
}
