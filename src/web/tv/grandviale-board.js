// Grand Viale board: a holiday resort. A winding avenue loops between the mountains (top) and the beach
// (bottom); hotels stand in the bends, each with its own architecture.
//
// The world is a ground plane (x right, y towards the viewer) seen from above at an angle, plus a height axis:
// flat things are drawn through one canvas transform, upright things (buildings, trees, cars) at projected points,
// sorted back to front. What never changes on the ground (road, spaces, meadow) is painted once on a layer.
// A camera with a target position and zoom follows the events; the game moves it with focus() and overview().

import { euro } from "../shared/config.js";
import { drawCar, roundedRect } from "./scene.js";

const WIDTH = 1920;
const HEIGHT = 1080;
const CANVAS_MAX_WIDTH = 1280; // drawn at 720p and scaled up by the page: the TV stick cannot fill 1080p every frame
const GROUND_SQUASH = 0.72; // how much the ground is flattened by the viewing angle
const SCREEN_CENTER = { x: 960, y: 590 };
const OVERVIEW = { x: 960, y: 610, zoom: 1 };
const SPACE_COUNT = 28;
const ROAD_WIDTH = 96;
const BEACH_Y = 885;
const SEA_Y = 1035;
const LAYER = { x: -300, y: -150, width: 2520, height: 1250, scale: 1 }; // world rectangle of the painted layer

const TILES = {
  bank: { color: "#ffd23f", icon: "🏦" },
  buy: { color: "#2ec46d", icon: "💰" },
  build: { color: "#f77f00", icon: "🏗️" },
  free: { color: "#35c6f0", icon: "🚪" },
  gift: { color: "#ff6fb5", icon: "🎁" },
  municipio: { color: "#9b5de5", icon: "🏛️" },
};

const PERMIT_LOOK = {
  si: { text: "SÌ", color: "#2ec46d" },
  no: { text: "NO", color: "#e63946" },
  gratis: { text: "GRATIS", color: "#d99a00" },
  doppio: { text: "×2", color: "#f77f00" },
};

const PIPS = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

// The avenue passes through these points, clockwise on screen, starting at the Banca (bottom centre).
const AVENUE = [
  [960, 800], [640, 830], [360, 760], [230, 560], [330, 350], [560, 270], [760, 360], [900, 500],
  [1080, 420], [1220, 270], [1480, 250], [1680, 400], [1700, 620], [1540, 790], [1260, 830],
];

// [x, y, size, kind]
const PLANTS = [
  [90, 420, 60, "tree"], [110, 700, 70, "tree"], [730, 590, 50, "tree"], [1120, 650, 55, "tree"],
  [1580, 540, 50, "tree"], [1850, 320, 65, "tree"], [1830, 700, 70, "tree"], [1110, 170, 55, "tree"],
  [650, 140, 60, "tree"], [1340, 120, 55, "tree"], [1880, 520, 50, "tree"],
  [60, 270, 80, "pine"], [390, 120, 70, "pine"], [450, 175, 55, "pine"], [1500, 110, 75, "pine"],
  [1560, 80, 60, "pine"], [1885, 170, 70, "pine"],
  [290, 955, 80, "palm"], [730, 965, 70, "palm"], [960, 950, 85, "palm"], [1180, 960, 70, "palm"], [1650, 955, 80, "palm"],
];
const MOUNTAINS = [[70, 60, 330], [300, 40, 420], [560, 55, 300], [-120, 70, 260]]; // [x, y, height]
const MEADOW_PATCHES = [[300, 520, 200], [1000, 620, 160], [1450, 480, 220], [800, 200, 180], [1750, 760, 170], [150, 150, 150]];
const BUILDING_HEIGHTS = [0.62, 0.82, 1, 0.9];

// Dense polyline of a closed Catmull-Rom curve through AVENUE, with the distance walked up to each sample.
function buildPath() {
  const samples = [];
  const count = AVENUE.length;
  for (let i = 0; i < count; i++) {
    const [p0, p1, p2, p3] = [-1, 0, 1, 2].map((offset) => AVENUE[(i + offset + count) % count]);
    for (let step = 0; step < 24; step++) {
      const t = step / 24;
      const blend = (a, b, c, d) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
      samples.push({ x: blend(p0[0], p1[0], p2[0], p3[0]), y: blend(p0[1], p1[1], p2[1], p3[1]) });
    }
  }
  let walked = 0;
  samples.forEach((sample, index) => {
    sample.at = walked;
    const next = samples[(index + 1) % samples.length];
    walked += Math.hypot(next.x - sample.x, next.y - sample.y);
  });
  return { samples, length: walked };
}

const PATH = buildPath();

