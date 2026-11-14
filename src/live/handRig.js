import * as THREE from 'three';
import { scanMaterial } from '../anatomy.js';

/**
 * Rest pose of the LEFT hand skeleton in the model's coordinates (metres), expressed
 * as the 21 MediaPipe hand landmarks. Estimated from the BodyParts3D hand mesh
 * (fingers hang down, thumb on +X). The right hand is the mirror image (x → −x).
 */
function buildRestLeft() {
  const L = new Array(21);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  L[0] = V(0.262, 0.884, 0.020);
  // thumb
  L[1] = V(0.290, 0.860, 0.030);
  L[2] = V(0.307, 0.836, 0.046);
  L[3] = V(0.317, 0.813, 0.061);
  const thumbTip = V(0.323, 0.797, 0.070);
  L[4] = thumbTip.clone().add(thumbTip.clone().sub(L[3]).normalize().multiplyScalar(0.006));
  // fingers: MCP (known), bone tip (read from the mesh); PIP/DIP by typical phalanx proportions
  const z = (y) => 0.03 + (0.83 - y) * 0.65;
  const fingers = [
    { base: 5, mcp: [0.292, 0.818], tip: [0.308, 0.741] },   // index
    { base: 9, mcp: [0.270, 0.818], tip: [0.277, 0.732] },   // middle
    { base: 13, mcp: [0.250, 0.816], tip: [0.250, 0.744] },  // ring
    { base: 17, mcp: [0.229, 0.812], tip: [0.222, 0.755] },  // pinky
  ];
  for (const f of fingers) {
    const mcp = V(f.mcp[0], f.mcp[1], z(f.mcp[1]));
    const bt = V(f.tip[0], f.tip[1], z(f.tip[1]));
    const tip = bt.clone().add(bt.clone().sub(mcp).normalize().multiplyScalar(0.006));
    const span = tip.clone().sub(mcp);
    L[f.base] = mcp;
    L[f.base + 1] = mcp.clone().addScaledVector(span, 0.47);
    L[f.base + 2] = mcp.clone().addScaledVector(span, 0.77);
    L[f.base + 3] = tip;
  }
  return L;
}
export const REST_LEFT = buildRestLeft();
export const mirrorRest = (L) => L.map((p) => new THREE.Vector3(-p.x, p.y, p.z));

// Bones: [parent landmark, child landmark, kind]. kind 'p' = palm (rigid), 't' = thumb ref, 'f' = finger ref.
const BONES = [
  { a: 0, b: 9, kind: 'p' },
  { a: 1, b: 2, kind: 't' }, { a: 2, b: 3, kind: 't' }, { a: 3, b: 4, kind: 't' },
  ...[5, 9, 13, 17].flatMap((m) => [
    { a: m, b: m + 1, kind: 'f' }, { a: m + 1, b: m + 2, kind: 'f' }, { a: m + 2, b: m + 3, kind: 'f' },
  ]),
];
const PALM_SEGS = [[0, 5], [0, 9], [0, 13], [0, 17], [0, 1]];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const arr = (v) => [v.x, v.y, v.z];

function segDist(p, a, b) {
  const ab = sub(b, a), ap = sub(p, a);
  const t = Math.max(0, Math.min(1, dot(ap, ab) / (dot(ab, ab) || 1)));
  return len(sub(ap, [ab[0] * t, ab[1] * t, ab[2] * t]));
}

