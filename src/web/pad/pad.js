// Phone controller: join form (team name and colour), then the lobby pad. The TV owns the state: this
// page sends requests and draws what the TV answers.

import { COLORS, GAMES, PING_MS, SILENCE_MS } from "../shared/config.js";
import { openGuest } from "../shared/link.js";

const TILT_SEND_MS = 66;

const elements = {
  join: document.getElementById("join"),
  lobby: document.getElementById("lobby"),
  name: document.getElementById("name"),
  colors: document.getElementById("colors"),
  enter: document.getElementById("enter"),
  welcome: document.getElementById("welcome"),
  car: document.getElementById("car"),
  honk: document.getElementById("honk"),
  leader: document.getElementById("leader"),
  game: document.getElementById("game"),
  previous: document.getElementById("previous"),
  next: document.getElementById("next"),
  start: document.getElementById("start"),
  offline: document.getElementById("offline"),
  fullscreen: document.getElementById("fullscreen"),
};

// The id survives reloads, so a phone that reconnects takes its seat back.
let peerId = localStorage.getItem("peerId");
if (!peerId) {
  peerId = Math.random().toString(36).slice(2, 10);
  localStorage.setItem("peerId", peerId);
}

let chosenColor = localStorage.getItem("color");
let takenColors = [];
let joined = false;
let heardAt = performance.now();
let tilt = 0;
let sentTilt = 0;
let dragStartX = null;

elements.name.value = localStorage.getItem("name") || "";

const link = openGuest(peerId, onMessage, onOpen);
setInterval(heartbeat, PING_MS);
setInterval(sendTilt, TILT_SEND_MS);
renderColors();

function onOpen() {
  // After a reconnection the TV may have forgotten this phone: introduce it again.
  if (joined) sendHello();
  else link.send({ t: "peek" });
}

function onMessage(message) {
  heardAt = performance.now();
  elements.offline.hidden = true;
  if (message.t !== "lobby") return;
  takenColors = message.taken;
  if (!message.you) {
    // Not seated: first contact, or the colour was taken meanwhile, or the TV restarted.
    if (joined) sendHello();
    renderColors();
    return;
  }
  const color = COLORS.find((candidate) => candidate.id === message.you.color);
  elements.join.hidden = true;
  elements.lobby.hidden = false;
  elements.welcome.textContent = "Ciao " + message.you.name + "! Guardate la TV";
  elements.car.style.setProperty("--color", color.hex);
  elements.leader.hidden = !message.you.leader;
  elements.game.textContent = GAMES[message.game].name;
}

function heartbeat() {
  link.send({ t: "ping" });
  elements.offline.hidden = performance.now() - heardAt < SILENCE_MS;
}

function renderColors() {
  elements.colors.textContent = "";
  if (takenColors.includes(chosenColor)) chosenColor = null;
  for (const color of COLORS) {
    const button = document.createElement("button");
    button.className = color.id === chosenColor ? "color chosen" : "color";
    button.style.background = color.hex;
    button.disabled = takenColors.includes(color.id);
    button.setAttribute("aria-label", color.id);
    button.onclick = () => {
      chosenColor = color.id;
      renderColors();
    };
    elements.colors.append(button);
  }
  elements.enter.disabled = !chosenColor || !elements.name.value.trim();
}

function sendHello() {
  link.send({ t: "hello", name: elements.name.value, color: chosenColor });
}

// Browsers grant fullscreen and screen wake lock only inside a touch handler.
function claimPhone() {
  const root = document.documentElement;
  if (root.requestFullscreen) root.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
  if (navigator.wakeLock) navigator.wakeLock.request("screen").catch(() => {});
}

function sendTilt() {
  if (!joined || Math.abs(tilt - sentTilt) < 0.02) return;
  sentTilt = tilt;
  link.send({ t: "tilt", x: tilt });
}

function setTilt(value) {
  tilt = Math.max(-1, Math.min(1, value));
  elements.car.style.transform = "translateX(" + tilt * 60 + "px) rotate(" + tilt * 12 + "deg)";
}

elements.name.oninput = renderColors;

elements.enter.onclick = () => {
  localStorage.setItem("name", elements.name.value);
  localStorage.setItem("color", chosenColor);
  joined = true;
  claimPhone();
  sendHello();
};

elements.honk.onclick = () => {
  link.send({ t: "honk" });
  if (navigator.vibrate) navigator.vibrate(60);
};

elements.previous.onclick = () => link.send({ t: "pick", step: -1 });
elements.next.onclick = () => link.send({ t: "pick", step: 1 });
elements.start.onclick = () => link.send({ t: "start" });

// Touch only: motion sensors are not used (see AGENTS.md).
elements.car.addEventListener("pointerdown", (event) => {
  dragStartX = event.clientX;
  elements.car.setPointerCapture(event.pointerId);
});
elements.car.addEventListener("pointermove", (event) => {
  if (dragStartX === null) return;
  setTilt((event.clientX - dragStartX) / 90);
});
for (const type of ["pointerup", "pointercancel"]) {
  elements.car.addEventListener(type, () => {
    dragStartX = null;
    setTilt(0);
  });
}

// Leaving fullscreen by mistake (back gesture, notification) shows a one-tap way back.
document.addEventListener("fullscreenchange", () => {
  elements.fullscreen.hidden = !joined || document.fullscreenElement !== null;
});
elements.fullscreen.onclick = () => {
  elements.fullscreen.hidden = true;
  claimPhone();
};
document.addEventListener("visibilitychange", () => {
  if (joined && document.visibilityState === "visible" && navigator.wakeLock) {
    navigator.wakeLock.request("screen").catch(() => {});
  }
});
