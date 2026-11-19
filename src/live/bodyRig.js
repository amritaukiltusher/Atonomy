import * as THREE from 'three';
import { BY_KEY, indexMeshes, scanMaterial, setRim } from '../anatomy.js';
import { clamp } from './filters.js';

/**
 * Full-body rig. The anatomy model is a set of separate rigid meshes, so each one is assigned to a body
 * segment (pelvis, chest, head, upper arm, forearm, hand, thigh, shank, foot × sides) and every segment is
 * moved rigidly from MediaPipe Pose landmarks: pivot at the live joint, orientation from the bone
 * direction (swing relative to its parent so twist follows the torso), scale from the live bone length.
 */

export const BODY_LAYERS = [
  { id: 'skeleton', label: 'Skeleton', on: true, color: '#ece4d0' },
  { id: 'organs', label: 'Organs', on: true, color: '#e58fa3' },
  { id: 'muscles', label: 'Muscles (rigid)', on: false, color: '#b4534f' },
];

/* ───────── which mesh follows which segment ───────── */
const SEG_KEYS = {
  head: ['skull', 'mandible', 'teeth', 'spine_cervical', 'brain', 'brainstem', 'cerebellum', 'eye_l', 'eye_r', 'pituitary',
    'tongue', 'pharynx', 'larynx', 'salivary_glands', 'neck_muscles_l', 'neck_muscles_r'],
  chest: ['clavicle_l', 'clavicle_r', 'scapula_l', 'scapula_r', 'ribs_l', 'ribs_r', 'sternum', 'spine_thoracic',
    'heart', 'lung_l', 'lung_r', 'bronchi', 'trachea', 'esophagus', 'thymus', 'liver', 'stomach', 'spleen', 'pancreas', 'gallbladder',
    'kidney_l', 'kidney_r', 'adrenal_l', 'adrenal_r', 'small_intestine', 'colon', 'breast_l', 'breast_r',
    'chest_muscles_l', 'chest_muscles_r', 'back_muscles_l', 'back_muscles_r', 'abdominal_muscles', 'trapezius_l', 'trapezius_r',
    'diaphragm', 'intercostals_l', 'intercostals_r'],
  pelvis: ['pelvis', 'spine_lumbar', 'bladder', 'prostate', 'uterus', 'vagina', 'ovary_l', 'ovary_r', 'fallopian_tubes', 'reproductive',
    'ureter_l', 'ureter_r', 'appendix', 'pelvic_floor', 'iliopsoas_l', 'iliopsoas_r', 'gluteal_l', 'gluteal_r'],
};
for (const s of ['l', 'r']) {
  SEG_KEYS[`uarm_${s}`] = [`humerus_${s}`, `upper_arm_muscles_${s}`, `deltoid_${s}`, `rotator_cuff_${s}`, `shoulder_muscles_${s}`];
  SEG_KEYS[`farm_${s}`] = [`forearm_${s}`, `forearm_muscles_${s}`];
  SEG_KEYS[`hand_${s}`] = [`hand_${s}`, `hand_muscles_${s}`];
  SEG_KEYS[`thigh_${s}`] = [`femur_${s}`, `quadriceps_${s}`, `hamstrings_${s}`, `adductors_${s}`];
  SEG_KEYS[`shank_${s}`] = [`lower_leg_${s}`, `patella_${s}`, `calf_${s}`, `shin_muscles_${s}`];
  SEG_KEYS[`foot_${s}`] = [`foot_${s}`, `foot_muscles_${s}`];
}

/* ───────── small maths helpers ───────── */
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const mid = (a, b) => a.clone().add(b).multiplyScalar(0.5);

/** Orientation whose Y axis is `up` and whose X axis is `x` made perpendicular to it. */
function basisQuat(x, up) {
  const y = up.clone().normalize();
  const xx = x.clone().addScaledVector(y, -x.dot(y)).normalize();
  const z = new THREE.Vector3().crossVectors(xx, y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xx, y, z));
}
/** Head orientation from the ear-to-ear axis `x` and the facing direction `f`. */
function headQuat(x, f) {
  const y = new THREE.Vector3().crossVectors(f, x).normalize();
  const xx = new THREE.Vector3().crossVectors(y, f).normalize();
  const z = f.clone().normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xx, y, z));
}
const delta = (live, rest) => live.clone().multiply(rest.clone().invert());

