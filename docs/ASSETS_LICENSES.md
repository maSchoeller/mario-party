# Lizenz-Register (ASSET-05, AUDIO-07)

Jedes Asset (3D, Audio, Font, Code-Bibliothek mit Laufzeit-Auslieferung) wird hier mit Quelle,
Lizenz, Tool/Tarif und Datum geführt. Generierungs-Details (Prompts, Task-/Audio-IDs, Modelle)
stehen maschinenlesbar in [asset-generation-log.json](asset-generation-log.json).
Erzeugung und Nachbearbeitung sind skriptbasiert: siehe [scripts/assets/README.md](../scripts/assets/README.md).

## ⚠ Nutzungsrechte (AUDIO-07): vor öffentlicher Freigabe klären

| Dienst | Genutzter Tarif (20.10.2026) | Rechtslage laut Anbieter (zu prüfen!) | Konsequenz |
|---|---|---|---|
| **ElevenLabs** (Stimme, SFX, Gebrabbel) | **Bezahlter Tarif** (seit 20.10.2026). Seit v0.3.1 sind **alle** ElevenLabs-Dateien im bezahlten Tarif erzeugt; die 19 SFX/Gebrabbel aus dem Free-Tarif wurden neu generiert. | Geprüft am 20.10.2026, siehe [Abschnitt unten](#elevenlabs-stimme-dimario-geprüft-am-20102026). Kurz: kommerzielle Nutzung erlaubt, Rechte am Output bleiben bei uns, keine Namensnennung nötig. | ✅ Erledigt. Neue Clips lassen sich nur mit aktivem bezahltem Tarif erzeugen. |
| **Suno** über **sunoapi.org** (Musik, Jingles) | Credits bei sunoapi.org (Drittanbieter, **keine offizielle Suno-API**) | Suno vergibt Eigentum/kommerzielle Rechte nur an Ausgaben aus bezahlten Suno-Abos. Welche Rechte über sunoapi.org entstehen, ist unklar (dortige AGB + Suno-AGB prüfen). | **Rechtlich größtes Risiko.** Vor öffentlicher Nutzung klären oder Musik mit eigenem Suno-Pro/Premier-Konto neu erzeugen. Die prozedurale Musik bleibt als Fallback eingebaut. |

## ElevenLabs-Stimme „DiMario“ (geprüft am 20.10.2026)

Keine Rechtsberatung, sondern eine Zusammenfassung der Anbieterbedingungen. Für ein kommerzielles Release gegebenenfalls juristisch bestätigen lassen.

| Frage | Ergebnis | Quelle |
|---|---|---|
| Dürfen wir die Clips kommerziell nutzen? | **Ja.** Mit bezahltem Abo ist kommerzielle Nutzung erlaubt (§1(c)(ii)); im Free-Tarif nur nicht-kommerziell (§1(c)(i)). | [ElevenLabs Terms of Use EU](https://elevenlabs.io/terms-of-use-eu) |
| Wem gehören die Aufnahmen? | **Uns.** „you retain all rights in and to your Output“ (§4(c)(ii)). ElevenLabs erhält eine nicht-exklusive Lizenz zur Verbesserung seiner Dienste (§4(d)). | Terms of Use EU |
| Müssen wir ElevenLabs oder den Sprecher nennen? | **Nein.** Weder die Bedingungen noch das Voice Library Addendum verlangen eine Namensnennung. Eine freiwillige Nennung im Impressum schadet nicht. | Terms of Use EU, [Voice Library Addendum EU](https://elevenlabs.io/vlaeu) |
| Was passiert, wenn der Sprecher die Stimme zurückzieht? | Die Stimme bleibt während der **Kündigungsfrist von 730 Tagen** nutzbar. Vorher erzeugte Aufnahmen bleiben **dauerhaft** nutzbar: „Outputs generated … prior to the end of the Notice Period will continue to exist and remain available for use thereafter“ (Addendum §4). | Voice Library Addendum EU, Stimmen-Daten per API |
| Was passiert nach Ende unseres Abos? | Die Rechte an den bereits erzeugten Dateien enden laut Bedingungen nicht (§4(c)(ii)). Wir haben alle Dateien lokal im Repo (§14: selbst exportieren). **Neue** Clips gehen nur mit aktivem bezahltem Abo. | Terms of Use EU |
| Gibt es Einschränkungen für die Stimme? | Professioneller Stimmklon aus der Bibliothek. „Voice mixing“ ist nicht erlaubt (machen wir nicht), es gilt die Prohibited Use Policy (harmlose Spielansagen). | ElevenLabs-API `GET /v1/voices/DQ4rTqXxHr077oQgsA9D` |

## Ausgelieferte Fremd-Bestandteile

| Bestandteil | Quelle | Lizenz | Verwendung | Datum |
|---|---|---|---|---|
| Nunito (Schrift) | `@fontsource/nunito` (Google Fonts, Vernon Adams u. a.) | SIL Open Font License 1.1 | UI auf TV und Handy (ART-06) | 2026-10-20 |
| Babylon.js | `@babylonjs/core` | Apache-2.0 | 3D-Engine Host (TECH-01) | 2026-10-20 |
| Babylon.js glTF-Loader | `@babylonjs/loaders` 9.31 | Apache-2.0 | GLB-Modelle laden (ASSET-03) | 2026-10-20 |
| Havok Physics (Web) | `@babylonjs/havok` | MIT (Havok-Web-Build von Babylon.js) | Physik-Effekte Host | 2026-10-20 |
| qrcode | `qrcode` (npm) | MIT | QR-Code in der Lobby | 2026-10-20 |
| meshoptimizer (Decoder) | `meshoptimizer` (npm, Arseny Kapoulkine) | MIT | Entpackt die meshopt-komprimierten GLBs im Browser; wird mit der App ausgeliefert (kein CDN) | 2026-10-20 |
| gltfpack (nur Build) | `gltfpack` (npm, Arseny Kapoulkine) | MIT | Komprimiert die GLBs (`scripts/assets/compress.mjs`); nicht ausgeliefert | 2026-10-20 |
| ws | `ws` (npm) | MIT | WebSocket-Server | 2026-10-20 |
| @azure/data-tables | Microsoft | MIT | Spielstände in Table Storage | 2026-10-20 |

## KI-generierte Audio-Assets

| Asset | Tool / Modell | Tarif | Dateien | Datum |
|---|---|---|---|---|
| Musik: Lobby, Kokosnuss-Küste (+Finale), Vulkan-Gipfel (+Finale), Bimmelbahn-Stadt (+Finale), 3 Minispiel-Stimmungen, Siegerehrung (11 Tracks) | Suno V6 (instrumental, Custom Mode) via sunoapi.org | sunoapi.org-Credits (12 Credits/Generierung) | `apps/web/public/media/audio/music/*.mp3` | 2026-10-20 |
| Jingles: Stern, Item, Ausbruch, Zug | Suno V6 via sunoapi.org, auf ≤ 4 s gekürzt | wie oben | `…/audio/sfx/jingle_*.mp3` | 2026-10-20 |
| Moderator „Käpt’n Plapperschnabel“ (57 ganze Sätze: Höhepunkte, Würfelzahlen −2…26, 8 Figurennamen) | ElevenLabs TTS `eleven_v3`, deutsche Bibliotheksstimme „DiMario – Energetic and Fun“ (`DQ4rTqXxHr077oQgsA9D`, per Casting ausgewählt) | bezahlt | `…/audio/voice/*.mp3` + `manifest.json` | 2026-10-20 |
| SFX (14) + Gebrabbel je Figur (5) | ElevenLabs Sound Generation | Free | `…/audio/sfx/*.mp3` | 2026-10-20 |
| Würfel-Klacken + Gebrabbel Bruno/Hoppla/Schildi/Zippy | ElevenLabs Sound Generation | bezahlt | `…/audio/sfx/clack.mp3`, `babble_*.mp3` | 2026-10-20 |

Nachbearbeitung (Stille kürzen, Lautheit angleichen, MP3-Bitrate) mit Blender 5.2 (audaspace), siehe
`scripts/assets/blender/audio.py`.

## Eigene Assets (Eigenleistung, keine Fremdrechte)

| Asset | Erzeugung | Datei |
|---|---|---|
| Helden Rocco/Quaki/Pingo/Foxy/Bruno/Hoppla/Schildi/Zippy, Moderator (Low-Poly, 3,3–4,0 k Dreiecke, gebackene AO in Vertexfarben, starres Teile-Rig) | Blender 5.2, Python-Skript (`scripts/assets/blender/characters.py`) | `apps/web/public/media/models/<figur>.glb` |
| Props + Wahrzeichen (69 Stück, v0.3 mit gebackener AO in Vertexfarben): gemeinsam (u. a. Item-Häuschen, Start-Tor, Schatzkiste, Duell- und Glücksschild, Laterne, Bank), Insel (Palmen, Büsche, Farn, Blumen, Gras, Muscheln, Klippe, Brücke, Steg, Boot, Leuchtturm, Ruine, Stelzenhütte), Vulkan (Lavafels, Kristall, Riesenpilz, Dampfschlot, Steinbrücke, Seilbahnstation, Gondel, Tempel, Knochen, Lore, Kaktus, Aschepflanze, Zelt), Stadt (Stadthäuser, Bahnhof, Waggon, Bäume, Hecke, Laterne, Blumenkasten, Kiosk, Marktstand, Laden, Steinbrücke, Fahrrad, Briefkasten) | Blender 5.2, Python-Skripte (`scripts/assets/blender/props*.py`, `propkit.py`) | `apps/web/public/media/models/props*.glb` |
| Prozedurale Fallbacks: Figuren, Props, Musik, SFX (die Browser-Sprachsynthese ist seit v0.3 entfernt; ohne Datei gibt es nur den Untertitel) | Code (greifen nur, wenn eine Datei fehlt) | `apps/web/src/host/render/*.ts`, `apps/web/src/host/audio.ts` |
| Emoji-Icons am Handy | System-Emoji-Schrift des Geräts | `apps/web/src/common/characters.ts` |
| Landschaft, Wasser, Lava, Detail-Texturen, 3D-Würfel | Prozedural zur Laufzeit (Höhenfeld + Canvas-Texturen), keine Bilddateien | `apps/web/src/host/render/terrain.ts`, `dice3d.ts` |

## Bewusste Abweichungen von der Asset-Pipeline der Spec

- **ASSET-01 (CC0-Pakete) / ASSET-02 (Meshy/Tripo):** Es gibt keine Zugänge zu KI-3D-Tools. Statt CC0-Paketen
  und KI-Meshes werden alle Modelle reproduzierbar per Blender-Skript gebaut. Dadurch gibt es keine Lizenzfragen
  und die Palette ist automatisch einheitlich (ART-05). Die Skripte lassen sich jederzeit durch importierte
  KI-/CC0-Meshes ersetzen, solange die Namenskonvention `<gruppe>__<material>` eingehalten wird.
- **„Geriggt“ (ASSET-02):** Statt Skelett und Skinning haben die Figuren ein starres Teile-Rig
  (Körper/Kopf/Arme an Drehpunkten). Die geforderten Animationen (ART-02) laufen prozedural auf diesen Gelenken.
- **ASSET-03 (Draco/meshopt):** Seit v0.3 sind die Modelle zusammen ~7,3 MB groß (mehr Details, Vertexfarben).
  Für den Laptop im Heimnetz ist das unkritisch; vor einem öffentlichen Deployment lohnt sich meshopt-Kompression
  (offener Punkt). Texturen sind prozedural (Laufzeit), daher kein KTX2.
