import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  STRUCTS, BY_KEY, SYSTEMS, SYSTEM_LABELS, SYSTEM_COLORS,
  loadModel, indexMeshes, scanMaterial, setRim, ghostSkinMaterial,
} from './anatomy.js';
import { describe } from './info.js';
import { bnName, BN_SYSTEM, BN_CATEGORY } from './bn.js';

const EYE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const ACCENT = new THREE.Color('#4de1ff');

const PRESETS = [
  { id: 'full', name: 'Overview', sys: { skin: 0.22, skeleton: 1, muscles: 0, organs: 1, vessels: 0.0, nerves: 0 }, cam: { t: [0, 0.86, 0], d: 4.3 } },
  { id: 'skin', name: 'Surface', sys: { skin: 1, skeleton: 0, muscles: 0, organs: 0, vessels: 0, nerves: 0 }, cam: { t: [0, 0.86, 0], d: 4.3 } },
  { id: 'muscles', name: 'Muscles', sys: { skin: 0, skeleton: 0.0, muscles: 1, organs: 0, vessels: 0, nerves: 0 }, cam: { t: [0, 0.86, 0], d: 4.3 } },
  { id: 'skeleton', name: 'Skeleton', sys: { skin: 0.08, skeleton: 1, muscles: 0, organs: 0, vessels: 0, nerves: 0 }, cam: { t: [0, 0.86, 0], d: 4.3 } },
  { id: 'organs', name: 'Organs', sys: { skin: 0.1, skeleton: 0.18, muscles: 0, organs: 1, vessels: 0, nerves: 0 }, cam: { t: [0, 1.15, 0], d: 2.1 } },
  { id: 'circ', name: 'Circulatory', sys: { skin: 0.08, skeleton: 0.12, muscles: 0, organs: 1, vessels: 1, nerves: 0 }, filter: (s) => s.system === 'vessels' || s.category === 'Cardiovascular' || s.system === 'skeleton' || s.system === 'skin', cam: { t: [0, 1.0, 0], d: 3.0 } },
  { id: 'nerv', name: 'Nervous', sys: { skin: 0.08, skeleton: 0.12, muscles: 0, organs: 1, vessels: 0, nerves: 1 }, filter: (s) => s.system === 'nerves' || s.category === 'Neurological' || s.system === 'skeleton' || s.system === 'skin', cam: { t: [0, 1.0, 0], d: 3.0 } },
  { id: 'head', name: 'Head & neck', sys: { skin: 0.1, skeleton: 1, muscles: 0, organs: 1, vessels: 0.0, nerves: 1 }, filter: (s) => s.system === 'skin' || (s.system !== 'joints' && headKeys.has(s.key)), cam: { t: [0, 1.6, 0.02], d: 0.8 } },
];
const headKeys = new Set(['skull', 'mandible', 'teeth', 'spine_cervical', 'brain', 'cerebellum', 'brainstem', 'pituitary', 'eye_l', 'eye_r', 'tongue', 'pharynx', 'larynx', 'cranial_nerves', 'carotid_l', 'carotid_r', 'arteries_head', 'neck_muscles_l', 'neck_muscles_r', 'salivary_glands']);

export class Atlas {
  constructor() {
    this.$ = (id) => document.getElementById(id);
    this.canvas = this.$('atlas-canvas');
    this.view = this.$('atlas-view');
    this.sex = 'male';
    this.meshes = new Map();       // key -> mesh
    this.sysState = Object.fromEntries(SYSTEMS.map((s) => [s, { on: true, opacity: 1 }]));
    this.hiddenKeys = new Set();
    this.filter = null;
    this.selected = null;
    this.hovered = null;
    this.explode = 0;
    this.sectionAxis = 'off';
    this.camGoal = null;
    this.ready = false;
    this.active = false;

    this.#initThree();
    this.#initUI();
    this._tick = this._tick.bind(this);
  }

