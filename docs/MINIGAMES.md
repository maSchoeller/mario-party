# Minispiele bauen (Modul-Leitfaden)

Jedes Minispiel ist ein **reines TypeScript-Modul** in `packages/shared/src/minigames/games/<id>.ts`
und implementiert `MinigameDef` aus `packages/shared/src/minigames/types.ts` (MINI-07).
Der Host simuliert das Spiel (Host-Autorität), rendert es generisch aus der `view()` und
schickt jedem Handy das Controller-Layout aus `layout()`. Das Handy hat **keine** 3D-Engine.

Referenz-Implementierungen: `kokosRegen.ts` (Joystick), `gipfelSprint.ts` (Mashen),
`schnellzieher.ts` (Reaktion mit synchronisierten Zeitstempeln).

## Lebenszyklus

```
setup(players, rng, {practice}) → state
  pro Tick (60 Hz am Host, 30 Hz im Test):
    bot(state, i, level, rng, dt) → MgInput[]   (nur für Bot-Spieler; Ergebnis geht an input())
    input(state, i, input)                      (auch für Menschen, jederzeit zwischen Ticks)
    tick(state, dt, rng)
  isOver(state) → true  ⇒ result(state) → Rang pro Spieler (0 = bester, Gleichstand = gleicher Rang)
view(state)            → was der TV zeigt (Entities + HUD + Kamera)
layout(state, i)       → welches Controller-Layout Spieler i gerade am Handy sieht
```

Regeln:

- **Zufall nur über das übergebene `rng`** (kein `Math.random`), State muss **JSON-serialisierbar** sein
  (keine Klassen, Maps, Funktionen).
- **Spielzeit 30–60 s** (`duration`), das Spiel muss **sicher enden** (Zeitlimit als Notbremse).
- **Übungsphase** (`practice: true`): Spiel endet nie (`isOver` → false), Ziele/Fortschritt dürfen
  zurückgesetzt werden. Der Host beendet die Übung, wenn alle „Bereit“ gedrückt haben.
- **Bots für jede Rolle** (BOT-03) mit 3 Stärken (`easy`/`medium`/`hard`, siehe `BOT_SKILL`).
  Schwere Bots sollen im Schnitt besser sein als leichte, aber schlagbar bleiben.
- **Teams**: `players[i].team`. FFA: eigener Index · 2v2: 0/1 · 1v3: 0 = Solo, 1 = Trio · Duell: 0/1.
  In Team-Formaten erhalten alle Mitglieder **denselben Rang** (Hilfsfunktionen `teamRanks`,
  `teamRanksFromScores` in `util.ts`).
- Spieleranzahl: FFA/2v2/1v3 = 4 Spieler, Duell = 2.
- **Eingabe-Zeitstempel** (`press.t`) sind bereits in Minispiel-Sekunden umgerechnet und am Handy
  gemessen (NET-05). Für Timing-Spiele immer `input.t` statt Ankunftszeit nutzen und ggf. eine kurze
  Kulanzzeit auf späte Nachrichten warten (siehe Schnellzieher).

## Steuerungsarten (MINI-05, MINI-08)

`control` ∈ `joystick | tap | motion | draw` (genau eine pro Spiel; bei 1v3 die Hauptsteuerung).
`motion: true` für Gyro/Schütteln (Filter A11Y-02).

| Layout (`layout()`) | Handy zeigt | Input an `input()` |
|---|---|---|
| `{kind:'joystick', buttons?}` | Touch-Joystick (+ Buttons) | `{type:'stick',x,y}` (−1..1, **y>0 = nach vorne/oben = +z in der Welt**), `{type:'button',id,down}` |
| `{kind:'mash', labelKey}` | großer Tipp-Button | `{type:'tap'}` je Tipp |
| `{kind:'button', labelKey}` | ein Button mit Zeitstempel | `{type:'press', t}` |
| `{kind:'tilt'}` | Gyro (Ersatz: Schieberegler/Pad) | `{type:'tilt',x,y}` (−1..1; x = nach rechts geneigt, y = nach vorne geneigt) ~30 Hz |
| `{kind:'shake'}` | Schütteln (Ersatz: Tippen) | `{type:'shake', power}` 0..1 pro Schüttelimpuls |
| `{kind:'draw', shape}` | Zeichenfläche mit Vorlage (Punkte 0..1) | `{type:'draw', points, duration}` (einmal pro Strich) |
| `{kind:'swipe'}` | Wischfläche | `{type:'swipe', dir}` |
| `{kind:'choice', options, locked?}` | große Auswahl-Buttons | `{type:'choice', id}` |
| `{kind:'number', min, max, value?}` | Zahleneingabe +/− und Senden | `{type:'number', value}` |
| `{kind:'pads', count, colors, active?}` | farbige Pads | `{type:'pad', idx}` |
| `{kind:'wait', labelKey}` | Hinweis (z. B. ausgeschieden) | – |

