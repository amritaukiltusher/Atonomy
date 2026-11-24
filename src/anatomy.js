import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import catalog from './catalog.json';

export const BASE = import.meta.env.BASE_URL;
export const STRUCTS = catalog;
export const BY_KEY = Object.fromEntries(catalog.map((s) => [s.key, s]));

export const SYSTEMS = ['skin', 'skeleton', 'muscles', 'organs', 'vessels', 'nerves'];
export const SYSTEM_LABELS = {
  skin: 'Skin', skeleton: 'Skeleton', muscles: 'Muscles', organs: 'Organs',
  vessels: 'Vessels', nerves: 'Nerves', joints: 'Joints',
};
export const SYSTEM_COLORS = {
  skin: '#e3b9a0', skeleton: '#ece4d0', muscles: '#d9534f', organs: '#e08a6a',
  vessels: '#4aa3ff', nerves: '#ffd84a',
};

/** Credit line required by the CC BY 4.0 licence of the models. */
export const ATTRIBUTION =
  'Anatomy: BodyParts3D © The Database Center for Life Science (CC BY 4.0); ' +
  'female organs: Human Reference Atlas 3D Reference Organs, HuBMAP (CC BY 4.0); ' +
  'female body: MakeHuman (CC0). Modified by open-anatomy-3d ' +
  '(https://github.com/MervinR07/open-anatomy-3d), CC BY 4.0.';

const cache = new Map();

/** Loads (once) and returns a fresh clone of the model scene. Geometry is shared, materials are not. */
export function loadModel(sex, onProgress) {
  if (!cache.has(sex)) {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const p = loader.loadAsync(`${BASE}models/anatomy-${sex}.glb`, onProgress);
    cache.set(sex, p);
    p.catch(() => cache.delete(sex));          // a failed download must not poison later attempts
  }
  return cache.get(sex).then((g) => {
    const scene = g.scene.clone(true);
    scene.traverse((o) => {
      if (o.isMesh && !o.geometry.attributes.normal) o.geometry.computeVertexNormals();
    });
    scene.updateMatrixWorld(true);
    return scene;
  });
}

/** Collect meshes by catalog key. */
export function indexMeshes(scene) {
  const map = new Map();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    let key = o.name;
    // GLTFLoader renames a node that shares its name with another node ("skin" group + "skin" mesh → "skin_1")
    if (!BY_KEY[key]) { const m = key.match(/^(.+)_\d+$/); if (m && BY_KEY[m[1]] && !map.has(m[1])) key = m[1]; }
    map.set(key, o);
  });
  return map;
}

/**
 * Standard material with a soft rim light — gives the "scan" look and keeps
 * overlapping transparent shapes readable.
 */
export function scanMaterial(color, { opacity = 1, rim = 0.35, rimColor = '#9fefff', roughness = 0.55 } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), roughness, metalness: 0.04,
    transparent: opacity < 1, opacity, depthWrite: opacity >= 0.999, side: THREE.FrontSide,
  });
  const rc = new THREE.Color(rimColor);
  mat.userData.rim = { strength: rim };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = { value: mat.userData.rim.strength };
    mat.userData.shader = sh;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRim;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         float rimF = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.2);
         totalEmissiveRadiance += vec3(${rc.r.toFixed(3)}, ${rc.g.toFixed(3)}, ${rc.b.toFixed(3)}) * rimF * uRim;`,
      );
  };
  mat.customProgramCacheKey = () => 'scan-rim';
  return mat;
}

export function setRim(mat, v) {
  mat.userData.rim.strength = v;
  if (mat.userData.shader) mat.userData.shader.uniforms.uRim.value = v;
}

/** Fresnel "ghost skin" shader. */
export function ghostSkinMaterial(color = '#6fdcff') {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.FrontSide, clipping: true,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 0.2 },
      uBase: { value: 0.05 },
    },
    vertexShader: /* glsl */`
      #include <clipping_planes_pars_vertex>
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <clipping_planes_pars_fragment>
      uniform vec3 uColor; uniform float uOpacity; uniform float uBase;
      varying vec3 vN; varying vec3 vV;
      void main() {
        #include <clipping_planes_fragment>
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4);
        float a = (uBase + f * 0.95) * uOpacity * 4.0;
        gl_FragColor = vec4(uColor * (0.7 + 0.6 * f), clamp(a, 0.0, 1.0));
        #include <colorspace_fragment>
      }`,
  });
}
