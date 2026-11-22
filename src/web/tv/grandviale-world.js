// Grand Viale: the 3D world, drawn with Three.js. It is a board game on a table that came alive: the board
// is a printed slab (meadow, avenue, spaces with their symbols) and on it stand hotels, cars, people, trees,
// mountains and a sea that look real. The dice are thrown onto the board.
//
// Axes: the game's (x, y) on the board are (x, z) here; height is the scene's y. Units are board units.
// The module only reads the game state every frame (see grandviale.js) and offers focus() / overview().

import { euro } from "../shared/config.js";
import * as THREE from "../vendor/three.module.min.js";
import { PERMIT_LOOK, PIPS } from "./grandviale-hud.js";
import { BEACH_Y, PATH, ROAD_WIDTH, SEA_Y, SPACE_COUNT, TILES, ringPoint } from "./grandviale-path.js";

const RENDER_MAX_WIDTH = 1280; // rendered at 720p and scaled up by the page: enough for the TV stick's GPU
const BOARD = { x: -160, y: -170, width: 2240, height: 1420 };
const BOARD_TEXTURE_SCALE = 1.25;
const OVERVIEW = { x: 960, z: 600, zoom: 1 };
const CAMERA_DISTANCE = 2250;
const CONSTRUCTION_MS = 1000;
const DIE_SIZE = 58;
const DIE_THROW_MS = 1200;

// Relative heights of the buildings of a hotel, by how many it has.
const HEIGHTS = { 3: [0.7, 1, 0.85], 4: [0.62, 0.82, 1, 0.9] };

// [x, y, size, kind]
const PLANTS = [
  [90, 420, 60, "tree"], [110, 700, 70, "tree"], [730, 590, 50, "tree"], [1120, 650, 55, "tree"],
  [1580, 540, 50, "tree"], [1850, 320, 65, "tree"], [1830, 700, 70, "tree"], [1110, 170, 55, "tree"],
  [650, 140, 60, "tree"], [1340, 120, 55, "tree"], [1880, 520, 50, "tree"], [1960, 120, 60, "tree"],
  [60, 290, 80, "pine"], [400, 110, 70, "pine"], [455, 170, 55, "pine"], [1500, 110, 75, "pine"],
  [1560, 80, 60, "pine"], [1900, 230, 70, "pine"], [-60, 520, 75, "pine"], [2000, 620, 70, "pine"],
  [290, 955, 80, "palm"], [730, 965, 70, "palm"], [960, 950, 85, "palm"], [1180, 960, 70, "palm"], [1650, 955, 80, "palm"],
  [60, 960, 75, "palm"], [1900, 950, 70, "palm"],
];
const MOUNTAINS = [[40, -60, 150, 300], [330, -80, 170, 380], [610, -70, 140, 280], [-110, 120, 120, 230]]; // [x, y, radius, height]
const CLOUDS = [[300, 200, 0.9], [1300, 500, 1.2], [1800, 150, 0.8]]; // [x, y, size]

// Number die: the value on each face, in the order of BoxGeometry's faces (+x, -x, +y, -y, +z, -z).
const NUMBER_FACES = [3, 4, 1, 6, 2, 5];
const PERMIT_FACES = ["si", "no", "si", "gratis", "si", "doppio"];
const TOP_FACE = 2;

function canvasTexture(width, height, paint) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext("2d"), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function lambert(color, options) {
  return new THREE.MeshLambertMaterial({ color, ...options });
}

// A mesh standing on the board at (x, y), its base at the given height.
function solid(geometry, material, x, height, y) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, height, y);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function easeOut(t) {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
}

