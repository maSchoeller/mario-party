# Lizenz-Register (ASSET-05, AUDIO-07)

Jedes Asset (3D, Audio, Font, Code-Bibliothek mit Laufzeit-Auslieferung) wird hier mit Quelle,
Lizenz, Tool/Tarif und Datum geführt. **Stand v0.1 (20.10.2026): es werden noch keine externen
3D-/Audio-Assets ausgeliefert** – alle Figuren, Props und Klänge sind prozedural im Code erzeugte
Platzhalter (siehe [OPEN_POINTS.md](OPEN_POINTS.md)).

## Ausgelieferte Fremd-Bestandteile

| Bestandteil | Quelle | Lizenz | Verwendung | Datum |
|---|---|---|---|---|
| Nunito (Schrift) | `@fontsource/nunito` (Google Fonts, Vernon Adams u. a.) | SIL Open Font License 1.1 | UI auf TV und Handy (ART-06) | 2026-10-20 |
| Babylon.js | `@babylonjs/core` | Apache-2.0 | 3D-Engine Host (TECH-01) | 2026-10-20 |
| Havok Physics (Web) | `@babylonjs/havok` | MIT (Havok-Web-Build von Babylon.js) | Physik-Effekte Host | 2026-10-20 |
| qrcode | `qrcode` (npm) | MIT | QR-Code in der Lobby | 2026-10-20 |
| ws | `ws` (npm) | MIT | WebSocket-Server | 2026-10-20 |
| @azure/data-tables | Microsoft | MIT | Spielstände in Table Storage | 2026-10-20 |

## Eigene Platzhalter-Assets (Eigenleistung, keine Fremdrechte)

| Asset | Erzeugung | Datei |
|---|---|---|
| Helden Rocco/Quaki/Pingo/Foxy, Moderator | prozedurale Low-Poly-Geometrie | `apps/web/src/host/render/characters.ts` |
| Palmen, Hütten, Felsen, Vulkan, Häuser, Zug, Münzen, Stern | prozedural | `apps/web/src/host/render/props.ts`, `board.ts`, `minigameView.ts` |
| Musik je Map + Finale, Minispiel-, Lobby-, Sieger-Loops | prozedural (WebAudio) | `apps/web/src/host/audio.ts` |
| SFX, Figuren-Gebrabbel | prozedural (WebAudio) | `apps/web/src/host/audio.ts` |
| Moderator-Stimme | Browser-Sprachsynthese (Systemstimme des Host-Geräts, nicht ausgeliefert) | `apps/web/src/host/audio.ts` |
| Emoji-Icons am Handy | System-Emoji-Schrift des Geräts | `apps/web/src/common/characters.ts` |

## Geplante Einträge (noch offen)

| Asset-Gruppe | Quelle (geplant) | Lizenz/Tarif zu prüfen |
|---|---|---|
| Umgebung & Props | Quaternius, Kenney, Poly Pizza | CC0 – je Paket Datum/Version eintragen |
| Helden, Moderator, Map-Wahrzeichen | Meshy/Tripo + Blender | Nutzungsrechte je Tarif (kommerzielle Nutzung?) |
| Musik | Suno | Tarif mit kommerzieller Nutzung für öffentliche Freigabe |
| SFX & Moderator-Stimme | ElevenLabs | Tarif/Lizenz der Stimme |
