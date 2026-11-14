import * as THREE from 'three';

/**
 * Anatomical feature points on the male reference head (model space, metres) and
 * the MediaPipe face-mesh landmark each one corresponds to. They are all rigid
 * (they do not move when the jaw opens or the face changes expression).
 */
export const HEAD_FEATURES = [
  { name: 'nose tip', lm: 1, p: [0.0, 1.5657, 0.1043] },
  { name: 'nasion', lm: 168, p: [0.0, 1.5974, 0.0883] },
  { name: 'right iris', lm: 468, p: [-0.0301, 1.5966, 0.0689] },
  { name: 'left iris', lm: 473, p: [0.0301, 1.5964, 0.0684] },
];
/**
 * Model-space point that plays the role of MediaPipe's canonical-face origin (mid-head). The canonical
 * nose tip sits about (0, −1.13, +7.48) cm from that origin, so the pivot is the model's nose tip minus that.
 * Pose rotation/scale are applied about this point, which keeps the translation from MediaPipe meaningful.
 */
export const HEAD_PIVOT = new THREE.Vector3(0.0, 1.5657 + 0.0113, 0.1043 - 0.0748);
/** Feature points relative to the pivot (the head rig's local frame). */
export const HEAD_FEATURE_VECS = HEAD_FEATURES.map((f) => new THREE.Vector3(...f.p).sub(HEAD_PIVOT));

/** The 24 proper rotations that map one right-handed axis convention onto another. */
export const AXIS_CANDIDATES = (() => {
  const out = [];
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const p of perms) {
    for (let sx = -1; sx <= 1; sx += 2) for (let sy = -1; sy <= 1; sy += 2) for (let sz = -1; sz <= 1; sz += 2) {
      const m = new THREE.Matrix4().set(
        p[0] === 0 ? sx : 0, p[0] === 1 ? sx : 0, p[0] === 2 ? sx : 0, 0,
        p[1] === 0 ? sy : 0, p[1] === 1 ? sy : 0, p[1] === 2 ? sy : 0, 0,
        p[2] === 0 ? sz : 0, p[2] === 1 ? sz : 0, p[2] === 2 ? sz : 0, 0,
        0, 0, 0, 1);
      if (m.determinant() > 0) out.push(new THREE.Quaternion().setFromRotationMatrix(m));
    }
  }
  return out; // index of identity is found by caller
})();

const _v = new THREE.Vector3();

/**
 * With the head rotation and distance known (from MediaPipe's facial transform),
 * solve scale + screen position so rigid anatomical features land exactly on the
 * detected landmarks:   X + a·Z = 0,  Y + b·Z = 0   with  P = s·R·q + t, t.z known.
 * a, b are the landmarks in "tan space" (x/−z, y/−z).
 * Returns { s, tx, ty, err } where err is the RMS reprojection error in tan space.
 */
export function fitHead(quat, tz, landmarks, tanV, aspect, extraRot = null) {
  const q = extraRot ? quat.clone().multiply(extraRot) : quat;
  const A = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const B = [0, 0, 0];
  const rs = [];
  for (let i = 0; i < HEAD_FEATURES.length; i++) {
    const lm = landmarks[HEAD_FEATURES[i].lm];
    if (!lm) return null;
    const a = (2 * lm.x - 1) * tanV * aspect;
    const b = (1 - 2 * lm.y) * tanV;
    const r = _v.copy(HEAD_FEATURE_VECS[i]).applyQuaternion(q);
    rs.push([r.x, r.y, r.z, a, b]);
    const rows = [[r.x + a * r.z, 1, 0, -a * tz], [r.y + b * r.z, 0, 1, -b * tz]];
    for (const [c0, c1, c2, rhs] of rows) {
      const c = [c0, c1, c2];
      for (let m = 0; m < 3; m++) { for (let n = 0; n < 3; n++) A[m * 3 + n] += c[m] * c[n]; B[m] += c[m] * rhs; }
    }
  }
  const sol = solve3(A, B);
  if (!sol) return null;
  const [s, tx, ty] = sol;
  if (!(s > 0.2 && s < 5)) return { s, tx, ty, err: 1 };
  let e2 = 0;
  for (const [rx, ry, rz, a, b] of rs) {
    const Z = s * rz + tz;
    const ex = (s * rx + tx) / -Z - a, ey = (s * ry + ty) / -Z - b;
    e2 += ex * ex + ey * ey;
  }
  return { s, tx, ty, err: Math.sqrt(e2 / (2 * rs.length)) };
}

function solve3(A, B) {
  const [a, b, c, d, e, f, g, h, i] = A;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) return null;
  const inv = [
    (e * i - f * h), (c * h - b * i), (b * f - c * e),
    (f * g - d * i), (a * i - c * g), (c * d - a * f),
    (d * h - e * g), (b * g - a * h), (a * e - b * d),
  ].map((x) => x / det);
  return [
    inv[0] * B[0] + inv[1] * B[1] + inv[2] * B[2],
    inv[3] * B[0] + inv[4] * B[1] + inv[5] * B[2],
    inv[6] * B[0] + inv[7] * B[1] + inv[8] * B[2],
  ];
}

/** MediaPipe's 4x4 transform → { quat, tz (metres, negative) }, tolerating row- or column-major layout. */
export function parseFaceMatrix(data) {
  const m = new THREE.Matrix4();
  const colMajorOk = Math.abs(data[3]) + Math.abs(data[7]) + Math.abs(data[11]) < 1e-3;
  if (colMajorOk) m.fromArray(data); else m.set(...data);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  m.decompose(p, q, s);
  return { quat: q, tz: p.z / 100, pos: p.clone().divideScalar(100) }; // matrix translation is in cm
}
