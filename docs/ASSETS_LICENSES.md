# Lizenz-Register (ASSET-05, AUDIO-07)

Jedes Asset (3D, Audio, Font, Code-Bibliothek mit Laufzeit-Auslieferung) wird hier mit Quelle,
Lizenz, Tool/Tarif und Datum geführt. Generierungs-Details (Prompts, Task-/Audio-IDs, Modelle)
stehen maschinenlesbar in [asset-generation-log.json](asset-generation-log.json).
Erzeugung und Nachbearbeitung sind skriptbasiert: siehe [scripts/assets/README.md](../scripts/assets/README.md).

## ⚠ Nutzungsrechte (AUDIO-07): vor öffentlicher Freigabe klären

| Dienst | Genutzter Tarif (20.10.2026) | Rechtslage laut Anbieter (zu prüfen!) | Konsequenz |
|---|---|---|---|
| **ElevenLabs** (Stimme, SFX, Gebrabbel) | **Free** (API-Key mit eingeschränkten Rechten; Bibliotheks- und Design-Stimmen per API gesperrt) | Free-Tarif: Ausgaben nur **nicht-kommerziell** und **mit Namensnennung** („ElevenLabs“). Kommerzielle Nutzung ab Starter-/Creator-Tarif. | Für den privaten Spieleabend ok (Namensnennung im Impressum). Vor öffentlicher Freigabe: Tarif upgraden und Clips neu erzeugen (Skripte sind idempotent) oder Lizenzlage bestätigen. |
| **Suno** über **sunoapi.org** (Musik, Jingles) | Credits bei sunoapi.org (Drittanbieter, **keine offizielle Suno-API**) | Suno vergibt Eigentum/kommerzielle Rechte nur an Ausgaben aus bezahlten Suno-Abos. Welche Rechte über sunoapi.org entstehen, ist unklar (dortige AGB + Suno-AGB prüfen). | **Rechtlich größtes Risiko.** Vor öffentlicher Nutzung klären oder Musik mit eigenem Suno-Pro/Premier-Konto neu erzeugen. Die prozedurale Musik bleibt als Fallback eingebaut. |

## Ausgelieferte Fremd-Bestandteile

| Bestandteil | Quelle | Lizenz | Verwendung | Datum |
|---|---|---|---|---|
| Nunito (Schrift) | `@fontsource/nunito` (Google Fonts, Vernon Adams u. a.) | SIL Open Font License 1.1 | UI auf TV und Handy (ART-06) | 2026-10-20 |
| Babylon.js | `@babylonjs/core` | Apache-2.0 | 3D-Engine Host (TECH-01) | 2026-10-20 |
| Babylon.js glTF-Loader | `@babylonjs/loaders` 9.31 | Apache-2.0 | GLB-Modelle laden (ASSET-03) | 2026-10-20 |
| Havok Physics (Web) | `@babylonjs/havok` | MIT (Havok-Web-Build von Babylon.js) | Physik-Effekte Host | 2026-10-20 |
| qrcode | `qrcode` (npm) | MIT | QR-Code in der Lobby | 2026-10-20 |
| ws | `ws` (npm) | MIT | WebSocket-Server | 2026-10-20 |
| @azure/data-tables | Microsoft | MIT | Spielstände in Table Storage | 2026-10-20 |

## KI-generierte Audio-Assets

| Asset | Tool / Modell | Tarif | Dateien | Datum |
|---|---|---|---|---|
| Musik: Lobby, Kokosnuss-Küste (+Finale), Vulkan-Gipfel (+Finale), Bimmelbahn-Stadt (+Finale), 3 Minispiel-Stimmungen, Siegerehrung (11 Tracks) | Suno V6 (instrumental, Custom Mode) via sunoapi.org | sunoapi.org-Credits (12 Credits/Generierung) | `apps/web/public/media/audio/music/*.mp3` | 2026-10-20 |
| Jingles: Stern, Item, Ausbruch, Zug | Suno V6 via sunoapi.org, auf ≤ 4 s gekürzt | wie oben | `…/audio/sfx/jingle_*.mp3` | 2026-10-20 |
| Moderator „Käpt’n Plapperschnabel“ (177 Sprachbausteine) | ElevenLabs TTS `eleven_v3`, Premade-Stimme „Callum“ | Free | `…/audio/voice/*.mp3` + `manifest.json` | 2026-10-20 |
| SFX (14) + Gebrabbel je Figur (5) | ElevenLabs Sound Generation | Free | `…/audio/sfx/*.mp3` | 2026-10-20 |

Nachbearbeitung (Stille kürzen, Lautheit angleichen, MP3-Bitrate) mit Blender 5.2 (audaspace), siehe
`scripts/assets/blender/audio.py`.

## Eigene Assets (Eigenleistung, keine Fremdrechte)

| Asset | Erzeugung | Datei |
|---|---|---|
| Helden Rocco/Quaki/Pingo/Foxy, Moderator (Low-Poly, 1,4–1,7 k Dreiecke, starres Teile-Rig) | Blender 5.2, Python-Skript (`scripts/assets/blender/characters.py`) | `apps/web/public/media/models/<figur>.glb` |
| Props + Wahrzeichen: Palme, Hütte, Stadthaus, Fels, Baum, toter Baum, Obsidian, Vulkan, Kokos-Kanone, Krabbe, Uhrturm, Brunnen, Lok, Marktstand | Blender 5.2, Python-Skript (`scripts/assets/blender/props.py`) | `apps/web/public/media/models/props.glb` |
| Prozedurale Fallbacks: Figuren, Props, Musik, SFX, Moderator per Browser-Sprachsynthese | Code (greifen nur, wenn eine Datei fehlt) | `apps/web/src/host/render/*.ts`, `apps/web/src/host/audio.ts` |
| Emoji-Icons am Handy | System-Emoji-Schrift des Geräts | `apps/web/src/common/characters.ts` |

## Bewusste Abweichungen von der Asset-Pipeline der Spec

- **ASSET-01 (CC0-Pakete) / ASSET-02 (Meshy/Tripo):** Es gibt keine Zugänge zu KI-3D-Tools. Statt CC0-Paketen
  und KI-Meshes werden alle Modelle reproduzierbar per Blender-Skript gebaut. Dadurch gibt es keine Lizenzfragen
  und die Palette ist automatisch einheitlich (ART-05). Die Skripte lassen sich jederzeit durch importierte
  KI-/CC0-Meshes ersetzen, solange die Namenskonvention `<gruppe>__<material>` eingehalten wird.
- **„Geriggt“ (ASSET-02):** Statt Skelett und Skinning haben die Figuren ein starres Teile-Rig
  (Körper/Kopf/Arme an Drehpunkten). Die geforderten Animationen (ART-02) laufen prozedural auf diesen Gelenken.
- **ASSET-03 (Draco/meshopt):** Die Modelle sind zusammen ~0,9 MB groß. Ein Draco-Decoder (~300 KB WASM) bzw.
  meshopt würde mehr Komplexität bringen, als er spart. Texturen gibt es keine, daher kein KTX2.
