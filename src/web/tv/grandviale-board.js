// Grand Viale board. The world is a ground plane (x right, y towards the viewer, 1920x1080 units) seen from
// above at an angle, plus a height axis: flat things (grass, road, lots) are drawn through one canvas transform,
// upright things (buildings, trees, cars) at projected points, sorted back to front. A camera with a target
// position and zoom follows the events; the game moves it with focus() and overview().

import { euro } from "../shared/config.js";
import { drawCar, roundedRect } from "./scene.js";

const WIDTH = 1920;
const HEIGHT = 1080;
const GROUND_SQUASH = 0.72; // how much the ground is flattened by the viewing angle
const SCREEN_CENTER = { x: 960, y: 590 };
const OVERVIEW = { x: 960, y: 600, zoom: 1 };
const RING = { left: 420, right: 1500, top: 380, bottom: 840, radius: 150 };
const SPACE_COUNT = 28;

const TILES = {
  bank: { color: "#ffd23f", icon: "🏦" },
  buy: { color: "#2ec46d", icon: "💰" },
  build: { color: "#f77f00", icon: "🏗️" },
  free: { color: "#35c6f0", icon: "🚪" },
  bonus: { color: "#ff6fb5", icon: "🎁" },
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

const TREES = [
  [150, 200, 70], [300, 300, 55], [420, 170, 60], [110, 380, 50], [1500, 160, 60], [1700, 210, 75], [1830, 340, 55],
  [120, 880, 65], [300, 990, 70], [440, 920, 50], [1480, 960, 55], [960, 250, 45], [960, 990, 45],
];
const POND = { x: 1730, y: 930, radius: 120 };
const BUILDING_HEIGHTS = [0.62, 0.82, 1, 0.9];

// The ring, clockwise on screen from the middle of the bottom side: pieces with a length and a point function.
const RADIUS = RING.radius;
const HALF_STRAIGHT = (RING.right - RING.left) / 2 - RADIUS;
const SIDE = RING.bottom - RING.top - 2 * RADIUS;
const ARC = Math.PI * RADIUS / 2;
const MIDDLE_X = (RING.left + RING.right) / 2;

function arcPoint(centerX, centerY, angle) {
  return { x: centerX + RADIUS * Math.cos(angle), y: centerY + RADIUS * Math.sin(angle) };
}

const PIECES = [
  { length: HALF_STRAIGHT, at: (offset) => ({ x: MIDDLE_X - offset, y: RING.bottom }) },
  { length: ARC, at: (offset) => arcPoint(RING.left + RADIUS, RING.bottom - RADIUS, Math.PI / 2 + offset / RADIUS) },
  { length: SIDE, at: (offset) => ({ x: RING.left, y: RING.bottom - RADIUS - offset }) },
  { length: ARC, at: (offset) => arcPoint(RING.left + RADIUS, RING.top + RADIUS, Math.PI + offset / RADIUS) },
  { length: 2 * HALF_STRAIGHT, at: (offset) => ({ x: RING.left + RADIUS + offset, y: RING.top }) },
  { length: ARC, at: (offset) => arcPoint(RING.right - RADIUS, RING.top + RADIUS, 1.5 * Math.PI + offset / RADIUS) },
  { length: SIDE, at: (offset) => ({ x: RING.right, y: RING.top + RADIUS + offset }) },
  { length: ARC, at: (offset) => arcPoint(RING.right - RADIUS, RING.bottom - RADIUS, offset / RADIUS) },
  { length: HALF_STRAIGHT, at: (offset) => ({ x: RING.right - RADIUS - offset, y: RING.bottom }) },
];
const PERIMETER = PIECES.reduce((sum, piece) => sum + piece.length, 0);

// World point of a position along the ring; progress is a space index and may be fractional.
function ringPoint(progress) {
  let distance = (((progress % SPACE_COUNT) + SPACE_COUNT) % SPACE_COUNT) * PERIMETER / SPACE_COUNT;
  for (const piece of PIECES) {
    if (distance <= piece.length) return piece.at(distance);
    distance -= piece.length;
  }
  return PIECES[0].at(0);
}

export function spacePoint(index) {
  return ringPoint(index);
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

export function createBoard(canvas, state, hotels, spaces) {
  const context = canvas.getContext("2d");
  const camera = { ...OVERVIEW };
  let target = { ...OVERVIEW };
  let running = true;
  let previous = performance.now();
  let night = 0;
  let unit = 1; // canvas pixels per screen unit
  let bottomGap = 0;

  function resize() {
    canvas.width = Math.min(window.innerWidth * (window.devicePixelRatio || 1), WIDTH);
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
      };
    }
    if (player.move) {
      const t = Math.min(1, (now - player.move.start) / player.move.duration);
      const point = ringPoint(player.move.from + t);
      return { x: point.x, y: point.y, hop: Math.sin(Math.PI * t) * 34 };
    }
    const point = ringPoint(player.space);
    return { x: point.x, y: point.y, hop: 0 };
  }

  function drawGround(now) {
    const time = now / 1000;
    context.fillStyle = "#6fbf73";
    context.fillRect(-3000, -3000, 8000, 8000);
    context.fillStyle = "rgba(255, 255, 255, 0.06)";
    for (let stripe = -3000; stripe < 5000; stripe += 160) context.fillRect(stripe, -3000, 80, 8000);

    context.fillStyle = "rgba(20, 40, 30, 0.10)";
    for (let i = 0; i < 4; i++) {
      const x = ((time * (14 + i * 5) + i * 700) % 3200) - 600;
      context.beginPath();
      context.ellipse(x, 250 + i * 230, 260, 110, 0, 0, Math.PI * 2);
      context.fill();
    }

    context.fillStyle = "#4f9fd1";
    context.beginPath();
    context.arc(POND.x, POND.y, POND.radius, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "rgba(255, 255, 255, 0.6)";
    context.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const growth = (time * 0.3 + i / 3) % 1;
      context.globalAlpha = 1 - growth;
      context.beginPath();
      context.arc(POND.x - 30 + i * 30, POND.y, 10 + growth * 70, 0, Math.PI * 2);
      context.stroke();
    }
    context.globalAlpha = 1;

    hotels.forEach((hotel, index) => {
      const lot = hotel.lot;
      const owner = state.hotels[index].owner;
      context.fillStyle = owner ? shade(owner.hex, 1.75) : "#e9dcc0";
      roundedRect(context, lot.x, lot.y, lot.width, lot.height, 22);
      context.lineWidth = owner ? 10 : 4;
      context.strokeStyle = owner ? owner.hex : "rgba(90, 70, 40, 0.5)";
      context.setLineDash(owner ? [] : [16, 12]);
      context.stroke();
      context.setLineDash([]);
    });

    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(RING.left + RADIUS, RING.top);
    context.arcTo(RING.right, RING.top, RING.right, RING.bottom, RADIUS);
    context.arcTo(RING.right, RING.bottom, RING.left, RING.bottom, RADIUS);
    context.arcTo(RING.left, RING.bottom, RING.left, RING.top, RADIUS);
    context.arcTo(RING.left, RING.top, RING.right, RING.top, RADIUS);
    context.closePath();
    context.strokeStyle = "#f1e9da";
    context.lineWidth = 112;
    context.stroke();
    context.strokeStyle = "#3b3f58";
    context.lineWidth = 100;
    context.stroke();

    const activeSpace = state.players[state.current].space;
    for (let index = 0; index < SPACE_COUNT; index++) {
      const point = ringPoint(index);
      const tile = TILES[spaces[index]];
      if (index === activeSpace && !state.finished) {
        context.fillStyle = "rgba(255, 255, 255, " + (0.25 + 0.2 * Math.sin(time * 5)) + ")";
        context.beginPath();
        context.arc(point.x, point.y, 56, 0, Math.PI * 2);
        context.fill();
      }
      context.fillStyle = tile.color;
      context.beginPath();
      context.arc(point.x, point.y, 43, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#fffaf0";
      context.beginPath();
      context.arc(point.x, point.y, 34, 0, Math.PI * 2);
      context.fill();
    }
  }

  function drawTree(tree) {
    const [x, y, size] = tree;
    const base = project(x, y, 0);
    const zoom = camera.zoom;
    context.fillStyle = "rgba(0, 0, 0, 0.18)";
    context.beginPath();
    context.ellipse(base.x + size * 0.3 * zoom, base.y, size * 0.7 * zoom, size * 0.22 * zoom, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#5a3d2b";
    context.fillRect(base.x - 7 * zoom, base.y - size * zoom, 14 * zoom, size * zoom);
    context.fillStyle = "#1f7a55";
    context.beginPath();
    context.arc(base.x, base.y - size * 1.25 * zoom, size * 0.62 * zoom, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#2f9b6c";
    context.beginPath();
    context.arc(base.x - size * 0.18 * zoom, base.y - size * 1.4 * zoom, size * 0.38 * zoom, 0, Math.PI * 2);
    context.fill();
  }

  // One building: a box seen from the front and above (front wall, roof, a darker strip for the side).
  function drawBuilding(hotel, lot, slot, grow, now) {
    const zoom = camera.zoom;
    const slotWidth = (lot.width - 40) / 4;
    const width = (slotWidth - 12) * zoom;
    const depth = 50 * GROUND_SQUASH * zoom;
    const fullHeight = (lot.height > 200 ? 170 : 105) * BUILDING_HEIGHTS[slot];
    const height = fullHeight * grow * zoom;
    const base = project(lot.x + 26 + slot * slotWidth, lot.y + lot.height * 0.62, 0);

    context.fillStyle = "rgba(0, 0, 0, 0.22)";
    context.fillRect(base.x + 10 * zoom, base.y - 4 * zoom, width, 14 * zoom);
    context.fillStyle = shade(hotel.accent, 0.82);
    context.fillRect(base.x, base.y - height, width, height);
    context.fillStyle = shade(hotel.accent, 0.62);
    context.fillRect(base.x + width * 0.86, base.y - height, width * 0.14, height);
    context.fillStyle = shade(hotel.accent, 1.35);
    context.fillRect(base.x, base.y - height - depth, width, depth);
    context.fillStyle = shade(hotel.accent, 0.5);
    context.fillRect(base.x, base.y - height - 3 * zoom, width, 3 * zoom);

    const rows = Math.floor((height - 26 * zoom) / (24 * zoom));
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < 3; column++) {
        const lit = Math.sin(now / 900 + row * 3.1 + column * 1.7 + slot * 5) > -0.2 || night > 0.3;
        context.fillStyle = lit ? "#fff3b0" : "#31456b";
        context.fillRect(base.x + (8 + column * 17) * zoom, base.y - height + (10 + row * 24) * zoom, 11 * zoom, 14 * zoom);
      }
    }
    context.fillStyle = "#3a2a1e";
    context.fillRect(base.x + width * 0.36, base.y - 20 * zoom, width * 0.24, 20 * zoom);
  }

  function drawHotel(index, now) {
    const hotel = hotels[index];
    const status = state.hotels[index];
    for (let slot = 0; slot < status.stage; slot++) {
      const newest = slot === status.stage - 1;
      const t = newest ? Math.min(1, (now - status.builtAt) / 900) : 1;
      drawBuilding(hotel, hotel.lot, slot, Math.max(0.02, easeOutBack(t)), now);
    }
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
    const point = project(lot.x + lot.width / 2, lot.y + lot.height - 16, 0);
    const size = 23 * Math.min(1.5, Math.max(1, camera.zoom));
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
    for (const tree of TREES) items.push({ y: tree[1], draw: () => drawTree(tree) });
    hotels.forEach((hotel, index) => {
      items.push({ y: hotel.lot.y + hotel.lot.height * 0.62, draw: () => drawHotel(index, now) });
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
          const direction = point.y > 610 ? -1 : 1;
          if (index === state.current && !state.finished) {
            context.strokeStyle = player.hex;
            context.lineWidth = 5 * camera.zoom;
            context.beginPath();
            context.ellipse(screen.x, screen.y + point.hop * camera.zoom, (52 + 5 * Math.sin(now / 160)) * camera.zoom,
              16 * camera.zoom, 0, 0, Math.PI * 2);
            context.stroke();
          }
          drawCar(context, screen.x, screen.y, 0.52 * camera.zoom, player.hex, 0, direction);
        },
      });
    });
    // the icons of the spaces lie on the ground: before anything that stands on it
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = 34 * camera.zoom + "px system-ui, sans-serif";
    for (let index = 0; index < SPACE_COUNT; index++) {
      const point = project(ringPoint(index).x, ringPoint(index).y, 0);
      context.fillText(TILES[spaces[index]].icon, point.x, point.y + 2);
    }
    context.textBaseline = "alphabetic";
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
    context.fillStyle = "#6fbf73";
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
    drawBanner(now);
    drawDie(now);
    drawTexts(now);
    drawFinish(now);
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