/** Right-handed orthonormal frame (x,y,z columns) with y along `axis` and x as close to `ref` as possible. */
function frame(axis, ref) {
  const y = norm(axis);
  let x = sub(ref, [y[0] * dot(ref, y), y[1] * dot(ref, y), y[2] * dot(ref, y)]);
  if (len(x) < 1e-6) x = Math.abs(y[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], x = sub(x, [y[0] * dot(x, y), y[1] * dot(x, y), y[2] * dot(x, y)]);
  x = norm(x);
  return [x, y, cross(x, y)];
}

/** Per-hand reference vectors from 21 landmarks: side (pinky→index) and palm normal. */
function refs(P) {
  const side = norm(sub(P[5], P[17]));
  const normal = norm(cross(sub(P[5], P[0]), sub(P[17], P[0])));
  return { side, normal };
}

function boneFrame(P, bone, r) {
  const axis = sub(P[bone.b], P[bone.a]);
  if (bone.kind === 'p') return frame(sub(P[9], P[0]), r.side);
  return frame(axis, bone.kind === 't' ? r.normal : r.side);
}

export class HandRig {
  /**
   * @param {THREE.Mesh} srcMesh   the BodyParts3D hand bones mesh (world transform baked in)
   * @param {'left'|'right'} side
   */
  constructor(srcMesh, side, opacity = 0.75) {
    this.side = side;
    const rest = side === 'left' ? REST_LEFT : mirrorRest(REST_LEFT);
    this.rest = rest.map(arr);
    const rr = refs(this.rest);
    this.restFrames = BONES.map((b) => boneFrame(this.rest, b, rr));
    this.restLen = BONES.map((b) => len(sub(this.rest[b.b], this.rest[b.a])));
    this.restPalm = len(sub(this.rest[9], this.rest[0]));

    // bake the source mesh into a plain float geometry
    srcMesh.updateWorldMatrix(true, false);
    const g = srcMesh.geometry, pos = g.attributes.position, nrm = g.attributes.normal;
    const n = pos.count;
    this.n = n;
    this.restPos = new Float32Array(n * 3);
    this.restNrm = new Float32Array(n * 3);
    const v = new THREE.Vector3(), nv = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(srcMesh.matrixWorld);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(srcMesh.matrixWorld);
      this.restPos.set([v.x, v.y, v.z], i * 3);
      nv.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
      this.restNrm.set([nv.x, nv.y, nv.z], i * 3);
    }
    this.#computeWeights();

    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.restPos);
    this.nrm = new Float32Array(this.restNrm);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3).setUsage(THREE.DynamicDrawUsage));
    if (g.index) this.geo.setIndex(g.index.clone());
    this.material = scanMaterial('#ece4d0', { opacity, rim: 0.9, rimColor: '#bff4ff' });
    this.material.side = THREE.DoubleSide;
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 6;
  }

  #computeWeights() {
    const SIGMA = 0.0065, nb = BONES.length;
    this.bi = new Uint8Array(this.n * 3);
    this.bw = new Float32Array(this.n * 3);
    const d = new Float32Array(nb);
    for (let i = 0; i < this.n; i++) {
      const p = [this.restPos[i * 3], this.restPos[i * 3 + 1], this.restPos[i * 3 + 2]];
      let dmin = 1e9;
      for (let b = 0; b < nb; b++) {
        if (BONES[b].kind === 'p') d[b] = Math.min(...PALM_SEGS.map(([a, c]) => segDist(p, this.rest[a], this.rest[c]))) - 0.002;
        else d[b] = segDist(p, this.rest[BONES[b].a], this.rest[BONES[b].b]);
        if (d[b] < dmin) dmin = d[b];
      }
      const cand = [];
      for (let b = 0; b < nb; b++) {
        const e = (d[b] - dmin) / SIGMA;
        if (e < 3) cand.push([b, Math.exp(-e * e)]);
      }
      cand.sort((x, y) => y[1] - x[1]);
      const top = cand.slice(0, 3);
      const sum = top.reduce((s, c) => s + c[1], 0);
      for (let k = 0; k < 3; k++) {
        this.bi[i * 3 + k] = top[k] ? top[k][0] : 0;
        this.bw[i * 3 + k] = top[k] ? top[k][1] / sum : 0;
      }
    }
  }

  setOpacity(o) { this.material.opacity = o; this.material.transparent = true; this.material.depthWrite = false; }

  /** P: 21 camera-space points (metres) for this hand's live landmarks. */
  update(P) {
    const live = P.map(arr);
    const lr = refs(live);
    const g = Math.min(1.8, Math.max(0.55, len(sub(live[9], live[0])) / this.restPalm));
    const nb = BONES.length;
    const M = new Array(nb);
    for (let b = 0; b < nb; b++) {
      const bone = BONES[b];
      const Fl = boneFrame(live, bone, lr);
      const Fr = this.restFrames[b];
      let gl = g;
      if (bone.kind !== 'p') {
        const L = len(sub(live[bone.b], live[bone.a]));
        gl = Math.min(1.5 * g, Math.max(0.6 * g, L / this.restLen[b]));
      }
      M[b] = { Fl, Fr, o: live[bone.a], r: this.rest[bone.a], sx: g, sy: gl, sz: g };
    }
    const bi = this.bi, bw = this.bw, rp = this.restPos, rn = this.restNrm, op = this.pos, on = this.nrm;
    for (let i = 0; i < this.n; i++) {
      const vx = rp[i * 3], vy = rp[i * 3 + 1], vz = rp[i * 3 + 2];
      const nx = rn[i * 3], ny = rn[i * 3 + 1], nz = rn[i * 3 + 2];
      let px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0;
      for (let k = 0; k < 3; k++) {
        const w = bw[i * 3 + k]; if (w === 0) continue;
        const m = M[bi[i * 3 + k]];
        const dx = vx - m.r[0], dy = vy - m.r[1], dz = vz - m.r[2];
        const c0 = (m.Fr[0][0] * dx + m.Fr[0][1] * dy + m.Fr[0][2] * dz) * m.sx;
        const c1 = (m.Fr[1][0] * dx + m.Fr[1][1] * dy + m.Fr[1][2] * dz) * m.sy;
        const c2 = (m.Fr[2][0] * dx + m.Fr[2][1] * dy + m.Fr[2][2] * dz) * m.sz;
        px += w * (m.o[0] + m.Fl[0][0] * c0 + m.Fl[1][0] * c1 + m.Fl[2][0] * c2);
        py += w * (m.o[1] + m.Fl[0][1] * c0 + m.Fl[1][1] * c1 + m.Fl[2][1] * c2);
        pz += w * (m.o[2] + m.Fl[0][2] * c0 + m.Fl[1][2] * c1 + m.Fl[2][2] * c2);
        const n0 = m.Fr[0][0] * nx + m.Fr[0][1] * ny + m.Fr[0][2] * nz;
        const n1 = m.Fr[1][0] * nx + m.Fr[1][1] * ny + m.Fr[1][2] * nz;
        const n2 = m.Fr[2][0] * nx + m.Fr[2][1] * ny + m.Fr[2][2] * nz;
        qx += w * (m.Fl[0][0] * n0 + m.Fl[1][0] * n1 + m.Fl[2][0] * n2);
        qy += w * (m.Fl[0][1] * n0 + m.Fl[1][1] * n1 + m.Fl[2][1] * n2);
        qz += w * (m.Fl[0][2] * n0 + m.Fl[1][2] * n1 + m.Fl[2][2] * n2);
      }
      op[i * 3] = px; op[i * 3 + 1] = py; op[i * 3 + 2] = pz;
      const nl = Math.hypot(qx, qy, qz) || 1;
      on[i * 3] = qx / nl; on[i * 3 + 1] = qy / nl; on[i * 3 + 2] = qz / nl;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
  }
}