// The printed top of the board: meadow, beach, sea bed, the avenue and its spaces.
function paintBoard(spaces) {
  const scale = BOARD_TEXTURE_SCALE;
  return canvasTexture(BOARD.width * scale, BOARD.height * scale, (context) => {
    context.setTransform(scale, 0, 0, scale, -BOARD.x * scale, -BOARD.y * scale);
    const meadow = context.createLinearGradient(0, BOARD.y, 0, BEACH_Y);
    meadow.addColorStop(0, "#5fae63");
    meadow.addColorStop(1, "#7fcb72");
    context.fillStyle = meadow;
    context.fillRect(BOARD.x, BOARD.y, BOARD.width, BOARD.height);
    for (let i = 0; i < 2600; i++) {
      const x = BOARD.x + (i * 7919) % BOARD.width;
      const y = BOARD.y + (i * 6271) % (BEACH_Y - BOARD.y);
      context.fillStyle = ["rgba(30,90,40,0.25)", "rgba(190,230,150,0.3)", "rgba(255,255,255,0.5)", "rgba(255,210,63,0.6)"][i % 4];
      context.fillRect(x, y, i % 4 < 2 ? 9 : 4, i % 4 < 2 ? 5 : 4);
    }
    for (const [x, y, radius] of [[300, 520, 220], [1000, 620, 170], [1450, 480, 240], [800, 200, 190], [1750, 760, 180], [150, 150, 170]]) {
      const patch = context.createRadialGradient(x, y, radius * 0.2, x, y, radius);
      patch.addColorStop(0, "rgba(35, 110, 55, 0.35)");
      patch.addColorStop(1, "rgba(35, 110, 55, 0)");
      context.fillStyle = patch;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }

    const sand = context.createLinearGradient(0, BEACH_Y - 30, 0, SEA_Y + 20);
    sand.addColorStop(0, "rgba(242, 223, 167, 0)");
    sand.addColorStop(0.25, "#f2dfa7");
    sand.addColorStop(1, "#e6cf8f");
    context.fillStyle = sand;
    context.fillRect(BOARD.x, BEACH_Y - 30, BOARD.width, SEA_Y - BEACH_Y + 60);
    context.fillStyle = "#2378a8";
    context.fillRect(BOARD.x, SEA_Y, BOARD.width, BOARD.y + BOARD.height - SEA_Y);

    context.lineJoin = "round";
    context.beginPath();
    PATH.samples.forEach((sample, index) => {
      if (index === 0) context.moveTo(sample.x, sample.y);
      else context.lineTo(sample.x, sample.y);
    });
    context.closePath();
    context.strokeStyle = "#f3ead8";
    context.lineWidth = ROAD_WIDTH + 18;
    context.stroke();
    context.strokeStyle = "#3d4158";
    context.lineWidth = ROAD_WIDTH;
    context.stroke();
    context.strokeStyle = "rgba(255, 255, 255, 0.4)";
    context.lineWidth = 4;
    context.setLineDash([18, 22]);
    context.stroke();
    context.setLineDash([]);

    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "40px system-ui, sans-serif";
    for (let index = 0; index < SPACE_COUNT; index++) {
      const point = ringPoint(index);
      const tile = TILES[spaces[index]];
      context.fillStyle = "rgba(0, 0, 0, 0.25)";
      context.beginPath();
      context.arc(point.x + 3, point.y + 5, 46, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = tile.color;
      context.beginPath();
      context.arc(point.x, point.y, 45, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#fffaf0";
      context.beginPath();
      context.arc(point.x, point.y, 36, 0, Math.PI * 2);
      context.fill();
      context.fillText(tile.icon, point.x, point.y + 2);
    }

    // the cream frame of a game board
    context.strokeStyle = "#f3ead8";
    context.lineWidth = 26;
    context.strokeRect(BOARD.x + 13, BOARD.y + 13, BOARD.width - 26, BOARD.height - 26);
    context.strokeStyle = "#c9a45c";
    context.lineWidth = 5;
    context.strokeRect(BOARD.x + 30, BOARD.y + 30, BOARD.width - 60, BOARD.height - 60);
  });
}

function woodTexture() {
  const texture = canvasTexture(256, 256, (context) => {
    context.fillStyle = "#5b3d27";
    context.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 90; i++) {
      context.fillStyle = i % 3 ? "rgba(40, 24, 12, 0.25)" : "rgba(150, 105, 65, 0.2)";
      context.fillRect(0, (i * 37) % 256, 256, 1 + (i % 4));
    }
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(10, 10);
  return texture;
}

// Wall with windows, and which of the windows are lit at night.
function facadeTextures(wall, glass) {
  const map = canvasTexture(64, 64, (context) => {
    context.fillStyle = glass ? "#3f7fb5" : wall;
    context.fillRect(0, 0, 64, 64);
    for (let row = 0; row < 2; row++) {
      for (let column = 0; column < 2; column++) {
        context.fillStyle = glass ? "#9fd6f2" : "#34455f";
        context.fillRect(7 + column * 32, 8 + row * 32, glass ? 22 : 16, glass ? 24 : 19);
        if (glass) continue;
        context.fillStyle = "rgba(255, 255, 255, 0.55)";
        context.fillRect(5 + column * 32, 27 + row * 32, 20, 3);
      }
    }
  });
  const glow = canvasTexture(128, 128, (context) => {
    context.fillStyle = "#000";
    context.fillRect(0, 0, 128, 128);
    for (let row = 0; row < 4; row++) {
      for (let column = 0; column < 4; column++) {
        if ((row * 7 + column * 5) % 3 === 0) continue;
        context.fillStyle = (row + column) % 2 ? "#ffd98a" : "#fff3c4";
        context.fillRect(7 + column * 32, 8 + row * 32, glass ? 22 : 16, glass ? 24 : 19);
      }
    }
  });
  for (const texture of [map, glow]) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
  }
  glow.repeat.set(0.5, 0.5);
  return { map, glow };
}

// A box standing on its base whose walls repeat the facade texture every two windows.
function facadeBox(width, height, depth) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.translate(0, height / 2, 0);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(width / 28)) / 2, uv.getY(i) * Math.max(1, Math.round(height / 26)) / 2);
  return geometry;
}

function dieTextures(kind) {
  const faces = kind === "number" ? NUMBER_FACES : PERMIT_FACES;
  return faces.map((face) => canvasTexture(128, 128, (context) => {
    context.fillStyle = "#fffdf5";
    context.fillRect(0, 0, 128, 128);
    context.strokeStyle = "#d8d2c0";
    context.lineWidth = 8;
    context.strokeRect(4, 4, 120, 120);
    if (kind === "number") {
      context.fillStyle = "#14142b";
      for (const [column, row] of PIPS[face]) {
        context.beginPath();
        context.arc(64 + column * 34, 64 + row * 34, 13, 0, Math.PI * 2);
        context.fill();
      }
      return;
    }
    const look = PERMIT_LOOK[face];
    context.fillStyle = look.color;
    context.fillRect(12, 12, 104, 104);
    context.fillStyle = "#fff";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "900 " + (look.text.length > 2 ? 24 : 58) + "px system-ui, sans-serif";
    context.fillText(look.text, 64, 68);
  }));
}

