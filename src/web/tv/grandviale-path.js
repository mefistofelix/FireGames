// Grand Viale: the shape of the avenue, shared by the board and the game rules.
// Board units are the voxels of the pictures (see src/art/pixelart.py, which draws the same avenue with the
// same formula: change them together): x grows to the lower right of the screen, y to the lower left.

export const SPACE_COUNT = 32;

// The avenue is a closed curve: an oval that swells and narrows a little. Space 0 (the Banca) is at the far
// left of the picture and the spaces follow each other at equal distances along the curve.
const CENTER = [149, 121];
const RADIUS = [92, 64];
const CURVE_START = Math.PI * 1.25;
const CURVE_SAMPLES = 1440;
const REACH = 16; // a lot is next to the spaces whose centre is within this distance of it

function curve(turn) {
  const angle = CURVE_START + turn * Math.PI * 2;
  const rx = RADIUS[0] + 3 * Math.cos(3 * angle + 0.6);
  const ry = RADIUS[1] + 3 * Math.sin(2 * angle + 0.3);
  return { x: CENTER[0] + rx * Math.cos(angle), y: CENTER[1] + ry * Math.sin(angle) };
}

const samples = [];
for (let index = 0; index < CURVE_SAMPLES; index++) samples.push(curve(index / CURVE_SAMPLES));
const walked = [0];
samples.forEach((sample, index) => {
  const next = samples[(index + 1) % CURVE_SAMPLES];
  walked.push(walked[index] + Math.hypot(next.x - sample.x, next.y - sample.y));
});
const LENGTH = walked[CURVE_SAMPLES];

// The stretch of the curve a position falls on; progress is a space index and may be fractional.
function stretchAt(progress) {
  const distance = (((progress % SPACE_COUNT) + SPACE_COUNT) % SPACE_COUNT) * LENGTH / SPACE_COUNT;
  let low = 0;
  let high = CURVE_SAMPLES;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (walked[middle] <= distance) low = middle;
    else high = middle;
  }
  const from = samples[low];
  const to = samples[(low + 1) % CURVE_SAMPLES];
  return { from, to, t: (distance - walked[low]) / Math.max(walked[low + 1] - walked[low], 1e-9) };
}

// Point of a position along the avenue.
export function ringPoint(progress) {
  const { from, to, t } = stretchAt(progress);
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

// Which way a car at that position is going: an angle on the board, 0 along x, a quarter turn along y.
export function ringHeading(progress) {
  const { from, to } = stretchAt(progress);
  return Math.atan2(to.y - from.y, to.x - from.x);
}

function distanceToLot(point, lot) {
  const dx = Math.max(lot.x - point.x, 0, point.x - lot.x - lot.width);
  const dy = Math.max(lot.y - point.y, 0, point.y - lot.y - lot.height);
  return Math.hypot(dx, dy);
}

// Indexes of the spaces a lot ({x, y, width, height}) is next to: there it can be bought and there its
// entrances go. Two lots facing each other across the avenue are next to the same spaces.
export function borderingSpaces(lot) {
  const spaces = [];
  for (let index = 0; index < SPACE_COUNT; index++) {
    if (distanceToLot(ringPoint(index), lot) <= REACH) spaces.push(index);
  }
  return spaces;
}

// Where the door of a lot is for somebody arriving from a space of the avenue: on the edge of the lot, as
// near to that space as possible. along is "x" when that edge runs along x.
export function lotDoor(lot, space) {
  const from = ringPoint(space);
  const inset = 4;
  const x = Math.max(lot.x + inset, Math.min(lot.x + lot.width - inset, from.x));
  const y = Math.max(lot.y + inset, Math.min(lot.y + lot.height - inset, from.y));
  const outsideAlongY = from.y < lot.y || from.y > lot.y + lot.height;
  return { x, y, along: outsideAlongY ? "x" : "y" };
}
