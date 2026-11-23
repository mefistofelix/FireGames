// Grand Viale: the board, drawn as isometric pixel art on a small canvas (960x540) that the page scales up
// with hard pixels. Every picture comes from src/web/assets/grandviale/pixel, drawn by src/art/pixelart.py
// together with board.json, which says where each picture goes and in which order.
// This module only reads the game state each frame; the game moves the camera with focus() and overview().

import { COLORS } from "../shared/config.js";
import { lotDoor, ringDirection, ringPoint } from "./grandviale-path.js";

const BASE = "../assets/grandviale/pixel/";
const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 540;
const VIEW_CENTER_Y = 292;   // a little below the middle: the team chips cover the top of the screen
const BUILD_MS = 1300;       // how long a new piece takes to rise (the game waits as long)
const PERMIT_FACES = ["si", "no", "gratis", "doppio"];

export function createWorld(canvas, state, hotels) {
  canvas.width = VIEW_WIDTH;
  canvas.height = VIEW_HEIGHT;
  canvas.style.imageRendering = "pixelated";
  const context = canvas.getContext("2d");
  const images = new Map();
  let board = null; // board.json, once loaded
  let running = true;
  let night = 0;
  const camera = { x: 0, y: 0, scale: 1 };
  let target = null; // {point, scale}: what the camera looks at; null: the whole board

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

  fetch(BASE + "board.json").then((response) => response.json()).then((data) => {
    if (!running) return;
    board = data;
    camera.x = data.size[0] / 2;
    camera.y = data.size[1] / 2 - 24;
    // everything is asked for at once, so that nothing pops in during the game
    image("ground");
    data.statics.forEach((entry) => entry.f && image(entry.f));
    data.hotels.forEach((hotel, index) => {
      for (let stage = 0; stage <= hotel.pieces; stage++) {
        image("hotel-" + index + "-" + stage);
        image("hotel-" + index + "-" + stage + "-crane");
      }
    });
    Object.keys(data.sprites).forEach(image);
  });

  // Board point (z above the road by default) -> pixel of the board picture.
  function project(x, y, z) {
    const height = z === undefined ? board.ground + 1 : z;
    return { x: (x - y) * 2 - board.origin[0], y: x + y - 2 * height - board.origin[1] };
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
    const statics = board.statics;
    for (let index = 0; index < statics.length; index++) {
      const [x0, y0, x1, y1] = statics[index].r;
      const inside = x >= x0 && y >= y0 && x < x1 && y < y1;
      if (!inside && x < x1 && y < y1) return index;
    }
    return statics.length;
  }

  function drawOutline(x0, y0, x1, y1, colour, width) {
    const corners = [project(x0, y0), project(x1, y0), project(x1, y1), project(x0, y1)];
    context.beginPath();
    corners.forEach((corner, index) => (index ? context.lineTo(corner.x + 2, corner.y + 1) : context.moveTo(corner.x + 2, corner.y + 1)));
    context.closePath();
    context.strokeStyle = colour;
    context.lineWidth = width;
    context.stroke();
  }

  function drawHotel(index, entry, now) {
    const status = state.hotels[index];
    const rising = status.stage > 0 && now - status.builtAt < BUILD_MS;
    if (!rising) {
      const picture = image("hotel-" + index + "-" + status.stage);
      if (ready(picture)) context.drawImage(picture, entry.x, entry.y);
    } else {
      // a crane stands on the lot and the new piece comes up from the ground
      const before = image("hotel-" + index + "-" + (status.stage - 1) + "-crane");
      const after = image("hotel-" + index + "-" + status.stage + "-crane");
      if (ready(before)) context.drawImage(before, entry.x, entry.y);
      if (ready(after)) {
        const grown = Math.ceil(after.naturalHeight * (now - status.builtAt) / BUILD_MS);
        const from = after.naturalHeight - grown;
        context.drawImage(after, 0, from, after.naturalWidth, grown, entry.x, entry.y + from, after.naturalWidth, grown);
      }
    }
    for (const space of status.entrances) {
      const door = lotDoor(hotels[index].lot, space);
      drawSprite("entrance-" + door.along, door.x, door.y, 0);
    }
  }

  function drawScene(now) {
    const ground = image("ground");
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
      cars.push({ player, pose });
      moving.push({ at: placeInOrder(pose.x, pose.y), depth: pose.x + pose.y, name: "car-" + colour + "-" + pose.direction, x: pose.x, y: pose.y, z: pose.z });
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
    board.statics.forEach((entry, index) => {
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

    // a pointer in the team's colour over each car: it is seen even when a building hides the car
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
    for (const [x, y] of board.lamps) {
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

  // Pixel of the board picture -> pixel of the canvas.
  function toView(x, y) {
    return {
      x: Math.round(VIEW_WIDTH / 2 - camera.x * camera.scale) + x * camera.scale,
      y: Math.round(VIEW_CENTER_Y - camera.y * camera.scale) + y * camera.scale,
    };
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

    // the camera moves at an unhurried pace towards where the game points it
    let goal = { x: board.size[0] / 2, y: board.size[1] / 2 - 24, scale: 1 };
    if (target) {
      const centre = project(target.point.x, target.point.y);
      goal = { x: centre.x, y: centre.y - 14, scale: target.scale };
    }
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
    drawDie(now);
  }

  // Names over the lots and the cars, for the panels to write (in their 1920x1080 space): the letters
  // would be unreadable at the size of the board's pixels.
  function labels() {
    if (!board) return [];
    const unit = 1920 / VIEW_WIDTH;
    const list = [];
    state.hotels.forEach((status, index) => {
      const entry = board.hotels[index];
      const picture = image("hotel-" + index + "-" + status.stage);
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
