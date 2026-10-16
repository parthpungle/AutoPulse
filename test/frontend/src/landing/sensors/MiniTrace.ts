import { gsap } from 'gsap';
import type { SyntheticSignals } from '../../experience/signals/SyntheticSignals';

/** Seconds of signal shown across the trace, per sensor (fast sensors get a short window). */
const WINDOW = [0.06, 0.06, 0.12, 30, 8, 3, 1, 0.25];
const UNITS = ['60 ms', '60 ms', '120 ms', '30 s', '8 s', '3 s', '1 s', '250 ms'];

/** Human label for the time window shown in sensor i's trace. */
export function windowLabel(i: number) {
  return UNITS[i] ?? '';
}

/**
 * A small live 2-D trace of one sensor's synthetic signal (SyntheticSignals.trace), redrawn every
 * frame while visible. It follows the engine state, so Knock visibly changes the mic and
 * vibration traces.
 */
export class MiniTrace {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly signals: SyntheticSignals;
  private sensor = 0;
  private color = '#ffffff';
  private running = false;
  private w = 0;
  private h = 0;
  private dpr = 1;

  get element() {
    return this.canvas;
  }

  constructor(canvas: HTMLCanvasElement, signals: SyntheticSignals) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.signals = signals;
  }

  set(sensor: number, color: string) {
    this.sensor = sensor;
    this.color = color;
  }

  start() {
    if (this.running) return;
    this.running = true;
    gsap.ticker.add(this.draw);
  }

  stop() {
    this.running = false;
    gsap.ticker.remove(this.draw);
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (r.width !== this.w || r.height !== this.h || dpr !== this.dpr) {
      this.w = r.width;
      this.h = r.height;
      this.dpr = dpr;
      this.canvas.width = Math.max(1, Math.round(r.width * dpr));
      this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    }
  }

  private draw = () => {
    this.resize();
    const { ctx, w, h, dpr } = this;
    if (!w || !h) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // grid
    ctx.strokeStyle = 'rgba(233, 236, 239, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      const y = Math.round((h * i) / 4) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    for (let i = 1; i < 8; i++) {
      const x = Math.round((w * i) / 8) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    ctx.stroke();

    // trace: the last WINDOW seconds, newest on the right
    const span = WINDOW[this.sensor];
    const now = this.signals.time;
    const n = Math.min(480, Math.round(w));
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const t = now - span + (span * i) / n;
      const v = Math.max(-1.2, Math.min(1.2, this.signals.trace(this.sensor, t)));
      const x = (w * i) / n;
      const y = h * 0.5 - v * h * 0.38;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  };
}
