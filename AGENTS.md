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
- Everything visible is web (`src/web`, plain ES modules, **no build step, no npm**; the only third-party code is
  Three.js, see "Graphics"), packed
  into the APK as assets. The TV page draws the game; the phones open `http://<tv-ip>:8080/` (QR code on the TV),
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
`remote-N`) and at the first key press for the others, so one remote can be passed around. Back during a game
asks to press again, then ends the game (`window.onTvBack`, called by `MainActivity.onBackPressed`).

## Graphics

Art direction asked by the owner (2026-11-22): **a board game that came alive**. The simulation of a real board
game (a board on a table, printed spaces, dice thrown onto the board that bounce among the buildings) mixed with
a realistic setting: buildings, city, cars and people look "real", the guest gets out of the car and walks into
the hotel, a hotel is built by a crane with scaffolding, fast, and each hotel and each area of the map has its own
character. Not AAA: elaborate indie quality, cared for in every detail. The phones are remote controls for the
actions.

More direction from the owner (2026-11-22), to be followed in all three games:

- **Each game has its own visual style**, lighting and setting. The game-choice screen should become a
  **triptych**: three panels, each showing its game's real 3D scene, animated and lit as in the game (not done
  yet: the lobby is still the 2D scene, and only Grand Viale has a 3D scene).
- **Detail**: every hotel must be a recognisable complex with its own equipment (pools, tennis courts, roof
  terraces, gardens...), every area of the map its own character. Low detail reads as ugly: keep adding.
- **Camera**: the whole board does not have to be visible. The camera stays with the team in turn, moves
  between places at an unhurried pace so that everyone follows what is happening, closes in on the events, and
  pulls back to the whole board for the dice, then returns.
- **Sound**: realistic ambience (sea, birds, city, construction) mixed with music and with sounds for the game
  events. Today there are only short synthesized effects (`shared/sound.js`): ambience and music are to do, and
  need either audio files (an asset, to be approved) or much better synthesis.
- The owner compares the result with the classic game and with AAA work and finds it far from both. The honest
  limits: everything is procedural (no models, no photographic textures, no baked light) and the TV GPU is small.
  Real models and textures (for example CC0 packs) would be the biggest step up and need the owner's approval
  as assets. The board, the hotels and their names stay original: the classic game is a reference for the level
  of richness, not something to reproduce.

- 3D is drawn with **Three.js r160**, vendored as `src/web/vendor/three.module.min.js` (approved by the owner; the
  only third-party code in the project; no build step: it is imported as an ES module). Everything is procedural:
  geometry from Three.js primitives, textures painted on canvases. No model or image files.
- `grandviale-world.js` is the scene: wooden table, board slab whose top is one painted canvas (meadow, beach,
  avenue, spaces with their symbols, cream frame), sea, mountains, plants, lamps, clouds, boats; per hotel a lot
  plate in the owner's colour, flag, label sprite, buildings by `style` (`lighthouse`, `chalet`, `pitched`,
  `dome`, `palace`, `tower`, `flat`) with balconies, awnings, parapets and equipped roofs (pools, tennis courts,
  helipad, roof garden), a hedge around the lot, and the leisure area; one crane + scaffold + dust lent to whichever piece is
  growing; cars and people; entrances (red carpet and canopy); the two dice. It only reads the game state each
  frame and offers `focus(point, zoom)` / `overview()`; the camera gets lower and turns when it closes in. The
  game keeps it on the team in turn (`showPlayer`), on the lot of an event, and on the whole board during a throw.
  Small repeated details are merged into one mesh (`mergedBoxes`) to keep the draw calls low.
- Dice: the game decides the result, the scene puts that face on top while the die is out of sight, then plays a
  scripted flight (bounces, spin that ends exactly at rest). No physics engine.
- Stay: the game's `glide` + `hidden` + `night` flags become: the car pulls over, the guest walks to the door and
  goes in, the sun goes down, windows and street lamps light up.
- `grandviale-hud.js` draws the flat panels (team chips, banner, dice tray, floating amounts, final ranking) on a
  transparent 2D canvas over the scene. `grandviale-path.js` holds the avenue (closed Catmull-Rom curve, 28 spaces)
  and the look of the spaces. `grandviale-board.js` joins world and panels in one animation loop.
- A hotel is "next to" the `reach` spaces nearest to its lot (`nearestSpaces`), so moving a lot or the avenue
  changes where it is bought and where its entrances go: check that every hotel still has an Acquisti space.
- `tv/index.html?demo` starts a game with every hotel fully built, to look at the board while working on it.
- Performance on the reference TV (Fire TV Stick 4K Max 2nd gen, PowerVR GE9215, OpenGL ES 3.2, 1.7 GB RAM):
  about 30 fps with the scene rendered at 1280x720, a 1024 shadow map redrawn every other frame, Lambert
  materials. The frame rate is logged every 5 s (`adb logcat -s FireGames`). Measure before adding detail.
- The lobby (`scene.js`) is still Canvas 2D.

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
  Approved so far: Three.js.
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

### Grand Viale rules (as implemented in `grandviale.js`)

The mechanics follow the classic rules of the hotel-building family, checked on 2026-11-22 against three published
rule summaries (hotelboardgame.com, rulespal.com, ultraboardgames.com; editions differ on details). Board,
hotel names, prices and art are our own and must stay so.

- 2-4+ teams, 12.000 € each. Two dice: the numbered die (movement and nights) and the permit die. Both are
  always shown in the bottom right corner with their last result.
- Turn: roll the numbered die and move. Two cars never share a space: the car goes on to the next free one.
  A six gives another throw after the turn's business.
- Passing the Banca (space 0) pays 2.000 €; with three or more teams it stops paying when only two are left.
- Acquisti space: buy a free lot next to that space, or take over ("esproprio") a lot another team owns there
  with nothing built, paying that team half the land price. No building in the same turn.
- Cantiere space: choose one own hotel and how many of its next buildings to ask for, then roll the permit die:
  3 faces yes (pay), 1 no, 1 free, 1 double price (may be declined). Buildings go up in order; the leisure area is
  the last piece, asked for alone, and raises the night rate like a building.
- Regalo space: the next piece of one own hotel, free and without permit.
- Entrances: reaching or passing the Municipio (space 14) gives the right, that turn, to buy one entrance for each
  own hotel with at least one building. The Ingresso spaces give one free entrance. An entrance takes the first
  free space next to the lot; one entrance per space.
- Stopping on a space with another team's entrance: roll the numbered die for the nights, pay nights × the
  hotel's rate for its current pieces.
- A team that cannot pay auctions whole hotels (cheapest first) to the other teams, from the land price in steps
  of 500 €; with no bid the bank pays the land price and the hotel is cleared. Still short = bankrupt.
  Last team standing wins; the first team (or Back twice on the remote) can end early: richest wins.
- Differences from the classic rules, on purpose or not yet done: the entrance space is chosen automatically
  (no "reserved" first space, no stealing the opposite side of the road), a claim is never forgotten (the game
  asks for every payment itself), the double-price permit may be declined, no trading between teams, no way to
  skip an absent team's turn.
- Checked by playing in the browser: buying, occupied spaces, several buildings on one permit, the six, the
  stay with payment. Not yet played through: esproprio, Regalo, Municipio entrances, auction, bankruptcy.

## Open decisions (ask the owner)

- **Guest without the Wi-Fi password**: optional Wi-Fi QR code (password typed once on the TV). An internet relay
  for players outside the LAN was discussed and not chosen.
