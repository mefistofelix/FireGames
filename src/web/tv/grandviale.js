// Grand Viale: rules and turn flow. The board drawing is in grandviale-board.js.
// An original game of the "buy land, build hotels, charge the guests" family. The mechanics follow the
// classic rules of that family (see "Grand Viale rules" in AGENTS.md); board, hotels and prices are our own.
//
// The turn is written as straight async code: ask() shows buttons on one phone and resolves with the
// button the team pressed; the animations are awaited with wait().

import { euro } from "../shared/config.js";
import * as sound from "../shared/sound.js";
import { chipCenter, createBoard, lotDoor, nearestSpaces, spacePoint } from "./grandviale-board.js";

const START_CASH = 12000;
const SALARY = 2000;
const HOP_MS = 260;
const AUCTION_STEP = 500;
const HOTEL_REACH = 3; // a lot is as long as three spaces of the avenue
const BANK_SPACE = 0;
const MUNICIPIO_SPACE = 14;
const PERMIT_FACES = ["si", "si", "si", "no", "gratis", "doppio"];

// What a team may do on each of the 28 spaces of the avenue.
const SPACES = [
  "bank", "buy", "build", "buy", "build", "free", "buy", "build", "buy", "build", "gift", "buy", "build", "buy",
  "municipio", "buy", "build", "buy", "build", "free", "buy", "build", "buy", "build", "gift", "buy", "build", "buy",
];

const SPACE_TEXT = {
  bank: "Banca.",
  buy: "Casella Acquisti: potete comprare un terreno qui accanto.",
  build: "Casella Cantiere: chiedete il permesso per costruire.",
  free: "Casella Ingresso: un ingresso gratis per un vostro hotel.",
  municipio: "Municipio.",
  gift: "Casella Regalo: un pezzo di hotel gratis.",
};

// land: price of the lot. stages: cost of each piece in building order; the last one is the leisure area,
// the others are buildings. rates: price of one night with that many pieces. corner: where the lot is on the
// board (all lots are LOT wide); the pictures are drawn by src/art/pixelart.py, which lists the hotels in this
// same order with the same corners and the same number of pieces.
// A hotel is "next to" the HOTEL_REACH spaces nearest to its lot: there it can be bought and has its entrances.
// Number of buildings, land, building and entrance prices follow the eight title deeds of the classic rules,
// from the one-building guest house to the big ones; names, places and night rates are ours.
const LOT = 44;
const HOTEL_LIST = [
  { name: "Pensione Girasole", accent: "#e9c46a", land: 500, stages: [1800, 250], entrance: 100, rates: [100, 150], corner: [91, 126] },
  { name: "Locanda del Faro", accent: "#e76f51", land: 1000, stages: [2200, 1400, 1400, 500], entrance: 100, rates: [100, 200, 300, 400], corner: [44, 126] },
  { name: "Albergo Tre Pini", accent: "#52b788", land: 1500, stages: [2400, 1000, 500, 1000], entrance: 100, rates: [100, 250, 350, 450], corner: [138, 126] },
  { name: "Rifugio Stella Alpina", accent: "#a47148", land: 2000, stages: [2600, 1200, 1200, 2000], entrance: 150, rates: [150, 300, 400, 550], corner: [44, 0] },
  { name: "Villa Ortensia", accent: "#b388eb", land: 2500, stages: [3600, 2600, 1800, 1800, 3000], entrance: 200, rates: [150, 350, 500, 650, 800], corner: [182, 63] },
  { name: "Grand Hotel Aurora", accent: "#ff8fab", land: 2500, stages: [3500, 2500, 2500, 1750, 1750, 2500], entrance: 200, rates: [150, 350, 500, 650, 800, 1000], corner: [0, 63] },
  { name: "Palazzo Belvedere", accent: "#f4a261", land: 3000, stages: [3300, 2200, 1800, 1800, 1800, 4000], entrance: 250, rates: [200, 350, 550, 750, 950, 1100], corner: [138, 0] },
  { name: "Torre Zaffiro", accent: "#4895ef", land: 3500, stages: [5000, 3000, 2250, 1750, 5000], entrance: 250, rates: [200, 400, 600, 850, 1050], corner: [91, 0] },
];

const HOTELS = HOTEL_LIST.map((hotel) => ({
  ...hotel,
  buildings: hotel.stages.length - 1,
  lot: { x: hotel.corner[0], y: hotel.corner[1], width: LOT, height: LOT },
  spaces: nearestSpaces({ x: hotel.corner[0] + LOT / 2, y: hotel.corner[1] + LOT / 2 }, HOTEL_REACH),
}));

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