// World point of a position along the avenue; progress is a space index and may be fractional.
function ringPoint(progress) {
  const distance = (((progress % SPACE_COUNT) + SPACE_COUNT) % SPACE_COUNT) * PATH.length / SPACE_COUNT;
  const samples = PATH.samples;
  let index = samples.length - 1;
  while (samples[index].at > distance) index--;
  const from = samples[index];
  const to = samples[(index + 1) % samples.length];
  const span = Math.hypot(to.x - from.x, to.y - from.y);
  const t = (distance - from.at) / span;
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

export function spacePoint(index) {
  return ringPoint(index);
}

// Indexes of the spaces closest to a point: the spaces a hotel standing there is "next to".
export function nearestSpaces(point, count) {
  const byDistance = [];
  for (let index = 0; index < SPACE_COUNT; index++) {
    const space = ringPoint(index);
    byDistance.push({ index, distance: Math.hypot(space.x - point.x, space.y - point.y) });
  }
  byDistance.sort((a, b) => a.distance - b.distance);
  return byDistance.slice(0, count).map((entry) => entry.index).sort((a, b) => a - b);
}

// Centre, in screen units, of a player's chip in the top bar.
export function chipCenter(index, count) {
  const width = Math.min(430, 1840 / count);
  const left = (WIDTH - width * count) / 2;
  return { x: left + width * (index + 0.5), y: 58, width: width - 16 };
}

function shade(hex, factor) {
  const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  const mixed = channels.map((value) => Math.round(factor <= 1 ? value * factor : value + (255 - value) * (factor - 1)));
  return "rgb(" + mixed.join(",") + ")";
}

function easeOutBack(t) {
  const overshoot = 1.7;
  return 1 + (overshoot + 1) * Math.pow(t - 1, 3) + overshoot * Math.pow(t - 1, 2);
}

function tracePath(context) {
  context.beginPath();
  PATH.samples.forEach((sample, index) => {
    if (index === 0) context.moveTo(sample.x, sample.y);
    else context.lineTo(sample.x, sample.y);
  });
  context.closePath();
}

// Paints once what never changes on the ground. Icons are stretched so they look upright after the squash.
function paintLayer(spaces) {
  const layer = document.createElement("canvas");
  layer.width = LAYER.width * LAYER.scale;
  layer.height = LAYER.height * LAYER.scale;
  const context = layer.getContext("2d");
  context.setTransform(LAYER.scale, 0, 0, LAYER.scale, -LAYER.x * LAYER.scale, -LAYER.y * LAYER.scale);

  for (const [x, y, radius] of MEADOW_PATCHES) {
    const patch = context.createRadialGradient(x, y, radius * 0.2, x, y, radius);
    patch.addColorStop(0, "rgba(40, 120, 60, 0.28)");
    patch.addColorStop(1, "rgba(40, 120, 60, 0)");
    context.fillStyle = patch;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  const flowers = ["#fff", "#ffd23f", "#ff8fab"];
  for (let i = 0; i < 260; i++) {
    const x = (i * 733) % 2400 - 250;
    const y = (i * 397) % 1000 - 120;
    if (y > BEACH_Y - 20) continue;
    context.fillStyle = flowers[i % 3];
    context.fillRect(x, y, 5, 5);
  }

  context.lineJoin = "round";
  tracePath(context);
  context.strokeStyle = "rgba(0, 0, 0, 0.18)";
  context.lineWidth = ROAD_WIDTH + 34;
  context.stroke();
  context.strokeStyle = "#f3ead8";
  context.lineWidth = ROAD_WIDTH + 16;
  context.stroke();
  context.strokeStyle = "#454a66";
  context.lineWidth = ROAD_WIDTH;
  context.stroke();
  context.strokeStyle = "rgba(255, 255, 255, 0.35)";
  context.lineWidth = 4;
  context.setLineDash([18, 22]);
  context.stroke();
  context.setLineDash([]);

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "36px system-ui, sans-serif";
  for (let index = 0; index < SPACE_COUNT; index++) {
    const point = ringPoint(index);
    const tile = TILES[spaces[index]];
    context.fillStyle = tile.color;
    context.beginPath();
    context.arc(point.x, point.y, 44, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#fffaf0";
    context.beginPath();
    context.arc(point.x, point.y, 35, 0, Math.PI * 2);
    context.fill();
    context.save();
    context.translate(point.x, point.y);
    context.scale(1, 1 / GROUND_SQUASH);
    context.fillText(tile.icon, 0, 1);
    context.restore();
  }
  return layer;
}

export function createBoard(canvas, state, hotels, spaces) {
  const context = canvas.getContext("2d");
  const layer = paintLayer(spaces);
  const camera = { ...OVERVIEW };
  let target = { ...OVERVIEW };
  let running = true;
  let previous = performance.now();
  let night = 0;
  let unit = 1; // canvas pixels per screen unit
  let bottomGap = 0;
  let frames = 0;
  let countedSince = performance.now();

  function resize() {
    canvas.width = Math.min(window.innerWidth * (window.devicePixelRatio || 1), CANVAS_MAX_WIDTH);
    canvas.height = canvas.width * window.innerHeight / window.innerWidth;
    unit = canvas.width / WIDTH;
    bottomGap = canvas.height - HEIGHT * unit;
  }
  window.addEventListener("resize", resize);
  resize();

  function project(x, y, z) {
    return {
      x: SCREEN_CENTER.x + (x - camera.x) * camera.zoom,
      y: SCREEN_CENTER.y + (y - camera.y) * GROUND_SQUASH * camera.zoom - (z || 0) * camera.zoom,
    };
  }

  function useGround() {
    const scale = unit * camera.zoom;
    context.setTransform(scale, 0, 0, scale * GROUND_SQUASH,
      unit * (SCREEN_CENTER.x - camera.x * camera.zoom),
      unit * (SCREEN_CENTER.y - camera.y * GROUND_SQUASH * camera.zoom) + bottomGap);
  }

  function useScreen() {
    context.setTransform(unit, 0, 0, unit, 0, bottomGap);
  }

  function carPoint(player, now) {
    if (player.glide) {
      const t = Math.min(1, (now - player.glide.start) / player.glide.duration);
      return {
        x: player.glide.from.x + (player.glide.to.x - player.glide.from.x) * t,
        y: player.glide.from.y + (player.glide.to.y - player.glide.from.y) * t,
        hop: 0,
        progress: player.space,
      };
    }
    if (player.move) {
      const t = Math.min(1, (now - player.move.start) / player.move.duration);
      const point = ringPoint(player.move.from + t);
      return { x: point.x, y: point.y, hop: Math.sin(Math.PI * t) * 34, progress: player.move.from + t };
    }
    const point = ringPoint(player.space);
    return { x: point.x, y: point.y, hop: 0, progress: player.space };
  }

  function drawGround(now) {
    const time = now / 1000;
    context.fillStyle = "#f2dfa7";
    context.fillRect(-3000, BEACH_Y, 8000, SEA_Y - BEACH_Y + 40);
    context.fillStyle = "#3fa9d6";
    context.fillRect(-3000, SEA_Y, 8000, 3000);
    context.strokeStyle = "rgba(255, 255, 255, 0.8)";
    context.lineWidth = 7;
    for (let row = 0; row < 4; row++) {
      context.globalAlpha = row === 0 ? 0.9 : 0.35;
      context.beginPath();
      for (let x = -400; x <= 2400; x += 40) {
        const y = SEA_Y + row * 62 + Math.sin(x / 110 + time * 1.6 + row * 2) * 9 + Math.sin(time * 0.9) * 6;
        if (x === -400) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    }
    context.globalAlpha = 1;

    context.drawImage(layer, LAYER.x, LAYER.y, LAYER.width, LAYER.height);

    hotels.forEach((hotel, index) => {
      const lot = hotel.lot;
      const owner = state.hotels[index].owner;
      context.fillStyle = "rgba(0, 0, 0, 0.14)";
      roundedRect(context, lot.x + 6, lot.y + 10, lot.width, lot.height, 44);
      context.fillStyle = owner ? shade(owner.hex, 1.72) : "#ead9b0";
      roundedRect(context, lot.x, lot.y, lot.width, lot.height, 44);
      context.lineWidth = owner ? 10 : 4;
      context.strokeStyle = owner ? owner.hex : "rgba(110, 85, 45, 0.55)";
      context.setLineDash(owner ? [] : [16, 12]);
      context.stroke();
      context.setLineDash([]);
    });

    if (!state.finished) {
      const point = ringPoint(state.players[state.current].space);
      context.strokeStyle = "rgba(255, 255, 255, " + (0.55 + 0.35 * Math.sin(time * 5)) + ")";
      context.lineWidth = 8;
      context.beginPath();
      context.arc(point.x, point.y, 52, 0, Math.PI * 2);
      context.stroke();
    }
  }

  function drawShadow(base, width) {
    context.fillStyle = "rgba(0, 0, 0, 0.18)";
    context.beginPath();
    context.ellipse(base.x + width * 0.25, base.y, width, width * 0.3, 0, 0, Math.PI * 2);
    context.fill();
  }

  function drawPlant(plant, now) {
    const [x, y, size, kind] = plant;
    const base = project(x, y, 0);
    const zoom = camera.zoom;
    const tall = size * zoom;
    drawShadow(base, tall * 0.6);
    if (kind === "pine") {
      context.fillStyle = "#5a3d2b";
      context.fillRect(base.x - 5 * zoom, base.y - tall * 0.4, 10 * zoom, tall * 0.4);
      for (let level = 0; level < 3; level++) {
        const bottom = base.y - tall * (0.3 + level * 0.42);
        const half = tall * (0.5 - level * 0.11);
        context.fillStyle = level === 2 ? "#2f8f6a" : "#1f6e54";
        context.beginPath();
        context.moveTo(base.x - half, bottom);
        context.lineTo(base.x, bottom - tall * 0.75);
        context.lineTo(base.x + half, bottom);
        context.fill();
      }
      return;
    }
    if (kind === "palm") {
      const sway = Math.sin(now / 900 + x) * 0.06;
      const top = { x: base.x + tall * 0.25, y: base.y - tall * 1.5 };
      context.strokeStyle = "#8a5a35";
      context.lineWidth = 10 * zoom;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(base.x, base.y);
      context.quadraticCurveTo(base.x - tall * 0.1, base.y - tall * 0.8, top.x, top.y);
      context.stroke();
      context.strokeStyle = "#2f9b5c";
      context.lineWidth = 9 * zoom;
      for (let leaf = 0; leaf < 6; leaf++) {
        const angle = -Math.PI + leaf * Math.PI / 5 + sway;
        context.beginPath();
        context.moveTo(top.x, top.y);
        context.quadraticCurveTo(top.x + Math.cos(angle) * tall * 0.5, top.y + Math.sin(angle) * tall * 0.5 - tall * 0.2,
          top.x + Math.cos(angle) * tall * 0.8, top.y + Math.sin(angle) * tall * 0.3 + tall * 0.1);
        context.stroke();
      }
      context.lineCap = "butt";
      return;
    }
    context.fillStyle = "#5a3d2b";
    context.fillRect(base.x - 7 * zoom, base.y - tall, 14 * zoom, tall);
    context.fillStyle = "#1f7a55";
    context.beginPath();
    context.arc(base.x, base.y - tall * 1.25, tall * 0.62, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#2f9b6c";
    context.beginPath();
    context.arc(base.x - tall * 0.18, base.y - tall * 1.4, tall * 0.38, 0, Math.PI * 2);
    context.fill();
  }

  function drawMountain(mountain) {
    const [x, y, height] = mountain;
    const base = project(x, y, 0);
    const tall = height * camera.zoom;
    const half = tall * 0.75;
    context.fillStyle = "#7d8fb3";
    context.beginPath();
    context.moveTo(base.x - half, base.y);
    context.lineTo(base.x, base.y - tall);
    context.lineTo(base.x + half, base.y);
    context.fill();
    context.fillStyle = "#5f7198";
    context.beginPath();
    context.moveTo(base.x, base.y - tall);
    context.lineTo(base.x + half, base.y);
    context.lineTo(base.x + half * 0.2, base.y);
    context.fill();
    context.fillStyle = "#fff";
    context.beginPath();
    context.moveTo(base.x, base.y - tall);
    context.lineTo(base.x - half * 0.3, base.y - tall * 0.7);
    context.lineTo(base.x - half * 0.1, base.y - tall * 0.76);
    context.lineTo(base.x + half * 0.08, base.y - tall * 0.68);
    context.lineTo(base.x + half * 0.3, base.y - tall * 0.7);
    context.fill();
  }

  function drawBoat(index, now) {
    const x = ((now / 1000 * (18 + index * 9) + index * 900) % 2600) - 300;
    const base = project(x, SEA_Y + 110 + index * 70, 0);
    const zoom = camera.zoom;
    const bob = Math.sin(now / 500 + index) * 4 * zoom;
    context.fillStyle = "#fff";
    context.beginPath();
    context.moveTo(base.x, base.y - 90 * zoom + bob);
    context.lineTo(base.x + 46 * zoom, base.y - 16 * zoom + bob);
    context.lineTo(base.x, base.y - 16 * zoom + bob);
    context.fill();
    context.fillStyle = index ? "#e63946" : "#ffb703";
    context.beginPath();
    context.moveTo(base.x - 6 * zoom, base.y - 80 * zoom + bob);
    context.lineTo(base.x - 6 * zoom, base.y - 16 * zoom + bob);
    context.lineTo(base.x - 40 * zoom, base.y - 16 * zoom + bob);
    context.fill();
    context.fillStyle = "#5a3d2b";
    roundedRect(context, base.x - 50 * zoom, base.y - 12 * zoom + bob, 104 * zoom, 18 * zoom, 9 * zoom);
  }

  // The first building of the lighthouse inn: a striped tower with a turning beam.
  function drawLighthouse(base, grow, now) {
    const zoom = camera.zoom;
    const height = 210 * grow * zoom;
    const bottom = 30 * zoom;
    const top = 19 * zoom;
    drawShadow(base, 40 * zoom);
    for (let band = 0; band < 5; band++) {
      const from = band / 5;
      const to = (band + 1) / 5;
      const halfFrom = bottom + (top - bottom) * from;
      const halfTo = bottom + (top - bottom) * to;
      context.fillStyle = band % 2 ? "#e63946" : "#fff";
      context.beginPath();
      context.moveTo(base.x - halfFrom, base.y - height * from);
      context.lineTo(base.x + halfFrom, base.y - height * from);
      context.lineTo(base.x + halfTo, base.y - height * to);
      context.lineTo(base.x - halfTo, base.y - height * to);
      context.fill();
    }
    context.fillStyle = "#31456b";
    context.fillRect(base.x - 26 * zoom, base.y - height - 8 * zoom, 52 * zoom, 8 * zoom);
    context.fillStyle = "#fff3b0";
    context.fillRect(base.x - 15 * zoom, base.y - height - 36 * zoom, 30 * zoom, 28 * zoom);
    context.fillStyle = "#e63946";
    context.beginPath();
    context.moveTo(base.x - 22 * zoom, base.y - height - 36 * zoom);
    context.lineTo(base.x, base.y - height - 62 * zoom);
    context.lineTo(base.x + 22 * zoom, base.y - height - 36 * zoom);
    context.fill();
    if (grow < 1) return;
    const sweep = Math.sin(now / 1100);
    const reach = 300 * zoom;
    const origin = { x: base.x, y: base.y - height - 22 * zoom };
    const beam = context.createLinearGradient(origin.x, 0, origin.x + sweep * reach, 0);
    beam.addColorStop(0, "rgba(255, 243, 176, 0.75)");
    beam.addColorStop(1, "rgba(255, 243, 176, 0)");
    context.fillStyle = beam;
    context.beginPath();
    context.moveTo(origin.x, origin.y);
    context.lineTo(origin.x + sweep * reach, origin.y - 46 * zoom);
    context.lineTo(origin.x + sweep * reach, origin.y + 46 * zoom);
    context.fill();
  }

  // One building: a box seen from the front and above, finished according to the hotel's style.
  function drawBuilding(hotel, slot, grow, now) {
    const lot = hotel.lot;
    const zoom = camera.zoom;
    const slotWidth = (lot.width - 50) / 4;
    const base = project(lot.x + 30 + slot * slotWidth, lot.y + lot.height * 0.5, 0);
    if (hotel.style === "lighthouse" && slot === 0) {
      drawLighthouse({ x: base.x + slotWidth * zoom * 0.45, y: base.y }, grow, now);
      return;
    }
    const width = (slotWidth - 12) * zoom;
    const depth = 50 * GROUND_SQUASH * zoom;
    const height = hotel.tall * BUILDING_HEIGHTS[slot] * grow * zoom;
    const top = base.y - height;
    const glass = hotel.style === "tower";

    context.fillStyle = "rgba(0, 0, 0, 0.22)";
    context.fillRect(base.x + 12 * zoom, base.y - 4 * zoom, width, 16 * zoom);
    context.fillStyle = shade(hotel.accent, glass ? 0.6 : 0.85);
    context.fillRect(base.x, top, width, height);
    context.fillStyle = shade(hotel.accent, glass ? 0.42 : 0.64);
    context.fillRect(base.x + width * 0.86, top, width * 0.14, height);
    context.fillStyle = shade(hotel.accent, 1.38);
    context.fillRect(base.x, top - depth, width, depth);

    const rowHeight = (glass ? 17 : 24) * zoom;
    const rows = Math.floor((height - 26 * zoom) / rowHeight);
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < 3; column++) {
        const lit = Math.sin(now / 900 + row * 3.1 + column * 1.7 + slot * 5) > -0.2 || night > 0.3;
        context.fillStyle = lit ? (glass ? "#c9f1ff" : "#fff3b0") : (glass ? "#3f78b3" : "#31456b");
        context.fillRect(base.x + (8 + column * 17) * zoom, top + 10 * zoom + row * rowHeight, 11 * zoom, rowHeight * 0.6);
      }
    }
    context.fillStyle = "#3a2a1e";
    context.fillRect(base.x + width * 0.36, base.y - 20 * zoom, width * 0.24, 20 * zoom);

    if (hotel.style === "chalet" || hotel.style === "pitched") {
      context.fillStyle = hotel.style === "chalet" ? "#fff" : "#b5523b";
      context.beginPath();
      context.moveTo(base.x - 6 * zoom, top);
      context.lineTo(base.x + width / 2, top - depth - 34 * zoom);
      context.lineTo(base.x + width + 6 * zoom, top);
      context.fill();
      context.fillStyle = "#6b4630";
      context.fillRect(base.x - 6 * zoom, top - 3 * zoom, width + 12 * zoom, 6 * zoom);
    }
    if (hotel.style === "dome") {
      context.fillStyle = shade(hotel.accent, 1.6);
      context.beginPath();
      context.arc(base.x + width / 2, top - depth / 2, width * 0.36, Math.PI, 0);
      context.fill();
      context.fillStyle = "#ffd23f";
      context.fillRect(base.x + width / 2 - 2 * zoom, top - depth / 2 - width * 0.36 - 16 * zoom, 4 * zoom, 16 * zoom);
    }
    if (glass) {
      context.fillStyle = "#c7d0e0";
      context.fillRect(base.x + width / 2 - 2 * zoom, top - depth - 40 * zoom, 4 * zoom, 40 * zoom);
      context.fillStyle = Math.sin(now / 300) > 0 ? "#ff4d4d" : "#7a1f1f";
      context.beginPath();
      context.arc(base.x + width / 2, top - depth - 42 * zoom, 5 * zoom, 0, Math.PI * 2);
      context.fill();
    }
    if (hotel.style === "palace") {
      context.fillStyle = "#fff";
      for (let column = 0; column < 4; column++) {
        context.fillRect(base.x + (4 + column * (width / zoom - 14) / 3) * zoom, base.y - 34 * zoom, 6 * zoom, 34 * zoom);
      }
      context.fillStyle = shade(hotel.accent, 1.5);
      context.fillRect(base.x - 3 * zoom, base.y - 40 * zoom, width + 6 * zoom, 7 * zoom);
    }
  }

  // The leisure area, last piece of a hotel: a pool with a sunshade in front of the buildings.
  function drawLeisure(hotel, grow) {
    const lot = hotel.lot;
    const zoom = camera.zoom;
    const center = project(lot.x + lot.width * 0.74, lot.y + lot.height * 0.74, 0);
    const width = 62 * grow * zoom;
    context.fillStyle = "#fffaf0";
    context.beginPath();
    context.ellipse(center.x, center.y, width + 7 * zoom, (width + 7 * zoom) * 0.42, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#35c6f0";
    context.beginPath();
    context.ellipse(center.x, center.y, width, width * 0.42, 0, 0, Math.PI * 2);
    context.fill();
    const pole = { x: center.x + width + 22 * zoom, y: center.y + 6 * zoom };
    context.fillStyle = "#8a5a35";
    context.fillRect(pole.x - 2 * zoom, pole.y - 54 * grow * zoom, 4 * zoom, 54 * grow * zoom);
    context.fillStyle = "#e63946";
    context.beginPath();
    context.arc(pole.x, pole.y - 54 * grow * zoom, 26 * grow * zoom, Math.PI, 0);
    context.fill();
  }

  function drawHotel(index, now) {
    const hotel = hotels[index];
    const status = state.hotels[index];
    const newestGrow = Math.max(0.02, easeOutBack(Math.min(1, (now - status.builtAt) / 900)));
    const built = Math.min(status.stage, hotel.buildings);
    for (let slot = 0; slot < built; slot++) {
      const newest = slot === status.stage - 1;
      drawBuilding(hotel, slot, newest ? newestGrow : 1, now);
    }
    if (status.stage > hotel.buildings) drawLeisure(hotel, newestGrow);
  }

  function drawEntrance(space, index) {
    const hotel = hotels[index];
    const owner = state.hotels[index].owner;
    const from = ringPoint(space);
    const lotCenter = { x: hotel.lot.x + hotel.lot.width / 2, y: hotel.lot.y + hotel.lot.height / 2 };
    const length = Math.hypot(lotCenter.x - from.x, lotCenter.y - from.y);
    const point = project(from.x + (lotCenter.x - from.x) / length * 62, from.y + (lotCenter.y - from.y) / length * 62, 0);
    const zoom = camera.zoom;
    context.fillStyle = owner.hex;
    roundedRect(context, point.x - 17 * zoom, point.y - 42 * zoom, 34 * zoom, 42 * zoom, 14 * zoom);
    context.fillStyle = "#2b1d14";
    roundedRect(context, point.x - 9 * zoom, point.y - 28 * zoom, 18 * zoom, 28 * zoom, 8 * zoom);
  }

  function drawLotLabel(index) {
    const hotel = hotels[index];
    const status = state.hotels[index];
    const lot = hotel.lot;
    const point = project(lot.x + lot.width / 2, lot.y + lot.height - 8, 0);
    const size = 21 * Math.min(1.5, Math.max(1, camera.zoom));
    let detail = "In vendita · " + euro(hotel.land);
    if (status.owner) detail = status.owner.name;
    if (status.stage) detail = status.owner.name + " · notte " + euro(hotel.rates[status.stage - 1]);
    context.textAlign = "center";
    context.font = "800 " + size + "px system-ui, sans-serif";
    const width = Math.max(context.measureText(hotel.name).width, context.measureText(detail).width * 0.8) + 30;
    context.fillStyle = "rgba(16, 18, 44, 0.82)";
    roundedRect(context, point.x - width / 2, point.y - size * 2.2, width, size * 2.5, size * 0.6);
    context.fillStyle = "#fff";
    context.fillText(hotel.name, point.x, point.y - size * 1.05);
    context.font = "600 " + size * 0.75 + "px system-ui, sans-serif";
    context.fillStyle = status.owner ? shade(status.owner.hex, 1.5) : "#ffd23f";
    context.fillText(detail, point.x, point.y - size * 0.05);
  }

  function drawUpright(now) {
    const items = [];
    for (const mountain of MOUNTAINS) items.push({ y: mountain[1], draw: () => drawMountain(mountain) });
    for (const plant of PLANTS) items.push({ y: plant[1], draw: () => drawPlant(plant, now) });
    for (let boat = 0; boat < 2; boat++) items.push({ y: SEA_Y + 110 + boat * 70, draw: () => drawBoat(boat, now) });
    hotels.forEach((hotel, index) => {
      items.push({ y: hotel.lot.y + hotel.lot.height * 0.5, draw: () => drawHotel(index, now) });
    });
    for (const [space, index] of state.entranceAt) {
      items.push({ y: ringPoint(space).y - 1, draw: () => drawEntrance(space, index) });
    }
    state.players.forEach((player, index) => {
      if (player.bankrupt || player.hidden) return;
      const point = carPoint(player, now);
      items.push({
        y: point.y + 2,
        draw: () => {
          const screen = project(point.x + (index - (state.players.length - 1) / 2) * 16, point.y + 14, point.hop);
          const direction = ringPoint(point.progress + 0.2).x >= ringPoint(point.progress).x ? 1 : -1;
          drawCar(context, screen.x, screen.y, 0.52 * camera.zoom, player.hex, 0, direction);
        },
      });
    });
    items.sort((a, b) => a.y - b.y);
    for (const item of items) item.draw();
    hotels.forEach((hotel, index) => drawLotLabel(index));

    for (const effect of state.effects) {
      if (effect.kind !== "dust") continue;
      const t = (now - effect.start) / effect.duration;
      const point = project(effect.x + effect.dx * t, effect.y, -effect.dy * t);
      context.fillStyle = "rgba(240, 225, 200, " + (1 - t) + ")";
      context.beginPath();
      context.arc(point.x, point.y, (8 + 14 * t) * camera.zoom, 0, Math.PI * 2);
      context.fill();
    }
  }

  function drawChips(seconds) {
    state.players.forEach((player, index) => {
      player.shownCash += (player.cash - player.shownCash) * Math.min(1, seconds * 6);
      const chip = chipCenter(index, state.players.length);
      const active = index === state.current && !state.finished;
      context.globalAlpha = player.bankrupt ? 0.45 : 1;
      context.fillStyle = active ? "#fff" : "rgba(16, 18, 44, 0.85)";
      roundedRect(context, chip.x - chip.width / 2, 14, chip.width, 88, 26);
      context.fillStyle = player.hex;
      context.beginPath();
      context.arc(chip.x - chip.width / 2 + 46, 58, 26, 0, Math.PI * 2);
      context.fill();
      context.textAlign = "left";
      context.fillStyle = active ? "#14142b" : "#fff";
      context.font = "800 30px system-ui, sans-serif";
      context.fillText(player.name, chip.x - chip.width / 2 + 86, 52);
      context.font = "700 28px system-ui, sans-serif";
      context.fillStyle = active ? "#0a7a3b" : "#7CFC9A";
      const cash = player.bankrupt ? "bancarotta" : euro(Math.round(player.shownCash));
      context.fillText(cash, chip.x - chip.width / 2 + 86, 86);
      context.globalAlpha = 1;
    });
  }

  function drawDie(now) {
    const die = state.die;
    if (!die.visible) return;
    let face = die.face;
    let angle = 0;
    let lift = 0;
    let scale = 1;
    if (die.rolling) {
      face = die.faces[Math.floor(now / 70) % die.faces.length];
      angle = now / 90;
      lift = Math.abs(Math.sin(now / 120)) * 70;
    } else {
      scale = 1 + 0.3 * Math.max(0, 1 - (now - die.stoppedAt) / 300);
    }
    context.save();
    context.translate(960, 560);
    context.fillStyle = "rgba(0, 0, 0, 0.3)";
    context.beginPath();
    context.ellipse(0, 110, 90 - lift * 0.4, 20, 0, 0, Math.PI * 2);
    context.fill();
    context.translate(0, -lift);
    context.rotate(angle);
    context.scale(scale, scale);
    context.fillStyle = die.hex;
    roundedRect(context, -92, -92, 184, 184, 40);
    context.fillStyle = "#fff";
    roundedRect(context, -80, -80, 160, 160, 32);
    if (die.kind === "number") {
      context.fillStyle = "#14142b";
      for (const [column, row] of PIPS[face]) {
        context.beginPath();
        context.arc(column * 44, row * 44, 16, 0, Math.PI * 2);
        context.fill();
      }
    } else {
      const look = PERMIT_LOOK[face];
      context.fillStyle = look.color;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = "900 " + (look.text.length > 2 ? 38 : 76) + "px system-ui, sans-serif";
      context.fillText(look.text, 0, 4);
      context.textBaseline = "alphabetic";
    }
    context.restore();
  }

  // The two dice of the game with their last result, in the bottom right corner.
  function drawTray() {
    const dice = [
      { x: 1740, kind: "number", face: state.tray.number },
      { x: 1838, kind: "permit", face: state.tray.permit },
    ];
    context.fillStyle = "rgba(16, 18, 44, 0.8)";
    roundedRect(context, 1680, 962, 218, 100, 24);
    for (const die of dice) {
      context.fillStyle = "#fff";
      roundedRect(context, die.x - 38, 974, 76, 76, 16);
      context.textAlign = "center";
      context.textBaseline = "middle";
      if (die.kind === "number" && die.face) {
        context.fillStyle = "#14142b";
        for (const [column, row] of PIPS[die.face]) {
          context.beginPath();
          context.arc(die.x + column * 21, 1012 + row * 21, 8, 0, Math.PI * 2);
          context.fill();
        }
      } else {
        const look = die.face ? PERMIT_LOOK[die.face] : { text: die.kind === "number" ? "1-6" : "SÌ/NO", color: "#9aa3b8" };
        context.fillStyle = look.color;
        context.font = "900 " + (look.text.length > 2 ? 17 : 34) + "px system-ui, sans-serif";
        context.fillText(look.text, die.x, 1013);
      }
      context.textBaseline = "alphabetic";
    }
  }

  function drawBanner(now) {
    const banner = state.banner;
    if (now > banner.until) return;
    const appear = Math.min(1, (now - banner.start) / 250);
    const vanish = Math.min(1, (banner.until - now) / 300);
    context.globalAlpha = Math.min(appear, vanish);
    context.font = "900 46px system-ui, sans-serif";
    context.textAlign = "center";
    const width = context.measureText(banner.text).width + 90;
    context.fillStyle = banner.hex;
    roundedRect(context, 960 - width / 2, 128 - 20 * (1 - appear), width, 84, 42);
    context.strokeStyle = "#fff";
    context.lineWidth = 5;
    context.stroke();
    context.fillStyle = "#fff";
    context.fillText(banner.text, 960, 186 - 20 * (1 - appear));
    context.globalAlpha = 1;
  }

  function drawTexts(now) {
    for (const effect of state.effects) {
      if (effect.kind !== "text") continue;
      const t = (now - effect.start) / effect.duration;
      context.globalAlpha = 1 - t * t;
      context.font = "900 40px system-ui, sans-serif";
      context.textAlign = "center";
      context.lineWidth = 8;
      context.strokeStyle = "rgba(16, 18, 44, 0.9)";
      context.strokeText(effect.text, effect.x, effect.y + 50 * t);
      context.fillStyle = effect.hex;
      context.fillText(effect.text, effect.x, effect.y + 50 * t);
    }
    context.globalAlpha = 1;
  }

  function drawFinish(now) {
    if (!state.finished) return;
    const age = (now - state.finished.start) / 1000;
    context.fillStyle = "rgba(16, 18, 44, " + Math.min(0.78, age) + ")";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    for (let i = 0; i < 90; i++) {
      const x = (i * 211) % WIDTH + Math.sin(age * 2 + i) * 30;
      const y = ((age * (160 + (i % 7) * 40) + i * 97) % (HEIGHT + 100)) - 50;
      context.fillStyle = ["#ffd23f", "#e63946", "#35c6f0", "#2ec46d", "#ff6fb5"][i % 5];
      context.fillRect(x, y, 14, 22);
    }
    const ranking = state.finished.ranking;
    context.textAlign = "center";
    context.fillStyle = "#ffd23f";
    context.font = "900 110px system-ui, sans-serif";
    context.fillText("🏆 " + ranking[0].player.name + " vince!", 960, 330);
    context.font = "700 46px system-ui, sans-serif";
    ranking.forEach((entry, index) => {
      context.fillStyle = entry.player.hex;
      const worth = entry.player.bankrupt ? "bancarotta" : euro(entry.worth);
      context.fillText((index + 1) + ". " + entry.player.name + " — " + worth, 960, 470 + index * 70);
    });
  }

  function frame(now) {
    if (!running) return;
    const seconds = Math.min(0.1, (now - previous) / 1000);
    previous = now;
    const ease = 1 - Math.exp(-seconds * 3.2);
    camera.x += (target.x - camera.x) * ease;
    camera.y += (target.y - camera.y) * ease;
    camera.zoom += (target.zoom - camera.zoom) * ease;
    night += ((state.night ? 1 : 0) - night) * Math.min(1, seconds * 2.5);
    state.effects = state.effects.filter((effect) => now - effect.start < effect.duration);

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = "#74c476";
    context.fillRect(0, 0, canvas.width, canvas.height);
    useGround();
    drawGround(now);
    useScreen();
    if (night > 0.01) {
      context.fillStyle = "rgba(12, 14, 60, " + night * 0.55 + ")";
      context.fillRect(0, 0, WIDTH, HEIGHT);
    }
    drawUpright(now);
    drawChips(seconds);
    drawTray();
    drawBanner(now);
    drawDie(now);
    drawTexts(now);
    drawFinish(now);

    // Frame rate in the console every five seconds: on the TV it ends up in logcat (adb logcat -s chromium).
    frames++;
    if (now - countedSince >= 5000) {
      console.log("Grand Viale: " + Math.round(frames * 1000 / (now - countedSince)) + " fps");
      frames = 0;
      countedSince = now;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    stop() {
      running = false;
      window.removeEventListener("resize", resize);
    },
    focus(point, zoom) {
      target = { x: point.x, y: point.y, zoom };
    },
    overview() {
      target = { ...OVERVIEW };
    },
  };
}