/**
 * MediaPipe hand result → 21 camera-space points (metres, OpenGL axes: +X right, +Y up, camera looks −Z).
 * The metric 3D shape comes from `world` (hand-centred metres); the 2D landmarks fix the
 * position/depth under the same pinhole model the renderer uses.
 */
export function handPointsFromMediaPipe(lm, world, tanV, aspect, out = null) {
  const n = 21;
  const rel = new Array(n), a = new Array(n), b = new Array(n);
  let mx = 0, my = 0, mz = 0, ma = 0, mb = 0;
  for (let i = 0; i < n; i++) {
    rel[i] = [world[i].x, -world[i].y, -world[i].z];
    a[i] = (2 * lm[i].x - 1) * tanV * aspect;
    b[i] = (1 - 2 * lm[i].y) * tanV;
    mx += rel[i][0]; my += rel[i][1]; mz += rel[i][2]; ma += a[i]; mb += b[i];
  }
  mx /= n; my /= n; mz /= n; ma /= n; mb /= n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    rel[i][0] -= mx; rel[i][1] -= my; rel[i][2] -= mz;
    const da = a[i] - ma, db = b[i] - mb;
    num += rel[i][0] * da + rel[i][1] * db; den += da * da + db * db;
  }
  const D = Math.max(0.08, num / (den || 1e-9));         // distance of the hand centre from the camera
  const cx = ma * D, cy = mb * D, cz = -D;
  const P = out || Array.from({ length: n }, () => new THREE.Vector3());
  for (let i = 0; i < n; i++) P[i].set(cx + rel[i][0], cy + rel[i][1], cz + rel[i][2]);
  return { P, depth: D };
}
