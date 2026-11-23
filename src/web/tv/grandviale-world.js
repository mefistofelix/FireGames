// Grand Viale: the board, drawn as isometric pixel art on a small canvas (960x540) that the page scales up
// with hard pixels. Every picture comes from src/web/assets/grandviale/pixel, drawn by src/art/pixelart.py
// together with board.json, which says where each picture goes and in which order.
// The board is drawn from two opposite sides ("views"): the camera goes round to the side from which the
// place it looks at is not hidden by the hotels.
// This module only reads the game state each frame; the game moves the camera with focus() and overview().

import { COLORS } from "../shared/config.js";
import { lotDoor, ringDirection, ringPoint } from "./grandviale-path.js";

const BASE = "../assets/grandviale/pixel/";
const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 540;
const VIEW_CENTER_Y = 292;   // a little below the middle: the team panels cover the top of the screen
const BUILD_MS = 1300;       // how long a new piece takes to rise (the game waits as long)
const TURN_MS = 260;         // half of the time the camera takes to go round to the other side
const BOARD_CENTER = { x: 113, y: 85 };
const PERMIT_FACES = ["si", "no", "gratis", "doppio"];
const DIRECTIONS = ["xp", "yp", "xn", "yn"]; // each quarter turn of the board moves a direction to the next one

