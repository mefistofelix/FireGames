# Fire Games — agent notes

Party board games for Fire TV: the TV is the board, every team uses one phone as controller. Three games are
planned (see "Games"). UI strings Italian, code and this file English, user docs `README.md` (Italian).
Keep both files aligned with every accepted change, in the same commit.

## How it works

- The games are played **on the LAN, in front of the TV**. No internet service is involved in play (decision of
  the owner); internet is used only by the self-update.
- The Fire TV app (package `com.mefistofelix.firegames`, launcher name "Fire Games") is a thin Kotlin shell:
  `LanServer` (HTTP + WebSocket on port 8080, hand written, no libraries) and a full-screen WebView that loads
  `http://127.0.0.1:8080/tv/index.html` from it.
- Everything visible is web (`src/web`, plain ES modules, **no build step, no npm, no third-party code**), packed
  into the APK as assets. The pictures of the boards are pixel art drawn by a script (see "Graphics"). The TV page draws the game; the phones open `http://<tv-ip>:8080/` (QR code on the TV),
  which redirects to `/pad/`. One web codebase covers Android and iOS phones.
- **The TV page owns all the game state.** Phones send requests, the TV validates them and sends each phone what
  it must show. Turns and choices are always explicit actions on the phone (roll, buy, attack...); the TV shows
  the result with animation and sound.
- `LanServer` knows nothing about games: it forwards JSON envelopes `{from, to, body}` between WebSocket clients
  by id. The TV page is id `tv` (accepted only from loopback); a phone's id is a random string kept in its
  `localStorage`, so a phone that reloads or reconnects takes its seat back.

## Code map

- `src/web/shared/link.js` — `openHost` / `openGuest`: the only place that knows the transport. WebSocket to
  `LanServer`, or BroadcastChannel when the pages are opened from `localhost` (development, see below).
- `src/web/shared/config.js` — team colours, game list, timings, `serverInfo()` / `padUrl()`.
- `src/web/shared/qr.js` — QR encoder (byte mode, level M, versions 1-6, up to 106 bytes).
- `src/web/shared/sound.js` — sound effects synthesized with Web Audio (no audio files).
- `src/web/tv/` — TV page: `tv.js` lobby logic (seats, leader, game choice, teams added with the remote) and host
  of the running game (routes phone messages, shows the remote menu), `scene.js` animated lobby backdrop
  (sky, clouds, birds, pond, traffic; every player is a car on the road), `tv.css` sized in `vh`.
- `src/web/tv/grandviale.js` — Grand Viale rules and turn flow, written as straight async code: `ask(player,
  status, buttons)` resolves with the pressed button, animations are awaited. The board is drawn by
  `grandviale-board.js` and the modules under it (see "Graphics").
- `src/art/pixelart.py` — draws the pictures of the board (not part of the app; its output is committed).
- `src/web/pad/` — phone page: join form (team name, colour), lobby pad (horn, drag the car, game choice for the
  leader), game screen that renders the "view" sent by the TV. `?player=2` gives a tab its own identity (dev).
- `src/android/java/.../LanServer.kt` — static files from assets (`Cache-Control: no-cache`), `/info`
  (`{ip, port, version}`), `/ws?id=`; sends `{t:"bye"}` to the TV when a phone's socket closes.
- `MainActivity.kt` — WebView, keep-screen-on, update dialog. `Updater.kt` / `Relauncher.kt` — self-update.
- `build.gradle.kts` — the Android app is the root Gradle project; sources `src/android`, assets `src/web`,
  outputs under `build/`.

## Lobby protocol (bodies)

Phone → TV: `{t:"peek"}` (ask the lobby state before joining), `{t:"hello", name, color}`, `{t:"ping"}` every
2 s, `{t:"tilt", x}` (-1..1, how far the car is dragged, sent on change at most 15 Hz), `{t:"honk"}`, and from the leader (first seated
player) `{t:"pick", step}` and `{t:"start"}`.
TV → phone: `{t:"lobby", taken, you, game}` (`you` is null until seated), `{t:"pong"}`.
In the lobby a phone silent for 6 s is dropped; a phone that hears nothing for 6 s shows "Cerco la TV…".

