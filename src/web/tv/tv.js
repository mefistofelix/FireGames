// TV page: the lobby (QR code, seats, game choice) and the host of the running game.
// The TV owns all the state; phones only send requests. Teams can also play without a phone: the TV remote
// adds them in the lobby and answers the questions of whoever's turn it is, so the remote is passed around.

import { COLORS, GAMES, NAME_MAX_LENGTH, SILENCE_MS, padUrl, serverInfo } from "../shared/config.js";
import { openHost } from "../shared/link.js";
import { drawQr } from "../shared/qr.js";
import * as sound from "../shared/sound.js";
import { startGrandViale } from "./grandviale.js";
import { startScene } from "./scene.js";

const BACK_CONFIRM_MS = 3000;
const MIN_TEAMS = 2;
const MAX_TEAMS = 4;

// peerId -> {name, color, hex, tilt, honkAt, seenAt, remote}; the first one is the leader.
// Remote teams have no phone: remote is true and their peerId is "remote-N".
const players = new Map();
let selectedGame = 0;
let toastTimer = 0;
let game = null;
let menu = null; // {prompt, index, shown}: the running game's question, answerable with the remote
let backAt = -Infinity;
let chooser = null; // {count}: "how many teams?", asked when a game is started without enough teams

const link = openHost(onMessage);
const scene = startScene(document.getElementById("scene"), players);
renderLobby();
showAddress();
setInterval(dropSilentPlayers, 1000);
window.addEventListener("keydown", onKey);
window.onTvBack = onBack; // called by the Android shell for the remote's Back key

async function showAddress() {
  const info = await serverInfo();
  const url = padUrl(info);
  drawQr(document.getElementById("qr"), url);
  document.getElementById("url").textContent = url.replace("http://", "").replace(/\/$/, "");
  if (info) document.getElementById("version").textContent = "v" + info.version;
}

function renderLobby() {
  const container = document.getElementById("games");
  container.textContent = "";
  GAMES.forEach((game, index) => {
    const card = document.createElement("article");
    card.className = index === selectedGame ? "game selected" : "game";
    const icon = document.createElement("div");
    icon.className = "icon";
    icon.textContent = game.icon;
    const name = document.createElement("h2");
    name.textContent = game.name;
    const tagline = document.createElement("p");
    tagline.textContent = game.tagline;
    card.append(icon, name, tagline);
    container.append(card);
  });
  const leader = players.values().next().value;
  const hint = document.getElementById("hint");
  hint.textContent = leader && !leader.remote
    ? leader.name + " sceglie il gioco dal telefono"
    : "Inquadra il codice con il telefono per entrare";
}

function toast(text) {
  const element = document.getElementById("toast");
  element.textContent = text;
  element.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("visible"), 3000);
}

function pickGame(step) {
  selectedGame = (selectedGame + step + GAMES.length) % GAMES.length;
  sound.tick();
  renderLobby();
  sendLobbyToAll();
}

function freeColor() {
  const taken = [...players.values()].map((player) => player.color);
  return COLORS.find((color) => !taken.includes(color.id));
}

function addRemoteTeam() {
  const color = freeColor();
  if (!color) return;
  let number = 1;
  while (players.has("remote-" + number)) number++;
  players.set("remote-" + number, {
    name: "Squadra " + number, color: color.id, hex: color.hex, tilt: 0, honkAt: -Infinity, seenAt: 0, remote: true,
  });
  sound.chime();
  renderLobby();
  sendLobbyToAll();
}

function removeRemoteTeam() {
  const remoteIds = [...players.keys()].filter((peerId) => players.get(peerId).remote);
  if (!remoteIds.length) return;
  players.delete(remoteIds[remoteIds.length - 1]);
  sound.goodbye();
  renderLobby();
  sendLobbyToAll();
}

