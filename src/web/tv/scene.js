// Animated lobby backdrop: dusk sky, clouds, birds, hills, a pond, and a road where every player is a car.
// Everything is drawn in a 1920x1080 space anchored to the bottom of the canvas.

const WIDTH = 1920;
const HEIGHT = 1080;
const ROAD_TOP = 850;
const TRAFFIC_Y = 905;
const PLAYER_Y = 1000;
const TRAFFIC_COLORS = ["#c9d1e0", "#8d99ae", "#e0b089", "#a3c4bc", "#d9a5b3"];

function random(min, max) {
  return min + Math.random() * (max - min);
}

function makeClouds() {
  return Array.from({ length: 7 }, () => ({
    x: random(0, WIDTH),
    y: random(230, 520),
    size: random(50, 110),
    speed: random(6, 18),
  }));
}

function makeBirds() {
  return Array.from({ length: 6 }, () => ({
    x: random(0, WIDTH),
    y: random(120, 420),
    speed: random(50, 90),
    phase: random(0, 6),
    size: random(10, 18),
  }));
}

function makeTrees() {
  return [150, 330, 700, 1010, 1260, 1540, 1790].map((x) => ({ x, size: random(50, 85) }));
}

function hillY(x, base, height, stretch, shift) {
  return base - height * (0.6 + 0.4 * Math.sin(x / stretch + shift)) * (0.75 + 0.25 * Math.sin(x / (stretch * 0.37)));
}

function drawHills(context, color, base, height, stretch, shift) {
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(0, HEIGHT);
  for (let x = 0; x <= WIDTH; x += 24) context.lineTo(x, hillY(x, base, height, stretch, shift));
  context.lineTo(WIDTH, HEIGHT);
  context.fill();
}

function drawCloud(context, cloud) {
  context.fillStyle = "rgba(255, 236, 220, 0.75)";
  const size = cloud.size;
  for (const [dx, dy, scale] of [[0, 0, 1], [-0.9, 0.2, 0.7], [0.9, 0.25, 0.75], [0.35, -0.45, 0.7], [-0.4, -0.3, 0.6]]) {
    context.beginPath();
    context.arc(cloud.x + dx * size, cloud.y + dy * size, size * scale, 0, Math.PI * 2);
    context.fill();
  }
}

function drawBird(context, bird, time) {
  const flap = Math.sin(time * 9 + bird.phase) * bird.size * 0.8;
  context.strokeStyle = "rgba(30, 25, 50, 0.8)";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(bird.x - bird.size, bird.y - flap);
  context.quadraticCurveTo(bird.x - bird.size / 2, bird.y - bird.size / 2, bird.x, bird.y);
  context.quadraticCurveTo(bird.x + bird.size / 2, bird.y - bird.size / 2, bird.x + bird.size, bird.y - flap);
  context.stroke();
}

function drawTree(context, tree) {
  const groundY = hillY(tree.x, 800, 110, 260, 1) + 12;
  context.fillStyle = "#4a3426";
  context.fillRect(tree.x - 7, groundY - tree.size, 14, tree.size);
  context.fillStyle = "#1f6e54";
  context.beginPath();
  context.arc(tree.x, groundY - tree.size - 20, tree.size * 0.62, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#2b8a68";
  context.beginPath();
  context.arc(tree.x - tree.size * 0.2, groundY - tree.size - 32, tree.size * 0.4, 0, Math.PI * 2);
  context.fill();
}

function drawPond(context, time) {
  context.fillStyle = "#5fa8d3";
  context.beginPath();
  context.ellipse(480, 800, 190, 34, 0, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "rgba(255, 255, 255, 0.55)";
  context.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    const growth = (time * 0.25 + i / 3) % 1;
    context.globalAlpha = 1 - growth;
    context.beginPath();
    context.ellipse(430 + i * 60, 800, 14 + growth * 60, 3 + growth * 10, 0, 0, Math.PI * 2);
    context.stroke();
  }
  context.globalAlpha = 1;
}

function drawRoad(context) {
  context.fillStyle = "#2b2d42";
  context.fillRect(0, ROAD_TOP, WIDTH, HEIGHT - ROAD_TOP);
  context.fillStyle = "#f1e9da";
  context.fillRect(0, ROAD_TOP, WIDTH, 6);
  context.fillStyle = "rgba(255, 210, 63, 0.9)";
  for (let x = 20; x < WIDTH; x += 120) context.fillRect(x, 938, 64, 8);
}

export function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.fill();
}