## Game protocol (all games)

The phone is a dumb terminal: the TV sends each team a view and the phone sends back the pressed button.
TV → phone: `{t:"view", name, hex, money, turn, status, buttons:[{id, label, sub, kind, disabled}], cards:[{title,
text, hex}]}` (`kind`: `primary`, `plain`, `danger`, `quiet`; `turn` true makes the phone vibrate once).
Phone → TV: `{t:"act", id}`. `peek` / `hello` during a game are answered with the current view, so a phone
that reloads or wakes up is back in its seat; seats are never dropped while a game runs.
A game module exports `start...({canvas, seats, send, onPrompt, onFinish})` and returns `{onAct, viewFor, end}`.

## Remote-only play

Every question can also be answered on the TV: `onPrompt` gives `tv.js` the waiting question and it shows a menu
(▲ ▼ OK). The menu opens by itself for teams without a phone (added in the lobby with ▲, removed with ▼, ids
`remote-N`) and at the first key press for the others, so one remote can be passed around. **Starting a game never
blocks on missing teams**: with fewer than two, the TV asks "Quante squadre giocano?" (2-4) and adds the missing
ones as teams without a phone. Nobody needs a phone to play. Back during a game
asks to press again, then ends the game (`window.onTvBack`, called by `MainActivity.onBackPressed`).

## Graphics

Decision of the owner (2026-11-23): **isometric pixel art**, for the whole project, after a 3D attempt with
Three.js (removed: no vendored library is left). It is also much lighter for the TV. What the owner asked before
still holds and is to be followed in all three games:

- **A board game that came alive**: a board on a table, printed spaces, pieces standing on it; but the hotels,
  cars and people look like a small real world. The guest gets out of the car and walks in, a hotel is built by a
  crane, the dice are thrown on the board.
- **Each game has its own visual style**, lighting and setting. The game-choice screen should become a
  **triptych** of three panels, each showing its game's real board, animated (not done: the lobby is still the
  2D scene of `scene.js`).
- **Detail**: every hotel is a recognisable complex with its own equipment (pools, tennis courts, roof terraces,
  gardens...), every area of the map has its own character. Low detail reads as ugly: keep adding.
- **Camera**: the whole board does not have to be visible. The camera stays with the team in turn, moves at an
  unhurried pace, closes in on the events and pulls back to the whole board for the dice.
- **Sound**: realistic ambience mixed with music and event sounds. Today there are only short synthesized effects
  (`shared/sound.js`); ambience and music are to do (free-licence audio files are allowed, see Conventions).
- **How close to the classic games**: the owner wants them as close as possible. The line kept here: rules, number
  of pieces and price scale follow the classic games; board layout, hotels, map, names and every picture are
  our own (same richness, not a copy of the printed board or of its eight hotels).

How it is made:

- `src/art/pixelart.py` draws every picture. Each object is a small voxel model written in Python (boxes,
  cylinders, roofs, windows...), drawn with three shaded faces per voxel in 2:1 isometric projection, with a dark
  outline. Run `uv run --no-project --with pillow python -I src/art/pixelart.py` from the repository root: it
  rewrites `src/web/assets/grandviale/pixel` (about 150 PNG files, 0.6 MB, **committed**: the build does not run
  the script) and `build/preview/board.png` (the whole board with every hotel complete, to look at while drawing).
  Pillow is used only by this script on the dev PC, it is not part of the app.