/** Model-space nose tip and an estimate of where MediaPipe puts the ear points (ear-canal level, ~11.5 cm behind the nose). */
const NOSE = V(0, 1.5657, 0.1043);
const EAR_HALF = 0.075;

/** Rest-pose joints and directions, read from the model itself. */
function readRest(by) {
  const a = (k) => V(...BY_KEY[k].anchor);
  const box = (k) => new THREE.Box3().setFromObject(by.get(k));
  const rest = { j: {} };
  for (const n of ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle']) for (const s of ['l', 'r']) rest.j[`${n}_${s}`] = a(`${n}_${s}`);
  const { j } = rest;
  rest.hipMid = mid(j.hip_l, j.hip_r);
  rest.shMid = mid(j.shoulder_l, j.shoulder_r);
  rest.spineMid = mid(rest.hipMid, rest.shMid);
  rest.up = rest.shMid.clone().sub(rest.hipMid);
  rest.torsoLen = rest.up.length();
  rest.qPelvis = basisQuat(j.hip_l.clone().sub(j.hip_r), rest.up);
  rest.qChest = basisQuat(j.shoulder_l.clone().sub(j.shoulder_r), rest.up);
  const neck = box('spine_cervical');
  rest.neckBase = V((neck.min.x + neck.max.x) / 2, neck.min.y + 0.01, (neck.min.z + neck.max.z) / 2);
  const earMid = NOSE.clone().add(V(0, 0.025, -0.115));
  rest.qHead = headQuat(V(2 * EAR_HALF, 0, 0), NOSE.clone().sub(earMid));
  for (const s of ['l', 'r']) {
    rest[`hand_${s}`] = box(`hand_${s}`).getCenter(V());
    rest[`foot_${s}`] = box(`foot_${s}`).getCenter(V());
  }
  return rest;
}

export class BodyRig {
  constructor(scene) {
    scene.updateMatrixWorld(true);
    const by = indexMeshes(scene);
    this.rest = readRest(by);
    this.group = new THREE.Group();
    this.group.visible = false;
    this.segs = {};
    this.layers = Object.fromEntries(BODY_LAYERS.map((l) => [l.id, l.on]));
    this.mats = {
      bone: scanMaterial('#e6dcc3', { opacity: 1, rim: 0.7, rimColor: '#bff4ff' }),
      muscle: scanMaterial('#b4534f', { opacity: 0.45, rim: 0.8, rimColor: '#ffb0a8' }),
      organs: [],
    };
    this.mats.muscle.depthWrite = false;

    for (const id of Object.keys(SEG_KEYS)) {
      const g = new THREE.Group();
      g.matrixAutoUpdate = false;
      this.group.add(g);
      this.segs[id] = { id, group: g, meshes: [], q: new THREE.Quaternion(), pivot: V(), restPivot: V(), s: 1, fresh: false, everFresh: false, lost: 99 };
    }
    for (const [id, keys] of Object.entries(SEG_KEYS)) {
      for (const key of keys) {
        const m = by.get(key); const entry = BY_KEY[key];
        if (!m || !entry || !BODY_LAYERS.some((l) => l.id === entry.system)) continue;
        const restWorld = m.matrixWorld.clone();
        m.removeFromParent();
        m.matrixAutoUpdate = false; m.matrix.copy(restWorld);
        m.frustumCulled = false;
        m.userData.layer = entry.system;
        if (entry.system === 'skeleton') m.material = this.mats.bone;
        else if (entry.system === 'muscles') { m.material = this.mats.muscle; m.renderOrder = 4; }
        else { m.material = scanMaterial(entry.color || '#e58fa3', { opacity: 1, rim: 0.5, roughness: 0.6 }); this.mats.organs.push(m.material); }
        this.segs[id].group.add(m); this.segs[id].meshes.push(m);
      }
    }
    this.setLayers(this.layers);
    this.setOpacity(0.7);
    this._m = new THREE.Matrix4(); this._t = new THREE.Matrix4(); this._s = V(1, 1, 1);
  }

  setLayers(l) { Object.assign(this.layers, l); this.#vis(); }
  setOpacity(v) {
    const o = clamp(0.35 + v * 0.65, 0.35, 1);
    this.mats.bone.transparent = o < 0.999; this.mats.bone.opacity = o; this.mats.bone.depthWrite = o > 0.7;
    this.mats.muscle.opacity = clamp(0.15 + v * 0.45, 0.15, 0.7);
    setRim(this.mats.bone, 0.4 + (1 - v) * 0.8);
  }
  #vis() {
    for (const sg of Object.values(this.segs)) {
      for (const m of sg.meshes) m.visible = !!this.layers[m.userData.layer];
      sg.group.visible = sg.everFresh && sg.lost < 0.7;
    }
    this.group.visible = Object.values(this.segs).some((s) => s.group.visible);
  }

  /** `P`: 33 camera-space points (smoothed), `vis`: their visibility scores, `dt` seconds. Returns true if a body was posed. */
  update(P, vis, dt) {
    const R = this.rest, S = this.segs, j = R.j;
    const ok = (...ids) => ids.every((i) => (vis[i] ?? 0) > 0.4);
    for (const s of Object.values(S)) s.fresh = false;

    // torso: pelvis follows the hip line, chest follows the shoulder line, both lean along hips → shoulders
    if (ok(11, 12, 23, 24)) {
      const hipMid = mid(P[23], P[24]), shMid = mid(P[11], P[12]);
      const up = shMid.clone().sub(hipMid);
      const sT = clamp(up.length() / R.torsoLen, 0.5, 2.0);
      const pel = S.pelvis, ch = S.chest;
      pel.q.copy(delta(basisQuat(P[23].clone().sub(P[24]), up), R.qPelvis));
      ch.q.copy(delta(basisQuat(P[11].clone().sub(P[12]), up), R.qChest));
      pel.pivot.copy(hipMid); pel.restPivot.copy(R.hipMid);
      ch.pivot.copy(mid(hipMid, shMid)); ch.restPivot.copy(R.spineMid);
      pel.s = ch.s = sT; pel.fresh = ch.fresh = true;

      // head hangs from the neck base of the chest; orientation from nose + ears when they are visible
      const hd = S.head;
      hd.pivot.copy(R.neckBase).sub(R.spineMid).multiplyScalar(sT).applyQuaternion(ch.q).add(ch.pivot);
      hd.restPivot.copy(R.neckBase); hd.s = sT; hd.fresh = true;
      if (!hd.everFresh) hd.q.copy(ch.q);
      if (ok(0, 7, 8) || (vis[0] > 0.4 && vis[7] > 0.25 && vis[8] > 0.25)) {
        const earMid = mid(P[7], P[8]);
        hd.q.copy(delta(headQuat(P[7].clone().sub(P[8]), P[0].clone().sub(earMid)), R.qHead));
      }
    }

    // limbs: carry the rest bone with the parent, then swing it onto the live bone direction
    const chain = (seg, parentQ, from, to, restFrom, restTo, ids) => {
      if (!ok(...ids)) return;
      const live = to.clone().sub(from); const len = live.length();
      const restVec = restTo.clone().sub(restFrom);
      if (len < 1e-4) return;
      const carried = restVec.clone().normalize().applyQuaternion(parentQ);
      seg.q.copy(new THREE.Quaternion().setFromUnitVectors(carried, live.normalize())).multiply(parentQ);
      seg.pivot.copy(from); seg.restPivot.copy(restFrom);
      seg.s = clamp(len / restVec.length(), 0.6, 1.6); seg.fresh = true;
    };
    for (const [s, k] of [['l', 0], ['r', 1]]) {
      const sh = 11 + k, el = 13 + k, wr = 15 + k, pk = 17 + k, ix = 19 + k, hp = 23 + k, kn = 25 + k, an = 27 + k, hl = 29 + k, ft = 31 + k;
      chain(S[`uarm_${s}`], S.chest.q, P[sh], P[el], j[`shoulder_${s}`], j[`elbow_${s}`], [sh, el]);
      chain(S[`farm_${s}`], S[`uarm_${s}`].q, P[el], P[wr], j[`elbow_${s}`], j[`wrist_${s}`], [el, wr]);
      chain(S[`hand_${s}`], S[`farm_${s}`].q, P[wr], mid(P[pk], P[ix]), j[`wrist_${s}`], R[`hand_${s}`], [wr, pk, ix]);
      S[`hand_${s}`].s = S[`farm_${s}`].s;
      chain(S[`thigh_${s}`], S.pelvis.q, P[hp], P[kn], j[`hip_${s}`], j[`knee_${s}`], [hp, kn]);
      chain(S[`shank_${s}`], S[`thigh_${s}`].q, P[kn], P[an], j[`knee_${s}`], j[`ankle_${s}`], [kn, an]);
      chain(S[`foot_${s}`], S[`shank_${s}`].q, P[an], mid(P[hl], P[ft]), j[`ankle_${s}`], R[`foot_${s}`], [an, hl, ft]);
      S[`foot_${s}`].s = S[`shank_${s}`].s;
    }

    // compose  M = T(pivot) · R(q) · S(s) · T(−restPivot)  for every segment
    let any = false;
    for (const sg of Object.values(S)) {
      sg.lost = sg.fresh ? 0 : sg.lost + dt;
      if (sg.fresh) sg.everFresh = true;
      if (sg.everFresh) {
        this._s.setScalar(sg.s);
        this._m.compose(sg.pivot, sg.q, this._s).multiply(this._t.makeTranslation(-sg.restPivot.x, -sg.restPivot.y, -sg.restPivot.z));
        sg.group.matrix.copy(this._m); sg.group.matrixWorldNeedsUpdate = true;
      }
      sg.group.visible = sg.everFresh && sg.lost < 0.7;
      any ||= sg.group.visible;
    }
    this.group.visible = any;
    return any;
  }

  hide() { this.group.visible = false; for (const s of Object.values(this.segs)) { s.lost = 99; s.everFresh = false; s.group.visible = false; } }
}

/* ───────── MediaPipe pose → camera space ───────── */
/**
 * `lm`: normalized image landmarks, `world`: metric landmarks (hip-centred), both 33 long.
 * Returns 33 camera-space points (metres; camera looks down −Z, +Y up) and the visibility array. The distance
 * is solved so the metric body projects onto the 2D landmarks (visible points only), which pins both scale and depth.
 */
export function posePointsFromMediaPipe(lm, world, tanV, aspect, flipZ = false, out = null) {
  const n = 33;
  const vis = Array.from({ length: n }, (_, i) => Math.min(lm[i].visibility ?? 1, world[i]?.visibility ?? 1));
  const use = vis.map((v) => v > 0.5);
  if (use.filter(Boolean).length < 6) return null;
  const rel = world.map((w) => [w.x, -w.y, flipZ ? w.z : -w.z]);
  const a = lm.map((p) => (2 * p.x - 1) * tanV * aspect);
  const b = lm.map((p) => (1 - 2 * p.y) * tanV);
  let cnt = 0, mx = 0, my = 0, mz = 0, ma = 0, mb = 0;
  for (let i = 0; i < n; i++) if (use[i]) { cnt++; mx += rel[i][0]; my += rel[i][1]; mz += rel[i][2]; ma += a[i]; mb += b[i]; }
  mx /= cnt; my /= cnt; mz /= cnt; ma /= cnt; mb /= cnt;
  let nx = 0, dx = 0, ny = 0, dy = 0;
  for (let i = 0; i < n; i++) if (use[i]) {
    nx += (rel[i][0] - mx) * (a[i] - ma); dx += (a[i] - ma) ** 2;
    ny += (rel[i][1] - my) * (b[i] - mb); dy += (b[i] - mb) ** 2;
  }
  // guard against a mirrored axis convention: the metric axes must grow with the image axes
  const sx = nx < 0 ? -1 : 1, sy = ny < 0 ? -1 : 1;
  const D = Math.max(0.4, (Math.abs(nx) + Math.abs(ny)) / ((dx + dy) || 1e-9));
  const cx = ma * D, cy = mb * D;
  const P = out || Array.from({ length: n }, () => new THREE.Vector3());
  for (let i = 0; i < n; i++) P[i].set(cx + sx * (rel[i][0] - mx), cy + sy * (rel[i][1] - my), -D + (rel[i][2] - mz));
  return { P, vis, depth: D };
}

/* ───────── synthetic pose for the demo (no camera needed) ───────── */
const POSE_EDGES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [28, 30], [30, 32], [0, 7], [0, 8]];
export { POSE_EDGES };

