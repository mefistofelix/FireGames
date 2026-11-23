# Fire Games

Giochi da tavolo per **Fire TV** da fare in compagnia davanti alla TV: la TV è il tabellone, ogni squadra usa
**un telefono** come controller.

- Si entra **inquadrando il QR code** mostrato sulla TV: nessuna app da installare sul telefono, funziona nel
  browser di Android e iPhone.
- Ogni squadra scrive il proprio nome e sceglie un colore.
- Dadi, animazioni, effetti e suoni sono sulla TV; turni e scelte (lancia i dadi, compra, attacca…) si fanno dal
  telefono, che mostra anche soldi, punti e carte della squadra.
- Si gioca **in rete locale**: TV e telefoni devono essere sulla stessa Wi-Fi. Non serve internet per giocare.

## Stato

| | |
|---|---|
| Collegamento telefoni via QR, nome e colore squadra | fatto |
| Sala d'attesa animata (ogni squadra è una macchina: clacson, si muove trascinandola) | fatto |
| Scelta del gioco (dal telefono della prima squadra o dal telecomando) | fatto |
| Gioco anche senza telefoni, passandosi il telecomando | fatto |
| **Grand Viale** — terreni, hotel e pernottamenti | giocabile |
| **Dominio** — carri armati, dadi e conquista | da fare |
| **Occhio di Falco** — trova il personaggio nascosto | da fare |

I tre giochi sono originali: nomi, tabelloni, personaggi e grafica propri.

## Come si gioca

1. Apri **Fire Games** sulla Fire TV.
2. Con il telefono (sulla stessa Wi-Fi) inquadra il QR code, oppure scrivi nel browser l'indirizzo sotto al codice.
3. Scrivi il nome della squadra, scegli il colore, tocca **Entra**.
4. La prima squadra entrata sceglie il gioco e lo avvia. Dal telecomando: ◀ ▶ per scegliere, OK per avviare.

**Senza telefono**: basta premere OK per avviare: la TV chiede quante squadre giocano (da 2 a 4) e si gioca
passandosi il telecomando. In alternativa, nella sala d'attesa ▲ aggiunge una squadra senza telefono (▼ la toglie),
anche insieme a squadre col telefono. Durante la
partita le scelte della squadra di turno compaiono anche sulla TV: ▲ ▼ per scegliere, OK per confermare, e ci si
passa il telecomando. **Indietro** due volte termina la partita.

### Grand Viale

I dadi sono due: quello **numerato** (per muoversi e per le notti) e quello dei **permessi**.

- Si lancia il dado numerato e si avanza sul viale. Due macchine non stanno mai sulla stessa casella: chi arriva
  su una casella occupata prosegue fino alla prima libera. Con un **sei** si tira ancora.
- **Banca** 🏦: passando si incassano 2.000 €.
- **Acquisti** 💰: si compra il terreno libero accanto, oppure si **espropria** a metà prezzo un terreno altrui su
  cui non è stato costruito nulla.
- **Cantiere** 🏗️: si sceglie un proprio hotel e quanti edifici costruire, poi si lancia il dado dei permessi:
  sì, no, gratis oppure prezzo doppio (e il permesso concesso va usato, anche vendendo altro all'asta).
- **Area relax**: quando un hotel ha tutti i suoi edifici, si compra in qualsiasi proprio turno, senza permesso.
  Alza la tariffa.
- **Regalo** 🎁: un pezzo di hotel gratis, senza permesso.
- **Municipio** 🏛️: passandoci si può aprire un **ingresso** per ogni proprio hotel. Le caselle **Ingresso** 🚪
  ne regalano uno.
- Chi si ferma su un ingresso altrui entra in hotel, lancia il dado per le **notti** e paga.
- Chi non può pagare mette **all'asta** i propri hotel, senza prezzo minimo; se nessuno offre l'hotel viene
  demolito. Se non basta è bancarotta. Vince l'ultima squadra rimasta, o la più ricca se la partita viene
  terminata prima.
- Gli hotel sono otto, dalla pensione con un solo edificio ai grandi alberghi con cinque: numero di edifici e
  prezzi seguono la scala del gioco classico, nomi, plancia e disegni sono nostri.

Note sui telefoni:

- La pagina chiede lo **schermo intero** al tocco su *Entra*. Su iPhone Safari lo schermo intero non esiste: la
  pagina è comunque fatta per stare in una schermata senza scorrere.
- I comandi sono **solo a tocco**: i sensori di movimento del telefono non vengono usati (i browser li danno solo
  alle pagine HTTPS, che in rete locale non ci sono).

## Installazione e aggiornamenti

L'APK viene costruito da GitHub Actions e pubblicato nel repository
[mefistofelix/firetv-apps](https://github.com/mefistofelix/firetv-apps), lo stesso delle altre app Fire TV.
L'app controlla `firegames.json` a ogni ritorno in primo piano (al massimo ogni 2 minuti): se c'è una versione più
nuova la propone, la scarica, ne verifica lo SHA-256 e apre l'installazione di Fire TV; poi si riapre da sola.
La prima volta Fire OS chiede di attivare *Installa app sconosciute* per Fire Games.

Prima installazione, con ADB di rete attivo sulla TV:

```powershell
adb connect <ip-della-tv>:5555
adb install -r build\apk\FireGames-N.apk
```

## Sviluppo

- `src/web` — tutto quello che si vede (pagina TV e pagina telefono), JavaScript senza build e senza librerie
  esterne. Il tabellone è in **pixel art isometrica**: le immagini (in `src/web/assets`) le disegna lo script
  `src/art/pixelart.py`, da rieseguire quando si cambia un disegno:
  `uv run --no-project --with pillow python -I src/art/pixelart.py`.
- `src/android` — guscio Kotlin: server HTTP/WebSocket in LAN, WebView a schermo intero, aggiornamento automatico.
- Prova sul PC senza TV:

  ```powershell
  uv run --no-project python -m http.server 5173 --directory src/web
  ```

  poi apri `http://localhost:5173/tv/index.html` e, in altre schede dello stesso browser,
  `http://localhost:5173/pad/`.
- Rilascio: dopo `git push`, `bash release.sh` avvia la build su GitHub Actions, scarica l'APK in `build/apk` e lo
  offre alle TV tramite `firetv-apps`. `bash release.sh build` si ferma all'APK.

Dettagli tecnici, protocollo e decisioni aperte: [AGENTS.md](AGENTS.md).