- Board units are the voxels: x grows to the lower right of the screen, y to the lower left, z up; a voxel at
  (x, y, z) is drawn at pixel ((x - y) * 2, x + y - 2 * z). The avenue (4 corners, 28 spaces every 14 units) and the
  corners of the eight lots (44 x 44 units) are written **twice**, in `pixelart.py` (`CORNERS`, `HOTELS`) and in
  the game (`grandviale-path.js`, `HOTEL_LIST` in `grandviale.js`), in the same order: change them together.
- Pictures: `ground.png` (table slab, meadow, sea corner, mountains, car park, lake, avenue with the 28 printed
  spaces); for each hotel one picture per number of pieces built (`hotel-<index>-<pieces>.png`, all with the same
  frame) and the same with a crane (`...-crane.png`); bank, town hall, lamps, plants; cars (one model per team
  colour of `config.js`, four directions), guests, entrance canopy, the six faces of the die and the four of the
  permit die. A hotel model is a function of the number of pieces, written for a lot on the far side of the
  avenue and turned for the other three sides (`turn_left`, `turn_right`, `turn_front`), so that the gate always
  faces the avenue.
- `board.json` holds the origin of the ground picture, where each static picture goes and its footprint, in
  **drawing order** (worked out by the script: a thing is drawn before what lies in front of it), and for the
  moving pictures the offset from the point they stand on.
- `grandviale-world.js` draws the board on a **960x540 canvas scaled up by the page with hard pixels**
  (`image-rendering: pixelated`): ground, the owners' colours (outline of the lots and of the spaces with an
  entrance), then the static pictures in order with cars and guests slipped in at their depth (`placeInOrder`),
  a pointer in the team's colour over each car (seen even behind a building), night (dark veil and lamp glow) and
  the die. It only reads the game state; the game moves the camera with `focus(point, zoom)` (scale 2, or 3 from
  zoom 2 up) and `overview()` (scale 1).
- Building: while a piece is new (`builtAt`, 1.3 s) the crane picture of the previous stage is drawn and the new
  one is revealed from the ground up.
- Stay: the game's `door` + `glide` + `hidden` + `night` become: the car pulls over, the guest walks to the gate
  of the lot (`lotDoor`) and goes in, night falls.
- `grandviale-hud.js` draws the flat panels on a transparent canvas over the board (1920x1080 space): the names
  of the hotels (with the land price while free, in the owner's colour afterwards; the world gives their places
  with `labels()`), team chips, banner, dice tray, floating amounts, final ranking. `grandviale-board.js` joins
  world and panels in one animation loop and logs the frame rate every 5 s (`adb logcat -s FireGames`).
- A hotel is "next to" the three spaces nearest to its lot (`nearestSpaces`): there it is bought and has its
  entrances. Moving a lot or the avenue changes that: check that every hotel still has an Acquisti space.
- `tv/index.html?demo` starts a game with every hotel fully built.
- Known limits: the near-side hotels hide part of the avenue behind them and their own gates (the pointer and the
  coloured outline of the space are the remedy); no lit windows at night; the 3D-era models and Three.js were
  removed in the same commit that brought the pixel art (they are in the history).
- Not measured on the TV yet (reference: Fire TV Stick 4K Max 2nd gen, PowerVR GE9215, 1.7 GB RAM; the earlier
  2D board ran at about 32 fps, the 3D one at about 30).

## Browser limits that shape the design

The phones load the pad over plain `http://` from a LAN address, which browsers treat as an insecure page:

- **Motion sensors (gyroscope / accelerometer) do not fire** on insecure pages, on both Android Chrome and iOS
  Safari. Decision of the owner (2026-11-22): **touch only, no gyroscope**. Do not add motion-sensor code;
  design "wow" interactions around touch (drag, swipe, hold, shake-free gestures) and phone vibration.
- **Screen Wake Lock** is also secure-context only: the phone screen may dim during long turns of other players.
- **Fullscreen**: requested on the "Entra" tap. Works on Android; iPhone Safari has no page fullscreen at all, so
  the pad is laid out to fit one screen without scrolling (`100dvh`, no zoom, no selection, no overscroll).
