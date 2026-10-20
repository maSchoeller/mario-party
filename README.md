# Würfel-Bande

3D-Party-Brettspiel im Browser: Ein Laptop am TV zeigt das Spielbrett, die Spieler steuern mit dem Handy.

- 📄 Anforderungs-Spec: [docs/spec/SPEC.md](docs/spec/SPEC.md)
- ✅ Umsetzungsstand je Anforderung: [docs/STATUS.md](docs/STATUS.md)
- ⛔ Offene Punkte (fehlende Dienste/Assets): [docs/OPEN_POINTS.md](docs/OPEN_POINTS.md)
- 🧩 Minispiele bauen: [docs/MINIGAMES.md](docs/MINIGAMES.md)
- 📜 Lizenz-Register (ASSET-05): [docs/ASSETS_LICENSES.md](docs/ASSETS_LICENSES.md)
- ⚖️ Balancing & unabhängiger Review: [docs/BALANCING.md](docs/BALANCING.md)

## Schnellstart (lokal, ohne Azure)

Voraussetzung: Node.js ≥ 20.

```bash
npm install
npm run dev          # Server (Port 8787) + Vite (Port 5173)
```

| Was | URL |
|---|---|
| Startseite | http://localhost:5173/ |
| TV/Host | http://localhost:5173/host |
| Handy-Controller | http://localhost:5173/play (oder QR-Code scannen) |
| Testansicht (TV + simulierte Handys in einem Fenster) | http://localhost:5173/dev?phones=2 |
| Bot-Demo ohne Handys | http://localhost:5173/host?demo=kokosnuss (`vulkan`, `bimmelbahn`, `marathon`; `&ff=1` Vorspulen, `&mg=<id>` einzelnes Minispiel) |

**Mit echten Handys im WLAN:** Laptop und Handys im selben WLAN, Host über `http://<Laptop-IP>:5173/host`
öffnen (der QR-Code zeigt automatisch die LAN-Adresse). Gyro (iOS) und Wake Lock brauchen HTTPS:

```bash
HTTPS=1 npm run dev  # selbstsigniertes Zertifikat, einmal im Handy-Browser akzeptieren
```

Ohne Sensor-Freigabe gibt es für Neige-/Schüttel-Spiele eine Ersatz-Steuerung am Bildschirm.

### Produktionsnaher Lauf (ein Prozess)

```bash
npm run build        # baut den Web-Client nach apps/web/dist
npm start            # Server liefert Client + API auf http://localhost:8787
```

Spielstände landen lokal in `.data/saves/` (7 Tage), Telemetrie in `.data/telemetry.ndjson`.
Mit `AZURE_STORAGE_CONNECTION_STRING` nutzt der Server Azure Table Storage (lokal testbar mit Azurite).

## Tests

```bash
npm test             # Unit-/Integrationstests (Engine, Maps, 21 Minispiele, Bots, Server)
npm run test:e2e     # Playwright: Lobby, P2P, Relay-Fallback, Reconnect, Host-Reload, Pause, Demo
npm run simulate     # komplette Bot-Partien auf allen Maps (Balancing-Überblick)
npx tsx packages/shared/scripts/balance.ts 60   # Balancing-Kennzahlen (Aufholjagd, Bonus, Ökonomie)
npm run typecheck
AZURITE=1 npx vitest run apps/server/test/tableStore.test.ts   # mit laufendem Azurite
```

## Architektur

```
packages/shared   Spiel-Engine (Regeln, Maps, Items, Gimmicks, Bots, Bonus), 21 Minispiel-Module,
                  Netzwerk-Protokoll, i18n (Deutsch), Raumcodes, Namensfilter – reines TypeScript
apps/server       Node.js: Lobby-Registry, WebRTC-Signaling, WS-Relay, Save-API, Telemetrie, Rate-Limits
apps/web          /host  Babylon.js + Havok (TV, Spiel-Autorität)   /play  Controller ohne 3D-Engine
e2e               Playwright-Tests mit echtem Browser für TV und Handys
infra             Bicep (Azure), Dockerfile, GitHub-Actions-Workflows (noch nicht deployt)
```

- **Host ist Autorität** (TECH-03): Regeln, Zufall, Minispiel-Simulation und Bots laufen im Host-Browser,
  Handys senden nur Eingaben und bekommen fertige Anzeige-Zustände.
- **Netzwerk** (NET-01..03): WebRTC-DataChannels (zuverlässig + unzuverlässig) P2P, Signaling über den
  Server; bis P2P steht bzw. wenn es nicht klappt, läuft alles über den WebSocket-Relay.
  `?relay=1` erzwingt den Relay zum Testen.
- **Daten-getriebene Maps** (MAP-06) und **Minispiel-Module** (MINI-07): neue Inhalte ohne Engine-Änderung.
