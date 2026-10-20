# Umsetzungsstand je Anforderung (Stand 20.10.2026, v0.3)

Legende: ✅ umgesetzt & lokal getestet · 🟡 umgesetzt mit Platzhalter/Einschränkung · ⛔ offen (externer Dienst/Gerät nötig, siehe [OPEN_POINTS.md](OPEN_POINTS.md))

## Spiel, Lobby, Modi

| ID | Stand | Umsetzung / Nachweis |
|---|---|---|
| GAME-01 | ✅ | 2–4 Menschen, Bots füllen auf 4; ab 3 Menschen abschaltbar (dann 3 Sitze, Runden-Minispiele FFA). `session.ts` `startGame`, `engine.test.ts` |
| GAME-02 | ✅ | 20/25/30 Runden am Handy wählbar |
| GAME-03 | ✅ | TV braucht während der Partie keine Eingabe; alles am Handy (Bandenchef) |
| LOBBY-01 | ✅ | 1 Klick „Lobby erstellen“, QR + 4-stelliger Code ohne 0/O/1/I/L (`roomcode.ts`, Server-Test) |
| LOBBY-02 | ✅ | Name (max. 12) + Figur, anonym |
| LOBBY-03 | ✅ | Erstes Handy = Bandenchef (Modus, Map, Runden, Bots, Stärke, Start, Pause, Entfernen), übertragbar, geht bei Abbruch weiter (E2E) |
| LOBBY-04 | ✅ | Figur pro Lobby einmalig, Spielerfarbe + Form (●▲■◆) als Ring/Sockel und in der UI |
| LOBBY-05 | ✅ | Session-Token im Browser, Rückkehr auf den Platz, Bot übernimmt (E2E „phone reconnect“) |
| LOBBY-06 | ✅ | Räume verfallen nach 2 h Inaktivität (Server-Test), Saves 7 Tage |
| LOBBY-07 | ✅ | Nickname-Blockliste inkl. Leetspeak (`nickname.ts`) |
| MODE-01 | ✅ | Brett-Partie |
| MODE-02 | ✅ | Marathon: 10 Spiele gemischt, letztes = Gipfelsturm doppelt (`engine.test.ts`) |
| MODE-03 | ✅ | ohne Wiederholung, Bandenchef kann Minispiele abwählen |

## Brett

| ID | Stand | Umsetzung / Nachweis |
|---|---|---|
| 5.1 Ziel/Währungen/Balancing | ✅ | Werte in `config.ts`; Sieg Sterne → Münzen → Würfel |
| 5.2 Feldtypen | ✅ | Blau, Rot, Ereignis (Gimmick), Glücksfeld (Rad), Duell, Item, Shop, Stern (wandert) |
| BOARD-01 | ✅ | Abzweigung am Handy (Pfeile mit Richtung), TV zeigt 3D-Pfeile |
| BOARD-02 | ✅ | Stern/Shop/Bahnhof/Seilbahn beim Vorbeilaufen (zählen keinen Schritt), Rest beim Stehenbleiben |
| BOARD-03 | ✅ | Gezeiten, Ausbruch (+Lava, Münzregen, Brocken, Seilbahn), Zug nach Fahrplan + Tickets |
| BOARD-04 | 🟡 | Vorspulen (Bandenchef hält Taste, ×3), AFK-Timeout (Computer entscheidet nach 35 s); Bot-Züge 3,5–18 s. Mit Menschen ungemessen |
| BOARD-05 | ✅ | Jede Aktion als Untertitel; Stimme bewusst sparsam: ganze Sätze nur an Höhepunkten + Würfelzahl (`voice.ts`, `voice.test.ts`) |
| DICE (v0.3) | ✅ | 2 echte 3D-Würfel pro Zug: Standard (1–6) + frei gewählter 2. Würfel (Standard, Charakterwürfel oder Würfel-Item). Alle Würfel Ø 3,5 Schritte (Münzen = 0,4 Schritte), unterschiedliche Streuung, negative Flächen = rückwärts laufen (`dice.ts`, `dice3d.ts`, `engine.test.ts`) |
| ITEM-01/02 | ✅ | 10 Items (neu: Risiko-Würfel, Gold-Würfel), Einsatz am Handy vor dem Würfeln, max. 3, Ersetzen/Verwerfen |
| CHAOS-01 | ✅ | Finale letzte 5 Runden: Zwischenstand, Blau/Rot ×2, Letzter dreht Rad (Münzen/Item/Stern-Rabatt) |
| CHAOS-02/03 | ✅ | 3 aus 7 Bonus-Kategorien (eine immer aus dem Aufhol-Pool), einzeln enthüllt; Halbzeit-Aufholrad; Letzter nach Runde 10 gewinnt in 15–18 % der Bot-Partien ([BALANCING.md](BALANCING.md)) |
| BOT-01..04 | ✅ | 3 Stärken, Übernahme bei Abbruch, Bot-KI für alle 21 Minispiele, Brett-Entscheidungen Richtung Stern |

