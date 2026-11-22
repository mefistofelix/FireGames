// TV lobby: shows the QR code, seats the players that join from their phones and lets the first one
// (or the TV remote) choose the game. The TV owns all the state; phones only send requests.

import { COLORS, GAMES, NAME_MAX_LENGTH, SILENCE_MS, padUrl, serverInfo } from "../shared/config.js";
import { openHost } from "../shared/link.js";
import { drawQr } from "../shared/qr.js";
import * as sound from "../shared/sound.js";
import { startScene } from "./scene.js";

const players = new Map(); // peerId -> {name, color, hex, tilt, honkAt, seenAt}; the first one is the leader
let selectedGame = 0;
let toastTimer = 0;

const link = openHost(onMessage);
startScene(document.getElementById("scene"), players);
renderGames();
showAddress();
setInterval(dropSilentPlayers, 1000);
window.addEventListener("keydown", onKey);

async function showAddress() {
  const info = await serverInfo();
  const url = padUrl(info);
  drawQr(document.getElementById("qr"), url);
  document.getElementById("url").textContent = url.replace("http://", "").replace(/\/$/, "");
  if (info) document.getElementById("version").textContent = "v" + info.version;
}

function renderGames() {
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
  const hint = document.getElementById("hint");
  const leader = players.values().next().value;
  hint.textContent = leader
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
  renderGames();
  sendLobbyToAll();
}

function startGame() {
  // The games are not implemented yet: the lobby is the first milestone.
  toast(GAMES[selectedGame].name + " è in arrivo!");
}

function onKey(event) {
  sound.unlock();
  if (event.key === "ArrowLeft") pickGame(-1);
  if (event.key === "ArrowRight") pickGame(1);
  if (event.key === "Enter") startGame();
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
  renderGames();
  sendLobbyToAll();
}

function leave(peerId) {
  const player = players.get(peerId);
  if (!player) return;
  players.delete(peerId);
  sound.goodbye();
  toast(player.name + " è uscito");
  renderGames();
  sendLobbyToAll();
}

function dropSilentPlayers() {
  const now = performance.now();
  for (const [peerId, player] of players) {
    if (now - player.seenAt > SILENCE_MS) leave(peerId);
  }
}

function onMessage(peerId, message) {
  const player = players.get(peerId);
  if (player) player.seenAt = performance.now();
  if (message.t === "ping") return link.send(peerId, { t: "pong" });
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
