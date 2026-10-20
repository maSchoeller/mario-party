# Asset-Pipeline

Alle Modelle und Audio-Dateien unter `apps/web/public/media/` werden von diesen Skripten erzeugt.
Rohdaten (Downloads) landen in `assets-src/` (nicht im Repo).

## 1. API-Tokens (einmalig)

```bash
pwsh scripts/set-secrets.ps1
```

Liest `SUNO_API_KEY` (sunoapi.org) und `ELEVENLABS_API_KEY` verdeckt ein und speichert sie in
`%USERPROFILE%\.wuerfel-bande\secrets.env` (nur für den Benutzer lesbar, außerhalb des Repos).
Alternativ werden gleichnamige Umgebungsvariablen verwendet. `node scripts/assets/check-apis.mjs`
zeigt Credits und Zugriff.

## 2. Generieren (kostet Credits, nur fehlende Dateien)

| Schritt | Befehl | Kosten (20.10.2026) |
|---|---|---|
| Musik + Jingles (Suno V6, Prompt-Leitfaden in `music.mjs`) | `node scripts/assets/music.mjs [key …]` | 12 Credits/Track |
| Moderator-Clips: ganze Sätze, Würfelzahlen, Figurennamen (ElevenLabs, Stimme „DiMario“) | `npx tsx scripts/assets/voice.ts [--dry]` | ≈ 1.500 Zeichen |
| SFX + Gebrabbel (ElevenLabs) | `node scripts/assets/sfx.mjs [key …]` | ≈ 220 Credits |

Die vertonten Sätze stehen in `VOICE_LINES` (`packages/shared/src/i18n/voice.ts`). Ändert sich ein Text, nimmt
`voice.ts` nur diesen Clip neu auf, denn das Manifest speichert einen Hash je Text. `packages/shared/test/voice.test.ts`
schlägt fehl, solange ein Clip fehlt oder veraltet ist.
Für eine andere Sprache: Wörterbuch ergänzen, Skript mit dem neuen Wörterbuch laufen lassen.

## 3. Bauen (Blender 5.x, kein ffmpeg nötig)

```bash
node scripts/assets/build.mjs
```

- `models`: `blender/characters.py` + Prop-Bibliotheken → GLB nach `assets-src/models` (Dreiecks-Budget wird geprüft),
  danach `compress.mjs`: meshopt-Kompression mit `gltfpack` nach `apps/web/public/media/models` (~73 % kleiner;
  der Decoder wird mit der App ausgeliefert, kein CDN). Nur neu komprimieren: `node scripts/assets/build.mjs compress`
  - `props.py` → `props.glb` (gemeinsame Props + Feld-Gebäude), `props_island.py`, `props_volcano.py`,
    `props_city.py` → `props_<thema>.glb`; Bausteine in `propkit.py`, Budgets: Streu-Vegetation ≤ 300
    (Gras ≤ 40), normale Props ≤ 2.500, Landmarken ≤ 6.000 Dreiecke pro Prop
  - einzelne Props neu bauen: `blender -b --factory-startup -P scripts/assets/blender/props_city.py -- --out <dir> --only kiosk,bike`
- `audio`: `blender/audio.py` → Stille kürzen, Lautheit angleichen, MP3

Blender-Pfad bei Bedarf über `BLENDER=/pfad/zu/blender` setzen. Vorschau-Renderings:
`blender -b -P scripts/assets/blender/preview.py -- --out vorschau.png assets-src/models/foxy.glb`,
Kontaktbogen einer Prop-Bibliothek (EEVEE, Licht wie im Spiel, `tint` = `--tint`):
`blender -b -P scripts/assets/blender/preview.py -- --sheet --out assets-src/previews/props/props_city.png assets-src/models/props_city.glb`.

## Konventionen

- Koordinaten in den Blender-Skripten sind **Babylon-Koordinaten** (Y oben, Blick nach −Z). `lib.B()` rechnet um.
- Mesh-Namen `<gruppe>__<material>`: Gruppe = Rig-Teil (`body`, `head`, `armL`, `armR`) oder Prop-ID.
  Material `c_<hex>` = Palettenfarbe, `glow_<hex>` = leuchtend, `tint` = Farbe zur Laufzeit.
- Props tragen Vertex-Farben (`COLOR_0`, ≈ 0,55–1,0: Ton-Variation, Verlauf, gebackene AO), die die
  Palettenfarbe multiplizieren; Export mit `export_vertex_color='ACTIVE'`.
- Fehlt eine Datei, nutzt der Host automatisch die prozeduralen Platzhalter.