## Maps

| ID | Stand | Umsetzung / Nachweis |
|---|---|---|
| MAP-01 | ✅ | v0.3: 60–80 Felder, 4–6 Abzweigungen, 1–2 Shops, ≥ 5 Sternplätze – automatisch validiert (`validateMap`). Kokosnuss 73/5, Vulkan 65/4, Bimmelbahn 61/5 |
| MAP-07 (v0.3) | ✅ | Landschaft aus Map-Daten: Höhenfeld mit Küsten, Hügeln, Fluss-/Lava-/Kanal-Rinnen; Wege eingeebnet; Brücken, Steg, Gebäude an Shop/Item/Glück/Duell/Start; instanzierte Vegetation (`terrain.ts`, `board.ts`) |
| MAP-02 | ✅ | Gimmick angekündigt + animiert (Wasserstand, Ausbruch/Kamerawackeln, Zugfahrt), HUD-Widget |
| MAP-03 | ✅ | Übersichtskamera, Verfolgung des aktiven Spielers, Zoom bei Ereignissen |
| MAP-04 | ✅ | Suno-Loop je Map + Finale-Variante, Crossfade-Loop |
| MAP-05 | ✅ | Einsteiger → Mittel → Komplex |
| MAP-06 | ✅ | Maps als Daten (`packages/shared/src/maps`), Gimmick per ID |

## Minispiele

| ID | Stand | Umsetzung / Nachweis |
|---|---|---|
| MINI-01 | ✅ | 20 + Finale „Gipfelsturm“ |
| MINI-02 | ✅ | 8 FFA / 5×2v2 / 4×1v3 / 3 Duelle; Teams nach Feldfarbe oder zufällig |
| MINI-03 | ✅ | 30–60 s (Vertragstest) |
| MINI-04 | ✅ | Erklär-Screen mit Steuerung, Übungsphase, Start bei allen „Bereit“ oder nach 30 s |
| MINI-05 | ✅ | Eine Steuerungsart je Spiel, passendes Handy-Layout |
| MINI-06 | ✅ | Mit Bots und 2–4 Menschen spielbar |
| MINI-07 | ✅ | Einheitliches Modul (Setup/Input/Tick/Ergebnis/Bot/View/Layout) |
| MINI-08 | ✅ | Steuerungsmix ≤ 40 % je Art (Test) |
| MINI-09 | ✅ | thematisch (Insel/Vulkan/Stadt), auf jeder Map spielbar |

## Controller, Grafik, Audio

