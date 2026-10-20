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
| Moderator-Sprachbausteine (ElevenLabs) | `npx tsx scripts/assets/voice.ts [--dry]` | ≈ 2.800 Zeichen |
| SFX + Gebrabbel (ElevenLabs) | `node scripts/assets/sfx.mjs [key …]` | ≈ 220 Credits |

Wird ein Moderator-Text (`mod.*` in `packages/shared/src/i18n/de.ts`) geändert, ergänzt `voice.ts` nur die
neuen Bausteine. `packages/shared/test/voice.test.ts` schlägt fehl, solange ein Baustein fehlt.
Für eine andere Sprache: Wörterbuch ergänzen, Skript mit dem neuen Wörterbuch laufen lassen.

## 3. Bauen (Blender 5.x, kein ffmpeg nötig)

```bash
node scripts/assets/build.mjs
```

- `models`: `blender/characters.py` + `blender/props.py` → GLB (Dreiecks-Budget wird geprüft)
- `audio`: `blender/audio.py` → Stille kürzen, Lautheit angleichen, MP3

Blender-Pfad bei Bedarf über `BLENDER=/pfad/zu/blender` setzen. Vorschau-Renderings:
`blender -b -P scripts/assets/blender/preview.py -- --out vorschau.png apps/web/public/media/models/foxy.glb`.

## Konventionen

- Koordinaten in den Blender-Skripten sind **Babylon-Koordinaten** (Y oben, Blick nach −Z). `lib.B()` rechnet um.
- Mesh-Namen `<gruppe>__<material>`: Gruppe = Rig-Teil (`body`, `head`, `armL`, `armR`) oder Prop-ID.
  Material `c_<hex>` = Palettenfarbe, `glow_<hex>` = leuchtend, `tint` = Farbe zur Laufzeit.
- Fehlt eine Datei, nutzt der Host automatisch die prozeduralen Platzhalter.