function startGame() {
  if (game) return;
  if (selectedGame !== 0) {
    toast(GAMES[selectedGame].name + " è in arrivo!");
    return;
  }
  if (players.size < 2) {
    openChooser();
    return;
  }
  const seats = [...players].map(([peerId, player]) => ({ peerId, name: player.name, hex: player.hex, remote: player.remote }));
  document.body.classList.add("playing");
  scene.setRunning(false);
  game = startGrandViale({
    canvas: document.getElementById("board"),
    worldCanvas: document.getElementById("world"),
    seats,
    send: (peerId, body) => link.send(peerId, body),
    onPrompt,
    onFinish: endGame,
  });
}

function endGame() {
  game = null;
  menu = null;
  renderMenu();
  document.body.classList.remove("playing");
  scene.setRunning(true);
  for (const player of players.values()) player.seenAt = performance.now();
  renderLobby();
  sendLobbyToAll();
}

// Starting with fewer than two teams is not an error: the TV asks how many teams play and adds the missing
// ones as teams without a phone, who pass the remote around.
function openChooser() {
  chooser = { count: MIN_TEAMS };
  renderChooser();
}

function closeChooser() {
  chooser = null;
  renderChooser();
}

function renderChooser() {
  const element = document.getElementById("menu");
  element.hidden = chooser === null;
  if (!chooser) return;
  element.textContent = "";
  const title = document.createElement("h2");
  title.textContent = "Quante squadre giocano?";
  const status = document.createElement("p");
  status.textContent = "Chi non ha il telefono gioca col telecomando: ve lo passate a ogni turno.";
  element.append(title, status);
  for (let count = MIN_TEAMS; count <= MAX_TEAMS; count++) {
    const row = document.createElement("div");
    row.className = count === chooser.count ? "choice selected" : "choice";
    row.textContent = count + " squadre";
    element.append(row);
  }
}

function onChooserKey(event) {
  if (event.key === "ArrowUp") chooser.count = Math.max(MIN_TEAMS, chooser.count - 1);
  if (event.key === "ArrowDown") chooser.count = Math.min(MAX_TEAMS, chooser.count + 1);
  if (event.key === "Enter") {
    const count = chooser.count;
    closeChooser();
    while (players.size < count) addRemoteTeam();
    startGame();
    return;
  }
  sound.tick();
  renderChooser();
}

function firstEnabled(buttons) {
  return Math.max(0, buttons.findIndex((button) => !button.disabled));
}

// The menu appears by itself for teams without a phone; for the others at the first press on the remote.
function onPrompt(prompt) {
  if (!prompt) {
    menu = null;
  } else if (!menu || menu.prompt !== prompt) {
    menu = { prompt, index: firstEnabled(prompt.buttons), shown: prompt.player.remote === true };
  }
  renderMenu();
}

function renderMenu() {
  const element = document.getElementById("menu");
  element.hidden = !menu || !menu.shown;
  if (element.hidden) return;
  element.textContent = "";
  const title = document.createElement("h2");
  title.textContent = menu.prompt.player.name;
  title.style.color = menu.prompt.player.hex;
  const status = document.createElement("p");
  status.textContent = menu.prompt.status;
  element.append(title, status);
  menu.prompt.buttons.forEach((button, index) => {
    const row = document.createElement("div");
    row.className = "choice" + (index === menu.index ? " selected" : "") + (button.disabled ? " disabled" : "");
    const label = document.createElement("span");
    label.textContent = button.label;
    const price = document.createElement("strong");
    price.textContent = button.sub || "";
    row.append(label, price);
    element.append(row);
  });
}

function moveMenu(step) {
  const buttons = menu.prompt.buttons;
  let index = menu.index;
  for (let tries = 0; tries < buttons.length; tries++) {
    index = (index + step + buttons.length) % buttons.length;
    if (!buttons[index].disabled) break;
  }
  menu.index = index;
  sound.tick();
}

function onGameKey(event) {
  if (!menu) return;
  if (!menu.shown) {
    menu.shown = true;
  } else if (event.key === "ArrowUp") {
    moveMenu(-1);
  } else if (event.key === "ArrowDown") {
    moveMenu(1);
  } else if (event.key === "Enter") {
    game.onAct(menu.prompt.peerId, menu.prompt.buttons[menu.index].id);
    return;
  }
  renderMenu();
}

