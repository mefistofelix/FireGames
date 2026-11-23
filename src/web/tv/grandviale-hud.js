// Grand Viale: the flat panels drawn over the board on their own transparent canvas, in a 1920x1080 space:
// the names of the hotels, team chips with the money, the banner, the tray with the last result of the two
// dice, floating amounts and the final ranking.

import { euro } from "../shared/config.js";
import { roundedRect } from "./scene.js";

const WIDTH = 1920;
const HEIGHT = 1080;
const CANVAS_MAX_WIDTH = 1280; // 720p scaled up by the page: enough for the letters, light for the TV

export const PERMIT_LOOK = {
  si: { text: "SÌ", color: "#2ec46d" },
  no: { text: "NO", color: "#e63946" },
  gratis: { text: "GRATIS", color: "#d99a00" },
  doppio: { text: "×2", color: "#f77f00" },
};

export const PIPS = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

// Centre, in screen units, of a player's chip in the top bar.
export function chipCenter(index, count) {
  const width = Math.min(430, 1840 / count);
  const left = (WIDTH - width * count) / 2;
  return { x: left + width * (index + 0.5), y: 58, width: width - 16 };
}

const NOTES = [[5000, "#b388eb"], [1000, "#ff8fab"], [500, "#7fd6a4"], [100, "#ffd166"], [50, "#bfe3ff"]];
const STEPS = ["Lancia", "Muovi", "Casella", "Fine turno"];

export function createHud(canvas, state, hotels) {
  const context = canvas.getContext("2d");

  function resize() {
    canvas.width = Math.min(window.innerWidth * (window.devicePixelRatio || 1), CANVAS_MAX_WIDTH);
    canvas.height = canvas.width * HEIGHT / WIDTH;
  }
  window.addEventListener("resize", resize);
  resize();

  // A small plate over each lot: the name, in the owner's colour, or the price of the land while it is free.
  function drawLabels(labels) {
    context.textAlign = "center";
    context.textBaseline = "middle";
    for (const label of labels) {
      const text = label.price ? label.text + " · " + euro(label.price) : label.text;
      context.font = "800 22px system-ui, sans-serif";
      const width = context.measureText(text).width + 28;
      context.fillStyle = label.hex || "rgba(16, 18, 44, 0.78)";
      roundedRect(context, label.x - width / 2, label.y - 36, width, 36, 18);
      if (label.hex) {
        context.strokeStyle = "#fff";
        context.lineWidth = 3;
        context.stroke();
      }
      context.lineWidth = 5;
      context.strokeStyle = "rgba(16, 18, 44, 0.9)";
      if (label.hex) context.strokeText(text, label.x, label.y - 17);
      context.fillStyle = "#fff";
      context.fillText(text, label.x, label.y - 17);
    }
    context.textBaseline = "alphabetic";
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
      if (!player.bankrupt) {
        if (chip.width > 330) drawNotes(player.cash, chip.x + chip.width / 2 - 20);
        drawDeeds(player, chip.x - chip.width / 2 + 6);
      }
      context.globalAlpha = 1;
    });
  }

  // The team's money as the notes it would keep next to the board, biggest first, fanned from the right.
  function drawNotes(cash, right) {
    const notes = [];
    let left = cash;
    for (const [value, colour] of NOTES) {
      while (left >= value && notes.length < 14) {
        notes.push(colour);
        left -= value;
      }
    }
    notes.reverse().forEach((colour, index) => {
      const x = right - 34 - index * 9;
      context.fillStyle = "rgba(16, 18, 44, 0.9)";
      context.fillRect(x - 1, 33, 36, 22);
      context.fillStyle = colour;
      context.fillRect(x, 34, 34, 20);
      context.fillStyle = "rgba(255, 255, 255, 0.55)";
      context.fillRect(x + 12, 39, 10, 10);
    });
  }

  // The team's title deeds under its panel: one card per hotel in the hotel's colour, with a mark for each
  // piece built and a door for each entrance.
  function drawDeeds(player, left) {
    let x = left;
    state.hotels.forEach((status, index) => {
      if (status.owner !== player) return;
      const width = 26 + Math.max(status.stage, 1) * 9;
      context.fillStyle = "rgba(16, 18, 44, 0.9)";
      roundedRect(context, x, 108, width, 34, 8);
      context.fillStyle = hotels[index].accent;
      roundedRect(context, x + 2, 110, width - 4, 30, 6);
      context.fillStyle = "#14142b";
      context.font = "900 15px system-ui, sans-serif";
      context.textAlign = "left";
      context.fillText(hotels[index].name.split(" ").pop().slice(0, 3).toUpperCase(), x + 6, 124);
      for (let piece = 0; piece < status.stage; piece++) context.fillRect(x + 7 + piece * 9, 129, 6, 7);
      context.fillStyle = "#c1121f";
      for (let door = 0; door < status.entrances.length; door++) context.fillRect(x + width - 9 - door * 5, 113, 3, 8);
      x += width + 6;
    });
  }

  // Where the turn is: the four steps, the current one in the team's colour. Bottom left, out of the way.
  function drawSteps() {
    const player = state.players[state.current];
    if (!player || state.finished || state.step === undefined) return;
    context.font = "800 24px system-ui, sans-serif";
    context.textAlign = "left";
    context.textBaseline = "middle";
    let x = 28;
    context.fillStyle = "rgba(16, 18, 44, 0.82)";
    roundedRect(context, 16, 994, 34 + STEPS.reduce((sum, step) => sum + context.measureText(step).width + 62, 0), 62, 31);
    STEPS.forEach((step, index) => {
      const width = context.measureText(step).width + 50;
      const current = index === state.step;
      if (current) {
        context.fillStyle = player.hex;
        roundedRect(context, x, 1002, width, 46, 23);
      }
      context.fillStyle = current ? "#fff" : (index < state.step ? "#7CFC9A" : "#9aa3b8");
      context.fillText((index < state.step ? "✓ " : (index + 1) + " ") + step, x + 14, 1026);
      x += width + 12;
    });
    context.textBaseline = "alphabetic";
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

  return {
    draw(now, seconds, labels) {
      const unit = canvas.width / WIDTH;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(unit, 0, 0, unit, 0, 0);
      state.effects = state.effects.filter((effect) => now - effect.start < effect.duration);
      if (!state.finished) drawLabels(labels);
      drawChips(seconds);
      drawSteps();
      drawTray();
      drawBanner(now);
      drawTexts(now);
      drawFinish(now);
    },
    stop() {
      window.removeEventListener("resize", resize);
    },
  };
}
