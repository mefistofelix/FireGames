// Grand Viale: the shape of the avenue, shared by the board and the game rules.
// Board units are the voxels of the pictures (see src/art/pixelart.py, which draws the same avenue):
// x grows to the lower right of the screen, y to the lower left.

export const SPACE_COUNT = 28;

// The avenue is a closed line through these corners; space 0 (the Banca) is on the first one and the
// spaces follow each other every STEP units.
const CORNERS = [[50, 50], [176, 50], [176, 120], [50, 120]];
const STEP = 14;

const SEGMENTS = CORNERS.map((from, index) => {
  const to = CORNERS[(index + 1) % CORNERS.length];
  return { from, to, length: Math.abs(to[0] - from[0]) + Math.abs(to[1] - from[1]) };
});

function segmentAt(progress) {
  let distance = (((progress % SPACE_COUNT) + SPACE_COUNT) % SPACE_COUNT) * STEP;
  for (const segment of SEGMENTS) {
    if (distance < segment.length) return { segment, t: distance / segment.length };
    distance -= segment.length;
  }
  return { segment: SEGMENTS[0], t: 0 };
}

// Point of a position along the avenue; progress is a space index and may be fractional.
export function ringPoint(progress) {
  const { segment, t } = segmentAt(progress);
  return {
    x: segment.from[0] + (segment.to[0] - segment.from[0]) * t,
    y: segment.from[1] + (segment.to[1] - segment.from[1]) * t,
  };
}

// Which way a car at that position is going: "xp", "xn", "yp" or "yn" (along x or y, forwards or backwards).
export function ringDirection(progress) {
  const { segment } = segmentAt(progress);
  if (segment.to[0] !== segment.from[0]) return segment.to[0] > segment.from[0] ? "xp" : "xn";
  return segment.to[1] > segment.from[1] ? "yp" : "yn";
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

// Where the door of a lot ({x, y, width, height}) is for somebody arriving from a space of the avenue:
// on the edge of the lot, as near to that space as possible. along is "x" when that edge runs along x.
export function lotDoor(lot, space) {
  const from = ringPoint(space);
  const inset = 4;
  const x = Math.max(lot.x + inset, Math.min(lot.x + lot.width - inset, from.x));
  const y = Math.max(lot.y + inset, Math.min(lot.y + lot.height - inset, from.y));
  const outsideAlongY = from.y < lot.y || from.y > lot.y + lot.height;
  return { x, y, along: outsideAlongY ? "x" : "y" };
}