export function createWorld(canvas, state, hotels) {
  canvas.width = VIEW_WIDTH;
  canvas.height = VIEW_HEIGHT;
  canvas.style.imageRendering = "pixelated";
  const context = canvas.getContext("2d");
  const images = new Map();
  let board = null;   // board.json, once loaded
  let view = null;    // the side the board is seen from: one of board.views
  let turning = null; // {to, start}: the camera is going round to another view
  let running = true;
  let night = 0;
  const camera = { x: 0, y: 0, scale: 1 };
  let target = null;  // {point, scale}: what the camera looks at; null: the whole board

  function image(name) {
    if (!images.has(name)) {
      const picture = new Image();
      picture.src = BASE + name + ".png";
      images.set(name, picture);
    }
    return images.get(name);
  }

  function ready(picture) {
    return picture.complete && picture.naturalWidth > 0;
  }

  function suffix() {
    return "-v" + board.views.indexOf(view);
  }

  // Asks for the pictures of a view before they are needed, so that nothing pops in.
  function preload(which) {
    const tail = "-v" + board.views.indexOf(which);
    image("ground" + tail);
    which.statics.forEach((entry) => entry.f && image(entry.f));
    state.hotels.forEach((status, index) => image("hotel-" + index + "-" + status.stage + tail));
  }

  fetch(BASE + "board.json").then((response) => response.json()).then((data) => {
    if (!running) return;
    board = data;
    view = data.views[0];
    camera.x = view.size[0] / 2;
    camera.y = view.size[1] / 2 - 24;
    data.views.forEach(preload);
    Object.keys(data.sprites).forEach(image);
  });

  // A point of the board as the current view sees it (the board turned by quarter turns).
  function turned(x, y, which) {
    let point = { x, y };
    for (let turn = 0; turn < (which || view).turns; turn++) point = { x: -point.y, y: point.x };
    return point;
  }

  // Board point (z above the road by default) -> pixel of the view's picture.
  function project(x, y, z, which) {
    const seen = which || view;
    const point = turned(x, y, seen);
    const height = z === undefined ? board.ground + 1 : z;
    return { x: (point.x - point.y) * 2 - seen.origin[0], y: point.x + point.y - 2 * height - seen.origin[1] };
  }

  function drawSprite(name, x, y, z) {
    const picture = image(name);
    if (!ready(picture)) return;
    const point = project(x, y, z);
    const offset = board.sprites[name];
    context.drawImage(picture, Math.round(point.x + offset[0]), Math.round(point.y + offset[1]));
  }

  function colourIndex(player) {
    const index = COLORS.findIndex((colour) => colour.hex === player.hex);
    return index >= 0 ? index : state.players.indexOf(player) % COLORS.length;
  }

  // Where a team's car is, and where the guest who got out of it is (null: on board).
  function carPose(player, now) {
    let progress = player.space;
    let hop = 0;
    if (player.move) {
      const t = Math.min(1, (now - player.move.start) / player.move.duration);
      progress = player.move.from + t;
      hop = Math.sin(t * Math.PI) * 1.5;
    }
    const here = ringPoint(progress);
    const pose = { x: here.x, y: here.y, z: board.ground + 1 + hop, direction: ringDirection(progress), person: null };
    const door = player.door; // set by the game while the team visits a hotel
    if (!door) return pose;

    // visiting a hotel: the car pulls over towards the door, the guest walks the rest and goes in
    let visit = player.hidden ? 1 : 0;
    if (player.glide) {
      const t = Math.min(1, (now - player.glide.start) / player.glide.duration);
      visit = player.glide.to === door ? t : 1 - t;
    }
    const parked = Math.min(visit / 0.35, 1);
    pose.x = here.x + Math.sign(door.x - here.x) * Math.min(Math.abs(door.x - here.x), 3) * parked;
    pose.y = here.y + Math.sign(door.y - here.y) * Math.min(Math.abs(door.y - here.y), 3) * parked;
    if (visit > 0.35 && !player.hidden) {
      const walked = (visit - 0.35) / 0.65;
      pose.person = { x: pose.x + (door.x - pose.x) * walked, y: pose.y + (door.y - pose.y) * walked };
    }
    return pose;
  }

  // A thing standing on a point goes in front of what lies behind it along x or along y: it is drawn just
  // before the first picture of the list that hides it.
  function placeInOrder(x, y) {
    const point = turned(x, y);
    const statics = view.statics;
    for (let index = 0; index < statics.length; index++) {
      const [x0, y0, x1, y1] = statics[index].r;
      const inside = point.x >= x0 && point.y >= y0 && point.x < x1 && point.y < y1;
      if (!inside && point.x < x1 && point.y < y1) return index;
    }
    return statics.length;
  }

  function outline(x0, y0, x1, y1) {
    const corners = [project(x0, y0), project(x1, y0), project(x1, y1), project(x0, y1)];
    context.beginPath();
    corners.forEach((corner, index) => (index ? context.lineTo(corner.x + 2, corner.y + 1) : context.moveTo(corner.x + 2, corner.y + 1)));
    context.closePath();
  }

  function drawOutline(x0, y0, x1, y1, colour, width) {
    outline(x0, y0, x1, y1);
    context.strokeStyle = colour;
    context.lineWidth = width;
    context.stroke();
  }

  function drawHotel(index, entry, now) {
    const status = state.hotels[index];
    const rising = status.stage > 0 && now - status.builtAt < BUILD_MS;
    const plain = image("hotel-" + index + "-" + status.stage + suffix());
    const before = rising ? image("hotel-" + index + "-" + (status.stage - 1) + "-crane" + suffix()) : null;
    const after = rising ? image("hotel-" + index + "-" + status.stage + "-crane" + suffix()) : null;
    if (rising && ready(before) && ready(after)) {
      // a crane stands on the lot and the new piece comes up from the ground
      context.drawImage(before, entry.x, entry.y);
      const grown = Math.ceil(after.naturalHeight * (now - status.builtAt) / BUILD_MS);
      const from = after.naturalHeight - grown;
      context.drawImage(after, 0, from, after.naturalWidth, grown, entry.x, entry.y + from, after.naturalWidth, grown);
    } else if (ready(plain)) {
      context.drawImage(plain, entry.x, entry.y);
    }
    for (const space of status.entrances) {
      const door = lotDoor(hotels[index].lot, space);
      const along = view.turns % 2 ? (door.along === "x" ? "y" : "x") : door.along;
      drawSprite("entrance-" + along, door.x, door.y, 0);
    }
  }

  // Small surprises that never get in the way: the shadows of the clouds, birds, now and then a plane.
  function drawLife(now) {
    const width = view.size[0];
    const height = view.size[1];
    context.fillStyle = "rgba(20, 30, 60, 0.10)";
    for (let cloud = 0; cloud < 3; cloud++) {
      const x = ((now / (95 + cloud * 30) + cloud * 420) % (width + 400)) - 200;
      const y = 90 + cloud * 130 + Math.sin(now / 9000 + cloud) * 20;
      context.beginPath();
      context.ellipse(x, y, 90 + cloud * 20, 34 + cloud * 6, 0, 0, Math.PI * 2);
      context.fill();
    }
    for (let bird = 0; bird < 5; bird++) {
      const lap = now / 28 + bird * 37;
      const x = (lap % (width + 300)) - 150 + (bird % 3) * 9;
      const y = 60 + ((Math.floor(lap / (width + 300)) * 97 + bird * 13) % (height - 160)) + Math.sin(now / 700 + bird) * 6 - x * 0.12;
      const wing = Math.sin(now / 110 + bird) > 0 ? 1 : 0;
      context.fillStyle = "#2b2d42";
      context.fillRect(Math.round(x), Math.round(y), 2, 1);
      context.fillRect(Math.round(x) - 2, Math.round(y) - wing, 2, 1);
      context.fillRect(Math.round(x) + 2, Math.round(y) - wing, 2, 1);
    }
    const flight = (now % 70000) / 9000; // a plane crosses the board every 70 seconds
    if (flight < 1) {
      const x = -60 + flight * (width + 120);
      const y = height * 0.75 - flight * height * 0.6;
      context.fillStyle = "rgba(20, 30, 60, 0.18)";
      context.fillRect(Math.round(x) - 8, Math.round(y) + 70, 22, 5);
      context.fillStyle = "#f8f9fa";
      context.fillRect(Math.round(x) - 8, Math.round(y), 22, 4);
      context.fillRect(Math.round(x), Math.round(y) - 7, 6, 18);
      context.fillRect(Math.round(x) - 9, Math.round(y) - 4, 3, 5);
      context.fillStyle = "#e63946";
      context.fillRect(Math.round(x) + 12, Math.round(y), 2, 4);
    }
  }

  function drawScene(now) {
    const ground = image("ground" + suffix());
    if (ready(ground)) context.drawImage(ground, 0, 0);

    // what the teams own: the edge of their lots and the spaces with their entrances, in their colour
    state.hotels.forEach((status, index) => {
      if (!status.owner) return;
      const lot = hotels[index].lot;
      drawOutline(lot.x - 1, lot.y - 1, lot.x + lot.width + 1, lot.y + lot.height + 1, status.owner.hex, 3);
      for (const space of status.entrances) {
        const point = ringPoint(space);
        drawOutline(point.x - 6, point.y - 6, point.x + 6, point.y + 6, status.owner.hex, 2);
      }
    });

    // cars and guests take their place among the pictures of the board
    const moving = [];
    const cars = [];
    state.players.forEach((player) => {
      if (player.bankrupt) return;
      const pose = carPose(player, now);
      const colour = colourIndex(player);
      const direction = DIRECTIONS[(DIRECTIONS.indexOf(pose.direction) + view.turns) % 4];
      cars.push({ player, pose });
      moving.push({ at: placeInOrder(pose.x, pose.y), depth: pose.x + pose.y, name: "car-" + colour + "-" + direction, x: pose.x, y: pose.y, z: pose.z });
      if (!pose.person) return;
      const person = pose.person;
      const onLot = hotels.some((hotel) => person.x >= hotel.lot.x && person.x < hotel.lot.x + hotel.lot.width &&
        person.y >= hotel.lot.y && person.y < hotel.lot.y + hotel.lot.height);
      const step = Math.abs(Math.sin(now / 90)) * 0.6;
      moving.push({ at: placeInOrder(person.x, person.y), depth: person.x + person.y + 0.5, name: "person-" + colour, x: person.x, y: person.y, z: (onLot ? 0 : board.ground + 1) + step });
    });
    moving.sort((a, b) => a.at - b.at || a.depth - b.depth);

    const current = cars.find((car) => car.player === state.players[state.current]);
    if (current && !state.finished) {
      const centre = project(current.pose.x, current.pose.y);
      context.beginPath();
      context.ellipse(centre.x + 2, centre.y + 1, 15 + Math.sin(now / 250) * 2, 7.5 + Math.sin(now / 250), 0, 0, Math.PI * 2);
      context.strokeStyle = "#ffffff";
      context.lineWidth = 2;
      context.stroke();
    }

    let next = 0;
    view.statics.forEach((entry, index) => {
      while (next < moving.length && moving[next].at <= index) {
        const thing = moving[next++];
        drawSprite(thing.name, thing.x, thing.y, thing.z);
      }
      if (entry.hotel !== undefined) drawHotel(entry.hotel, entry, now);
      else if (ready(image(entry.f))) context.drawImage(image(entry.f), entry.x, entry.y);
    });
    while (next < moving.length) {
      const thing = moving[next++];
      drawSprite(thing.name, thing.x, thing.y, thing.z);
    }

    // the lots the waiting question is about glow, so that everybody sees what is being chosen
    const pulse = 0.5 + Math.sin(now / 220) * 0.5;
    for (const index of state.highlight || []) {
      const lot = hotels[index].lot;
      outline(lot.x, lot.y, lot.x + lot.width, lot.y + lot.height);
      context.fillStyle = "rgba(255, 255, 255, " + (0.1 + pulse * 0.22) + ")";
      context.fill();
      context.strokeStyle = "rgba(255, 240, 150, " + (0.6 + pulse * 0.4) + ")";
      context.lineWidth = 3;
      context.stroke();
    }

    drawLife(now);

    // a pointer in the team's colour over each car: it is seen even when something hides the car
    for (const car of cars) {
      const top = project(car.pose.x, car.pose.y, car.pose.z + 9);
      const bob = Math.round(Math.sin(now / 300 + car.pose.x) * 1.5);
      context.fillStyle = "#16162c";
      context.fillRect(top.x - 3, top.y - 9 + bob, 10, 6);
      context.fillRect(top.x - 1, top.y - 3 + bob, 6, 2);
      context.fillRect(top.x + 1, top.y - 1 + bob, 2, 2);
      context.fillStyle = car.player.hex;
      context.fillRect(top.x - 2, top.y - 8 + bob, 8, 4);
      context.fillRect(top.x, top.y - 4 + bob, 4, 2);
    }
  }

  function drawNight() {
    if (night < 0.01) return;
    context.fillStyle = "rgba(10, 14, 52, " + (night * 0.58) + ")";
    context.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    context.globalCompositeOperation = "lighter";
    for (const [x, y] of view.lamps) {
      const centre = toView(x, y);
      const radius = 26 * camera.scale;
      const glow = context.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, radius);
      glow.addColorStop(0, "rgba(255, 214, 120, " + (night * 0.55) + ")");
      glow.addColorStop(1, "rgba(255, 214, 120, 0)");
      context.fillStyle = glow;
      context.fillRect(centre.x - radius, centre.y - radius, radius * 2, radius * 2);
    }
    context.globalCompositeOperation = "source-over";
  }

  // The game decides the result; while the die flies it shows faces at random, then stops on that one.
  function drawDie(now) {
    const die = state.die;
    if (!die.visible) return;
    const t = Math.min(1, (now - die.startedAt) / 1200);
    const x = 860 - 360 * (1 - (1 - t) * (1 - t));
    const height = Math.abs(Math.sin(t * Math.PI * 3.5)) * 110 * (1 - t);
    let face = die.face;
    if (die.rolling && t < 0.92) {
      const faces = die.kind === "number" ? [1, 2, 3, 4, 5, 6] : PERMIT_FACES;
      face = faces[Math.floor(now / 90) % faces.length];
    }
    const picture = image("die-" + face);
    if (!ready(picture)) return;
    const size = 2;
    context.fillStyle = "rgba(10, 12, 30, 0.35)";
    context.beginPath();
    context.ellipse(x, 372, 44 - height * 0.12, 18 - height * 0.05, 0, 0, Math.PI * 2);
    context.fill();
    context.drawImage(picture, Math.round(x - picture.naturalWidth * size / 2), Math.round(318 - height - picture.naturalHeight * size / 2),
      picture.naturalWidth * size, picture.naturalHeight * size);
  }

  // Pixel of the view's picture -> pixel of the canvas.
  function toView(x, y) {
    return {
      x: Math.round(VIEW_WIDTH / 2 - camera.x * camera.scale) + x * camera.scale,
      y: Math.round(VIEW_CENTER_Y - camera.y * camera.scale) + y * camera.scale,
    };
  }

  // From which side a point is best seen: from the side where it lies in the far half of the board,
  // with the hotels behind it. A point seen well enough from the current side does not make the camera turn.
  function bestView(point) {
    const side = (which) => {
      const seen = turned(point.x - BOARD_CENTER.x, point.y - BOARD_CENTER.y, which);
      return seen.x / BOARD_CENTER.x + seen.y / BOARD_CENTER.y; // negative: far half
    };
    if (side(view) < 0.2) return view;
    return board.views.reduce((best, which) => (side(which) < side(best) ? which : best), view);
  }

  function goalFor(which) {
    if (!target) return { x: which.size[0] / 2, y: which.size[1] / 2 - 24, scale: 1 };
    const centre = project(target.point.x, target.point.y, undefined, which);
    return { x: centre.x, y: centre.y - 14, scale: target.scale };
  }

  function draw(now, seconds) {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.imageSmoothingEnabled = false;
    // the table the board lies on
    context.fillStyle = "#5a3d2b";
    context.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    context.fillStyle = "#4f3526";
    for (let y = 0; y < VIEW_HEIGHT; y += 36) context.fillRect(0, y, VIEW_WIDTH, 2);
    if (!board) return;

    // going round to the other side: the picture fades out, the view changes, the picture fades in
    if (!turning && target) {
      const wanted = bestView(target.point);
      if (wanted !== view) {
        turning = { to: wanted, start: now };
        preload(wanted);
      }
    }
    let veil = 0;
    if (turning) {
      const t = (now - turning.start) / TURN_MS;
      if (t >= 1 && view !== turning.to) {
        view = turning.to;
        Object.assign(camera, goalFor(view));
      }
      veil = t < 1 ? t : 2 - t;
      if (t >= 2) turning = null;
    }

    // the camera moves at an unhurried pace towards where the game points it
    const goal = goalFor(view);
    const ease = 1 - Math.exp(-seconds * 2.6);
    camera.x += (goal.x - camera.x) * ease;
    camera.y += (goal.y - camera.y) * ease;
    camera.scale += (goal.scale - camera.scale) * ease;
    if (Math.abs(goal.scale - camera.scale) < 0.01) camera.scale = goal.scale;
    night += ((state.night ? 1 : 0) - night) * Math.min(1, seconds * 2.2);

    const corner = toView(0, 0);
    context.setTransform(camera.scale, 0, 0, camera.scale, corner.x, corner.y);
    drawScene(now);
    context.setTransform(1, 0, 0, 1, 0, 0);
    drawNight();
    if (veil > 0) {
      context.fillStyle = "rgba(90, 61, 43, " + Math.max(0, Math.min(1, veil)) + ")";
      context.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    }
    drawDie(now);
  }

  // Names over the lots, for the panels to write (in their 1920x1080 space): the letters would be
  // unreadable at the size of the board's pixels.
  function labels() {
    if (!board || turning) return [];
    const unit = 1920 / VIEW_WIDTH;
    const list = [];
    state.hotels.forEach((status, index) => {
      const entry = view.hotels[index];
      const picture = image("hotel-" + index + "-" + status.stage + suffix());
      if (!ready(picture)) return;
      const place = toView(entry.x + picture.naturalWidth / 2, entry.y + entry.tops[status.stage] - 5);
      list.push({ text: hotels[index].name, hex: status.owner ? status.owner.hex : null, price: status.owner ? null : hotels[index].land, x: place.x * unit, y: place.y * unit });
    });
    return list;
  }

  return {
    draw,
    labels,
    stop() {
      running = false;
    },
    // Camera: look at a point of the board from closer, or at the whole board.
    focus(point, zoom) {
      target = { point, scale: zoom >= 2 ? 3 : 2 };
    },
    overview() {
      target = null;
    },
  };
}