  /* ───────── three.js setup ───────── */
  #initThree() {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(devicePixelRatio, /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 1.5 : 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.localClippingEnabled = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.02, 60);
    this.camera.position.set(0, 1.1, 4.3);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.18;
    this.controls.maxDistance = 7;
    this.controls.target.set(0, 0.86, 0);
    this.controls.autoRotateSpeed = 1.2;
    this.controls.addEventListener('start', () => { this.camGoal = null; });

    this.scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x141a24, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 2.3); key.position.set(2.5, 4, 3.5); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x4de1ff, 1.6); rim.position.set(-3, 2, -3); this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0xffc9a8, 0.6); fill.position.set(-2, 0.5, 3); this.scene.add(fill);

    const grid = new THREE.PolarGridHelper(1.3, 16, 6, 96, 0x2b4a57, 0x16242c);
    grid.material.transparent = true; grid.material.opacity = 0.55;
    this.scene.add(grid);

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.jointGroup = new THREE.Group(); this.jointGroup.visible = false;
    this.scene.add(this.jointGroup);

    this.clipPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
    this.raycaster = new THREE.Raycaster();

    new ResizeObserver(() => this.#resize()).observe(this.view);
    this.#resize();

    // click picking (ignore drags)
    let down = null;
    this.canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    this.canvas.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]);
      down = null;
      if (moved < 5) this.#pick(e);
    });
  }

  #resize() {
    const w = this.view.clientWidth, h = this.view.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Centre the scene in the area above the floating toolbar, so the feet are never hidden behind it.
    const bar = this.$('atlas-toolbar');
    const covered = bar && bar.offsetHeight ? Math.min(bar.offsetHeight + 20, h * 0.4) : 0;
    if (covered) this.camera.setViewOffset(w, h, 0, Math.round(covered / 2), w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  /* ───────── model loading ───────── */
  async load(sex = this.sex) {
    this.sex = sex;
    this.ready = false;
    const loading = this.$('atlas-loading'), bar = this.$('atlas-loading-bar'), txt = this.$('atlas-loading-text');
    const token = (this.loadId = (this.loadId || 0) + 1);      // a newer load() call supersedes this one
    loading.classList.remove('done', 'error'); loading.onclick = null;
    txt.textContent = `Loading ${sex} anatomy…`;
    bar.style.width = '5%';
    // clear previous
    this.root.clear(); this.jointGroup.clear(); this.meshes.clear(); this.selected = null;

    let scene;
    try {
      scene = await loadModel(sex, (e) => {
        if (token === this.loadId && e.lengthComputable) bar.style.width = `${Math.max(5, (e.loaded / e.total) * 100)}%`;
      });
    } catch (err) {
      if (token !== this.loadId) return;
      console.error(err);
      loading.classList.add('error'); bar.style.width = '0%';
      txt.textContent = 'Could not load the anatomy model — check your connection. Tap here to retry.';
      loading.onclick = () => this.load(sex);
      return;
    }
    if (token !== this.loadId) return;
    this.root.add(scene);
    this.byKey = indexMeshes(scene);

    for (const [key, mesh] of this.byKey) {
      const s = BY_KEY[key];
      if (!s) { mesh.visible = false; continue; }
      mesh.userData.key = key;
      mesh.userData.base = mesh.position.clone();
      mesh.geometry.computeBoundingBox();
      const c = new THREE.Vector3(); new THREE.Box3().setFromObject(mesh).getCenter(c);
      mesh.userData.center = c;
      if (key === 'skin') {
        // solid, lit human skin when fully shown; a see-through warm "ghost" when faded so organs stay visible
        mesh.userData.solid = scanMaterial('#e2ab8b', { opacity: 1, rim: 0.12, rimColor: '#ffd9c4', roughness: 0.62 });
        mesh.userData.ghost = ghostSkinMaterial('#f2b896');
        mesh.material = mesh.userData.ghost;
      } else mesh.material = scanMaterial(s.color, { opacity: 1, rim: s.system === 'skeleton' ? 0.25 : 0.4 });
      mesh.renderOrder = key === 'skin' ? 5 : 0;
      this.meshes.set(key, mesh);
    }
    this.#buildJoints();
    this.#buildStructList();
    this.#syncSexButtons();
    bar.style.width = '100%';
    loading.classList.add('done');
    this.ready = true;
    this.applyPreset('full', false);
    this.setExplode(this.explode);
    this.#updateSection();
  }

  #buildJoints() {
    const geo = new THREE.SphereGeometry(0.014, 20, 14);
    for (const s of STRUCTS.filter((x) => x.system === 'joints')) {
      const a = this.sex === 'female' && s.anchorFemale ? s.anchorFemale : s.anchor;
      if (!a) continue;
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, depthTest: false }));
      m.position.set(...a);
      m.renderOrder = 999;
      m.userData.key = s.key; m.userData.isJoint = true; m.userData.base = m.position.clone();
      this.jointGroup.add(m);
    }
  }

  /* ───────── UI ───────── */
  #initUI() {
    // sex toggle
    this.$('sex-seg').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.sex !== this.sex) this.load(b.dataset.sex);
    });

    // presets
    const pc = this.$('presets');
    PRESETS.forEach((p) => {
      const b = document.createElement('button');
      b.className = 'chip'; b.textContent = p.name; b.dataset.id = p.id;
      b.addEventListener('click', () => this.applyPreset(p.id));
      pc.appendChild(b);
    });

    // systems
    const sl = this.$('sys-list');
    SYSTEMS.forEach((sys) => {
      const row = document.createElement('div');
      row.className = 'sys'; row.dataset.sys = sys; row.style.setProperty('--c', SYSTEM_COLORS[sys]);
      row.innerHTML = `<button class="eye on" aria-label="Toggle ${SYSTEM_LABELS[sys]}">${EYE_SVG}</button>
        <div class="sys-name">${SYSTEM_LABELS[sys]} <small></small></div>
        <input type="range" min="0" max="100" value="100" aria-label="${SYSTEM_LABELS[sys]} opacity" />`;
      row.querySelector('.eye').addEventListener('click', () => this.setSystem(sys, { on: !this.sysState[sys].on }));
      row.querySelector('input').addEventListener('input', (e) => this.setSystem(sys, { opacity: e.target.value / 100, on: e.target.value > 0 }));
      sl.appendChild(row);
    });

    this.$('search').addEventListener('input', () => this.#filterList());

    // toolbar
    this.$('explode').addEventListener('input', (e) => this.setExplode(e.target.value / 100));
    this.$('section-seg').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      this.sectionAxis = b.dataset.axis;
      this.$('section-seg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      this.$('section-pos').disabled = this.sectionAxis === 'off';
      this.#updateSection();
    });
    this.$('section-pos').addEventListener('input', () => this.#updateSection());
    const toggle = (id, fn) => this.$(id).addEventListener('click', (e) => {
      const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
      e.currentTarget.setAttribute('aria-pressed', on); fn(on);
    });
    toggle('btn-rotate', (on) => { this.controls.autoRotate = on; });
    toggle('btn-joints', (on) => { this.jointGroup.visible = on; });
    this.$('btn-shot').addEventListener('click', () => this.screenshot());
    this.$('btn-reset').addEventListener('click', () => { this.select(null); this.hiddenKeys.clear(); this.$('explode').value = 0; this.setExplode(0); this.applyPreset('full'); });
  }

  #syncSexButtons() {
    this.$('sex-seg').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.sex === this.sex));
  }

  #buildStructList() {
    const list = this.$('struct-list');
    list.innerHTML = '';
    const present = STRUCTS.filter((s) => s.system !== 'joints' && this.meshes.has(s.key));
    this.$('struct-count').textContent = present.length;
    for (const sys of SYSTEMS) {
      const items = present.filter((s) => s.system === sys).sort((a, b) => a.label.localeCompare(b.label));
      if (!items.length) continue;
      const head = document.createElement('div'); head.className = 'group-head'; head.textContent = `${SYSTEM_LABELS[sys]} (${BN_SYSTEM[sys]}) · ${items.length}`; head.dataset.sys = sys;
      list.appendChild(head);
      for (const s of items) {
        const row = document.createElement('div');
        row.className = 'srow'; row.dataset.key = s.key; row.dataset.sys = sys;
        row.style.setProperty('--c', s.color);
        row.innerHTML = `<span class="dot"></span><span class="lbl">${s.label}<small class="bn">${bnName(s.key)}</small></span><button class="mini-eye" aria-label="Toggle ${s.label}">${EYE_SVG}</button>`;
        row.addEventListener('click', (e) => {
          if (e.target.closest('.mini-eye')) {
            if (this.hiddenKeys.has(s.key)) this.hiddenKeys.delete(s.key); else this.hiddenKeys.add(s.key);
            this.#applyVisibility(); return;
          }
          this.select(s.key, { focus: true });
        });
        row.addEventListener('pointerenter', () => this.#hover(s.key));
        row.addEventListener('pointerleave', () => this.#hover(null));
        list.appendChild(row);
      }
    }
    this.#filterList();
  }

  #filterList() {
    const q = this.$('search').value.trim().toLowerCase();
    const list = this.$('struct-list');
    const groups = new Map();
    list.querySelectorAll('.srow').forEach((r) => {
      const s = BY_KEY[r.dataset.key];
      const hit = !q || s.label.toLowerCase().includes(q) || bnName(s.key).includes(q) || s.category.toLowerCase().includes(q) || s.key.includes(q);
      r.style.display = hit ? '' : 'none';
      if (hit) groups.set(r.dataset.sys, true);
    });
    list.querySelectorAll('.group-head').forEach((h) => { h.style.display = groups.has(h.dataset.sys) ? '' : 'none'; });
  }

  /* ───────── state → scene ───────── */
  setSystem(sys, patch) {
    Object.assign(this.sysState[sys], patch);
    this.#applyVisibility();
  }

  applyPreset(id, animate = true) {
    const p = PRESETS.find((x) => x.id === id) || PRESETS[0];
    this.filter = p.filter || null;
    this.hiddenKeys.clear();
    for (const sys of SYSTEMS) this.sysState[sys] = { on: p.sys[sys] > 0, opacity: p.sys[sys] > 0 ? p.sys[sys] : 1 };
    this.$('presets').querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.id === p.id));
    this.#applyVisibility();
    if (animate) this.flyTo(new THREE.Vector3(...p.cam.t), p.cam.d);
    else { this.controls.target.set(...p.cam.t); this.camera.position.set(p.cam.t[0] + p.cam.d * 0.18, p.cam.t[1] + p.cam.d * 0.12, p.cam.t[2] + p.cam.d); }
  }

  #applyVisibility() {
    const focus = this.selected;
    for (const [key, mesh] of this.meshes) {
      const s = BY_KEY[key];
      const st = this.sysState[s.system];
      const allowed = (!this.filter || this.filter(s)) && !this.hiddenKeys.has(key);
      const on = st.on && allowed;
      mesh.visible = on;
      const dim = focus && focus !== key && s.system !== 'skin';
      const op = st.opacity * (dim ? 0.18 : 1);
      if (key === 'skin') {
        const solid = st.opacity >= 0.95;
        mesh.material = solid ? mesh.userData.solid : mesh.userData.ghost;
        mesh.renderOrder = solid ? 0 : 5;
        if (!solid) { mesh.material.uniforms.uOpacity.value = st.opacity * 1.6; mesh.material.uniforms.uBase.value = 0.05; }
      } else {
        const m = mesh.material;
        m.opacity = op; m.transparent = op < 0.999; m.depthWrite = op >= 0.999; m.needsUpdate = true;
        m.emissive.set(key === focus ? 0x1a8fb0 : key === this.hovered ? 0x0c4a5c : 0x000000);
        mesh.renderOrder = op < 0.999 ? 3 : 0;
      }
    }
    for (const row of this.$('struct-list').querySelectorAll('.srow')) {
      const key = row.dataset.key, st = this.sysState[BY_KEY[key].system];
      row.classList.toggle('hidden-s', !(st.on && (!this.filter || this.filter(BY_KEY[key])) && !this.hiddenKeys.has(key)));
      row.classList.toggle('sel', key === this.selected);
    }
    this.$('sys-list').querySelectorAll('.sys').forEach((row) => {
      const st = this.sysState[row.dataset.sys];
      row.querySelector('.eye').classList.toggle('on', st.on);
      row.querySelector('input').value = Math.round(st.opacity * 100);
    });
  }

  #hover(key) {
    this.hovered = key;
    for (const [k, mesh] of this.meshes) {
      if (k === 'skin') continue;
      mesh.material.emissive.set(k === this.selected ? 0x1a8fb0 : k === key ? 0x0c4a5c : 0x000000);
    }
  }

  setExplode(v) {
    this.explode = v;
    const c0 = new THREE.Vector3(0, 0.95, 0);
    for (const [key, mesh] of this.meshes) {
      if (key === 'skin') continue;
      const off = mesh.userData.center.clone().sub(c0).multiplyScalar(v * 0.9);
      mesh.position.copy(mesh.userData.base).add(off);
    }
    this.jointGroup.children.forEach((j) => j.position.copy(j.userData.base));
    this.jointGroup.visible = v < 0.01 && this.$('btn-joints').getAttribute('aria-pressed') === 'true';
  }

  #updateSection() {
    const axis = this.sectionAxis;
    if (axis === 'off') { this.renderer.clippingPlanes = []; return; }
    const t = this.$('section-pos').value / 100;
    const cfg = { x: { n: [1, 0, 0], lo: -0.35, hi: 0.35 }, y: { n: [0, -1, 0], lo: 0.0, hi: 1.85 }, z: { n: [0, 0, -1], lo: -0.25, hi: 0.25 } }[axis];
    const pos = cfg.lo + (cfg.hi - cfg.lo) * t;
    this.clipPlane.normal.set(...cfg.n);
    // keep side where n·p + c >= 0
    const axisIdx = { x: 0, y: 1, z: 2 }[axis];
    const sign = cfg.n[axisIdx];
    this.clipPlane.constant = -sign * pos;
    this.renderer.clippingPlanes = [this.clipPlane];
    this.renderer.localClippingEnabled = false;
  }

  /* ───────── selection ───────── */
  select(key, { focus = false, point = null } = {}) {
    this.selected = key;
    this.#applyVisibility();
    this.#renderInfo(key);
    if (key && focus) {
      const mesh = this.meshes.get(key) || null;
      if (mesh) {
        const box = new THREE.Box3().setFromObject(mesh);
        const size = box.getSize(new THREE.Vector3()).length();
        this.flyTo(box.getCenter(new THREE.Vector3()), Math.max(0.35, size * 1.9));
      }
    }
    this.calloutPoint = key ? (point || this.meshes.get(key)?.userData.center.clone()) : null;
    this.$('callout').hidden = !key;
    if (key) this.$('callout-text').innerHTML = `${BY_KEY[key].label}<small class="bn">${bnName(key)}</small>`;
    const sel = this.$('struct-list').querySelector('.srow.sel');
    sel?.scrollIntoView({ block: 'nearest' });
  }

  #pick(e) {
    if (!this.ready) return;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const targets = [];
    if (this.jointGroup.visible) targets.push(...this.jointGroup.children);
    for (const [key, m] of this.meshes) {
      if (!m.visible) continue;
      const st = this.sysState[BY_KEY[key].system];
      if (key === 'skin' && st.opacity < 0.9) continue;      // click through the ghost skin
      if (st.opacity < 0.2) continue;
      targets.push(m);
    }
    // clip-aware: drop hits on the removed side of the section plane
    const hits = this.raycaster.intersectObjects(targets, false).filter((h) => this.sectionAxis === 'off' || this.clipPlane.distanceToPoint(h.point) >= 0);
    const hit = hits[0];
    if (hit) this.select(hit.object.userData.key, { point: hit.point.clone() });
    else this.select(null);
  }

  #renderInfo(key) {
    const el = this.$('info');
    if (!key) {
      el.innerHTML = '<div class="info-empty"><div class="info-icon">◎</div><p>Select any structure in the 3D view or from the list to see what it is and where it sits.</p></div>';
      return;
    }
    const s = BY_KEY[key];
    const mesh = this.meshes.get(key);
    let dims = '–';
    if (mesh) {
      const sz = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3()).multiplyScalar(100);
      dims = `${sz.x.toFixed(1)} × ${sz.y.toFixed(1)} × ${sz.z.toFixed(1)} cm`;
    }
    el.innerHTML = `
      <h2>${s.label}</h2><div class="bn-title">${bnName(s.key)}</div>
      <div class="tags" style="--c:${s.color}"><span class="tag c">${SYSTEM_LABELS[s.system]} · ${BN_SYSTEM[s.system]}</span><span class="tag">${s.category} · ${BN_CATEGORY[s.category] || ''}</span></div>
      <p>${describe(s)}</p>
      <div class="kv"><span>Bounding size</span><b>${dims}</b><span>Model</span><b>${this.sex} reference</b><span>ID</span><b>${s.key}</b></div>
      <div class="actions"><button class="btn small" id="i-focus">Focus</button><button class="btn small" id="i-hide">Hide</button><button class="btn small" id="i-clear">Clear</button></div>
      <p class="warn">Educational model — simplified and not for diagnosis.</p>`;
    el.querySelector('#i-focus').onclick = () => this.select(key, { focus: true });
    el.querySelector('#i-hide').onclick = () => { this.hiddenKeys.add(key); this.select(null); };
    el.querySelector('#i-clear').onclick = () => this.select(null);
  }

  /* ───────── camera & loop ───────── */
  flyTo(target, dist) {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.camGoal = { target: target.clone(), pos: target.clone().add(dir.multiplyScalar(dist)) };
  }

  screenshot() {
    this.renderer.render(this.scene, this.camera);
    this.canvas.toBlob((b) => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `anatomy-${this.selected || 'view'}.png`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  }

  start() { if (this.active) return; this.active = true; this.#resize(); requestAnimationFrame(this._tick); }
  stop() { this.active = false; }

  _tick() {
    if (!this.active) return;
    requestAnimationFrame(this._tick);
    if (this.camGoal) {
      const g = this.camGoal;
      this.controls.target.lerp(g.target, 0.1);
      this.camera.position.lerp(g.pos, 0.1);
      if (this.controls.target.distanceTo(g.target) < 0.002 && this.camera.position.distanceTo(g.pos) < 0.004) this.camGoal = null;
    }
    this.controls.update();
    // callout follows its 3D anchor
    if (this.calloutPoint && !this.$('callout').hidden) {
      const p = this.calloutPoint.clone().project(this.camera);
      const w = this.view.clientWidth, h = this.view.clientHeight;
      const c = this.$('callout');
      const off = p.z > 1;
      c.style.visibility = off ? 'hidden' : 'visible';
      c.style.left = `${(p.x * 0.5 + 0.5) * w}px`;
      c.style.top = `${(-p.y * 0.5 + 0.5) * h}px`;
    }
    this.renderer.render(this.scene, this.camera);
  }
}
