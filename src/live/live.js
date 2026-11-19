import * as THREE from 'three';
import { BASE, loadModel, indexMeshes } from '../anatomy.js';
import { HeadRig, HEAD_LAYERS } from './headRig.js';
import { HandRig, REST_LEFT, mirrorRest, handPointsFromMediaPipe } from './handRig.js';
import { fitHead, parseFaceMatrix, AXIS_CANDIDATES, HEAD_FEATURES, HEAD_FEATURE_VECS } from './fit.js';
import { OneEuroVec, QuatFilter, clamp } from './filters.js';
import { BodyRig, BODY_LAYERS, posePointsFromMediaPipe, syntheticPose, POSE_EDGES } from './bodyRig.js';

const GCS = 'https://storage.googleapis.com/mediapipe-models';
const FACE_URL = `${GCS}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`;
const HAND_URL = `${GCS}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`;
const POSE_URL = `${GCS}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`;
const NO_VIS = new Array(33).fill(0);

const FOV = 63;                                        // MediaPipe's face-geometry camera assumption (vertical, degrees)
const TAN_V = Math.tan((FOV * Math.PI) / 360);
const BS_KEYS = ['jawOpen', 'jawForward', 'jawLeft', 'jawRight',
  'eyeLookInLeft', 'eyeLookOutLeft', 'eyeLookUpLeft', 'eyeLookDownLeft',
  'eyeLookInRight', 'eyeLookOutRight', 'eyeLookUpRight', 'eyeLookDownRight'];

const $ = (id) => document.getElementById(id);