function onKey(event) {
  sound.unlock();
  if (event.key === "Escape") onBack();
  if (game) return onGameKey(event);
  if (chooser) return onChooserKey(event);
  if (event.key === "ArrowLeft") pickGame(-1);
  if (event.key === "ArrowRight") pickGame(1);
  if (event.key === "ArrowUp") addRemoteTeam();
  if (event.key === "ArrowDown") removeRemoteTeam();
  if (event.key === "Enter") startGame();
}

// Returns true when Back was used here; false lets the Android shell close the app.
function onBack() {
  if (chooser) {
    closeChooser();
    return true;
  }
  if (!game) return false;
  if (performance.now() - backAt < BACK_CONFIRM_MS) {
    game.end();
  } else {
    backAt = performance.now();
    toast("Premi ancora Indietro per terminare la partita");
  }
  return true;
}

function lobbyFor(peerId) {
  const player = players.get(peerId);
  const leaderId = players.keys().next().value;
  const taken = [];
  for (const [otherId, other] of players) {
    if (otherId !== peerId) taken.push(other.color);
  }
  return {
    t: "lobby",
    taken,
    you: player ? { name: player.name, color: player.color, leader: peerId === leaderId } : null,
    game: selectedGame,
  };
}

function sendLobbyToAll() {
  for (const peerId of players.keys()) link.send(peerId, lobbyFor(peerId));
}

function join(peerId, message) {
  const color = COLORS.find((candidate) => candidate.id === message.color);
  const name = String(message.name || "").trim().slice(0, NAME_MAX_LENGTH);
  const takenByOther = [...players].some(([otherId, other]) => otherId !== peerId && other.color === message.color);
  if (!color || !name || takenByOther) {
    link.send(peerId, lobbyFor(peerId));
    return;
  }
  const isNew = !players.has(peerId);
  const previous = players.get(peerId) || { tilt: 0, honkAt: -Infinity };
  players.set(peerId, { ...previous, name, color: color.id, hex: color.hex, seenAt: performance.now() });
  if (isNew) {
    sound.chime();
    toast(name + " è entrato!");
  }
  renderLobby();
  sendLobbyToAll();
}

function leave(peerId) {
  const player = players.get(peerId);
  if (!player) return;
  players.delete(peerId);
  sound.goodbye();
  toast(player.name + " è uscito");
  renderLobby();
  sendLobbyToAll();
}

// Only in the lobby: during a game the seats are kept, so a phone that sleeps comes back to its place.
function dropSilentPlayers() {
  if (game) return;
  const now = performance.now();
  for (const [peerId, player] of players) {
    if (!player.remote && now - player.seenAt > SILENCE_MS) leave(peerId);
  }
}

function onGameMessage(peerId, message) {
  if (message.t === "act") game.onAct(peerId, message.id);
  if (message.t === "peek" || message.t === "hello") link.send(peerId, game.viewFor(peerId));
}

function onMessage(peerId, message) {
  const player = players.get(peerId);
  if (player) player.seenAt = performance.now();
  if (message.t === "ping") return link.send(peerId, { t: "pong" });
  if (game) return onGameMessage(peerId, message);
  if (message.t === "peek") return link.send(peerId, lobbyFor(peerId));
  if (message.t === "hello") return join(peerId, message);
  if (message.t === "bye") return leave(peerId);
  if (!player) return;
  if (message.t === "tilt") player.tilt = Math.max(-1, Math.min(1, Number(message.x) || 0));
  if (message.t === "honk") {
    player.honkAt = performance.now();
    sound.honk();
  }
  const isLeader = players.keys().next().value === peerId;
  if (!isLeader) return;
  if (message.t === "pick") pickGame(message.step === -1 ? -1 : 1);
  if (message.t === "start") startGame();
}