- An app cannot read the saved Wi-Fi password on Fire OS (Android gives it only to system apps): a "join the Wi-Fi"
  QR code needs the password typed once in the TV app.

## Development

- No JDK / Android SDK / Node on the dev PC. The web part runs as is from any static file server:
  `uv run --no-project python -m http.server 5173 --directory src/web`, then open
  `http://localhost:5173/tv/index.html` and, in other tabs of the same browser, `http://localhost:5173/pad/`
  (BroadcastChannel transport; each tab of one browser shares `localStorage`, so use a private window or another
  profile for a second player). `/info` answers 404 there and the QR points at the local pad.
- The Kotlin part can only be checked by the Actions build and on a TV. For tests use only the most powerful
  Fire TV on the owner's LAN, never the others.
- `tools/` and `build/` are disposable (downloads and outputs); `.gitignore` is an allow-list.

## Build, release, self-update

- `build.sh` builds `build/apk/FireGames-N.apk` (N = `BUILD_NUMBER` = versionCode, versionName `0.1.N`); it
  downloads Gradle 8.9 to `tools/` and expects JDK 17 + Android SDK as on GitHub runners.
- `.github/workflows/ci.yml` (manual `workflow_dispatch`, no `uses:` actions) runs `build.sh` and publishes the
  APK as release `build-N` of this repository.
- `bash release.sh` on the dev PC (local `gh` login, no token in this public repository): starts that workflow for
  the pushed HEAD, waits, downloads the APK, uploads it as release `firegames-N` of the public repository
  `mefistofelix/firetv-apps` and rewrites `firegames.json` there. `bash release.sh build` stops after the download.
- `Updater.kt` reads `firegames.json` on resume (at most every 2 minutes), offers the newer build, checks the
  SHA-256 and installs through a PackageInstaller session; `Relauncher.kt` reopens the app. Same scheme and same
  signing key (`src/android/debug.keystore`, committed on purpose) as the owner's other Fire TV apps.

## Conventions

- Simple, readable code; descriptive names; guard clauses; no abstraction without a concrete need.
- No third-party dependencies without the owner's explicit approval (this includes JS libraries and assets).
  The app has none today. The owner allowed free-licence assets (2026-11-22, CC0 preferred: models, textures,
  audio): record source and licence here when one is added.
- Commit and push at every meaningful step. Never mention an AI assistant in commits or repository metadata.
  No private information in the repository. LF line endings, no `.gitattributes`.
- Workflows stay minimal and call repository scripts.

## Games

All three must be **original games**: own names, rules text, boards, characters, art and sounds. They may share
a genre and mechanics with classic board games, but must not copy a specific existing game's board, names,
characters or look. Working titles (in `config.js`):

1. **Grand Viale** — property and hotel building on a street board: dice, buying land, building, paying stays.
2. **Dominio** — territory conquest with armies and dice battles.
3. **Occhio di Falco** — find the hidden character in a crowded animated scene before the others.

Status: the platform and **Grand Viale** are playable; the other two show "in arrivo".
The owner asks for games as close as possible to the classic ones they are inspired by: follow their complete
rules (see below) and their richness, keep boards, names and pictures our own.

### Grand Viale rules (as implemented in `grandviale.js`)

The mechanics follow the classic rules of the hotel-building family. Read in full on 2026-11-23: the rulebook
published by hotelboardgame.com (Italian PDF, "the most standard rules, editions may differ") and the title-deed
tables of the same site. The complete Italian rulebook of the conquest game for **Dominio** was read too
(goblins.net PDF): see "Dominio rules to follow".

- 2-4+ teams, 12.000 € each. Two dice: the numbered die (movement and nights) and the permit die. Both are
  always shown in the bottom right corner with their last result.