const UA = navigator.userAgent || '';
const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(UA) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(UA));
/** In-app browsers (Facebook, Instagram, Messenger, LINE, WeChat, TikTok...) very often block the camera. */
const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Snapchat|TikTok|musical_ly|LinkedInApp|Twitter/i.test(UA);
const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error(`${label} is taking too long`), { name: 'TimeoutError' })), ms)),
]);
const store = {
  get(k, d) { try { const v = localStorage.getItem(`anatomy-live:${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`anatomy-live:${k}`, JSON.stringify(v)); } catch { /* storage may be unavailable */ } },
};

async function pickModelUrl(local, remote) {
  if (!__LOCAL_TASKS__.includes(local.split('/').pop())) return remote;   // nothing bundled → straight to the CDN
  try {
    const r = await fetch(local, { method: 'GET' });
    const type = r.headers.get('content-type') || '';
    if (r.ok && !type.includes('text/html')) { r.body?.cancel?.(); return local; }
  } catch { /* fall through to CDN */ }
  return remote;
}

export class LiveScan {
  constructor() {
    this.stage = $('stage'); this.video = $('live-video');
    this.glCanvas = $('live-gl'); this.hud = $('live-hud'); this.hudCtx = this.hud.getContext('2d');
    this.mode = null;              // 'camera' | 'demo' | null
    this.runId = 0;                // bumped by every start/stop so an abandoned start can tell it was cancelled
    this.running = false;
    this.W = 1280; this.H = 720;
    this.opts = {
      opacity: store.get('opacity', 70), mirror: store.get('mirror', true), points: store.get('points', false), swap: store.get('swap', false),
      layers: store.get('layers', Object.fromEntries(HEAD_LAYERS.map((l) => [l.id, l.on]))),
      align: store.get('align', { scale: 100, dy: 0, dz: 0 }),
      trackMode: store.get('trackMode', 'face'),
      bodyLayers: store.get('bodyLayers', Object.fromEntries(BODY_LAYERS.map((l) => [l.id, l.on]))),
      flipz: store.get('flipz', false),
    };
    this.lastFrame = { face: null, hands: [] };
    this.fps = 0;
    this._tick = this._tick.bind(this);

    this.#initThree();
    this.#initUI();
  }

  /* ───────── setup ───────── */
  #initThree() {
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas: this.glCanvas, antialias: true, alpha: true, powerPreference: 'high-performance' }));
    r.setClearColor(0x000000, 0);
    r.setPixelRatio(1);
    r.localClippingEnabled = true;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, this.W / this.H, 0.01, 50);
    this.scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x20242c, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(0.5, 1, 1.2); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x4de1ff, 1.4); rim.position.set(-1, 0.3, -0.5); this.scene.add(rim);
    this.#resize(this.W, this.H);
  }

  #resize(w, h) {
    this.W = w; this.H = h;
    this.renderer.setSize(w, h, false);
    this.hud.width = w; this.hud.height = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  #initUI() {
    this.#buildLayers();
    const bindRange = (id, key, fn) => { const el = $(id); el.value = key.split('.').reduce((o, k) => o[k], this.opts); el.addEventListener('input', () => { fn(Number(el.value)); }); };
    bindRange('live-opacity', 'opacity', (v) => { this.opts.opacity = v; store.set('opacity', v); this.head?.setOpacity(v / 100); this.body?.setOpacity(v / 100); this.#applyHandOpacity(); });
    const al = (k) => (v) => { this.opts.align[k] = v; store.set('align', this.opts.align); this.#applyAlign(); };
    bindRange('al-scale', 'align.scale', al('scale'));
    bindRange('al-y', 'align.dy', al('dy'));
    bindRange('al-z', 'align.dz', al('dz'));
    $('al-reset').addEventListener('click', () => {
      this.opts.align = { scale: 100, dy: 0, dz: 0 }; store.set('align', this.opts.align);
      $('al-scale').value = 100; $('al-y').value = 0; $('al-z').value = 0; this.#applyAlign();
    });
    const chk = (id, key, fn) => { const el = $(id); el.checked = this.opts[key]; el.addEventListener('change', () => { this.opts[key] = el.checked; store.set(key, el.checked); fn?.(); }); };
    chk('opt-mirror', 'mirror', () => this.#applyMirror());
    chk('opt-points', 'points');
    chk('opt-swap', 'swap');
    chk('opt-flipz', 'flipz');
    this.#applyMirror();
    document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => this.#setMode(b.dataset.mode)));
    this.#syncModeUI();

    $('inapp-note').hidden = !IN_APP;
    $('btn-start').addEventListener('click', () => this.startCamera());
    $('btn-demo').addEventListener('click', () => this.startDemo());
    $('btn-stop').addEventListener('click', () => this.stop());
    $('btn-live-shot').addEventListener('click', () => this.screenshot());
  }

  /** (Re)builds the layer toggles for the current tracking mode. */
  #buildLayers() {
    const body = this.opts.trackMode === 'body';
    const defs = body ? BODY_LAYERS : HEAD_LAYERS;
    const state = body ? this.opts.bodyLayers : this.opts.layers;
    const wrap = $('live-layers');
    wrap.innerHTML = '';
    defs.forEach((l) => {
      const row = document.createElement('label');
      row.className = 'layer';
      row.innerHTML = `<input type="checkbox" ${state[l.id] ? 'checked' : ''} /><span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${l.color};margin-right:7px"></i>${l.label}</span>`;
      row.querySelector('input').addEventListener('change', (e) => {
        state[l.id] = e.target.checked; store.set(body ? 'bodyLayers' : 'layers', state);
        row.classList.toggle('on', e.target.checked); (body ? this.body : this.head)?.setLayers(state);
      });
      row.classList.toggle('on', !!state[l.id]);
      wrap.appendChild(row);
    });
  }

  #syncModeUI() {
    const body = this.opts.trackMode === 'body';
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === this.opts.trackMode));
    $('lbl-face').textContent = body ? 'Body' : 'Face';
    $('card-title').textContent = body ? 'See inside your whole body' : 'See inside your own head';
    $('card-desc').textContent = body
      ? 'Stand 2–3 metres back so your whole body is in the picture. The skeleton and organs follow your arms, legs, torso and head in real time.'
      : 'Point your webcam at your face. The skull, brain, jaw and eyes follow you in real time — open your mouth and the jaw opens, hold up a hand and its bones appear.';
    $('row-hands').hidden = body; $('row-swap').hidden = body; $('block-align').hidden = body; $('row-flipz').hidden = !body;
    this.#buildLayers();
  }

  async #setMode(mode) {
    if (mode === this.opts.trackMode) return;
    this.opts.trackMode = mode; store.set('trackMode', mode);
    this.#syncModeUI();
    const prev = this.mode;
    if (!prev) return;
    this.stop(true);                                     // restart the same source (camera / demo) in the new mode
    if (prev === 'camera') await this.startCamera(); else await this.startDemo();
  }

  #applyMirror() { this.stage.classList.toggle('mirror', this.opts.mirror); }
  #applyAlign() {
    const a = this.opts.align;
    this.head?.setAlign({ scale: a.scale / 100, dy: a.dy / 1000, dz: a.dz / 1000 });
  }
  #applyHandOpacity() { const o = 0.25 + (this.opts.opacity / 100) * 0.65; this.hands?.forEach((h) => h.setOpacity(o)); }

  async #ensureRigs() {
    if (this.head) return;
    this.#status('Loading anatomy model…');
    const scene = await loadModel('male');
    this.head = new HeadRig(scene);
    this.scene.add(this.head.group);
    this.head.setLayers(this.opts.layers); this.head.setOpacity(this.opts.opacity / 100); this.#applyAlign();

    const by = indexMeshes(await loadModel('male'));
    this.hands = [new HandRig(by.get('hand_l'), 'left'), new HandRig(by.get('hand_r'), 'right')];
    this.scene.add(this.hands[0].mesh, this.hands[1].mesh);
    this.#applyHandOpacity();

    // smoothing state
    this.fPose = new OneEuroVec(4, 2.0, 12.0);
    this.fQuat = new QuatFilter(2.5, 0.8);
    this.fBS = new OneEuroVec(BS_KEYS.length, 3.0, 5.0);
    this.fHand = { left: new OneEuroVec(63, 2.5, 30.0), right: new OneEuroVec(63, 2.5, 30.0) };
    this.axisFix = null; this.calib = { n: 0, err: AXIS_CANDIDATES.map(() => 0) };
    this.lostFace = 99; this.lostHand = { left: 99, right: 99 };
  }

  async #ensureBody() {
    if (this.body) return;
    this.#status('Loading 3D anatomy…');
    this.body = new BodyRig(await loadModel('male'));
    this.scene.add(this.body.group);
    this.body.setLayers(this.opts.bodyLayers); this.body.setOpacity(this.opts.opacity / 100);
    this.fBody = new OneEuroVec(99, 1.2, 15.0);
    this.bodyPts = Array.from({ length: 33 }, () => new THREE.Vector3());
  }

  /* ───────── start / stop ───────── */
  async startCamera() {
    this.#error(null);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      return this.#error(IN_APP
        ? 'This in-app browser does not allow camera access. Open this page in Chrome or Safari (use the ⋮ / share menu → "Open in browser").'
        : 'Camera access needs a secure page (https:// or localhost) and a browser that supports getUserMedia.');
    }
    $('btn-start').disabled = true;
    const run = ++this.runId;
    try {
      this.phase = 'camera';
      this.#status('Requesting camera… tap “Allow” when asked');
      const video = IS_MOBILE
        ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60, max: 90 } }
        : { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 90, max: 120 } };   // fast camera → more tracking updates per second
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      } catch (err) {
        if (err?.name !== 'OverconstrainedError' && err?.name !== 'NotFoundError') throw err;
        this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });   // any camera will do
      }
      if (run !== this.runId) { this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null; return; }   // cancelled while the permission prompt was open
      this.mode = 'camera';
      const v = this.video;
      v.muted = true; v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
      v.srcObject = this.stream;
      await withTimeout(v.play(), 10000, 'The camera preview');
      if (!v.videoWidth) await withTimeout(new Promise((res) => { v.onloadedmetadata = res; }), 8000, 'The camera preview');
      this.stage.classList.remove('demo');
      v.style.display = '';
      this.#resize(v.videoWidth || 640, v.videoHeight || 480);
      $('stage-empty').hidden = true;                    // show the live preview right away
      $('btn-stop').disabled = false;

      if (this.opts.trackMode === 'body') {
        this.phase = 'anatomy';
        this.#status('Camera on ✓   Loading 3D anatomy…');
        await this.#ensureBody();
        if (run !== this.runId) return;
        this.phase = 'tracker';
        this.#status('Camera on ✓   Anatomy ✓   Loading body tracker (first time ~6 MB)…');
        await withTimeout(this.#initPose(), 120000, 'The body tracker download');
        if (run !== this.runId) return;
        this.#begin();
        return;
      }
      this.phase = 'anatomy';
      this.#status('Camera on ✓   Loading 3D anatomy…');
      await this.#ensureRigs();
      if (run !== this.runId) return;
      this.phase = 'tracker';
      this.#status('Camera on ✓   Anatomy ✓   Loading face tracker (first time ~10 MB)…');
      await withTimeout(this.#initFace(), 120000, 'The face tracker download');
      if (run !== this.runId) return;
      this.#begin();
      this.#initHandsInBackground();
    } catch (e) {
      if (run !== this.runId) return;
      console.error(e);
      this.#fail(e);
    } finally {
      $('btn-start').disabled = false;
    }
  }

  async startDemo() {
    this.#error(null);
    this.stop(true);
    const run = ++this.runId;
    try {
      this.mode = 'demo';
      this.video.style.display = 'none';
      this.stage.classList.add('demo');
      const portrait = this.stage.clientHeight > this.stage.clientWidth * 1.1;   // phones: use a portrait canvas
      this.#resize(portrait ? 720 : 1280, portrait ? 1280 : 720);
      await (this.opts.trackMode === 'body' ? this.#ensureBody() : this.#ensureRigs());
      if (run !== this.runId) return;
      this.#begin();
    } catch (e) { if (run !== this.runId) return; console.error(e); this.#fail(e); }
  }

  #begin() {
    $('stage-empty').hidden = true;
    $('btn-stop').disabled = false; $('btn-live-shot').disabled = false;
    const body = this.opts.trackMode === 'body';
    this.head && (this.head.group.visible = false); this.hands?.forEach((h) => { h.mesh.visible = false; }); this.body?.hide();
    this.#status(this.mode === 'demo' ? (body ? 'Demo — simulated full body' : 'Demo — simulated head and hands') : (body ? 'Tracking — step back so your whole body is in view' : 'Tracking — show your face to the camera'));
    this.running = true; this.lastT = performance.now() / 1000; this.lastVideoT = -1; this.lastTs = 0;
    this.axisFix = null; this.calib = { n: 0, err: AXIS_CANDIDATES.map(() => 0) };
    requestAnimationFrame(this._tick);
  }

  stop(keepUI = false) {
    this.runId++;
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null; this.video.srcObject = null;
    if (this.head) this.head.group.visible = false;
    this.hands?.forEach((h) => { h.mesh.visible = false; });
    this.body?.hide();
    this.hudCtx.clearRect(0, 0, this.W, this.H);
    this.renderer.clear();
    this.mode = null;
    if (!keepUI) {
      $('stage-empty').hidden = false; $('live-status').hidden = true;
      $('btn-stop').disabled = true; $('btn-live-shot').disabled = true;
      $('stat-fps').textContent = $('stat-face').textContent = $('stat-hands').textContent = '–';
    }
  }

  onShow() { this.visible = true; }
  onHide() { this.visible = false; if (this.mode) this.stop(); }

  async #trackerKit() {
    if (this.kit) return this.kit;
    const { FilesetResolver, FaceLandmarker, HandLandmarker, PoseLandmarker } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks(`${BASE}wasm`);
    const make = async (Cls, url, extra) => {
      for (const delegate of ['GPU', 'CPU']) {
        try { return await Cls.createFromOptions(fileset, { baseOptions: { modelAssetPath: url, delegate }, runningMode: 'VIDEO', ...extra }); }
        catch (e) { if (delegate === 'CPU') throw e; console.warn(`${Cls.name}: GPU delegate failed, retrying on CPU`, e); }
      }
    };
    return (this.kit = { FaceLandmarker, HandLandmarker, PoseLandmarker, make });
  }

  async #initPose() {
    if (this.pose) return;
    const { PoseLandmarker, make } = await this.#trackerKit();
    const url = await pickModelUrl(`${BASE}models/mediapipe/pose_landmarker_lite.task`, POSE_URL);
    this.pose = await make(PoseLandmarker, url, { numPoses: 1 });
  }

  async #initFace() {
    if (this.face) return;
    const { FaceLandmarker, make } = await this.#trackerKit();
    const url = await pickModelUrl(`${BASE}models/mediapipe/face_landmarker.task`, FACE_URL);
    this.face = await make(FaceLandmarker, url, { numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true });
  }

  /** Hands load after the face is already tracking, so the first picture appears sooner on slow phones. */
  #initHandsInBackground() {
    if (this.handLm || this.handLoading) return;
    this.handLoading = true;
    (async () => {
      const { HandLandmarker, make } = await this.#trackerKit();
      const url = await pickModelUrl(`${BASE}models/mediapipe/hand_landmarker.task`, HAND_URL);
      this.handLm = await make(HandLandmarker, url, { numHands: 2 });
    })().catch((e) => {
      console.warn('Hand tracker failed to load', e);
      this.#toast('Hand tracking could not load — face tracking still works.');
    }).finally(() => { this.handLoading = false; });
  }

  /* ───────── frame loop ───────── */
  _tick(nowMs) {
    if (!this.running) return;
    requestAnimationFrame(this._tick);
    const now = nowMs / 1000;
    const dt = clamp(now - this.lastT, 0.001, 0.1); this.lastT = now;
    this.fps += (1 / dt - this.fps) * 0.1;

    try {
      if (this.mode === 'camera') this.#detect(dt);
      else this.#demo(now, dt);
    } catch (e) { console.error(e); this.#error(`Tracking error: ${e.message}`); this.running = false; return; }

    this.#drawHud();
    this.renderer.render(this.scene, this.camera);
    if (((nowMs / 250) | 0) !== this._lastStat) {
      this._lastStat = (nowMs / 250) | 0;
      $('stat-fps').textContent = this.fps.toFixed(0);
      if (this.opts.trackMode === 'body') $('stat-face').textContent = this.body?.group.visible ? 'tracking' : 'searching';
      else {
        $('stat-face').textContent = this.head.group.visible ? 'tracking' : 'searching';
        $('stat-hands').textContent = String(this.hands.filter((h) => h.mesh.visible).length);
      }
    }
  }

  #detect(dt) {
    const v = this.video;
    if (v.readyState < 2) return;
    if (v.currentTime !== this.lastVideoT) {
      this.lastVideoT = v.currentTime;
      const ts = Math.max(performance.now(), this.lastTs + 1); this.lastTs = ts;
      if (this.opts.trackMode === 'body') {
        const pr = this.pose.detectForVideo(v, ts);
        this.lastFrame.pose = pr;
        this.#applyPose(pr, dt);
        return;
      }
      const fr = this.face.detectForVideo(v, ts);
      this.lastFrame.face = fr;
      this.#applyFace(fr, dt);
      // hands may still be loading; on phones run them every other frame to keep the frame rate up
      if (this.handLm && (this.fps > 50 || (this._n = (this._n || 0) + 1) % 2 === 0)) {
        const hr = this.handLm.detectForVideo(v, ts);
        this.lastFrame.hands = hr;
        this.#applyHands(hr, dt);
      }
    }
  }

  /* ───────── face ───────── */
  #applyFace(fr, dt) {
    const lms = fr?.faceLandmarks?.[0];
    const mat = fr?.facialTransformationMatrixes?.[0];
    if (!lms || !mat) { if (++this.lostFace > 6) this.head.group.visible = false; return; }
    this.lostFace = 0;
    const bsArr = fr.faceBlendshapes?.[0]?.categories;
    const bs = {}; if (bsArr) for (const c of bsArr) bs[c.categoryName] = c.score;
    this.#poseHead(lms, mat.data, bs, dt);
  }

  #poseHead(lms, matData, bs, dt) {
    const { quat, tz } = parseFaceMatrix(matData);
    const aspect = this.W / this.H;

    // One-off self-calibration of the axis convention: pick the rotation that best reprojects the rigid features.
    if (!this.axisFix) {
      const idIdx = AXIS_CANDIDATES.findIndex((q) => Math.abs(q.w) > 0.999);
      AXIS_CANDIDATES.forEach((c, i) => { const f = fitHead(quat, tz, lms, TAN_V, aspect, c); this.calib.err[i] += f ? f.err : 1; });
      if (++this.calib.n >= 20) {
        let best = idIdx, bestE = this.calib.err[idIdx] * 0.85;                 // prefer the expected convention
        this.calib.err.forEach((e, i) => { if (e < bestE) { best = i; bestE = e; } });
        this.axisFix = AXIS_CANDIDATES[best].clone();
        this.calibInfo = { chosen: best, identity: idIdx, errIdentity: this.calib.err[idIdx] / this.calib.n, errChosen: this.calib.err[best] / this.calib.n };
        console.info('[live] head axis calibration', this.calibInfo);
      }
    }
    const fix = this.axisFix || AXIS_CANDIDATES.find((q) => Math.abs(q.w) > 0.999);
    const fit = fitHead(quat, tz, lms, TAN_V, aspect, fix);
    if (!fit || fit.err > 0.25) return;
    const q = quat.clone().multiply(fix);
    const qs = this.fQuat.filter(q, dt);
    const p = this.fPose.filter([fit.s, fit.tx, fit.ty, tz], dt, [0, 0, 0, 0]);
    this.head.setPose(qs, p[0], new THREE.Vector3(p[1], p[2], p[3]));
    this.head.group.visible = true;

    const raw = BS_KEYS.map((k) => bs[k] || 0);
    const sm = this.fBS.filter(raw, dt, new Array(raw.length));
    this.head.setExpression(Object.fromEntries(BS_KEYS.map((k, i) => [k, sm[i]])));
    this.lastFit = { ...fit, q: qs.clone() };
  }

  /* ───────── hands ───────── */
  #applyHands(hr, dt) {
    const seen = { left: false, right: false };
    const list = hr?.landmarks || [];
    for (let h = 0; h < list.length; h++) {
      const label = hr.handedness?.[h]?.[0]?.categoryName || 'Left';
      // frames are not mirrored, so MediaPipe's "Left" is the user's right hand
      let userRight = (label === 'Left') !== this.opts.swap;
      let key = userRight ? 'right' : 'left';
      if (seen[key]) key = key === 'right' ? 'left' : 'right';
      if (seen[key]) continue;
      seen[key] = true;
      const rig = this.hands[key === 'left' ? 0 : 1];
      const { P } = handPointsFromMediaPipe(list[h], hr.worldLandmarks[h], TAN_V, this.W / this.H);
      const flat = new Array(63); P.forEach((p, i) => { flat[i * 3] = p.x; flat[i * 3 + 1] = p.y; flat[i * 3 + 2] = p.z; });
      const sm = this.fHand[key].filter(flat, dt, new Array(63));
      const SP = P.map((p, i) => p.set(sm[i * 3], sm[i * 3 + 1], sm[i * 3 + 2]));
      rig.update(SP);
      rig.mesh.visible = true; this.lostHand[key] = 0;
    }
    for (const key of ['left', 'right']) {
      if (!seen[key] && ++this.lostHand[key] > 5) { this.hands[key === 'left' ? 0 : 1].mesh.visible = false; this.fHand[key].reset(); }
    }
  }

  /* ───────── demo (no camera) ───────── */
  /** Feeds one MediaPipe pose result through the same path for real tracking and the demo. */
  #applyPose(pr, dt) {
    const lm = pr?.landmarks?.[0], wd = pr?.worldLandmarks?.[0];
    const res = lm && wd ? posePointsFromMediaPipe(lm, wd, TAN_V, this.W / this.H, this.opts.flipz, this.bodyPts) : null;
    if (!res) { this.lostBody = (this.lostBody || 0) + dt; if (this.lostBody > 0.5) this.fBody.reset(); this.body.update(this.bodyPts, NO_VIS, dt); return; }
    this.lostBody = 0;
    const flat = new Array(99);
    res.P.forEach((p, i) => { flat[i * 3] = p.x; flat[i * 3 + 1] = p.y; flat[i * 3 + 2] = p.z; });
    this.fBody.filter(flat, dt, flat);
    res.P.forEach((p, i) => p.set(flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2]));
    this.body.update(res.P, res.vis, dt);
  }

  #demo(t, dt) {
    if (this.opts.trackMode === 'body') {
      const sp = syntheticPose(this.body, t, TAN_V, this.W / this.H, this.demoAmp ?? 1);
      this.lastFrame = { pose: { landmarks: [sp.landmarks], worldLandmarks: [sp.worldLandmarks] } };
      this.#applyPose(this.lastFrame.pose, dt);
      return;
    }
    const aspect = this.W / this.H;
    // ground-truth head transform
    const euler = new THREE.Euler(0.18 * Math.sin(t * 1.1), 0.55 * Math.sin(t * 0.7), 0.1 * Math.sin(t * 0.5), 'YXZ');
    const R = new THREE.Quaternion().setFromEuler(euler);
    const s = 1.04;
    const trueT = new THREE.Vector3(0.02 * Math.sin(t * 0.6), 0.01, -0.58);   // camera-space position of the head pivot
    // synthesise what MediaPipe would report: landmarks of the rigid features + the facial transform (cm)
    const lms = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
    HEAD_FEATURES.forEach((f, i) => {
      const P = HEAD_FEATURE_VECS[i].clone().applyQuaternion(R).multiplyScalar(s).add(trueT);
      lms[f.lm] = { x: (P.x / -P.z / (TAN_V * aspect) + 1) / 2, y: (1 - P.y / -P.z / TAN_V) / 2, z: 0 };
    });
    const m = new THREE.Matrix4().compose(new THREE.Vector3(0, 0, -58), R, new THREE.Vector3(1, 1, 1));
    const jaw = clamp(0.5 + 0.55 * Math.sin(t * 1.9), 0, 1) * 0.7;
    const bs = { jawOpen: jaw, eyeLookOutLeft: 0.25 * Math.sin(t), eyeLookInRight: 0.25 * Math.sin(t), eyeLookUpLeft: 0.1, eyeLookUpRight: 0.1 };
    this.lostFace = 0;
    this.#poseHead(lms, m.elements, bs, dt);
    this.lastFrame = { face: { faceLandmarks: [lms] }, hands: [] };

    // synthetic hands built from the rest skeleton with animated finger curls
    [['left', REST_LEFT, 0.2, 1], ['right', mirrorRest(REST_LEFT), -0.2, -1]].forEach(([key, rest, x, sgn], k) => {
      const rig = this.hands[k];
      const pts = rest.map((p) => p.clone());
      const curl = (base, amt) => {
        const f0 = pts[base + 1].clone().sub(pts[base]).normalize();
        const axis = new THREE.Vector3().crossVectors(f0, new THREE.Vector3(0, 0, 1)).normalize();
        for (let j = 0; j < 3; j++) {
          const q = new THREE.Quaternion().setFromAxisAngle(axis, amt * [0.9, 1.1, 0.8][j]);
          const pivot = pts[base + j].clone();
          for (let i = base + j + 1; i <= base + 3; i++) pts[i].sub(pivot).applyQuaternion(q).add(pivot);
        }
      };
      [5, 9, 13, 17].forEach((b, i) => curl(b, clamp(0.5 + 0.5 * Math.sin(t * 2 + i * 0.7 + k), 0, 1) * 1.0));
      const c = pts[0].clone().add(pts[9]).multiplyScalar(0.5);
      const g = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3 * Math.sin(t * 0.8 + k), sgn * (0.5 + 0.4 * Math.sin(t * 0.9)), Math.PI + 0.25 * Math.sin(t * 0.6)));
      const T = new THREE.Vector3(x + sgn * 0.0, -0.05 + 0.03 * Math.sin(t + k), -0.5);
      const P = pts.map((p) => p.clone().sub(c).applyQuaternion(g).add(T));
      rig.update(P); rig.mesh.visible = true;
    });
  }

  /* ───────── HUD / output ───────── */
  #drawHud() {
    const ctx = this.hudCtx, { W, H } = this;
    ctx.clearRect(0, 0, W, H);
    if (!this.opts.points) return;
    if (this.opts.trackMode === 'body') {
      const lm = this.lastFrame.pose?.landmarks?.[0];
      if (!lm) return;
      ctx.strokeStyle = 'rgba(125,255,168,0.8)'; ctx.lineWidth = 2; ctx.fillStyle = '#7dffa8';
      for (const [a, b] of POSE_EDGES) { ctx.beginPath(); ctx.moveTo(lm[a].x * W, lm[a].y * H); ctx.lineTo(lm[b].x * W, lm[b].y * H); ctx.stroke(); }
      for (const p of lm) ctx.fillRect(p.x * W - 2, p.y * H - 2, 4, 4);
      return;
    }
    if (this.mode !== 'camera') return;
    const fr = this.lastFrame;
    ctx.fillStyle = 'rgba(77,225,255,0.55)';
    const face = fr.face?.faceLandmarks?.[0];
    if (face) for (const p of face) ctx.fillRect(p.x * W - 1, p.y * H - 1, 2, 2);
    ctx.fillStyle = '#ffd84a';
    if (face) for (const f of HEAD_FEATURES) { const p = face[f.lm]; ctx.beginPath(); ctx.arc(p.x * W, p.y * H, 4, 0, 6.3); ctx.fill(); }
    // where the anatomy features landed
    if (this.lastFit && this.head.group.visible) {
      ctx.strokeStyle = '#ff5ad0'; ctx.lineWidth = 2;
      for (const v of HEAD_FEATURE_VECS) {
        const P = this.head.group.localToWorld(v.clone());
        const x = ((P.x / -P.z / (TAN_V * (W / H))) + 1) / 2 * W, y = (1 - P.y / -P.z / TAN_V) / 2 * H;
        ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y); ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 6); ctx.stroke();
      }
    }
    ctx.fillStyle = '#7dffa8';
    for (const hand of fr.hands?.landmarks || []) for (const p of hand) ctx.fillRect(p.x * W - 2, p.y * H - 2, 4, 4);
  }

  screenshot() {
    const c = document.createElement('canvas'); c.width = this.W; c.height = this.H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.save();
    if (this.opts.mirror) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
    if (this.mode === 'camera') ctx.drawImage(this.video, 0, 0, c.width, c.height);
    this.renderer.render(this.scene, this.camera);
    ctx.drawImage(this.glCanvas, 0, 0);
    ctx.restore();
    c.toBlob((b) => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'anatomy-live.png'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  }

  /* ───────── messages ───────── */
  #status(msg) { const el = $('live-status'); el.hidden = !msg; el.textContent = msg || ''; el.classList.toggle('busy', /…/.test(msg || '')); }
  /** Errors go inside the start card when it is showing (so phones can't miss them), otherwise float over the stage. */
  #error(msg) {
    const card = !$('stage-empty').hidden;
    const a = $('live-error'), b = $('card-error');
    a.hidden = !msg || card; a.textContent = msg || '';
    b.hidden = !msg || !card; b.textContent = msg || '';
  }
  #toast(msg) { this.#status(msg); clearTimeout(this._toast); this._toast = setTimeout(() => { if (this.running) this.#status('Tracking — show your face to the camera'); }, 6000); }
  #fail(e) {
    this.stop(true);
    $('btn-stop').disabled = true; $('btn-live-shot').disabled = true;
    $('stage-empty').hidden = false; this.#status(null);
    const name = e?.name || '';
    const where = { camera: 'starting the camera', anatomy: 'loading the 3D anatomy', tracker: 'loading the face tracker' }[this.phase] || 'starting';
    let msg = `Something went wrong while ${where}: ${e?.message || e}`;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      msg = IN_APP
        ? 'The camera is blocked in this in-app browser. Open this page in Chrome or Safari and allow the camera.'
        : 'Camera permission was denied. Allow the camera for this site (address bar lock icon → Permissions; on iPhone: Settings → Safari → Camera) and try again — or use the demo.';
    } else if (name === 'NotFoundError' || name === 'OverconstrainedError') msg = 'No camera was found on this device. You can still try the demo.';
    else if (name === 'NotReadableError' || name === 'AbortError') msg = 'The camera is in use by another app or tab. Close it and try again.';
    else if (name === 'TimeoutError') msg = `${e.message}. Check your connection and tap Start camera again.`;
    else if (this.phase === 'tracker' || /fetch|network|Failed to load|download/i.test(String(e?.message))) {
      msg = `Could not load the face tracker (${e?.message || 'unknown error'}). It downloads from storage.googleapis.com — check your connection and try again.`;
    }
    this.#error(msg);
  }
}