/** Animated MediaPipe-style output (landmarks + world landmarks) built from the model's own rest skeleton. */
export function syntheticPose(rig, t, tanV, aspect, amp = 1) {
  const R = rig.rest, j = R.j;
  const pts = new Array(33);
  const earY = NOSE.y + 0.025, earZ = NOSE.z - 0.115;
  pts[0] = NOSE.clone();
  pts[7] = V(EAR_HALF, earY, earZ); pts[8] = V(-EAR_HALF, earY, earZ);
  for (const [i, dx, dy] of [[1, 0.03, 0.03], [2, 0.035, 0.03], [3, 0.04, 0.03], [4, -0.03, 0.03], [5, -0.035, 0.03], [6, -0.04, 0.03], [9, 0.02, -0.03], [10, -0.02, -0.03]]) pts[i] = NOSE.clone().add(V(dx, dy, -0.02));
  for (const [s, k, sg] of [['l', 0, 1], ['r', 1, -1]]) {
    pts[11 + k] = j[`shoulder_${s}`].clone(); pts[13 + k] = j[`elbow_${s}`].clone(); pts[15 + k] = j[`wrist_${s}`].clone();
    const hv = R[`hand_${s}`].clone().sub(j[`wrist_${s}`]);
    pts[17 + k] = j[`wrist_${s}`].clone().addScaledVector(hv, 1.5).add(V(-sg * 0.02, 0, 0));
    pts[19 + k] = j[`wrist_${s}`].clone().addScaledVector(hv, 1.5).add(V(sg * 0.02, 0, 0));
    pts[21 + k] = j[`wrist_${s}`].clone().add(V(sg * 0.04, -0.03, 0.03));
    pts[23 + k] = j[`hip_${s}`].clone(); pts[25 + k] = j[`knee_${s}`].clone(); pts[27 + k] = j[`ankle_${s}`].clone();
    const a = j[`ankle_${s}`];
    pts[29 + k] = V(a.x, 0.03, a.z - 0.05); pts[31 + k] = V(a.x, 0.03, a.z + 0.17);
  }
  const rotAbout = (ids, pivot, axis, ang) => { const q = new THREE.Quaternion().setFromAxisAngle(axis, ang * amp); ids.forEach((i) => pts[i].sub(pivot).applyQuaternion(q).add(pivot)); };
  const X = V(1, 0, 0), Y = V(0, 1, 0), Z = V(0, 0, 1);
  const wave = (f, p = 0) => 0.5 + 0.5 * Math.sin(t * f + p);
  const armIds = (k) => [13 + k, 15 + k, 17 + k, 19 + k, 21 + k], foreIds = (k) => [15 + k, 17 + k, 19 + k, 21 + k];
  // right arm: raise sideways, elbow bends up; left arm: raise forward and wave
  rotAbout(armIds(1), pts[12], Z, -(0.25 + 1.2 * wave(0.9)));
  rotAbout(foreIds(1), pts[14], X, -1.3 * wave(1.3, 1));
  rotAbout(armIds(0), pts[11], X, -0.9 * wave(0.7));
  rotAbout(foreIds(0), pts[13], X, -1.1 * wave(1.9));
  // left leg: lift knee, bend it; right leg: small step out
  const lift = Math.max(0, Math.sin(t * 0.8));
  rotAbout([25, 27, 29, 31], pts[23], X, -0.75 * lift);
  rotAbout([27, 29, 31], pts[25], X, 1.1 * lift);
  rotAbout([26, 28, 30, 32], pts[24], Z, 0.18 * wave(0.8, 2));
  // head turn and torso lean/twist about the hips
  const upper = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
  const neck = R.neckBase;
  rotAbout([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], neck, Y, 0.5 * Math.sin(t * 0.9));
  rotAbout(upper, R.hipMid, X, 0.12 * Math.sin(t * 0.8));
  rotAbout(upper, R.hipMid, Y, 0.3 * Math.sin(t * 0.6));
  rotAbout(upper, R.hipMid, Z, 0.08 * Math.sin(t * 0.7));
  // place in front of the camera
  const centre = V(0, 0.9, 0), T = V(0.12 * Math.sin(t * 0.4) * amp, 0, -2.15);
  const cam = pts.map((p) => p.clone().sub(centre).add(T));
  const hipC = mid(cam[23], cam[24]);
  const landmarks = cam.map((p) => ({ x: (p.x / -p.z / (tanV * aspect) + 1) / 2, y: (1 - p.y / -p.z / tanV) / 2, z: 0, visibility: 1 }));
  const worldLandmarks = cam.map((p) => { const r = p.clone().sub(hipC); return { x: r.x, y: -r.y, z: -r.z, visibility: 1 }; });
  return { landmarks, worldLandmarks };
}