| ID | Stand | Umsetzung / Nachweis |
|---|---|---|
| CTRL-01/02 | ✅ | Handy = Controller + private Infos; kontextabhängige Layouts |
| CTRL-03 | ✅ | Wartebildschirm: wer dran ist, Emoji-Reaktionen am TV |
| CTRL-04 | ✅ | Touch-Ziele ≥ 48 px, Hinweis zum Drehen |
| CTRL-05 | ✅ | Wake Lock (HTTPS nötig), Vibration |
| CTRL-06 | 🟡 | Gyro-Freigabe beim Beitritt; auf echtem iOS ungetestet ⛔ |
| CTRL-07 | ✅ | ~72 KB initial, keine 3D-Engine (`scripts/check-bundle.mjs` in CI) |
| ART-01 | ✅ | Eigene Figuren/Namen, keine Fremd-IP |
| ART-02 | ✅ | 8 Blender-Figuren (neu: Bruno, Hoppla, Schildi, Zippy) mit Teile-Rig, ≤ 4 k Dreiecke, gebackene AO in Vertexfarben; Animationen prozedural; Gebrabbel je Figur (ElevenLabs) |
| ART-03 | ✅ | Unterschiedliche Silhouetten, Farbring + Form |
| ART-04/05 | ✅ | Low-Poly mit weichen Farbverläufen, Detail-Textur (prozedural), animiertes Wasser/Lava, Himmelsverlauf, Vignette; alle GLB-Materialien über die zentrale Palette |
| ART-06 | ✅ | Abgerundete halbtransparente Karten, Nunito, große Typo |
| ART-07, A11Y-01 | ✅ | Form-Icons zusätzlich zur Farbe |
| ASSET-01..04 | 🟡 | GLB aus Blender-Skripten (Figur ≤ 1,8 k Dreiecke, Budget im Build geprüft); statt CC0/Meshy eigene Modelle, keine Mesh-Kompression ([Abweichungen](ASSETS_LICENSES.md#bewusste-abweichungen-von-der-asset-pipeline-der-spec)) |
| ASSET-05 | ✅ | `docs/ASSETS_LICENSES.md` |
| AUDIO-01..03 | ✅ | Suno-Musik + Jingles, ElevenLabs-SFX + Moderator; prozeduraler Fallback |
| AUDIO-04/05/06 | ✅ | Gebrabbel, Audio nur am Host, getrennte Lautstärken (gespeichert) |
| AUDIO-07 | 🟡 | Tarife dokumentiert (ElevenLabs Free = nicht-kommerziell, Suno über Drittanbieter = unklar) – Klärung vor Veröffentlichung ⛔ |

## Technik

| ID | Stand | Umsetzung / Nachweis |
|---|---|---|
| TECH-01 | ✅ | Babylon.js 9 + Havok, TypeScript, WebGL2 |
| TECH-02 | ✅ | `/host` und `/play`, gemeinsames Protokoll `packages/shared/src/net/protocol.ts` |
| TECH-03 | ✅ | Host ist Autorität |
| TECH-04 | ✅ | Spielzustand komplett JSON (Simulation macht laufend Round-Trips) |
| TECH-05, L10N-01 | ✅ | Alle Texte über i18n-Keys (Deutsch), Englisch als zweites Wörterbuch ergänzbar |
| NET-01/02 | ✅ | WebRTC-DataChannels zuverlässig + unzuverlässig, Signaling über eigenen Server, STUN |
| NET-03 | ✅ | Relay-Fallback (sofort nutzbar, P2P-Timeout 5 s), erzwingbar mit `?relay=1` (E2E) |
| NET-04 | ⛔ | Latenzmessung im echten WLAN offen |
| NET-05 | ✅ | Uhr-Synchronisation per Ping, Zeitstempel am Handy (Schnellzieher-Test) |
| NET-06 | ✅ | Verbindungsverlust am TV (📵), Bot übernimmt |
| SAVE-01 | ✅ | Autosave nach jeder Runde an Server + lokal |
| SAVE-02 | ✅ | Fortsetzen per 6-stelligem Code bis 7 Tage, Handys wählen ihre Figur |
| SAVE-03 | ✅ | Host-Reload setzt fort, Handys verbinden neu (E2E) |
| SAVE-04 | ✅ | Pause stoppt Timer/Minispiele (E2E) |
| PERF-01 | 🟡 | Auto-Qualitätsstufen; 60 fps am Referenzgerät ⛔ |
| PERF-02 | ✅ | Host-Erstladen ~11 MB (inkl. Havok-WASM), Maps prozedural |
| PERF-03/04 | ⛔ | Nur Chromium getestet |
| PERF-05 | ✅ | „Server wird geweckt …“ mit automatischem Reconnect |
| OPS-01..04 | 🟡 | Bicep lokal valide (build/lint ohne Warnung), Workflows vorbereitet, nicht deployt ⛔ |
| PRIV-01..03 | ✅ | Keine personenbezogenen Daten, anonyme Telemetrie ohne IDs/Cookies |
| SEC-03 | 🟡 | Entwürfe Impressum/Datenschutz (`/impressum.html`, `/datenschutz.html`), Platzhalter ausfüllen |
| SEC-01 | ✅ | Code/Token-Validierung, Rate-Limits (Nachrichten, Raumerstellung, Saves), Peers können nur den Host erreichen |
| A11Y-02 | ✅ | Filter „Ohne Schütteln/Gyro“ |
| A11Y-03 | ✅ | Untertitel für alle Ansagen |