// Car facing right (direction 1) or left (-1), wheels touching y.
export function drawCar(context, x, y, scale, color, lean, direction) {
  context.save();
  context.translate(x, y);
  context.rotate(lean);
  context.scale(scale * direction, scale);
  context.fillStyle = "rgba(0, 0, 0, 0.3)";
  context.beginPath();
  context.ellipse(0, 2, 82, 9, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = color;
  roundedRect(context, -80, -52, 160, 38, 12);
  roundedRect(context, -46, -84, 88, 44, 16);
  context.fillStyle = "#cfefff";
  roundedRect(context, -36, -76, 32, 26, 7);
  roundedRect(context, 2, -76, 32, 26, 7);
  context.fillStyle = "#fff6c9";
  context.fillRect(70, -44, 10, 12);
  context.fillStyle = "#e63946";
  context.fillRect(-80, -44, 6, 12);
  for (const wheelX of [-46, 46]) {
    context.fillStyle = "#14141f";
    context.beginPath();
    context.arc(wheelX, -14, 17, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#b8c0cc";
    context.beginPath();
    context.arc(wheelX, -14, 7, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawLabel(context, text, x, y, color) {
  context.font = "bold 34px system-ui, sans-serif";
  const width = context.measureText(text).width + 36;
  context.fillStyle = "rgba(10, 10, 25, 0.75)";
  roundedRect(context, x - width / 2, y - 44, width, 50, 25);
  context.fillStyle = color;
  context.textAlign = "center";
  context.fillText(text, x, y - 8);
}

// players: Map of peerId -> {name, hex, tilt (-1..1), honkAt (performance.now() of the last honk)}.
// The scene keeps one car per player and drives it away when the player disappears from the map.
export function startScene(canvas, players) {
  const context = canvas.getContext("2d");
  const clouds = makeClouds();
  const birds = makeBirds();
  const trees = makeTrees();
  const traffic = [];
  const cars = new Map();
  let nextTrafficAt = 0;
  let previous = performance.now();
  let running = true;

  function resize() {
    canvas.width = Math.min(window.innerWidth * (window.devicePixelRatio || 1), WIDTH);
    canvas.height = canvas.width * window.innerHeight / window.innerWidth;
  }
  window.addEventListener("resize", resize);
  resize();

  function updateCars(seconds, now) {
    let slot = 0;
    for (const [peerId, player] of players) {
      slot++;
      let car = cars.get(peerId);
      if (!car) {
        car = { x: -200, lean: 0, leaving: false };
        cars.set(peerId, car);
      }
      car.name = player.name;
      car.hex = player.hex;
      const home = WIDTH * slot / (players.size + 1);
      const target = home + player.tilt * 110;
      car.x += (target - car.x) * Math.min(1, seconds * 5);
      car.lean += (player.tilt * 0.22 - car.lean) * Math.min(1, seconds * 8);
      const sinceHonk = (now - player.honkAt) / 1000;
      car.jump = sinceHonk < 0.5 ? Math.sin(sinceHonk * Math.PI * 2) * 46 : 0;
      car.honking = sinceHonk < 0.8;
    }
    for (const [peerId, car] of cars) {
      if (players.has(peerId)) continue;
      car.x += seconds * 900;
      car.lean = -0.08;
      car.jump = 0;
      car.honking = false;
      if (car.x > WIDTH + 250) cars.delete(peerId);
    }
  }

  function updateTraffic(seconds, now) {
    if (now > nextTrafficAt) {
      const direction = Math.random() < 0.5 ? 1 : -1;
      traffic.push({
        x: direction === 1 ? -150 : WIDTH + 150,
        direction,
        speed: random(260, 420),
        color: TRAFFIC_COLORS[Math.floor(random(0, TRAFFIC_COLORS.length))],
      });
      nextTrafficAt = now + random(2500, 7000);
    }
    for (const car of traffic) car.x += car.direction * car.speed * seconds;
    while (traffic.length && (traffic[0].x < -300 || traffic[0].x > WIDTH + 300)) traffic.shift();
  }

  function frame(now) {
    if (!running) return;
    const seconds = Math.min(0.1, (now - previous) / 1000);
    previous = now;
    const time = now / 1000;

    const scale = canvas.width / WIDTH;
    context.setTransform(1, 0, 0, 1, 0, 0);
    const sky = context.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0, "#1b2a5c");
    sky.addColorStop(0.45, "#7b4b94");
    sky.addColorStop(0.68, "#f08a5d");
    sky.addColorStop(0.8, "#f9d976");
    context.fillStyle = sky;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(scale, 0, 0, scale, 0, canvas.height - HEIGHT * scale);

    const glow = context.createRadialGradient(1380, 640, 20, 1380, 640, 420);
    glow.addColorStop(0, "rgba(255, 244, 200, 0.95)");
    glow.addColorStop(0.18, "rgba(255, 220, 150, 0.55)");
    glow.addColorStop(1, "rgba(255, 200, 120, 0)");
    context.fillStyle = glow;
    context.fillRect(900, 200, 960, 700);

    for (const cloud of clouds) {
      cloud.x += cloud.speed * seconds;
      if (cloud.x > WIDTH + 250) cloud.x = -250;
      drawCloud(context, cloud);
    }
    for (const bird of birds) {
      bird.x += bird.speed * seconds;
      bird.y += Math.sin(time + bird.phase) * 0.3;
      if (bird.x > WIDTH + 50) bird.x = -50;
      drawBird(context, bird, time);
    }

    drawHills(context, "#4a4e8f", 760, 200, 310, 0);
    drawHills(context, "#2f6f5e", 800, 110, 260, 1);
    drawPond(context, time);
    for (const tree of trees) drawTree(context, tree);
    drawRoad(context);

    updateTraffic(seconds, now);
    for (const car of traffic) drawCar(context, car.x, TRAFFIC_Y, 0.62, car.color, 0, car.direction);

    updateCars(seconds, now);
    for (const car of cars.values()) {
      const bob = Math.sin(time * 6 + car.x) * 2;
      drawCar(context, car.x, PLAYER_Y - car.jump + bob, 1.25, car.hex, car.lean, 1);
      drawLabel(context, car.honking ? "BEEP!" : car.name, car.x, PLAYER_Y - 130 - car.jump, car.honking ? "#ffd23f" : "#fff");
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    // The lobby backdrop stops drawing while a game covers it.
    setRunning(value) {
      if (value && !running) requestAnimationFrame(frame);
      running = value;
    },
  };
}