- Eight hotels as in the classic deeds: buildings 1, 3, 3, 3, 4, 5, 5, 4 from the cheapest land (500) to the
  dearest (3.500), each with a leisure area; land, building and entrance prices are those of the deeds, in that
  order. The night rates are ours (nights x rate for the pieces built): the classic price tables were not found.
- Turn: roll the numbered die and move. Two cars never share a space: the car goes on to the next free one.
  A six gives another throw after the turn's business.
- Passing the Banca (space 0) pays 2.000 €; with three or more teams it stops paying when only two are left.
- Acquisti space: buy a free lot next to that space, or take over ("esproprio") a lot another team owns there
  with nothing built, at half the land price. No building in the same turn.
- Cantiere space: choose one own hotel and how many of its next buildings to ask for, then roll the permit die:
  3 faces yes (pay), 1 no, 1 free, 1 double price. A granted permit must be used: at double price the team
  auctions other hotels if it is short.
- Leisure area: when every building of a hotel is up, it is simply bought (no permit, no special space), in any
  turn of the owner.
- Regalo space: the next piece of one own hotel (building or leisure area), free and without permit.
- Entrances: reaching or passing the Municipio (space 14) gives the right, that turn, to buy one entrance for each
  own hotel with at least one building. The Ingresso spaces give one free entrance. One entrance per space.
- Stopping on a space with another team's entrance: roll the numbered die for the nights, pay nights x the
  hotel's rate; then the guest may still use the space.
- A team that cannot pay auctions whole hotels (cheapest first) to the other teams: no starting price, steps of
  500 €; with no bid the hotel is pulled down and the land is free again. Still short = bankrupt.
  Last team standing wins; the first team (or Back twice on the remote) can end early: richest wins.
- Differences from the classic rules, on purpose or not yet done: the entrance space is chosen automatically
  among the three of the lot (the classic lets the owner choose, and on a printed board with lots on both sides
  of the road an entrance also blocks the lot opposite: here no lot faces another); a claim is never forgotten
  (the game asks for every payment itself); the esproprio is paid to the previous owner (the rulebook does not
  say to whom); the leisure area may be bought in the same turn the last building goes up; no trading between
  teams; no way to skip an absent team's turn.
- Checked by playing in the browser on the pixel-art board: dice, movement, buying, Regalo, free entrance.
  Not yet played through: esproprio, several buildings on one permit, double price, leisure area, Municipio
  entrances, stay with payment, auction, bankruptcy.

### Dominio rules to follow (not implemented)

From the complete rulebook: 3-6 players, 42 territories in 6 continents (9, 4, 7, 6, 12, 4 territories; bonus
5, 2, 5, 3, 7, 2 armies per turn for a whole continent); 14 secret objective cards; 42 territory cards with one of
three symbols plus 2 jokers; 3 red attack dice and 3 blue defence dice. Start: 35/30/25/20 armies each for
3/4/5/6 players, territories dealt at random, one army on each, the rest placed freely. Turn in three phases:
reinforcements (territories / 3 rounded down, continent bonuses, card sets: three of a kind 4, 6 or 8, one of
each 10, joker + two alike 12, +2 for each card of a territory the player holds; sets are played before the
fights), attacks (from a territory with at least 2 armies to a neighbour by land or along a dashed sea line; up
to 3 dice each side, the attacker says how many first; highest against highest, **the defender wins ties**; the
conquered territory takes at least the armies of the last throw, more if wanted; one card at the end of a turn
with at least one conquest), one movement between two neighbouring own territories. Whoever wipes out a player
takes that player's cards (not before the end of the fourth round). The first to reach the secret objective wins.
The map must show: territories, continents, sea links, armies per territory. Ours will be the real world map
with our own division into territories and our own names.

## Open decisions (ask the owner)

- **Guest without the Wi-Fi password**: optional Wi-Fi QR code (password typed once on the TV). An internet relay
  for players outside the LAN was discussed and not chosen.