// seats: [{peerId, name, hex}] in turn order; the first one may end the game early.
// canvas takes the flat panels, worldCanvas (under it) the board. send(peerId, body) delivers a view to a phone. onPrompt(prompt) tells the TV which question is waiting
// ({player, status, buttons} or null) so the remote can answer it. onFinish() is called after the final ranking.
export function startGrandViale({ canvas, worldCanvas, seats, send, onPrompt, onFinish }) {
  const state = {
    players: seats.map((seat) => ({ ...seat, cash: START_CASH, shownCash: START_CASH, space: 0, move: null, bankrupt: false })),
    hotels: HOTELS.map(() => ({ owner: null, stage: 0, invested: 0, entrances: [], builtAt: 0 })),
    entranceAt: new Map(), // space -> hotel index
    current: 0,
    die: { visible: false },
    tray: { number: null, permit: null }, // last result of the two dice, shown in a corner
    banner: { text: "", until: 0 },
    effects: [], // amounts floating on the panels: {text, hex, x, y, start, duration}
    finished: null,
  };
  const board = createBoard(worldCanvas, canvas, state, HOTELS);
  let prompt = null; // {peerId, player, status, buttons, resolve}: the question waiting on a phone
  let note = "";
  let over = false;
  let endArmed = false;

  function banner(text, hex) {
    state.banner = { text, hex: hex || "#14142b", start: performance.now(), until: performance.now() + 2600 };
  }

  function floatText(text, hex, point) {
    state.effects.push({ text, hex, x: point.x, y: point.y, start: performance.now(), duration: 1600 });
  }

  function credit(player, amount) {
    player.cash += amount;
    const sign = amount >= 0 ? "+" : "−";
    const chip = chipCenter(state.players.indexOf(player), state.players.length);
    floatText(sign + euro(Math.abs(amount)), amount >= 0 ? "#7CFC9A" : "#ff8a8a", { x: chip.x, y: chip.y + 70 });
    refreshViews();
  }

  function alive() {
    return state.players.filter((player) => !player.bankrupt);
  }

  function ownedBy(player) {
    return state.hotels.map((hotel, index) => index).filter((index) => state.hotels[index].owner === player);
  }

  function worth(player) {
    return player.cash + ownedBy(player).reduce((sum, index) => sum + state.hotels[index].invested, 0);
  }

  function describe(index) {
    const hotel = state.hotels[index];
    const pieces = Math.min(hotel.stage, HOTELS[index].buildings) + " edifici";
    const leisure = hotel.stage > HOTELS[index].buildings ? " + area relax" : "";
    const rate = hotel.stage ? "notte " + euro(HOTELS[index].rates[hotel.stage - 1]) : "nessun incasso";
    return pieces + leisure + " · " + hotel.entrances.length + " ingressi · " + rate;
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
    const cards = ownedBy(player).map((index) => ({ title: HOTELS[index].name, text: describe(index), hex: HOTELS[index].accent }));
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

  // The camera stays with the team in turn: its car and the lots around it.
  function showPlayer(player) {
    board.focus(spacePoint(player.space), 1.5);
  }

  // The game has two dice: the numbered one (moves and nights) and the permit one (building permission).
  // The camera pulls back to the whole board for the throw; the caller brings it back where the action is.
  async function roll(kind, result, hex) {
    board.overview();
    await wait(700);
    const faces = kind === "number" ? [1, 2, 3, 4, 5, 6] : ["si", "no", "gratis", "doppio"];
    state.die = { visible: true, kind, faces, face: result, rolling: true, hex, startedAt: performance.now() };
    sound.dice();
    await wait(1200);
    state.die.rolling = false;
    state.die.stoppedAt = performance.now();
    state.tray[kind === "number" ? "number" : "permit"] = result;
    sound.tick();
    await wait(1100);
    state.die.visible = false;
    return result;
  }

  function rollNumber(hex) {
    return roll("number", 1 + Math.floor(Math.random() * 6), hex);
  }

  function occupiedByOther(player) {
    return state.players.some((other) => other !== player && !other.bankrupt && other.space === player.space);
  }

  // Moves the car; two cars never share a space, so it goes on to the next free one.
  // Returns true when the car reached or passed the Municipio, which gives the right to buy entrances.
  async function moveCar(player, steps) {
    let passedMunicipio = false;
    let remaining = steps;
    while (remaining > 0 || occupiedByOther(player)) {
      remaining--;
      const next = (player.space + 1) % SPACES.length;
      board.focus(spacePoint(next), 1.7);
      player.move = { from: player.space, start: performance.now(), duration: HOP_MS };
      sound.step();
      await wait(HOP_MS);
      player.move = null;
      player.space = next;
      if (next === MUNICIPIO_SPACE) passedMunicipio = true;
      if (next !== BANK_SPACE) continue;
      // with three or four teams, the bank stops paying once only two are left
      const bankPays = seats.length === 2 || alive().length > 2;
      if (!bankPays) continue;
      credit(player, SALARY);
      sound.cash();
      banner(player.name + " passa dalla Banca: +" + euro(SALARY), player.hex);
    }
    return passedMunicipio;
  }

  function release(index) {
    const hotel = state.hotels[index];
    for (const space of hotel.entrances) state.entranceAt.delete(space);
    state.hotels[index] = { owner: null, stage: 0, invested: 0, entrances: [], builtAt: 0 };
  }

  function lotCenter(index) {
    const lot = HOTELS[index].lot;
    return { x: lot.x + lot.width / 2, y: lot.y + lot.height / 2 };
  }

  // A whole hotel is sold to the other teams: no starting price, the teams bid in turn until one is left.
  // With no bid the hotel is pulled down and its land is free again; the seller gets nothing.
  async function auction(seller, index) {
    const name = HOTELS[index].name;
    let price = 0;
    let leader = null;
    let bidders = alive().filter((player) => player !== seller);
    board.focus(lotCenter(index), 1.7);
    banner("All'asta: " + name + " di " + seller.name, "#9b5de5");
    await wait(2200);
    while (bidders.length > 0 && !(bidders.length === 1 && bidders[0] === leader)) {
      for (const bidder of bidders.slice()) {
        if (bidder === leader) continue;
        const offer = price + AUCTION_STEP;
        let answer = "pass";
        if (bidder.cash >= offer) {
          const status = "Asta: " + name + " (" + describe(index) + "). " +
            (leader ? leader.name + " offre " + euro(price) + "." : "Nessuna offerta finora.");
          answer = await ask(bidder, status, [
            { id: "bid", label: "Offri", sub: euro(offer), kind: "primary" },
            { id: "pass", label: "Passo" },
          ]);
          if (over) return;
        }
        if (answer !== "bid") {
          bidders = bidders.filter((player) => player !== bidder);
          continue;
        }
        leader = bidder;
        price = offer;
        sound.tick();
        banner(bidder.name + " offre " + euro(price), bidder.hex);
      }
    }
    if (!leader) {
      banner("Nessuna offerta: " + name + " viene demolito", "#14142b");
      release(index);
      refreshViews();
      await wait(2000);
      return;
    }
    state.hotels[index].owner = leader;
    credit(leader, -price);
    credit(seller, price);
    sound.cash();
    banner(leader.name + " si aggiudica " + name + " per " + euro(price), leader.hex);
    await wait(2400);
  }

  // A team that cannot pay puts its hotels up for auction, cheapest first, until the amount is covered.
  // keep: a hotel that is not sold (the one the money is needed for).
  async function liquidate(player, amount, keep) {
    while (player.cash < amount && !over) {
      const owned = ownedBy(player).filter((index) => index !== keep).sort((a, b) => state.hotels[a].invested - state.hotels[b].invested);
      if (!owned.length) return;
      await auction(player, owned[0]);
    }
  }

  async function pay(player, receiver, amount, reason) {
    await liquidate(player, amount);
    if (over) return;
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
    if (alive().length === 1) finish();
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
    const door = lotDoor(HOTELS[index].lot, player.space);
    board.focus(lotCenter(index), 2.1);
    banner(player.name + " è ospite: " + HOTELS[index].name, owner.hex);
    player.door = door;
    await glide(player, spacePoint(player.space), door);
    player.hidden = true;
    state.night = true;
    const status = "Siete ospiti di " + HOTELS[index].name + " (" + owner.name + "). Quante notti restate?";
    await ask(player, status, [{ id: "roll", label: "Lancia: quante notti?", kind: "primary" }]);
    if (over) return;
    const nights = await rollNumber(owner.hex);
    board.focus(lotCenter(index), 2.1);
    floatText("🌙".repeat(nights), "#fff", { x: 960, y: 330 });
    const amount = nights * HOTELS[index].rates[hotel.stage - 1];
    await pay(player, owner, amount, nights === 1 ? "1 notte" : nights + " notti");
    state.night = false;
    player.hidden = false;
    if (!player.bankrupt && !over) await glide(player, door, spacePoint(player.space));
    player.door = null;
  }

  function pieceName(index, stage) {
    return stage === HOTELS[index].buildings ? "l'area relax" : "l'edificio " + (stage + 1);
  }

  // Adds the next pieces of a hotel, one after the other, for a total price.
  async function construct(player, index, count, cost) {
    const hotel = state.hotels[index];
    if (cost) credit(player, -cost);
    hotel.invested += cost;
    for (let piece = 0; piece < count; piece++) {
      hotel.stage++;
      hotel.builtAt = performance.now();
      sound.build();
      await wait(1300);
    }
  }

  function stagesCost(index, count) {
    const from = state.hotels[index].stage;
    return HOTELS[index].stages.slice(from, from + count).reduce((sum, cost) => sum + cost, 0);
  }

  // How many buildings to ask the permit for: several may be put up at a time, in order.
  async function chooseAmount(player, index) {
    const hotel = state.hotels[index];
    const missingBuildings = HOTELS[index].buildings - hotel.stage;
    if (missingBuildings <= 1) return 1;
    const buttons = [];
    for (let count = 1; count <= missingBuildings; count++) {
      const cost = stagesCost(index, count);
      buttons.push({
        id: String(count), label: count === 1 ? "1 edificio" : count + " edifici", sub: euro(cost),
        kind: count === 1 ? "primary" : "plain", disabled: player.cash < cost,
      });
    }
    const answer = await ask(player, "Quanti edifici volete costruire a " + HOTELS[index].name + "?", buttons);
    return Number(answer) || 1;
  }

  async function build(player, index) {
    const count = await chooseAmount(player, index);
    if (over) return;
    const cost = stagesCost(index, count);
    const name = HOTELS[index].name;
    banner(player.name + " chiede il permesso per " + name, player.hex);
    const outcome = await roll("permit", PERMIT_FACES[Math.floor(Math.random() * PERMIT_FACES.length)], player.hex);
    board.focus(lotCenter(index), 1.9);
    if (outcome === "no") {
      sound.buzzer();
      banner("Permesso NEGATO!", "#e63946");
      await wait(1600);
      return;
    }
    if (outcome === "gratis") {
      banner("Lavori GRATIS a " + name + "!", "#d99a00");
      await construct(player, index, count, 0);
      return;
    }
    if (outcome === "doppio") {
      // a granted permit must be used: a team short of money has to auction other hotels to pay
      banner("Permesso a prezzo DOPPIO: " + euro(cost * 2), "#f77f00");
      await wait(1800);
      await liquidate(player, cost * 2, index);
      if (over) return;
      if (player.cash < cost * 2) {
        sound.buzzer();
        banner(player.name + " non riesce a pagare: niente lavori", "#f77f00");
        await wait(1800);
        return;
      }
      banner(name + " cresce!", player.hex);
      await construct(player, index, count, cost * 2);
      return;
    }
    banner(name + " cresce!", player.hex);
    await construct(player, index, count, cost);
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

  function actionButtons(player, type, turn) {
    const buttons = [];
    const mine = ownedBy(player);
    const canGrow = mine.filter((index) => state.hotels[index].stage < HOTELS[index].stages.length);
    const canBuild = mine.filter((index) => state.hotels[index].stage < HOTELS[index].buildings);
    const canEquip = mine.filter((index) => state.hotels[index].stage === HOTELS[index].buildings);
    const canOpen = mine.filter((index) => state.hotels[index].stage > 0 && freeEntranceSpace(index) !== undefined);
    if (!turn.spaceUsed && type === "buy") {
      HOTELS.forEach((hotel, index) => {
        const status = state.hotels[index];
        if (!hotel.spaces.includes(player.space) || status.owner === player) return;
        if (!status.owner) {
          buttons.push({ id: "buy:" + index, label: "Compra " + hotel.name, sub: euro(hotel.land), kind: "primary", disabled: player.cash < hotel.land });
        } else if (status.stage === 0) {
          const price = hotel.land / 2;
          buttons.push({ id: "take:" + index, label: "Espropria " + hotel.name + " a " + status.owner.name, sub: euro(price), disabled: player.cash < price });
        }
      });
    }
    if (!turn.spaceUsed && type === "build") {
      for (const index of canBuild) {
        const cost = HOTELS[index].stages[state.hotels[index].stage];
        buttons.push({ id: "build:" + index, label: "Costruisci a " + HOTELS[index].name, sub: "da " + euro(cost), kind: "primary", disabled: player.cash < cost });
      }
    }
    // the leisure area of a finished hotel needs no permit and no special space: it is just paid for
    for (const index of canEquip) {
      const cost = HOTELS[index].stages[HOTELS[index].buildings];
      buttons.push({ id: "relax:" + index, label: "Area relax a " + HOTELS[index].name, sub: euro(cost), disabled: player.cash < cost });
    }
    if (!turn.spaceUsed && type === "gift") {
      for (const index of canGrow) {
        buttons.push({ id: "gift:" + index, label: "Gratis: " + pieceName(index, state.hotels[index].stage) + " di " + HOTELS[index].name, kind: "primary" });
      }
    }
    if (!turn.spaceUsed && type === "free") {
      for (const index of canOpen) {
        buttons.push({ id: "free:" + index, label: "Ingresso gratis: " + HOTELS[index].name, kind: "primary" });
      }
    }
    if (turn.entranceRight) {
      for (const index of canOpen) {
        if (turn.entrancesBought.includes(index)) continue;
        const cost = HOTELS[index].entrance;
        buttons.push({ id: "door:" + index, label: "Nuovo ingresso: " + HOTELS[index].name, sub: euro(cost), disabled: player.cash < cost });
      }
    }
    buttons.push({ id: "end", label: "Fine turno", kind: buttons.length ? "plain" : "primary" });
    return buttons;
  }

  // After moving (and paying): the action of the space, the entrances earned by passing the Municipio
  // (one for each hotel), then "Fine turno".
  async function actions(player, type, entranceRight) {
    const turn = { spaceUsed: false, entranceRight, entrancesBought: [] };
    while (true) {
      const status = SPACE_TEXT[type] + (entranceRight ? " Siete passati dal Municipio: potete aprire un ingresso per ogni hotel." : "");
      const id = await ask(player, status, actionButtons(player, type, turn));
      if (over || id === "end") return;
      const [verb, number] = id.split(":");
      const index = Number(number);
      board.focus(lotCenter(index), 1.7);
      if (verb === "buy" || verb === "take") {
        const previous = state.hotels[index].owner;
        const price = verb === "buy" ? HOTELS[index].land : HOTELS[index].land / 2;
        state.hotels[index].owner = player;
        state.hotels[index].invested = price;
        credit(player, -price);
        if (previous) credit(previous, price);
        sound.cash();
        banner(player.name + (previous ? " espropria " : " compra ") + HOTELS[index].name, player.hex);
        await wait(1800);
        turn.spaceUsed = true;
      }
      if (verb === "build") {
        await build(player, index);
        turn.spaceUsed = true;
      }
      if (verb === "relax") {
        banner("Area relax per " + HOTELS[index].name + "!", player.hex);
        await construct(player, index, 1, HOTELS[index].stages[HOTELS[index].buildings]);
      }
      if (verb === "gift") {
        banner("Regalo per " + HOTELS[index].name + "!", "#ff6fb5");
        await construct(player, index, 1, 0);
        turn.spaceUsed = true;
      }
      if (verb === "free") {
        addEntrance(player, index, 0);
        await wait(1500);
        turn.spaceUsed = true;
      }
      if (verb === "door") {
        addEntrance(player, index, HOTELS[index].entrance);
        await wait(1500);
        turn.entrancesBought.push(index);
      }
      if (over) return;
      showPlayer(player);
    }
  }

  // One team's turn; a six on the numbered die gives another throw.
  async function playTurn(player) {
    let again = true;
    while (again && !over && !player.bankrupt) {
      showPlayer(player);
      note = "Tocca a " + player.name + ".";
      banner("Tocca a " + player.name, player.hex);
      await ask(player, "Tocca a voi!", [{ id: "roll", label: "Lancia il dado", kind: "primary" }]);
      if (over) return;
      const steps = await rollNumber(player.hex);
      const entranceRight = await moveCar(player, steps);
      const type = SPACES[player.space];
      const hotelIndex = state.entranceAt.get(player.space);
      if (hotelIndex !== undefined && state.hotels[hotelIndex].owner !== player) {
        await payStay(player, hotelIndex);
        if (over || player.bankrupt) return;
      }
      showPlayer(player);
      await actions(player, type, entranceRight);
      again = steps === 6;
      if (again && !over) {
        banner("Sei! " + player.name + " tira ancora", player.hex);
        await wait(1500);
      }
    }
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