export function createWorld(canvas, state, hotels, spaces) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false; // redrawn every other frame, see draw()
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  const dayColor = new THREE.Color("#b9d9f0");
  const nightColor = new THREE.Color("#0c1030");
  scene.background = dayColor.clone();
  scene.fog = new THREE.Fog(scene.background, 3200, 6500);
  const camera = new THREE.PerspectiveCamera(32, 16 / 9, 40, 9000);

  function resize() {
    const width = Math.min(window.innerWidth * (window.devicePixelRatio || 1), RENDER_MAX_WIDTH);
    const height = width * window.innerHeight / window.innerWidth;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  // ---- light ----
  const sky = new THREE.HemisphereLight("#e6f2ff", "#7a6a45", 1.5);
  scene.add(sky);
  const sun = new THREE.DirectionalLight("#fff0d2", 3.2);
  sun.position.set(100, 1500, 1500);
  sun.target.position.set(960, 0, 560);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -1350;
  sun.shadow.camera.right = 1350;
  sun.shadow.camera.top = 1100;
  sun.shadow.camera.bottom = -1100;
  sun.shadow.camera.near = 200;
  sun.shadow.camera.far = 4200;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 1.5;
  scene.add(sun, sun.target);

  // ---- table and board ----
  const table = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), lambert("#ffffff", { map: woodTexture() }));
  table.rotation.x = -Math.PI / 2;
  table.position.set(960, -36, 560);
  table.receiveShadow = true;
  scene.add(table);

  const boardCenter = { x: BOARD.x + BOARD.width / 2, y: BOARD.y + BOARD.height / 2 };
  scene.add(solid(new THREE.BoxGeometry(BOARD.width, 34, BOARD.height), lambert("#2b2f45"), boardCenter.x, -17.5, boardCenter.y));
  const top = new THREE.Mesh(new THREE.PlaneGeometry(BOARD.width, BOARD.height), lambert("#ffffff", { map: paintBoard(spaces) }));
  top.rotation.x = -Math.PI / 2;
  top.position.set(boardCenter.x, 0, boardCenter.y);
  top.receiveShadow = true;
  scene.add(top);

  // ---- sea ----
  const waves = canvasTexture(256, 256, (context) => {
    context.clearRect(0, 0, 256, 256);
    context.strokeStyle = "rgba(255, 255, 255, 0.55)";
    context.lineWidth = 3;
    for (let row = 0; row < 6; row++) {
      context.beginPath();
      for (let x = 0; x <= 256; x += 8) context.lineTo(x, 20 + row * 42 + Math.sin(x / 256 * Math.PI * 4 + row) * 7);
      context.stroke();
    }
  });
  waves.wrapS = THREE.RepeatWrapping;
  waves.wrapT = THREE.RepeatWrapping;
  waves.repeat.set(9, 1);
  const seaDepth = BOARD.y + BOARD.height - SEA_Y - 30;
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(BOARD.width - 60, seaDepth),
    new THREE.MeshPhongMaterial({ color: "#3db4e6", map: waves, transparent: true, opacity: 0.86, shininess: 120, specular: "#ffffff" }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(boardCenter.x, 3, SEA_Y + seaDepth / 2);
  scene.add(water);

  const boats = [0, 1].map((index) => {
    const boat = new THREE.Group();
    boat.add(solid(new THREE.BoxGeometry(70, 12, 22), lambert("#6b4630"), 0, 6, 0));
    const sailShape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(34, 0), new THREE.Vector2(0, 70)]);
    const sail = solid(new THREE.ShapeGeometry(sailShape), lambert("#ffffff", { side: THREE.DoubleSide }), 2, 14, 0);
    const jib = solid(new THREE.ShapeGeometry(sailShape), lambert(index ? "#e63946" : "#ffb703", { side: THREE.DoubleSide }), -2, 14, 0);
    jib.scale.set(-0.8, 0.85, 1);
    boat.add(sail, jib);
    scene.add(boat);
    return boat;
  });

  // ---- mountains, plants, clouds, lamps ----
  const rock = lambert("#7f8aa6", { flatShading: true });
  const snow = lambert("#ffffff", { flatShading: true });
  for (const [x, y, radius, height] of MOUNTAINS) {
    const peak = solid(new THREE.ConeGeometry(radius, height, 7), rock, x, height / 2, y);
    peak.rotation.y = x;
    const cap = solid(new THREE.ConeGeometry(radius * 0.36, height * 0.36, 7), snow, x, height * 0.82 + 1, y);
    cap.rotation.y = x;
    scene.add(peak, cap);
  }

  const trunk = lambert("#6b4a32");
  const leaves = [lambert("#2f8f5b"), lambert("#256f4c"), lambert("#3fae62")];
  const palms = [];
  PLANTS.forEach(([x, y, size, kind], index) => {
    if (kind === "tree") {
      scene.add(solid(new THREE.CylinderGeometry(size * 0.08, size * 0.11, size * 0.7, 6), trunk, x, size * 0.35, y));
      const crown = solid(new THREE.IcosahedronGeometry(size * 0.48, 1), leaves[index % 3], x, size * 0.95, y);
      crown.scale.y = 1.15;
      scene.add(crown);
      return;
    }
    if (kind === "pine") {
      scene.add(solid(new THREE.CylinderGeometry(size * 0.06, size * 0.09, size * 0.4, 6), trunk, x, size * 0.2, y));
      for (let level = 0; level < 3; level++) {
        scene.add(solid(new THREE.ConeGeometry(size * (0.42 - level * 0.1), size * 0.6, 8), leaves[1], x, size * (0.6 + level * 0.36), y));
      }
      return;
    }
    const palm = new THREE.Group();
    const stem = solid(new THREE.CylinderGeometry(size * 0.05, size * 0.08, size * 1.3, 6), trunk, 0, size * 0.65, 0);
    palm.add(stem);
    for (let leaf = 0; leaf < 6; leaf++) {
      const frond = solid(new THREE.ConeGeometry(size * 0.12, size * 0.75, 4), leaves[2], 0, size * 1.3, 0);
      frond.rotation.set(0, 0, 1.15, "YXZ");
      frond.rotation.y = leaf * Math.PI / 3;
      frond.translateY(size * 0.33);
      palm.add(frond);
    }
    palm.position.set(x, 0, y);
    palm.rotation.z = 0.12;
    scene.add(palm);
    palms.push(palm);
  });

  const cloudMaterial = lambert("#ffffff", { transparent: true, opacity: 0.9 });
  const clouds = CLOUDS.map(([x, y, size]) => {
    const cloud = new THREE.Group();
    for (const [dx, dz, radius] of [[0, 0, 60], [-70, 10, 42], [70, 12, 46], [20, -30, 40]]) {
      const puff = solid(new THREE.IcosahedronGeometry(radius * size, 1), cloudMaterial, dx * size, 0, dz * size);
      puff.scale.y = 0.6;
      puff.receiveShadow = false;
      cloud.add(puff);
    }
    cloud.position.set(x, 520, y);
    scene.add(cloud);
    return cloud;
  });

  const lampGlow = new THREE.MeshBasicMaterial({ color: "#fff3c4" });
  const lampOff = lambert("#d9dde6");
  const lampHeads = [];
  for (let index = 0; index < SPACE_COUNT; index += 2) {
    const here = ringPoint(index + 0.5);
    const ahead = ringPoint(index + 0.6);
    const length = Math.hypot(ahead.x - here.x, ahead.y - here.y);
    const side = { x: -(ahead.y - here.y) / length, y: (ahead.x - here.x) / length };
    const x = here.x + side.x * (ROAD_WIDTH / 2 + 14);
    const y = here.y + side.y * (ROAD_WIDTH / 2 + 14);
    scene.add(solid(new THREE.CylinderGeometry(1.6, 2.2, 46, 5), lampOff, x, 23, y));
    const head = new THREE.Mesh(new THREE.SphereGeometry(5, 8, 6), lampOff);
    head.position.set(x, 48, y);
    scene.add(head);
    lampHeads.push(head);
  }

  // ---- hotels ----
  const lotFree = new THREE.Color("#e8d9b0");
  const white = new THREE.Color("#ffffff");
  const hotelViews = hotels.map((hotel) => buildHotel(hotel));

  function buildHotel(hotel) {
    const lot = hotel.lot;
    const centerX = lot.x + lot.width / 2;
    const centerY = lot.y + lot.height / 2;
    const border = solid(new THREE.BoxGeometry(lot.width + 16, 3, lot.height + 16), lambert("#b99b62"), centerX, 1.5, centerY);
    const plate = solid(new THREE.BoxGeometry(lot.width, 5, lot.height), lambert(lotFree), centerX, 2.5, centerY);
    scene.add(border, plate);

    const flag = new THREE.Group();
    flag.add(solid(new THREE.CylinderGeometry(1.5, 1.5, 78, 5), lambert("#e9edf5"), 0, 39, 0));
    const cloth = solid(new THREE.PlaneGeometry(34, 22), lambert("#ffffff", { side: THREE.DoubleSide }), 18, 66, 0);
    flag.add(cloth);
    flag.position.set(lot.x + 18, 5, lot.y + lot.height - 18);
    scene.add(flag);

    const textures = facadeTextures(hotel.style === "chalet" ? "#8a5a35" : hotel.accent, hotel.style === "tower");
    const wall = hotel.style === "tower"
      ? new THREE.MeshPhongMaterial({ map: textures.map, emissive: "#ffffff", emissiveMap: textures.glow, emissiveIntensity: 0.08, shininess: 90 })
      : lambert("#ffffff", { map: textures.map, emissive: "#ffffff", emissiveMap: textures.glow, emissiveIntensity: 0.05 });
    const accent = new THREE.Color(hotel.accent);
    const roofColor = { chalet: "#ffffff", pitched: "#b5523b" }[hotel.style] || accent.clone().multiplyScalar(0.55);
    const roof = lambert(roofColor, { flatShading: true });
    const trim = lambert(accent.clone().lerp(white, 0.6));

    const slotWidth = (lot.width - 50) / hotel.buildings;
    const width = Math.min(slotWidth - 14, 82);
    const depth = Math.min(lot.height * 0.42, 72);
    const pieces = [];
    for (let slot = 0; slot < hotel.buildings; slot++) {
      const height = hotel.tall * HEIGHTS[hotel.buildings][slot];
      const piece = new THREE.Group();
      piece.position.set(lot.x + 25 + slotWidth * (slot + 0.5), 5, lot.y + lot.height * 0.4);
      piece.userData = { width, depth, height };
      if (hotel.style === "lighthouse" && slot === 0) addLighthouse(piece, hotel.tall * 1.9);
      else addBuilding(piece, hotel.style, width, height, depth, wall, roof, trim);
      piece.visible = false;
      scene.add(piece);
      pieces.push(piece);
    }

    const leisure = new THREE.Group();
    leisure.add(solid(new THREE.BoxGeometry(92, 3, 44), lambert("#fffaf0"), 0, 1.5, 0));
    leisure.add(solid(new THREE.BoxGeometry(80, 3.4, 32), new THREE.MeshPhongMaterial({ color: "#35c6f0", shininess: 120 }), 0, 1.9, 0));
    for (const offset of [-34, 34]) {
      leisure.add(solid(new THREE.CylinderGeometry(1.2, 1.2, 26, 5), lambert("#8a5a35"), offset, 13, 32));
      leisure.add(solid(new THREE.ConeGeometry(15, 9, 8), lambert(offset < 0 ? "#e63946" : "#ffb703"), offset, 28, 32));
    }
    leisure.position.set(lot.x + lot.width * 0.5, 5, lot.y + lot.height * 0.8);
    leisure.visible = false;
    scene.add(leisure);

    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = 512;
    labelCanvas.height = 128;
    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    labelTexture.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, depthTest: false, transparent: true }));
    label.scale.set(250, 62, 1);
    label.position.set(centerX, 34, lot.y + lot.height + 26);
    label.renderOrder = 10;
    scene.add(label);

    return { hotel, plate, border, flag, cloth, wall, pieces, leisure, labelCanvas, labelTexture, signature: null };
  }

  function addBuilding(piece, style, width, height, depth, wall, roof, trim) {
    piece.add(solid(facadeBox(width, height, depth), wall, 0, 0, 0));
    piece.add(solid(new THREE.BoxGeometry(width * 0.24, 20, 3), lambert("#3a2a1e"), 0, 10, depth / 2 + 1));
    if (style === "chalet" || style === "pitched") {
      const pitched = solid(new THREE.ConeGeometry(width * 0.78, 34, 4), roof, 0, height + 17, 0);
      pitched.rotation.y = Math.PI / 4;
      pitched.scale.z = depth / width;
      piece.add(pitched);
      piece.add(solid(new THREE.BoxGeometry(8, 22, 8), lambert("#8d6e63"), width * 0.25, height + 16, 0));
      return;
    }
    piece.add(solid(new THREE.BoxGeometry(width + 6, 5, depth + 6), roof, 0, height + 2.5, 0));
    if (style === "dome") {
      piece.add(solid(new THREE.SphereGeometry(width * 0.36, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), trim, 0, height + 5, 0));
      piece.add(solid(new THREE.CylinderGeometry(1, 1, 18, 5), lambert("#ffd23f"), 0, height + 5 + width * 0.36 + 9, 0));
      return;
    }
    if (style === "tower") {
      piece.add(solid(new THREE.CylinderGeometry(1.4, 1.4, 44, 5), lambert("#c7d0e0"), 0, height + 27, 0));
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(4, 8, 6), new THREE.MeshBasicMaterial({ color: "#ff3b3b" }));
      beacon.position.set(0, height + 51, 0);
      beacon.userData.beacon = true;
      piece.add(beacon);
      return;
    }
    if (style === "palace") {
      for (let column = 0; column < 4; column++) {
        piece.add(solid(new THREE.CylinderGeometry(3, 3, 36, 8), lambert("#fffaf0"), -width / 2 + 8 + column * (width - 16) / 3, 18, depth / 2 + 6));
      }
      piece.add(solid(new THREE.BoxGeometry(width + 4, 6, 14), trim, 0, 39, depth / 2 + 4));
      return;
    }
    piece.add(solid(new THREE.BoxGeometry(width * 0.3, 9, depth * 0.3), lambert("#9aa3b8"), -width * 0.2, height + 9.5, 0));
  }

  function addLighthouse(piece, height) {
    const stripes = canvasTexture(8, 64, (context) => {
      for (let band = 0; band < 5; band++) {
        context.fillStyle = band % 2 ? "#e63946" : "#ffffff";
        context.fillRect(0, band * 13, 8, 13);
      }
    });
    const shaft = new THREE.CylinderGeometry(13, 24, height, 16);
    shaft.translate(0, height / 2, 0);
    piece.add(solid(shaft, lambert("#ffffff", { map: stripes }), 0, 0, 0));
    piece.add(solid(new THREE.CylinderGeometry(20, 20, 4, 16), lambert("#31456b"), 0, height + 2, 0));
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 18, 12), new THREE.MeshBasicMaterial({ color: "#fff3b0" }));
    lantern.position.set(0, height + 13, 0);
    piece.add(lantern);
    piece.add(solid(new THREE.ConeGeometry(16, 18, 12), lambert("#e63946"), 0, height + 31, 0));
    const beamGeometry = new THREE.ConeGeometry(30, 300, 16, 1, true);
    beamGeometry.translate(0, -150, 0);
    beamGeometry.rotateZ(Math.PI / 2);
    const beam = new THREE.Mesh(beamGeometry, new THREE.MeshBasicMaterial({
      color: "#fff3b0", transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    }));
    beam.position.set(0, height + 13, 0);
    beam.userData.beam = true;
    piece.add(beam);
    piece.userData.height = height;
  }

  function drawLabel(view, status) {
    const context = view.labelCanvas.getContext("2d");
    let detail = "In vendita · " + euro(view.hotel.land);
    if (status.owner) detail = status.owner.name;
    if (status.stage) detail = status.owner.name + " · notte " + euro(view.hotel.rates[status.stage - 1]);
    context.clearRect(0, 0, 512, 128);
    context.fillStyle = "rgba(16, 18, 44, 0.86)";
    context.beginPath();
    context.roundRect(6, 6, 500, 116, 30);
    context.fill();
    context.textAlign = "center";
    context.fillStyle = "#fff";
    context.font = "800 46px system-ui, sans-serif";
    context.fillText(view.hotel.name, 256, 58, 470);
    context.fillStyle = status.owner ? status.owner.hex : "#ffd23f";
    context.font = "700 34px system-ui, sans-serif";
    context.fillText(detail, 256, 102, 470);
    view.labelTexture.needsUpdate = true;
  }

  // ---- construction site: crane, scaffold and dust, lent to whichever hotel is growing ----
  const crane = new THREE.Group();
  const craneYellow = lambert("#ffc21a");
  const mast = solid(new THREE.BoxGeometry(7, 1, 7), craneYellow, 0, 0, 0);
  mast.geometry.translate(0, 0.5, 0);
  const jib = new THREE.Group();
  jib.add(solid(new THREE.BoxGeometry(120, 5, 5), craneYellow, 34, 0, 0));
  jib.add(solid(new THREE.BoxGeometry(16, 12, 10), lambert("#5a5f70"), -22, -4, 0));
  const cable = solid(new THREE.BoxGeometry(1.2, 1, 1.2), lambert("#222222"), 70, 0, 0);
  cable.geometry.translate(0, -0.5, 0);
  const load = solid(new THREE.BoxGeometry(14, 8, 14), lambert("#b0765a"), 70, 0, 0);
  jib.add(cable, load);
  crane.add(mast, jib);
  crane.visible = false;
  scene.add(crane);

  const scaffold = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1, 1, 6, 1)),
    new THREE.LineBasicMaterial({ color: "#ffc21a", transparent: true }));
  scaffold.visible = false;
  scene.add(scaffold);

  const dustMaterial = lambert("#e8dcc4", { transparent: true, opacity: 0.6 });
  const dust = Array.from({ length: 7 }, (unused, index) => {
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(12, 1), dustMaterial);
    puff.userData.angle = index * 0.9;
    puff.visible = false;
    scene.add(puff);
    return puff;
  });

  function showConstruction(piece, t) {
    const { width, depth, height } = piece.userData;
    const arrive = easeOut(t / 0.15) * (1 - easeOut((t - 0.85) / 0.15));
    crane.visible = true;
    crane.position.set(piece.position.x + width / 2 + 16, 5, piece.position.z - depth / 2 - 10);
    mast.scale.y = (height + 70) * Math.max(0.02, arrive);
    jib.position.y = (height + 70) * arrive;
    jib.rotation.y = Math.PI * 0.75 + Math.sin(t * Math.PI * 2) * 0.7;
    const drop = 20 + (1 - easeOut((t - 0.1) / 0.7)) * height;
    cable.scale.y = drop;
    load.position.y = -drop - 4;
    scaffold.visible = t < 0.9;
    scaffold.material.opacity = 1 - easeOut((t - 0.7) / 0.2);
    scaffold.scale.set(width + 10, height, depth + 10);
    scaffold.position.set(piece.position.x, 5 + height / 2, piece.position.z);
    dust.forEach((puff) => {
      const angle = puff.userData.angle + t * 2;
      const spread = width * 0.6 + t * 40;
      puff.visible = true;
      puff.position.set(piece.position.x + Math.cos(angle) * spread, 12 + t * 26, piece.position.z + Math.sin(angle) * spread * 0.7);
      puff.scale.setScalar(0.5 + t * 1.6);
    });
    dustMaterial.opacity = 0.6 * (1 - t);
  }

  function hideConstruction() {
    crane.visible = false;
    scaffold.visible = false;
    for (const puff of dust) puff.visible = false;
  }

  function updateHotels(now, night) {
    let building = false;
    hotelViews.forEach((view, index) => {
      const status = state.hotels[index];
      const hotel = view.hotel;
      const signature = (status.owner ? status.owner.peerId : "") + "|" + status.stage;
      if (signature !== view.signature) {
        view.signature = signature;
        view.plate.material.color.copy(status.owner ? new THREE.Color(status.owner.hex).lerp(white, 0.62) : lotFree);
        view.border.material.color.set(status.owner ? status.owner.hex : "#b99b62");
        view.flag.visible = status.owner !== null;
        if (status.owner) view.cloth.material.color.set(status.owner.hex);
        drawLabel(view, status);
      }
      view.cloth.rotation.y = Math.sin(now / 300 + index) * 0.35;
      view.wall.emissiveIntensity = 0.05 + night * 1.3;
      const t = (now - status.builtAt) / CONSTRUCTION_MS;
      view.pieces.forEach((piece, slot) => {
        piece.visible = slot < status.stage;
        if (!piece.visible) return;
        const growing = slot === status.stage - 1 && t < 1;
        piece.scale.y = growing ? Math.max(0.02, easeOut((t - 0.1) / 0.7)) : 1;
        if (growing) {
          building = true;
          showConstruction(piece, t);
        }
        for (const part of piece.children) {
          if (part.userData.beam) part.rotation.y = now / 700;
          if (part.userData.beacon) part.visible = Math.sin(now / 280) > 0;
        }
      });
      view.leisure.visible = status.stage > hotel.buildings;
      const leisureGrowing = view.leisure.visible && t < 1;
      view.leisure.scale.setScalar(leisureGrowing ? Math.max(0.02, easeOut(t)) : 1);
    });
    if (!building) hideConstruction();
  }

  // ---- entrances: a red carpet from the space to a canopy at the edge of the lot ----
  const entranceGroup = new THREE.Group();
  scene.add(entranceGroup);
  let entranceSignature = "";

  function updateEntrances() {
    let signature = "";
    for (const [space, index] of state.entranceAt) signature += space + ":" + index + ":" + state.hotels[index].owner.peerId + ",";
    if (signature === entranceSignature) return;
    entranceSignature = signature;
    entranceGroup.clear();
    for (const [space, index] of state.entranceAt) {
      const lot = hotels[index].lot;
      const from = ringPoint(space);
      const dx = lot.x + lot.width / 2 - from.x;
      const dy = lot.y + lot.height / 2 - from.y;
      const length = Math.hypot(dx, dy);
      const entrance = new THREE.Group();
      entrance.position.set(from.x, 0, from.y);
      entrance.rotation.y = Math.atan2(-dy, dx);
      const carpet = solid(new THREE.BoxGeometry(Math.min(length - 30, 110), 1, 22), lambert("#c1121f"), Math.min(length - 30, 110) / 2 + 40, 0.8, 0);
      const color = lambert(state.hotels[index].owner.hex);
      entrance.add(carpet);
      entrance.add(solid(new THREE.BoxGeometry(4, 34, 4), color, 62, 17, -14));
      entrance.add(solid(new THREE.BoxGeometry(4, 34, 4), color, 62, 17, 14));
      entrance.add(solid(new THREE.BoxGeometry(22, 5, 40), color, 62, 36, 0));
      entranceGroup.add(entrance);
    }
  }

  // ---- cars and people ----
  const tyre = lambert("#15151f");
  const glass = new THREE.MeshPhongMaterial({ color: "#bfe6ff", shininess: 100 });
  const playerViews = state.players.map((player) => {
    const car = new THREE.Group();
    const paint = new THREE.MeshPhongMaterial({ color: player.hex, shininess: 70 });
    car.add(solid(new THREE.BoxGeometry(64, 14, 30), paint, 0, 13, 0));
    car.add(solid(new THREE.BoxGeometry(34, 12, 26), glass, -3, 26, 0));
    car.add(solid(new THREE.BoxGeometry(30, 2, 24), paint, -3, 33, 0));
    for (const [x, z] of [[-20, -15], [-20, 15], [20, -15], [20, 15]]) {
      const wheel = solid(new THREE.CylinderGeometry(8, 8, 6, 12), tyre, x, 8, z);
      wheel.rotation.x = Math.PI / 2;
      car.add(wheel);
    }
    const lights = new THREE.Mesh(new THREE.BoxGeometry(2, 5, 24), new THREE.MeshBasicMaterial({ color: "#fff6c9" }));
    lights.position.set(32.5, 14, 0);
    car.add(lights);
    scene.add(car);

    const person = new THREE.Group();
    person.add(solid(new THREE.CylinderGeometry(4.5, 5.5, 18, 8), lambert(player.hex), 0, 9, 0));
    person.add(solid(new THREE.SphereGeometry(5, 10, 8), lambert("#f1c9a5"), 0, 23, 0));
    person.visible = false;
    scene.add(person);
    return { car, person };
  });

  // Where a player's car is, where it looks, and where the person who got out of it is (null: on board).
  function carPose(player, index, now) {
    if (player.move) {
      const t = Math.min(1, (now - player.move.start) / player.move.duration);
      const here = ringPoint(player.move.from + t);
      const ahead = ringPoint(player.move.from + t + 0.08);
      return { x: here.x, y: here.y, heading: Math.atan2(-(ahead.y - here.y), ahead.x - here.x), person: null };
    }
    const space = ringPoint(player.space);
    const ahead = ringPoint(player.space + 0.08);
    const heading = Math.atan2(-(ahead.y - space.y), ahead.x - space.x);
    const sharing = state.players.filter((other) => !other.bankrupt && other.space === player.space && !other.move);
    const lane = (sharing.indexOf(player) - (sharing.length - 1) / 2) * 34;
    const base = { x: space.x + Math.sin(heading) * lane, y: space.y + Math.cos(heading) * lane, heading, person: null };
    if (!player.glide && !player.hidden) return base;

    // visiting a hotel: the car pulls over towards the door, the guest walks the rest and goes in
    const door = player.glide ? (player.glide.from.x === space.x && player.glide.from.y === space.y ? player.glide.to : player.glide.from) : player.door;
    player.door = door;
    let progress = 1;
    if (player.glide) {
      const t = Math.min(1, (now - player.glide.start) / player.glide.duration);
      progress = player.glide.to === door ? t : 1 - t;
    }
    const parked = Math.min(progress / 0.35, 1) * 0.35;
    const carX = space.x + (door.x - space.x) * parked;
    const carY = space.y + (door.y - space.y) * parked;
    const walking = progress > 0.35 && !player.hidden;
    const walked = (progress - 0.35) / 0.65;
    return {
      x: carX, y: carY, heading: Math.atan2(-(door.y - space.y), door.x - space.x),
      person: walking ? { x: carX + (door.x - carX) * walked, y: carY + (door.y - carY) * walked } : null,
    };
  }

  function updatePlayers(now) {
    state.players.forEach((player, index) => {
      const view = playerViews[index];
      view.car.visible = !player.bankrupt;
      if (player.bankrupt) {
        view.person.visible = false;
        return;
      }
      const pose = carPose(player, index, now);
      view.car.position.set(pose.x, 0, pose.y);
      view.car.rotation.y = pose.heading;
      view.person.visible = pose.person !== null;
      if (pose.person) view.person.position.set(pose.person.x, 5 + Math.abs(Math.sin(now / 90)) * 2.5, pose.person.y);
    });
  }

  // ---- the space of the team in turn ----
  const ring = new THREE.Mesh(new THREE.RingGeometry(47, 58, 40), new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true }));
  ring.rotation.x = -Math.PI / 2;
  scene.add(ring);

  // ---- dice ----
  const dice = {};
  for (const kind of ["number", "permit"]) {
    const textures = dieTextures(kind);
    const materials = textures.map((texture) => new THREE.MeshPhongMaterial({ map: texture, shininess: 60 }));
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE), materials);
    mesh.castShadow = true;
    mesh.position.set(kind === "number" ? 905 : 1015, DIE_SIZE / 2, 962);
    mesh.rotation.y = kind === "number" ? 0.3 : -0.2;
    scene.add(mesh);
    dice[kind] = { mesh, materials, textures, faces: kind === "number" ? NUMBER_FACES : PERMIT_FACES, throwing: null };
  }
  let seenDie = null;

  // The result is decided by the game: its face is put on top before the throw (the die starts out of sight),
  // then the die flies in, bounces and spins down to rest exactly on it.
  function startThrow(die) {
    const view = dice[die.kind === "number" ? "number" : "permit"];
    const resultFace = view.faces.indexOf(die.face);
    const order = view.textures.map((texture, face) => face);
    order[TOP_FACE] = resultFace;
    order[resultFace] = TOP_FACE;
    view.materials.forEach((material, face) => {
      material.map = view.textures[order[face]];
    });
    const land = { x: current.x + (die.kind === "number" ? 70 : -70) / current.zoom, z: current.z + 150 / current.zoom };
    view.throwing = {
      start: die.startedAt,
      land,
      from: { x: land.x - 520, z: land.z + 260 },
      axis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
      yaw: (Math.random() - 0.5) * 0.7,
    };
  }

  function bounceHeight(t) {
    if (t < 0.45) return 380 * (1 - Math.pow(t / 0.45, 2));
    const hops = [[0.45, 0.75, 120], [0.75, 0.92, 45], [0.92, 1, 12]];
    for (const [from, to, height] of hops) {
      if (t <= to) {
        const u = (t - from) / (to - from);
        return height * 4 * u * (1 - u);
      }
    }
    return 0;
  }

  const yawAxis = new THREE.Vector3(0, 1, 0);
  const spin = new THREE.Quaternion();

  function updateDice(now) {
    const die = state.die;
    if (die.visible && die.rolling && die !== seenDie) {
      seenDie = die;
      startThrow(die);
    }
    for (const view of Object.values(dice)) {
      const flight = view.throwing;
      if (!flight) continue;
      const t = Math.min(1, (now - flight.start) / DIE_THROW_MS);
      const along = Math.pow(t, 0.8);
      view.mesh.position.set(
        flight.from.x + (flight.land.x - flight.from.x) * along,
        DIE_SIZE / 2 + bounceHeight(t),
        flight.from.z + (flight.land.z - flight.from.z) * along);
      view.mesh.quaternion.setFromAxisAngle(yawAxis, flight.yaw);
      spin.setFromAxisAngle(flight.axis, (1 - easeOut(t)) * Math.PI * 7);
      view.mesh.quaternion.multiply(spin);
      if (t === 1) view.throwing = null;
    }
  }

  // ---- camera ----
  const current = { ...OVERVIEW };
  let target = { ...OVERVIEW };

  function updateCamera(now, seconds) {
    const ease = 1 - Math.exp(-seconds * 2.8);
    current.x += (target.x - current.x) * ease;
    current.z += (target.z - current.z) * ease;
    current.zoom += (target.zoom - current.zoom) * ease;
    const close = Math.min(1, Math.max(0, (current.zoom - 1) / 1.1));
    const elevation = (50 - 20 * close) * Math.PI / 180; // lower, more dramatic angle when close
    const yaw = Math.sin(now / 9000) * 0.05 + close * 0.32;
    const distance = CAMERA_DISTANCE / current.zoom;
    camera.position.set(
      current.x + Math.sin(yaw) * Math.cos(elevation) * distance,
      Math.sin(elevation) * distance,
      current.z + Math.cos(yaw) * Math.cos(elevation) * distance);
    camera.lookAt(current.x, 30 * close, current.z);
  }

  // ---- night ----
  let night = 0;
  let frameNumber = 0;

  function updateSky(seconds) {
    night += ((state.night ? 1 : 0) - night) * Math.min(1, seconds * 2.2);
    sun.intensity = 3.2 - night * 2.9;
    sky.intensity = 1.5 - night * 1.1;
    scene.background.copy(dayColor).lerp(nightColor, night);
    scene.fog.color.copy(scene.background);
    const lit = night > 0.4;
    for (const head of lampHeads) head.material = lit ? lampGlow : lampOff;
  }

  return {
    draw(now, seconds) {
      updateSky(seconds);
      updateHotels(now, night);
      updateEntrances();
      updatePlayers(now);
      updateDice(now);
      updateCamera(now, seconds);

      const turn = ringPoint(state.players[state.current].space);
      ring.visible = !state.finished;
      ring.position.set(turn.x, 1.2, turn.y);
      ring.material.opacity = 0.55 + 0.35 * Math.sin(now / 200);
      waves.offset.x = now / 9000;
      water.position.y = 3 + Math.sin(now / 900) * 0.8;
      boats.forEach((boat, index) => {
        boat.position.set(((now / 1000 * (16 + index * 8) + index * 900) % 2100) - 100, 3 + Math.sin(now / 500 + index) * 2, SEA_Y + 70 + index * 60);
        boat.rotation.z = Math.sin(now / 700 + index) * 0.06;
      });
      clouds.forEach((cloud, index) => {
        cloud.position.x = ((now / 1000 * (9 + index * 3) + CLOUDS[index][0]) % 2800) - 400;
      });
      palms.forEach((palm, index) => {
        palm.rotation.z = 0.12 + Math.sin(now / 1100 + index) * 0.04;
      });
      frameNumber++;
      renderer.shadowMap.needsUpdate = frameNumber % 2 === 0;
      renderer.render(scene, camera);
    },
    stop() {
      window.removeEventListener("resize", resize);
      renderer.dispose();
    },
    focus(point, zoom) {
      target = { x: point.x, z: point.y, zoom };
    },
    overview() {
      target = { ...OVERVIEW };
    },
  };
}
