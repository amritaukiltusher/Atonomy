import * as THREE from 'three';

const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt);

/** One-Euro filter for a scalar: smooth when still, responsive when moving. */
export class OneEuro {
  constructor(minCutoff = 1.5, beta = 0.05, dCutoff = 1.0) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.x = null; this.dx = 0;
  }
  reset() { this.x = null; this.dx = 0; }
  filter(v, dt) {
    if (this.x === null || !(dt > 0)) { this.x = v; this.dx = 0; return v; }
    const d = (v - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (d - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }
}

/** Filters a fixed-length vector of scalars. */
export class OneEuroVec {
  constructor(n, ...args) { this.f = Array.from({ length: n }, () => new OneEuro(...args)); }
  reset() { this.f.forEach((f) => f.reset()); }
  filter(arr, dt, out = arr) { for (let i = 0; i < this.f.length; i++) out[i] = this.f[i].filter(arr[i], dt); return out; }
}

/** Speed-adaptive quaternion smoothing. */
export class QuatFilter {
  constructor(minCutoff = 2.5, beta = 0.8) { this.minCutoff = minCutoff; this.beta = beta; this.q = null; }
  reset() { this.q = null; }
  filter(q, dt) {
    if (!this.q || !(dt > 0)) { this.q = q.clone(); return this.q; }
    const speed = this.q.angleTo(q) / dt;
    this.q.slerp(q, alpha(this.minCutoff + this.beta * speed, dt));
    return this.q;
  }
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export { THREE };
