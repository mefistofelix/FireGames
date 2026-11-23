// Grand Viale board: the pixel-art world (grandviale-world.js) with the flat panels over it (grandviale-hud.js),
// driven by one animation loop. The game talks to this module only.

import { createHud } from "./grandviale-hud.js";
import { ringPoint } from "./grandviale-path.js";
import { createWorld } from "./grandviale-world.js";

export { chipCenter } from "./grandviale-hud.js";
export { borderingSpaces, lotDoor } from "./grandviale-path.js";

export function spacePoint(index) {
  return ringPoint(index);
}

// worldCanvas shows the board, hudCanvas lies over it. state is the game state (see grandviale.js).
export function createBoard(worldCanvas, hudCanvas, state, hotels) {
  const world = createWorld(worldCanvas, state, hotels);
  const hud = createHud(hudCanvas, state, hotels);
  let running = true;
  let previous = performance.now();
  let frames = 0;
  let countedSince = previous;

  function frame(now) {
    if (!running) return;
    const seconds = Math.min(0.1, (now - previous) / 1000);
    previous = now;
    world.draw(now, seconds);
    hud.draw(now, seconds, world.labels());

    // Frame rate in the console every five seconds: on the TV it ends up in logcat (adb logcat -s FireGames).
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
      world.stop();
      hud.stop();
    },
    // Camera: look at a point of the board from closer (zoom > 1), or at the whole board.
    focus: world.focus,
    overview: world.overview,
  };
}
