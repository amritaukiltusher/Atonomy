import * as THREE from 'three';
import { indexMeshes, scanMaterial, setRim } from '../anatomy.js';
import { clamp } from './filters.js';
import { HEAD_PIVOT } from './fit.js';

// Landmarks measured on the male reference model (metres).
const JAW_PIVOT = new THREE.Vector3(-0.0008, 1.531, -0.003);   // midpoint of the two mandibular condyles
const EYE_CENTER_L = new THREE.Vector3(0.0301, 1.5964, 0.0564);
const EYE_CENTER_R = new THREE.Vector3(-0.0301, 1.5966, 0.0569);
const NECK_CUT_Y = 1.455;                                       // everything below is clipped away

export const HEAD_LAYERS = [
  { id: 'skull', label: 'Skull & jaw', on: true, color: '#ece4d0' },
  { id: 'brain', label: 'Brain', on: true, color: '#e58fa3' },
  { id: 'eyes', label: 'Eyes', on: true, color: '#9ad7ff' },
  { id: 'neck', label: 'Neck spine & throat', on: true, color: '#d9cdb0' },
  { id: 'tongue', label: 'Tongue', on: true, color: '#e0707a' },
  { id: 'vessels', label: 'Blood vessels', on: false, color: '#4aa3ff' },
  { id: 'nerves', label: 'Cranial nerves', on: false, color: '#ffd84a' },
];

/** Splits the single merged teeth mesh into upper and lower sets (they are disconnected components). */
function splitTeeth(mesh) {
  const g = mesh.geometry;
  const index = g.index.array;
  const n = g.attributes.position.count;
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let i = 0; i < index.length; i += 3) {
    const a = find(index[i]), b = find(index[i + 1]), c = find(index[i + 2]);
    parent[b] = a; parent[c] = a;
  }
  // component centroid heights (world space; the mesh node only has translate+uniform scale)
  const pos = g.attributes.position;
  const sum = new Map(), cnt = new Map();
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    const r = find(i);
    sum.set(r, (sum.get(r) || 0) + v.y); cnt.set(r, (cnt.get(r) || 0) + 1);
  }
  const comps = [...sum.keys()].map((r) => ({ r, y: sum.get(r) / cnt.get(r) }));
  // 2-means on height
  let lo = Math.min(...comps.map((c) => c.y)), hi = Math.max(...comps.map((c) => c.y));
  for (let it = 0; it < 12; it++) {
    const mid = (lo + hi) / 2;
    const L = comps.filter((c) => c.y < mid), H = comps.filter((c) => c.y >= mid);
    if (!L.length || !H.length) break;
    lo = L.reduce((s, c) => s + c.y, 0) / L.length; hi = H.reduce((s, c) => s + c.y, 0) / H.length;
  }
  const mid = (lo + hi) / 2;
  const isLower = new Map(comps.map((c) => [c.r, c.y < mid]));
  const upIdx = [], loIdx = [];
  for (let i = 0; i < index.length; i += 3) {
    (isLower.get(find(index[i])) ? loIdx : upIdx).push(index[i], index[i + 1], index[i + 2]);
  }
  const make = (idx) => {
    const geo = g.clone(); geo.setIndex(idx);
    const m = new THREE.Mesh(geo, mesh.material);
    m.position.copy(mesh.position); m.quaternion.copy(mesh.quaternion); m.scale.copy(mesh.scale);
    return m;
  };
  return { upper: make(upIdx), lower: make(loIdx), stats: { comps: comps.length, split: mid } };
}

