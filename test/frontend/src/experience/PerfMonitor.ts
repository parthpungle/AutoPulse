/**
 * Frame-time ring buffer. Asks for a tier drop when the frame rate stays under 50 fps for 2 s,
 * with a grace period after resizes and tier changes and a cooldown between drops.
 */
export class PerfMonitor {
  private readonly times = new Float32Array(600);
  private head = 0;
  private filled = 0;
  private below = 0;
  private grace = 1.5;
  private cooldown = 0;
  private fps = 60;
  longFrames = 0;
  enabled = true;

  sample(dt: number) {
    this.times[this.head] = dt * 1000;
    this.head = (this.head + 1) % this.times.length;
    if (this.filled < this.times.length) this.filled++;
    if (dt > 0.05) this.longFrames++;
    this.fps += (1 / Math.max(dt, 1e-4) - this.fps) * 0.1;
  }

  /** Call once per frame; true means "drop a tier now". */
  shouldDrop(dt: number): boolean {
    if (!this.enabled) return false;
    if (this.grace > 0) {
      this.grace -= dt;
      this.below = 0;
      return false;
    }
    if (this.cooldown > 0) this.cooldown -= dt;
    this.below = this.fps < 50 ? this.below + dt : 0;
    if (this.below > 2 && this.cooldown <= 0) {
      this.below = 0;
      this.cooldown = 3;
      this.grace = 1;
      return true;
    }
    return false;
  }

  /** Ignore the next second (resize, tier change, tab switch). */
  hold(seconds = 1) {
    this.grace = Math.max(this.grace, seconds);
    this.below = 0;
  }

  get currentFps() {
    return this.fps;
  }

  /** Summary of the last frames (allocates; only for ?perf and the debug panel). */
  stats(lastN = 600) {
    const n = Math.min(lastN, this.filled);
    const arr: number[] = [];
    for (let k = 0; k < n; k++) arr.push(this.times[(this.head - 1 - k + this.times.length) % this.times.length]);
    const sorted = [...arr].sort((a, b) => a - b);
    const avg = arr.reduce((s, v) => s + v, 0) / Math.max(1, n);
    return {
      frames: n,
      avgFps: n ? 1000 / avg : 0,
      p95Ms: n ? sorted[Math.floor(n * 0.95)] : 0,
      maxMs: n ? sorted[n - 1] : 0,
      over50ms: arr.filter((v) => v > 50).length,
    };
  }

  reset() {
    this.filled = 0;
    this.head = 0;
    this.longFrames = 0;
  }
}
