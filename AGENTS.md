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
- `src/web/tv/` — TV page: `tv.js` lobby logic (seats, leader, game choice), `scene.js` animated backdrop
  (sky, clouds, birds, pond, traffic; every player is a car on the road), `tv.css` sized in `vh`.
- `src/web/pad/` — phone page: join form (team name, colour), lobby pad (horn, tilt, game choice for the leader).
- `src/android/java/.../LanServer.kt` — static files from assets (`Cache-Control: no-cache`), `/info`
  (`{ip, port, version}`), `/ws?id=`; sends `{t:"bye"}` to the TV when a phone's socket closes.
- `MainActivity.kt` — WebView, keep-screen-on, update dialog. `Updater.kt` / `Relauncher.kt` — self-update.
- `build.gradle.kts` — the Android app is the root Gradle project; sources `src/android`, assets `src/web`,
  outputs under `build/`.

## Lobby protocol (bodies)

Phone → TV: `{t:"peek"}` (ask the lobby state before joining), `{t:"hello", name, color}`, `{t:"ping"}` every
2 s, `{t:"tilt", x}` (-1..1, sent on change at most 15 Hz), `{t:"honk"}`, and from the leader (first seated
player) `{t:"pick", step}` and `{t:"start"}`.
TV → phone: `{t:"lobby", taken, you, game}` (`you` is null until seated), `{t:"pong"}`.
A phone silent for 6 s is dropped; a phone that hears nothing for 6 s shows "Cerco la TV…".
When a game adds messages, document them here.

## Browser limits that shape the design

The phones load the pad over plain `http://` from a LAN address, which browsers treat as an insecure page:

- **Motion sensors (gyroscope / accelerometer) do not fire** on insecure pages, on both Android Chrome and iOS
  Safari. So every motion effect must have a touch equivalent (today: drag the car). Real gyro needs HTTPS, which
  on a LAN means a real certificate for a DNS name that resolves to the TV, see "Open decisions".
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

Status: only the shared platform exists (connection, lobby, seats, game choice). "Avvia" shows "in arrivo".

## Open decisions (ask the owner)

- **Gyroscope**: wanted for "wow" effects, impossible over plain HTTP. Options: (a) keep touch equivalents only;
  (b) HTTPS on the LAN with a certificate for a wildcard DNS name mapped to private addresses (needs a domain, the
  private key ships in the APK, some routers block such DNS answers); (c) pad served from an HTTPS site and linked
  to the TV through an internet relay (contradicts "LAN only", but would also let a guest without Wi-Fi play).
- **Guest without the Wi-Fi password**: optional Wi-Fi QR code (password typed once on the TV) and/or option (c).
- Rendering for the games: hand-written Canvas 2D (current) or a library such as Three.js / PixiJS for 3D dice
  and richer effects (needs approval as a dependency, and a performance check on the TV).
