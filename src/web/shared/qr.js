// QR Code encoder: byte mode, error correction level M, versions 1-6 (texts up to 106 bytes).
// qrMatrix(text) returns the modules as rows of booleans (true = dark), without the quiet zone.

const VERSIONS = [
  null,
  { size: 21, dataBytes: 16, eccPerBlock: 10, blocks: 1, align: 0 },
  { size: 25, dataBytes: 28, eccPerBlock: 16, blocks: 1, align: 18 },
  { size: 29, dataBytes: 44, eccPerBlock: 26, blocks: 1, align: 22 },
  { size: 33, dataBytes: 64, eccPerBlock: 18, blocks: 2, align: 26 },
  { size: 37, dataBytes: 86, eccPerBlock: 24, blocks: 2, align: 30 },
  { size: 41, dataBytes: 108, eccPerBlock: 16, blocks: 4, align: 34 },
];

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

// GF(256) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
let power = 1;
for (let i = 0; i < 255; i++) {
  EXP[i] = power;
  LOG[power] = i;
  power <<= 1;
  if (power & 0x100) power ^= 0x11d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];

function multiply(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function rsGenerator(degree) {
  let generator = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(generator.length + 1).fill(0);
    for (let j = 0; j < generator.length; j++) {
      next[j] ^= generator[j];
      next[j + 1] ^= multiply(generator[j], EXP[i]);
    }
    generator = next;
  }
  return generator;
}

function rsRemainder(data, generator) {
  const remainder = new Array(generator.length - 1).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder.shift();
    remainder.push(0);
    for (let i = 0; i < remainder.length; i++) {
      remainder[i] ^= multiply(generator[i + 1], factor);
    }
  }
  return remainder;
}

function dataCodewords(bytes, version) {
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const byte of bytes) push(byte, 8);
  const capacity = version.dataBytes * 8;
  push(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  }
  const padding = [0xec, 0x11];
  for (let i = 0; codewords.length < version.dataBytes; i++) codewords.push(padding[i % 2]);
  return codewords;
}

function interleaved(codewords, version) {
  const generator = rsGenerator(version.eccPerBlock);
  const blockLength = version.dataBytes / version.blocks;
  const dataBlocks = [];
  const eccBlocks = [];
  for (let i = 0; i < version.blocks; i++) {
    const block = codewords.slice(i * blockLength, (i + 1) * blockLength);
    dataBlocks.push(block);
    eccBlocks.push(rsRemainder(block, generator));
  }
  const result = [];
  for (let i = 0; i < blockLength; i++) for (const block of dataBlocks) result.push(block[i]);
  for (let i = 0; i < version.eccPerBlock; i++) for (const block of eccBlocks) result.push(block[i]);
  return result;
}

function formatBits(mask) {
  const data = mask; // level M is 00 in the two high bits
  let remainder = data;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >> 9) * 0x537);
  return ((data << 10) | remainder) ^ 0x5412;
}

function emptyGrid(size) {
  return Array.from({ length: size }, () => new Array(size).fill(false));
}

function drawFunctionPatterns(modules, reserved, version) {
  const size = version.size;
  const set = (x, y, dark) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y][x] = dark;
    reserved[y][x] = true;
  };
  for (let i = 0; i < size; i++) {
    set(i, 6, i % 2 === 0);
    set(6, i, i % 2 === 0);
  }
  for (const [centerX, centerY] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        set(centerX + dx, centerY + dy, distance !== 2 && distance !== 4);
      }
    }
  }
  if (version.align) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        set(version.align + dx, version.align + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }
  drawFormat(modules, reserved, size, 0);
}

function drawFormat(modules, reserved, size, mask) {
  const bits = formatBits(mask);
  const set = (x, y, index) => {
    modules[y][x] = ((bits >> index) & 1) === 1;
    reserved[y][x] = true;
  };
  for (let i = 0; i <= 5; i++) set(8, i, i);
  set(8, 7, 6);
  set(8, 8, 7);
  set(7, 8, 8);
  for (let i = 9; i < 15; i++) set(14 - i, 8, i);
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, i);
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, i);
  modules[size - 8][8] = true;
  reserved[size - 8][8] = true;
}

function drawData(modules, reserved, size, codewords) {
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const y = upward ? size - 1 - step : step;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (reserved[y][x]) continue;
        const byte = codewords[bitIndex >> 3] || 0;
        modules[y][x] = ((byte >> (7 - (bitIndex & 7))) & 1) === 1;
        bitIndex++;
      }
    }
    upward = !upward;
  }
}

// Penalty for long runs and 2x2 blocks: enough to avoid the masks that are hard to scan.
function penalty(modules, size) {
  let score = 0;
  for (let i = 0; i < size; i++) {
    for (const line of [modules[i], modules.map((row) => row[i])]) {
      let run = 1;
      for (let j = 1; j <= size; j++) {
        if (j < size && line[j] === line[j - 1]) {
          run++;
          continue;
        }
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const color = modules[y][x];
      if (color === modules[y][x + 1] && color === modules[y + 1][x] && color === modules[y + 1][x + 1]) score += 3;
    }
  }
  return score;
}

export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(text);
  const version = VERSIONS.find((candidate) => candidate && bytes.length <= candidate.dataBytes - 2);
  if (!version) throw new Error("QR text too long: " + bytes.length + " bytes");
  const size = version.size;
  const base = emptyGrid(size);
  const reserved = emptyGrid(size);
  drawFunctionPatterns(base, reserved, version);
  drawData(base, reserved, size, interleaved(dataCodewords(bytes, version), version));

  let best = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < MASKS.length; mask++) {
    const modules = base.map((row) => row.slice());
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!reserved[y][x] && MASKS[mask](x, y)) modules[y][x] = !modules[y][x];
      }
    }
    drawFormat(modules, reserved, size, mask);
    const score = penalty(modules, size);
    if (score < bestScore) {
      best = modules;
      bestScore = score;
    }
  }
  return best;
}

// Draws the code on a canvas, one canvas pixel per module plus a 4 module quiet zone; scale it with CSS.
export function drawQr(canvas, text) {
  const modules = qrMatrix(text);
  const quiet = 4;
  canvas.width = modules.length + quiet * 2;
  canvas.height = canvas.width;
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#000";
  modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) context.fillRect(x + quiet, y + quiet, 1, 1);
    });
  });
}