## Darstellung (`view()`)

Koordinaten: y nach oben, Boden bei y = 0. Standardkamera schaut von −z nach +z
(`alpha = -π/2`), d. h. +x = rechts, +z = „hinten/oben“ am TV. Figuren sind ~1,6 hoch und
schauen bei `ry = 0` zur Kamera; `faceAngle(dx, dz)` liefert `ry` für eine Blickrichtung.

| `kind` | Geometrie (vor Skalierung `sx/sy/sz`) |
|---|---|
| `player` | Figur des Minispiel-Spielers `player` (Index), Füße bei `y`, Spielerfarbe als Ring; `anim`: idle/walk/jump/cheer/sad/hit/roll |
| `box` | Würfel 1×1×1, zentriert |
| `sphere` | Kugel Ø 1, zentriert |
| `cylinder` | Zylinder Ø 1, Höhe 1, zentriert |
| `cone` | Kegel Ø 1 unten, Höhe 1, **Basis bei y** |
| `torus` | Ring Ø 1, liegt flach, zentriert |
| `plane` | flache Fläche `sx × sz` bei Höhe y |
| `coin` / `star` | Münze / Stern ~Ø 1, dreht sich |
| `rock` / `coconut` / `balloon` | Fels Ø ~1 / Kokosnuss Ø ~0.7 / Ballon Ø 1 mit Schnur (zentriert) |
| `palm` | Palme ~5 hoch, Basis bei y |
| `boat` | Floß/Boot ~3 lang (x-Achse), Basis bei y |
| `train` | Lok ~4 lang (x-Achse), Basis bei y |
| `lantern` | Laterne mit Lichtschein (für `env: 'night'`) |

Weitere Felder: `color` (Hex), `alpha` (0..1), `glow` (leuchtet), `rx/ry/rz` (Radiant),
`label` (kurzer Text **ohne** Sprache, z. B. Zahl) bzw. `labelKey` (i18n-Key).
Entity-IDs müssen über die Zeit stabil sein (der Renderer diffed per `id`).

`env` setzt Himmel/Boden: `water | lava | grass | night | sky | city | sand | ice`.
`hud`: `timer` (Restsekunden), `scores` (Text je Spieler), `teams` (Text je Team mit
`labelKey`), `bars` (Fortschritt 0..1 je Spieler), `message` (großer Text per i18n-Key).

Lesbarkeit aus 3 m (Säule 3): wenige, große, kontrastreiche Objekte, Kamera so, dass alle
Spieler gleichzeitig sichtbar sind.

## Texte

Alle Texte über i18n-Keys (TECH-05): `mg.<id>.name`, `mg.<id>.desc` (Erklär-Screen, 1–2 Sätze),
`mg.<id>.controls` (Steuerung kurz) plus eigene Keys `mg.<id>.*` für HUD-Meldungen.
Controller-Labels: vorhandene `ctrl.*`-Keys nutzen oder neue `ctrl.*` ergänzen.

## Tests

`packages/shared/test/minigames/contract.ts` → `checkMinigameContract(def)` prüft Ende, Ränge,
Teams, Serialisierbarkeit, Entity-Arten, i18n-Keys, Übungsmodus und Zufallseingaben.
`botStrengthOrder(def)` prüft grob, dass schwere Bots besser abschneiden.

## Neues Minispiel registrieren

1. Modul in `games/<id>.ts`, 2. in der Gruppen-Datei `games/group-<format>.ts` eintragen, 3. Texte in `i18n/de-mg-<format>.ts`,
4. Test in `packages/shared/test/minigames/`. Engine, Host und Controller brauchen **keine** Änderung.
