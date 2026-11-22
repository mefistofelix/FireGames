// Grand Viale: loading the 3D models (glTF binary files under src/web/assets/grandviale, CC0, see AGENTS.md).

import { GLTFLoader } from "../vendor/GLTFLoader.js";
import * as THREE from "../vendor/three.module.min.js";

const BASE = "../assets/grandviale/";
const loader = new GLTFLoader();
const cache = new Map();

const FILL_LIGHT = 0.45; // how much of its own colour a textured model shows whatever the light

// The files come with physically based materials; the TV's GPU is small, so they are swapped for the
// cheaper Lambert ones, keeping texture and colour. Textured models (buildings, cars, people) get a fill
// light of their own, or the sides away from the sun turn out too dark; the plants, which have plain
// colours, are made a little deeper and more saturated. Everything casts and receives shadows.
function prepare(scene, isPlant) {
  const converted = new Map();
  scene.traverse((node) => {
    if (!node.isMesh) return;
    node.castShadow = true;
    node.receiveShadow = true;
    if (!converted.has(node.material)) {
      const source = node.material;
      const material = new THREE.MeshLambertMaterial({ map: source.map, color: source.color, vertexColors: source.vertexColors });
      if (source.map) {
        material.emissive.set("#ffffff");
        material.emissiveMap = source.map;
        material.emissiveIntensity = FILL_LIGHT;
      }
      if (isPlant) material.color.offsetHSL(0, 0.18, -0.1);
      converted.set(source, material);
    }
    node.material = converted.get(node.material);
  });
}

function fetchModel(path) {
  return new Promise((resolve, reject) => {
    loader.load(BASE + path, (gltf) => {
      prepare(gltf.scene, path.startsWith("nature/"));
      resolve(gltf);
    }, undefined, reject);
  });
}

// A copy of a static model; the file is downloaded once however many copies are asked for.
export function loadModel(path) {
  if (!cache.has(path)) cache.set(path, fetchModel(path));
  return cache.get(path).then((gltf) => gltf.scene.clone(true));
}

// A model with a skeleton and animation clips ({scene, animations}). Not shared: each call reads the file again,
// because a skinned model cannot simply be cloned.
export function loadAnimated(path) {
  return fetchModel(path);
}

// Wraps a model in a group so that it stands on the ground, centred, with the wanted width (along x),
// height, or length (its longer horizontal side). The group's userData.size is the final size.
export function fitted(model, target) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  let scale = 1;
  if (target.width) scale = target.width / size.x;
  if (target.height) scale = target.height / size.y;
  if (target.length) scale = target.length / Math.max(size.x, size.z);
  model.scale.multiplyScalar(scale);
  const center = box.getCenter(new THREE.Vector3());
  model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
  const group = new THREE.Group();
  group.add(model);
  group.userData.size = size.multiplyScalar(scale);
  return group;
}

// Gives every material of a model its own copy in the given colour (the texture is multiplied by it).
export function tinted(group, color) {
  group.traverse((node) => {
    if (!node.isMesh) return;
    node.material = node.material.clone();
    node.material.color.copy(color);
  });
  return group;
}
