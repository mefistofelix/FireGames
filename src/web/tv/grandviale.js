// Grand Viale: rules and turn flow. The board drawing is in grandviale-board.js.
// An original game of the "buy land, build hotels, charge the guests" family: own board, hotels and prices.
//
// The turn is written as straight async code: ask() shows buttons on one phone and resolves with the
// button the team pressed; the animations are awaited with wait().

import { euro } from "../shared/config.js";
import * as sound from "../shared/sound.js";
import { chipCenter, createBoard, nearestSpaces, spacePoint } from "./grandviale-board.js";

const START_CASH = 12000;
const SALARY = 2000;
const BONUS = 500;
const HOP_MS = 260;
const PERMIT_FACES = ["si", "si", "si", "no", "gratis", "doppio"];

// What a team may do on each of the 28 spaces of the ring.
const SPACES = [
  "bank", "buy", "build", "buy", "build", "free", "buy", "build", "buy", "build", "bonus", "buy", "build", "buy",
  "municipio", "buy", "build", "buy", "build", "free", "buy", "build", "buy", "build", "bonus", "buy", "build", "buy",
];

const SPACE_TEXT = {
  bank: "Banca: stipendio incassato.",
  buy: "Casella Acquisti: potete comprare un terreno qui accanto.",
  build: "Casella Cantiere: chiedete il permesso per costruire.",
  free: "Ingresso gratis per un vostro hotel.",
  municipio: "Municipio: qui il permesso di costruire è garantito.",
  bonus: "Turisti generosi: avete incassato una mancia.",
};

// land: price of the lot. stages: cost of each building. rates: price of one night with that many buildings.
// center/size: the lot on the board. reach: how many of the nearest spaces the hotel is "next to" (where it can be
// bought and where its entrances go). style and tall (height of its buildings) say how the board draws it.
const HOTEL_LIST = [
  { name: "Locanda del Faro", accent: "#e76f51", style: "lighthouse", tall: 110, land: 1000, stages: [1200, 1000, 800],
    entrance: 150, rates: [100, 200, 350], center: [500, 952], size: [310, 124], reach: 3 },
  { name: "Pensione Girasole", accent: "#e9c46a", style: "flat", tall: 105, land: 1200, stages: [1500, 1200, 1000],
    entrance: 150, rates: [120, 250, 400], center: [1400, 952], size: [310, 124], reach: 3 },
  { name: "Villa Ortensia", accent: "#b388eb", style: "dome", tall: 120, land: 1800, stages: [2200, 1800, 1500],
    entrance: 200, rates: [200, 400, 650], center: [915, 245], size: [230, 150], reach: 3 },
  { name: "Albergo Tre Pini", accent: "#52b788", style: "pitched", tall: 125, land: 2000, stages: [2500, 2000, 1800, 1500],
    entrance: 200, rates: [200, 400, 600, 900], center: [1715, 165], size: [280, 140], reach: 3 },
  { name: "Rifugio Stella Alpina", accent: "#a47148", style: "chalet", tall: 115, land: 2500, stages: [3000, 2500, 2000],
    entrance: 250, rates: [300, 600, 950], center: [200, 180], size: [260, 140], reach: 3 },
  { name: "Palazzo Belvedere", accent: "#f4a261", style: "palace", tall: 135, land: 3000, stages: [3500, 3000, 2500, 2500],
    entrance: 300, rates: [350, 650, 1000, 1400], center: [935, 655], size: [270, 140], reach: 3 },
  { name: "Grand Hotel Aurora", accent: "#ff8fab", style: "dome", tall: 175, land: 3500, stages: [4000, 3500, 3000, 3000],
    entrance: 300, rates: [400, 800, 1200, 1700], center: [520, 560], size: [300, 230], reach: 4 },
  { name: "Torre Zaffiro", accent: "#4895ef", style: "tower", tall: 270, land: 4000, stages: [5000, 4000, 4000, 3500],
    entrance: 350, rates: [500, 950, 1500, 2200], center: [1330, 560], size: [320, 240], reach: 4 },
];