export class HeadRig {
  /** @param {THREE.Object3D} modelScene a fresh clone of the male model */
  constructor(modelScene) {
    const by = indexMeshes(modelScene);
    const need = ['skull', 'mandible', 'teeth', 'brain', 'cerebellum', 'brainstem', 'pituitary', 'eye_l', 'eye_r', 'tongue',
      'spine_cervical', 'pharynx', 'carotid_l', 'carotid_r', 'arteries_head', 'cranial_nerves'];
    for (const k of need) if (!by.has(k)) throw new Error(`Model is missing "${k}"`);
    modelScene.updateMatrixWorld(true);

    this.group = new THREE.Group();          // pose (scale, rotation, translation from tracking)
    this.align = new THREE.Group();          // user fine alignment, about the pivot
    this.model = new THREE.Group();          // model-space children, shifted so HEAD_PIVOT sits at the origin
    this.model.position.copy(HEAD_PIVOT).negate();
    this.group.add(this.align); this.align.add(this.model);
    this.group.visible = false;

    this.mats = {
      bone: scanMaterial('#ece4d0', { opacity: 0.6, rim: 0.9, rimColor: '#bff4ff' }),
      boneSolid: scanMaterial('#e6dcc3', { opacity: 1, rim: 0.5, rimColor: '#bff4ff' }),
      brain: scanMaterial('#e58fa3', { opacity: 1, rim: 0.7, rimColor: '#ffd0da', roughness: 0.6 }),
      eye: scanMaterial('#bfe6ff', { opacity: 1, rim: 0.6 }),
      tongue: scanMaterial('#e0707a', { opacity: 1, rim: 0.4 }),
      vessel: scanMaterial('#4aa3ff', { opacity: 1, rim: 0.6 }),
      nerve: scanMaterial('#ffd84a', { opacity: 1, rim: 0.6 }),
      neck: scanMaterial('#d9cdb0', { opacity: 0.55, rim: 0.7, rimColor: '#bff4ff' }),
    };
    this.layerObjs = Object.fromEntries(HEAD_LAYERS.map((l) => [l.id, []]));
    this.baseOpacity = new Map();
    const clipMats = [];

    const add = (obj, layer, mat, order = 0) => {
      obj.removeFromParent();
      if (mat) obj.material = mat;
      obj.renderOrder = order;
      this.layerObjs[layer].push(obj);
      return obj;
    };

    // ── jaw group: mandible + lower teeth + tongue rotate about the condyles ──
    this.jaw = new THREE.Group(); this.jaw.position.copy(JAW_PIVOT);
    this.model.add(this.jaw);
    const fromWorld = (mesh, parent, pivot = null) => { if (pivot) mesh.position.sub(pivot); parent.add(mesh); };

    const mandible = add(by.get('mandible'), 'skull', this.mats.bone, 3);
    fromWorld(mandible, this.jaw, JAW_PIVOT);

    const { upper, lower } = splitTeeth(by.get('teeth'));
    upper.material = lower.material = this.mats.boneSolid;
    this.model.add(upper); this.layerObjs.skull.push(upper); upper.renderOrder = 1;
    lower.position.sub(JAW_PIVOT); this.jaw.add(lower); this.layerObjs.skull.push(lower); lower.renderOrder = 1;

    const tongue = add(by.get('tongue'), 'tongue', this.mats.tongue, 1);
    fromWorld(tongue, this.jaw, JAW_PIVOT);

    // skull (transparent shell)
    const skull = add(by.get('skull'), 'skull', this.mats.bone, 4); this.model.add(skull);

    // brain group
    for (const k of ['brain', 'cerebellum', 'brainstem', 'pituitary']) { const m = add(by.get(k), 'brain', this.mats.brain, 0); this.model.add(m); }

    // eyes rotate about their centres
    this.eyeL = new THREE.Group(); this.eyeL.position.copy(EYE_CENTER_L);
    this.eyeR = new THREE.Group(); this.eyeR.position.copy(EYE_CENTER_R);
    for (const [k, grp, c] of [['eye_l', this.eyeL, EYE_CENTER_L], ['eye_r', this.eyeR, EYE_CENTER_R]]) {
      const m = add(by.get(k), 'eyes', this.mats.eye, 1); m.position.sub(c); grp.add(m); this.model.add(grp);
    }

    // neck & throat (clipped below the chin)
    for (const k of ['spine_cervical', 'pharynx']) { const m = add(by.get(k), 'neck', this.mats.neck, 2); this.model.add(m); }
    for (const k of ['carotid_l', 'carotid_r', 'arteries_head']) { const m = add(by.get(k), 'vessels', this.mats.vessel, 1); this.model.add(m); }
    { const m = add(by.get('cranial_nerves'), 'nerves', this.mats.nerve, 1); this.model.add(m); }

    // clip plane (updated each frame in world space) for the neck-level structures
    this.clip = new THREE.Plane();
    for (const mat of [this.mats.neck, this.mats.vessel]) { mat.clippingPlanes = [this.clip]; }
    // eyeballs/tongue etc. need no clipping.

    this.state = { jaw: 0 };
    this.setLayers(Object.fromEntries(HEAD_LAYERS.map((l) => [l.id, l.on])));
    this.setOpacity(0.7);
  }

  setLayers(map) {
    for (const [id, on] of Object.entries(map)) for (const o of this.layerObjs[id] || []) o.visible = !!on;
  }

  /** Global overlay strength 0..1 for the translucent shells. */
  setOpacity(v) {
    this.mats.bone.opacity = clamp(0.15 + v * 0.55, 0.1, 0.95);
    this.mats.neck.opacity = clamp(0.1 + v * 0.5, 0.1, 0.9);
    for (const m of [this.mats.bone, this.mats.neck]) { m.transparent = true; m.depthWrite = false; }
    setRim(this.mats.bone, 0.5 + (1 - v) * 1.0);
  }

  setAlign({ scale = 1, dy = 0, dz = 0 }) {
    this.align.scale.setScalar(scale);
    this.align.position.set(0, dy, dz);
  }

  /** Place the head. s = uniform scale, t = camera-space position of the model origin. */
  setPose(quat, s, t) {
    this.group.quaternion.copy(quat);
    this.group.scale.setScalar(s);
    this.group.position.copy(t);
    this.group.updateMatrixWorld(true);
    // world-space neck clip plane: keep points above NECK_CUT_Y in head space
    const n = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
    const p = new THREE.Vector3(0, NECK_CUT_Y, 0).applyMatrix4(this.model.matrixWorld);
    this.clip.setFromNormalAndCoplanarPoint(n, p);
  }

  /** bs: object of blendshape scores (0..1) */
  setExpression(bs) {
    const g = (k) => bs[k] || 0;
    const open = clamp(g('jawOpen') * 1.35, 0, 1);
    this.jaw.rotation.set(open * 0.46, 0, 0);
    this.jaw.position.set(
      JAW_PIVOT.x + (g('jawLeft') - g('jawRight')) * 0.008,
      JAW_PIVOT.y - open * 0.002,
      JAW_PIVOT.z + g('jawForward') * 0.007 + open * 0.004,
    );
    const MAX = 0.6; // radians
    // subject's left eye = +X in model space
    this.eyeL.rotation.set(
      (g('eyeLookDownLeft') - g('eyeLookUpLeft')) * MAX,
      (g('eyeLookOutLeft') - g('eyeLookInLeft')) * MAX, 0, 'YXZ');
    this.eyeR.rotation.set(
      (g('eyeLookDownRight') - g('eyeLookUpRight')) * MAX,
      (g('eyeLookInRight') - g('eyeLookOutRight')) * MAX, 0, 'YXZ');
  }
}
