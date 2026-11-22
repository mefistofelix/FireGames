// Grand Viale: the shape of the avenue and the look of its spaces, shared by the 3D scene and the game rules.
// World units: x to the right, y towards the viewer (the 3D scene uses it as its z axis).

export const SPACE_COUNT = 28;
export const ROAD_WIDTH = 96;
export const BEACH_Y = 885;
export const SEA_Y = 1035;

export const TILES = {
  bank: { color: "#ffd23f", icon: "🏦" },
  buy: { color: "#2ec46d", icon: "💰" },
  build: { color: "#f77f00", icon: "🏗️" },
  free: { color: "#35c6f0", icon: "🚪" },
  gift: { color: "#ff6fb5", icon: "🎁" },
  municipio: { color: "#9b5de5", icon: "🏛️" },
};

// The avenue passes through these points, clockwise seen from above, starting at the Banca (bottom centre).
const AVENUE = [
  [960, 800], [640, 830], [360, 760], [230, 560], [330, 350], [560, 270], [760, 360], [900, 500],
  [1080, 420], [1220, 270], [1480, 250], [1680, 400], [1700, 620], [1540, 790], [1260, 830],
];

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

export const PATH = buildPath();

// Point of a position along the avenue; progress is a space index and may be fractional.
export function ringPoint(progress) {
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
