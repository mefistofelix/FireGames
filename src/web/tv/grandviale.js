// Grand Viale: rules and turn flow. The board drawing is in grandviale-board.js.
// An original game of the "buy land, build hotels, charge the guests" family. The mechanics follow the
// classic rules of that family (see "Grand Viale rules" in AGENTS.md); board, hotels and prices are our own.
//
// The turn is written as straight async code: ask() shows buttons on one phone and resolves with the
// button the team pressed; the animations are awaited with wait().

import { euro } from "../shared/config.js";
import * as sound from "../shared/sound.js";
import { chipCenter, createBoard, nearestSpaces, spacePoint } from "./grandviale-board.js";

const START_CASH = 12000;
const SALARY = 2000;
const HOP_MS = 260;
const AUCTION_STEP = 500;
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
// the others are buildings. rates: price of one night with that many pieces. center/size: the lot on the board.
// reach: how many of the nearest spaces the hotel is "next to" (where it can be bought and where its entrances go).
// style, tall (height of its buildings) and models (one 3D model per building, null: made of plain solids)
// say how the board draws it.
const HOTEL_LIST = [
  { name: "Locanda del Faro", accent: "#e76f51", style: "lighthouse", models: [null, "city/building-c", "town/building-type-c"], tall: 110, land: 1000, stages: [1200, 1000, 800, 700],
    entrance: 150, rates: [100, 200, 350, 500], center: [500, 952], size: [310, 124], reach: 3 },
  { name: "Pensione Girasole", accent: "#e9c46a", style: "flat", models: ["city/building-a", "city/building-b", "city/building-d"], tall: 105, land: 1200, stages: [1500, 1200, 1000, 800],
    entrance: 150, rates: [120, 250, 400, 550], center: [1400, 952], size: [310, 124], reach: 3 },
  { name: "Villa Ortensia", accent: "#b388eb", style: "dome", models: ["city/building-e", "city/building-f", "city/building-g"], tall: 120, land: 1800, stages: [2200, 1800, 1500, 1200],
    entrance: 200, rates: [200, 400, 650, 850], center: [915, 245], size: [230, 150], reach: 3 },
  { name: "Albergo Tre Pini", accent: "#52b788", style: "pitched", models: ["town/building-type-a", "town/building-type-b", "town/building-type-d", "town/building-type-e"], tall: 125, land: 2000, stages: [2500, 2000, 1800, 1500, 1500],
    entrance: 200, rates: [200, 400, 600, 900, 1150], center: [1715, 165], size: [280, 140], reach: 3 },
  { name: "Rifugio Stella Alpina", accent: "#a47148", style: "chalet", models: ["town/building-type-f", "town/building-type-n", "town/building-type-t"], tall: 115, land: 2500, stages: [3000, 2500, 2000, 1800],
    entrance: 250, rates: [300, 600, 950, 1250], center: [200, 180], size: [260, 140], reach: 3 },
  { name: "Palazzo Belvedere", accent: "#f4a261", style: "palace", models: ["city/building-h", "city/building-i", "city/building-k", "city/building-l"], tall: 135, land: 3000, stages: [3500, 3000, 2500, 2500, 2000],
    entrance: 300, rates: [350, 650, 1000, 1400, 1750], center: [935, 655], size: [270, 140], reach: 3 },
  { name: "Grand Hotel Aurora", accent: "#ff8fab", style: "dome", models: ["city/building-m", "city/building-j", "city/building-n", "city/building-skyscraper-e"], tall: 175, land: 3500, stages: [4000, 3500, 3000, 3000, 2500],
    entrance: 300, rates: [400, 800, 1200, 1700, 2100], center: [520, 560], size: [300, 230], reach: 4 },
  { name: "Torre Zaffiro", accent: "#4895ef", style: "tower", models: ["city/building-skyscraper-a", "city/building-skyscraper-b", "city/building-skyscraper-c", "city/building-skyscraper-d"], tall: 270, land: 4000, stages: [5000, 4000, 4000, 3500, 3000],
    entrance: 350, rates: [500, 950, 1500, 2200, 2700], center: [1330, 560], size: [320, 240], reach: 4 },
];

const HOTELS = HOTEL_LIST.map((hotel) => ({
  ...hotel,
  buildings: hotel.stages.length - 1,
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
// canvas takes the flat panels, worldCanvas (under it) the 3D scene. send(peerId, body) delivers a view to a phone. onPrompt(prompt) tells the TV which question is waiting
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
  const board = createBoard(worldCanvas, canvas, state, HOTELS, SPACES);
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

  // A whole hotel is sold to the other teams, starting from the price of its land. The teams bid in turn
  // until one is left; with no bid the bank pays the starting price and the hotel is cleared.
  async function auction(seller, index) {
    const name = HOTELS[index].name;
    let price = HOTELS[index].land;
    let leader = null;
    let bidders = alive().filter((player) => player !== seller);
    board.focus(lotCenter(index), 1.7);
    banner("All'asta: " + name + " di " + seller.name, "#9b5de5");
    await wait(2200);
    while (bidders.length > 0 && !(bidders.length === 1 && bidders[0] === leader)) {
      for (const bidder of bidders.slice()) {
        if (bidder === leader) continue;
        const offer = leader ? price + AUCTION_STEP : price;
        let answer = "pass";
        if (bidder.cash >= offer) {
          const status = "Asta: " + name + " (" + describe(index) + "). " +
            (leader ? leader.name + " offre " + euro(price) + "." : "Base d'asta " + euro(price) + ".");
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
      banner("Nessuna offerta: " + name + " torna alla banca", "#14142b");
      const refund = HOTELS[index].land;
      release(index);
      credit(seller, refund);
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
  async function liquidate(player, amount) {
    while (player.cash < amount && !over) {
      const owned = ownedBy(player).sort((a, b) => state.hotels[a].invested - state.hotels[b].invested);
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
    const lot = HOTELS[index].lot;
    const door = { x: lot.x + lot.width / 2, y: lot.y + lot.height * 0.72 };
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

  // How many pieces to ask the permit for: buildings may be put up several at a time, the leisure area
  // only alone and only when every building is there.
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
      if (player.cash < cost * 2) {
        sound.buzzer();
        banner("Costa il doppio: troppo per " + player.name, "#f77f00");
        await wait(1800);
        return;
      }
      banner("Permesso a prezzo DOPPIO", "#f77f00");
      const answer = await ask(player, "Il permesso costa il doppio. Accettate?", [
        { id: "accept", label: "Paga", sub: euro(cost * 2), kind: "primary" },
        { id: "decline", label: "Rinuncia" },
      ]);
      if (answer !== "accept") return;
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
      for (const index of canGrow) {
        const stage = state.hotels[index].stage;
        const cost = HOTELS[index].stages[stage];
        const label = stage === HOTELS[index].buildings ? "Area relax a " : "Costruisci a ";
        buttons.push({ id: "build:" + index, label: label + HOTELS[index].name, sub: "da " + euro(cost), kind: "primary", disabled: player.cash < cost });
      }
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
      board.focus(lotCenter(index), verb === "build" || verb === "gift" ? 1.9 : 1.7);
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
