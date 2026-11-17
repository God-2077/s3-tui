import { Transform } from "node:stream";

/** 传输进度：节流、速度（EMA）、ETA。 */

export interface ProgressSnapshot {
  loaded: number;
  total: number;
  percent: number;
  speed: number;
  etaMs?: number;
  part?: { current: number; total: number };
}

export class ProgressMeter {
  loaded = 0;
  private lastEmittedAt = 0;
  private lastSampleAt = Date.now();
  private lastSampleLoaded = 0;
  private speed = 0;
  private partInfo?: { current: number; total: number };

  constructor(
    readonly total: number,
    private readonly onUpdate: (snapshot: ProgressSnapshot) => void,
    private readonly intervalMs = 100,
  ) {}

  add(delta: number): void {
    if (!Number.isFinite(delta) || delta === 0) return;
    const next = this.loaded + delta;
    this.loaded = this.total > 0 ? Math.min(this.total, Math.max(0, next)) : Math.max(0, next);
    this.maybeEmit();
  }

  setLoaded(loaded: number): void {
    this.loaded = this.total > 0 ? Math.min(this.total, Math.max(0, loaded)) : Math.max(0, loaded);
    this.maybeEmit();
  }

  setPart(current: number, total: number): void {
    this.partInfo = { current, total };
    this.maybeEmit(true);
  }

  flush(): void {
    if (this.total > 0) this.loaded = Math.min(this.loaded, this.total);
    this.emit(Date.now(), true);
  }

  private snapshot(): ProgressSnapshot {
    const percent =
      this.total > 0 ? Math.min(100, Math.max(0, (this.loaded / this.total) * 100)) : 0;
    const etaMs =
      this.total > 0 && this.speed > 0 ? ((this.total - this.loaded) / this.speed) * 1000 : undefined;
    return {
      loaded: this.loaded,
      total: this.total,
      percent,
      speed: this.speed,
      etaMs,
      ...(this.partInfo ? { part: { ...this.partInfo } } : {}),
    };
  }

  private maybeEmit(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastEmittedAt < this.intervalMs) return;
    this.emit(now, force);
  }

  private emit(now: number, force: boolean): void {
    const elapsed = (now - this.lastSampleAt) / 1000;
    if (elapsed >= 0.2) {
      const instant = Math.max(0, this.loaded - this.lastSampleLoaded) / elapsed;
      this.speed = this.speed > 0 ? this.speed * 0.55 + instant * 0.45 : instant;
      this.lastSampleAt = now;
      this.lastSampleLoaded = this.loaded;
    } else if (force && this.speed === 0) {
      this.speed = 0;
    }
    this.lastEmittedAt = now;
    this.onUpdate(this.snapshot());
  }
}

/** 统计经过 transform 的字节数，不影响背压。 */
export function createCountingTransform(onChunk: (bytes: number) => void): Transform {
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      onChunk(chunk.length);
      callback(null, chunk);
    },
  });
}