const HOTELS = HOTEL_LIST.map((hotel) => ({
  ...hotel,
  lot: {
    x: hotel.center[0] - hotel.size[0] / 2,
    y: hotel.center[1] - hotel.size[1] / 2,
    width: hotel.size[0],
    height: hotel.size[1],
  },
  spaces: nearestSpaces({ x: hotel.center[0], y: hotel.center[1] }, hotel.reach),
}));

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// seats: [{peerId, name, hex}] in turn order; the first one may end the game early.
// send(peerId, body) delivers a view to a phone. onPrompt(prompt) tells the TV which question is waiting
// ({player, status, buttons} or null) so the remote can answer it. onFinish() is called after the final ranking.
export function startGrandViale({ canvas, seats, send, onPrompt, onFinish }) {
  const state = {
    players: seats.map((seat) => ({ ...seat, cash: START_CASH, shownCash: START_CASH, space: 0, move: null, bankrupt: false })),
    hotels: HOTELS.map(() => ({ owner: null, stage: 0, invested: 0, entrances: [], builtAt: 0 })),
    entranceAt: new Map(), // space -> hotel index
    current: 0,
    die: { visible: false },
    banner: { text: "", until: 0 },
    effects: [],
    finished: null,
  };
  const board = createBoard(canvas, state, HOTELS, SPACES);
  let prompt = null; // {peerId, status, buttons, resolve}: the question waiting on a phone
  let note = "";
  let over = false;
  let endArmed = false;

  function banner(text, hex) {
    state.banner = { text, hex: hex || "#14142b", start: performance.now(), until: performance.now() + 2600 };
  }

  function floatText(text, hex, point) {
    state.effects.push({ kind: "text", text, hex, x: point.x, y: point.y, start: performance.now(), duration: 1600 });
  }

  function credit(player, amount) {
    player.cash += amount;
    const sign = amount >= 0 ? "+" : "−";
    const chip = chipCenter(state.players.indexOf(player), state.players.length);
    floatText(sign + euro(Math.abs(amount)), amount >= 0 ? "#7CFC9A" : "#ff8a8a", { x: chip.x, y: chip.y + 70 });
    refreshViews();
  }

  function ownedBy(player) {
    return state.hotels.map((hotel, index) => index).filter((index) => state.hotels[index].owner === player);
  }

  function worth(player) {
    return player.cash + ownedBy(player).reduce((sum, index) => sum + state.hotels[index].invested, 0);
  }

  function viewFor(peerId) {
    const player = state.players.find((candidate) => candidate.peerId === peerId);
    if (!player) {
      return { t: "view", name: "Fire Games", status: "Partita in corso: entrate alla prossima!", buttons: [], cards: [] };
    }
    const active = prompt !== null && prompt.peerId === peerId;
    const buttons = active ? prompt.buttons.slice() : [];
    if (peerId === seats[0].peerId && !over) {
      buttons.push(endArmed
        ? { id: "end-confirm", label: "Conferma: termina la partita", kind: "danger" }
        : { id: "end-game", label: "Termina la partita", kind: "quiet" });
    }
    const cards = ownedBy(player).map((index) => {
      const hotel = state.hotels[index];
      const rate = hotel.stage ? "notte " + euro(HOTELS[index].rates[hotel.stage - 1]) : "nessun edificio";
      return {
        title: HOTELS[index].name,
        text: hotel.stage + " edifici · " + hotel.entrances.length + " ingressi · " + rate,
        hex: HOTELS[index].accent,
      };
    });
    let status = note;
    if (player.bankrupt) status = "Siete in bancarotta. " + note;
    if (active) status = prompt.status;
    return { t: "view", name: player.name, hex: player.hex, money: euro(player.cash), turn: active, status, buttons, cards };
  }

  function refreshViews() {
    for (const seat of seats) send(seat.peerId, viewFor(seat.peerId));
    onPrompt(prompt);
  }

  // Shows buttons on the player's phone and resolves with the id of the pressed one ("abort" if the game ends).
  function ask(player, status, buttons) {
    return new Promise((resolve) => {
      prompt = { peerId: player.peerId, player, status, buttons, resolve };
      refreshViews();
    });
  }

  function onAct(peerId, id) {
    if (peerId === seats[0].peerId && id === "end-game") {
      endArmed = true;
      setTimeout(() => {
        endArmed = false;
        refreshViews();
      }, 4000);
      refreshViews();
      return;
    }
    if (peerId === seats[0].peerId && id === "end-confirm" && endArmed) {
      finish();
      return;
    }
    if (!prompt || prompt.peerId !== peerId) return;
    const button = prompt.buttons.find((candidate) => candidate.id === id);
    if (!button || button.disabled) return;
    const resolve = prompt.resolve;
    prompt = null;
    refreshViews();
    resolve(id);
  }

  async function roll(kind, result, hex) {
    const faces = kind === "number" ? [1, 2, 3, 4, 5, 6] : ["si", "no", "gratis", "doppio"];
    state.die = { visible: true, kind, faces, face: result, rolling: true, hex, startedAt: performance.now() };
    sound.dice();
    await wait(1200);
    state.die.rolling = false;
    state.die.stoppedAt = performance.now();
    sound.tick();
    await wait(1100);
    state.die.visible = false;
    return result;
  }

  function rollNumber(hex) {
    return roll("number", 1 + Math.floor(Math.random() * 6), hex);
  }

  async function moveCar(player, steps) {
    for (let step = 0; step < steps; step++) {
      const next = (player.space + 1) % SPACES.length;
      board.focus(spacePoint(next), 1.5);
      player.move = { from: player.space, start: performance.now(), duration: HOP_MS };
      sound.step();
      await wait(HOP_MS);
      player.move = null;
      player.space = next;
      if (next === 0) {
        credit(player, SALARY);
        sound.cash();
        banner(player.name + " passa dalla Banca: +" + euro(SALARY), player.hex);
      }
    }
  }

  function release(index) {
    const hotel = state.hotels[index];
    for (const space of hotel.entrances) state.entranceAt.delete(space);
    state.hotels[index] = { owner: null, stage: 0, invested: 0, entrances: [], builtAt: 0 };
  }

  // Sells the debtor's hotels to the bank at half their cost, cheapest first, until the amount is covered.
  async function liquidate(player, amount) {
    while (player.cash < amount) {
      const owned = ownedBy(player).sort((a, b) => state.hotels[a].invested - state.hotels[b].invested);
      if (!owned.length) return;
      const refund = Math.floor(state.hotels[owned[0]].invested / 2);
      banner(player.name + " vende " + HOTELS[owned[0]].name + " alla banca", player.hex);
      release(owned[0]);
      credit(player, refund);
      sound.goodbye();
      await wait(1800);
    }
  }

  async function pay(player, receiver, amount, reason) {
    await liquidate(player, amount);
    const paid = Math.min(amount, player.cash);
    credit(player, -paid);
    credit(receiver, paid);
    sound.cash();
    banner(player.name + " paga " + euro(paid) + " a " + receiver.name + " (" + reason + ")", receiver.hex);
    await wait(2200);
    if (paid === amount) return;
    player.bankrupt = true;
    sound.buzzer();
    banner(player.name + " è in bancarotta!", "#e63946");
    await wait(2400);
    const alive = state.players.filter((candidate) => !candidate.bankrupt);
    if (alive.length === 1) finish();
  }

  function lotCenter(index) {
    const lot = HOTELS[index].lot;
    return { x: lot.x + lot.width / 2, y: lot.y + lot.height / 2 };
  }

  async function glide(player, from, to) {
    player.glide = { from, to, start: performance.now(), duration: 800 };
    await wait(800);
    player.glide = null;
  }

  // The camera closes in on the hotel, the car drives in, night falls and the guest rolls for the nights.
  async function payStay(player, index) {
    const hotel = state.hotels[index];
    const owner = hotel.owner;
    const lot = HOTELS[index].lot;
    const door = { x: lot.x + lot.width / 2, y: lot.y + lot.height * 0.72 };
    board.focus(lotCenter(index), 2.1);
    banner(player.name + " è ospite: " + HOTELS[index].name, owner.hex);
    await glide(player, spacePoint(player.space), door);
    player.hidden = true;
    state.night = true;
    const status = "Siete ospiti di " + HOTELS[index].name + " (" + owner.name + "). Quante notti restate?";
    await ask(player, status, [{ id: "roll", label: "Lancia: quante notti?", kind: "primary" }]);
    if (over) return;
    const nights = await rollNumber(owner.hex);
    floatText("🌙".repeat(nights), "#fff", { x: 960, y: 330 });
    const amount = nights * HOTELS[index].rates[hotel.stage - 1];
    await pay(player, owner, amount, nights === 1 ? "1 notte" : nights + " notti");
    state.night = false;
    player.hidden = false;
    if (player.bankrupt) return;
    await glide(player, door, spacePoint(player.space));
  }

  function construct(player, index, cost) {
    const hotel = state.hotels[index];
    if (cost) credit(player, -cost);
    hotel.stage++;
    hotel.invested += cost;
    hotel.builtAt = performance.now();
    sound.build();
    const lot = HOTELS[index].lot;
    for (let i = 0; i < 26; i++) {
      state.effects.push({
        kind: "dust", x: lot.x + Math.random() * lot.width, y: lot.y + lot.height * 0.5,
        dx: (Math.random() - 0.5) * 120, dy: -40 - Math.random() * 120, start: performance.now(), duration: 900,
      });
    }
  }

  async function build(player, index, guaranteed) {
    const cost = HOTELS[index].stages[state.hotels[index].stage];
    const name = HOTELS[index].name;
    let outcome = "si";
    if (!guaranteed) {
      banner(player.name + " chiede il permesso per " + name, player.hex);
      outcome = await roll("permit", PERMIT_FACES[Math.floor(Math.random() * PERMIT_FACES.length)], player.hex);
    }
    if (outcome === "no") {
      sound.buzzer();
      banner("Permesso NEGATO!", "#e63946");
      await wait(1600);
      return;
    }
    if (outcome === "gratis") {
      construct(player, index, 0);
      banner("Lavori GRATIS a " + name + "!", "#d99a00");
      await wait(1800);
      return;
    }
    if (outcome === "doppio") {
      if (player.cash < cost * 2) {
        sound.buzzer();
        banner("Costa il doppio: troppo per " + player.name, "#f77f00");
        await wait(1800);
        return;
      }
      banner("Permesso a prezzo DOPPIO", "#f77f00");
      const answer = await ask(player, "Il permesso costa il doppio. Accettate?", [
        { id: "accept", label: "Paga " + euro(cost * 2), kind: "primary" },
        { id: "decline", label: "Rinuncia" },
      ]);
      if (answer !== "accept") return;
      construct(player, index, cost * 2);
      banner(name + " cresce!", player.hex);
      await wait(1800);
      return;
    }
    construct(player, index, cost);
    banner(name + " cresce!", player.hex);
    await wait(1800);
  }

  function freeEntranceSpace(index) {
    return HOTELS[index].spaces.find((space) => !state.entranceAt.has(space));
  }

  function addEntrance(player, index, cost) {
    const space = freeEntranceSpace(index);
    state.entranceAt.set(space, index);
    state.hotels[index].entrances.push(space);
    state.hotels[index].invested += cost;
    if (cost) credit(player, -cost);
    sound.chime();
    banner("Nuovo ingresso per " + HOTELS[index].name, player.hex);
  }

  function actionButtons(player, type, spaceUsed, entranceBought) {
    const buttons = [];
    const mine = ownedBy(player);
    const canGrow = mine.filter((index) => state.hotels[index].stage < HOTELS[index].stages.length);
    const canOpen = mine.filter((index) => state.hotels[index].stage > 0 && freeEntranceSpace(index) !== undefined);
    if (!spaceUsed && type === "buy") {
      HOTELS.forEach((hotel, index) => {
        if (state.hotels[index].owner || !hotel.spaces.includes(player.space)) return;
        buttons.push({ id: "buy:" + index, label: "Compra " + hotel.name, sub: euro(hotel.land), kind: "primary", disabled: player.cash < hotel.land });
      });
    }
    if (!spaceUsed && (type === "build" || type === "municipio")) {
      for (const index of canGrow) {
        const cost = HOTELS[index].stages[state.hotels[index].stage];
        buttons.push({ id: "build:" + index, label: "Costruisci a " + HOTELS[index].name, sub: euro(cost), kind: "primary", disabled: player.cash < cost });
      }
    }
    if (!spaceUsed && type === "free") {
      for (const index of canOpen) {
        buttons.push({ id: "free:" + index, label: "Ingresso gratis: " + HOTELS[index].name, kind: "primary" });
      }
    }
    if (!entranceBought) {
      for (const index of canOpen) {
        const cost = HOTELS[index].entrance;
        buttons.push({ id: "door:" + index, label: "Nuovo ingresso: " + HOTELS[index].name, sub: euro(cost), disabled: player.cash < cost });
      }
    }
    buttons.push({ id: "end", label: "Fine turno", kind: buttons.length ? "plain" : "primary" });
    return buttons;
  }

  // After moving (and paying): the action of the space, at most one paid entrance, then "Fine turno".
  async function actions(player, type) {
    let spaceUsed = false;
    let entranceBought = false;
    while (true) {
      const id = await ask(player, SPACE_TEXT[type], actionButtons(player, type, spaceUsed, entranceBought));
      if (over || id === "end") return;
      const [verb, number] = id.split(":");
      const index = Number(number);
      if (verb === "buy") {
        state.hotels[index].owner = player;
        state.hotels[index].invested = HOTELS[index].land;
        credit(player, -HOTELS[index].land);
        sound.cash();
        banner(player.name + " compra " + HOTELS[index].name, player.hex);
        board.focus(lotCenter(index), 1.7);
        await wait(1800);
        spaceUsed = true;
      }
      if (verb === "build") {
        board.focus(lotCenter(index), 1.9);
        await build(player, index, type === "municipio");
        spaceUsed = true;
      }
      if (verb === "free") {
        board.focus(lotCenter(index), 1.7);
        addEntrance(player, index, 0);
        await wait(1500);
        spaceUsed = true;
      }
      if (verb === "door") {
        board.focus(lotCenter(index), 1.7);
        addEntrance(player, index, HOTELS[index].entrance);
        await wait(1500);
        entranceBought = true;
      }
      if (over) return;
      board.overview();
    }
  }

  async function playTurn(player) {
    board.overview();
    note = "Tocca a " + player.name + ".";
    banner("Tocca a " + player.name, player.hex);
    await ask(player, "Tocca a voi!", [{ id: "roll", label: "Lancia il dado", kind: "primary" }]);
    if (over) return;
    const steps = await rollNumber(player.hex);
    await moveCar(player, steps);
    const type = SPACES[player.space];
    const hotelIndex = state.entranceAt.get(player.space);
    if (hotelIndex !== undefined && state.hotels[hotelIndex].owner !== player) {
      await payStay(player, hotelIndex);
      if (over || player.bankrupt) return;
    }
    if (type === "bonus") {
      credit(player, BONUS);
      sound.cash();
      banner("Turisti generosi: +" + euro(BONUS), player.hex);
    }
    board.overview();
    await actions(player, type);
  }

  function finish() {
    if (over) return;
    over = true;
    const ranking = state.players
      .map((player) => ({ player, worth: player.bankrupt ? 0 : worth(player) }))
      .sort((a, b) => b.worth - a.worth);
    state.finished = { ranking, start: performance.now() };
    state.night = false;
    board.overview();
    note = "Partita finita: ha vinto " + ranking[0].player.name + "!";
    sound.fanfare();
    if (prompt) {
      const resolve = prompt.resolve;
      prompt = null;
      resolve("abort");
    }
    refreshViews();
    setTimeout(() => {
      board.stop();
      onFinish();
    }, 14000);
  }

  async function run() {
    while (!over) {
      const player = state.players[state.current];
      if (!player.bankrupt) await playTurn(player);
      state.current = (state.current + 1) % state.players.length;
    }
  }

  // "?demo" in the address starts with every hotel owned and fully built: to look at the board while drawing it.
  if (new URLSearchParams(location.search).has("demo")) {
    state.hotels.forEach((hotel, index) => {
      hotel.owner = state.players[index % state.players.length];
      hotel.stage = HOTELS[index].stages.length;
      hotel.invested = HOTELS[index].land;
    });
  }
  banner("Benvenuti a Grand Viale!", "#14142b");
  run();
  return { onAct, viewFor, end: finish };
}
