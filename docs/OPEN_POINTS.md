# Offene Punkte

Stand 21.10.2026 (v0.5). Alles andere ist lokal lauffähig und getestet, siehe [STATUS.md](STATUS.md).

## 0b. Neu in v0.5 (Feinschliff, zur Abnahme)

| Thema | Ergebnis | Zur Abstimmung |
|---|---|---|
| **Bots gegen Menschen** | Minispiel-Bots folgen einem menschlichen Referenzmodell (Reaktionszeit, Tippen, Zielen, Zählen …), sehen nur, was am TV sichtbar ist, und reagieren mit TV-Verzögerung ([BALANCING.md](BALANCING.md)). | In reinen Geschicklichkeitsspielen (Tippen, Schnellzieher, Schatz-Tauziehen, Strich-Künstler) gewinnt „Schwer“ gegen „Mittel“ weiter 85–98 %. Mehr Streuung pro Bot wäre möglich, wirkt aber unrealistisch. |
| **Geänderte Spielgefühle** | Ballon-Bombardement: ein Pumpstoß braucht 0,2 s (hektisches Schütteln ist nicht schneller). Kokos-Kanonier: Flugzeit 0,68 s, Trefferradius 2,0. Laternen-Jagd: Fangzeit 1,25 → 0,85 s. Joystick: äußerer Ring = volle Geschwindigkeit. Wackel-Brücke: sanftere Böen. Tandem-Tretboot: kürzere Strecke. | Kurzer Playtest mit Menschen. |
| **Vulkan-Map** | Der Kraterpfad führt jetzt wirklich über den Vulkan, der Ringweg außen herum, die Lava entspringt im Krater. Feldzahl/Abzweigungen gleich. | – |
| **Weitere Felder** | Kokosnuss 73 → 75 Felder (Dschungel- und Leuchtturmweg je +1), Bimmelbahn 61 → 62 (Marktstraße +1) – sonst gab es zu lange Einzelschritte. | – |
| **Minimap, Items, Inventar, Lautstärke** | Minimap unten Mitte; Item-Symbole auf allen TV-Spielerkarten; 🎒-Inventar jederzeit am Handy; Lautstärke im Bandenchef-Menü, Zahnrad am TV nur bei Mausbewegung. | – |
| **Bandenchef nach Reconnect** | Verbindet sich das Handy des Bandenchefs kurz neu, geht die Rolle an den nächsten Spieler und kommt nicht zurück. | Soll die Rolle bei Rückkehr zurückgehen? |
| **Sterne auf reichen Maps** | Kokosnuss/Vulkan enden mit 55–67 ungenutzten Münzen (Sterne sind durch Wege, nicht Münzen begrenzt). | Sternpreis auf diesen Maps erhöhen? |
| **Charakterwürfel** | Foxy 18,7 ± 4,4 % (300 Partien), sonst alle um 25 %. | Beobachten, erst mit 600+ Partien entscheiden. |
| **Laternen-Radar** | Während der Solo läuft, schickt der Host 7–10 Ansichten pro Sekunde an alle Handys. | Bei Problemen im echten WLAN nur an den Solo senden. |

## 0a. Neu in v0.4 (Feature-Branch, zur Abnahme)

| Thema | Ergebnis | Zur Abstimmung |
|---|---|---|
| **Minispiel-Kulissen** | Jedes Minispiel steht in einer Landschaft wie die Maps: 12 Sets (Lagune, Strand, Vulkan, Gipfel, Wiese, Garten, Stadt, Eismeer, Wolken, Studio, Wüste, Nachtwald) mit Gelände, Wasser/Lava, Vegetation, Licht und Partikeln. | Zuordnung Spiel → Kulisse (z. B. Schnick-Schnack am Strand, Weichen-Chaos auf der Wiese). |
| **Detail im Spielfeld** | Holz-, Planken-, Stein-, Eis-, Sand-Texturen; echte Modelle statt Klötzchen (Kanone, Lok, Kisten, Fahnen, Staffeleien …); 8 neue Blender-Props. | – |
| **Ton & Übergänge** | Iris-Blende Brett ↔ Minispiel, Kamera-Anflug, Musik leiser unter der Erklärung, Countdown-Ticks, Startsignal, Abpfiff mit gedämpfter Musik, Jubel + Konfetti über den Siegern, Ergebnis über der Szene; Effekt-Töne im Stereo-Panorama, Ambient-Loop je Kulisse. | Lautstärke der Ambient-Loops (derzeit deutlich unter den Effekten). |
| **Zeit** | Der Wechsel Brett → Minispiel → Brett dauert durch Blenden und Jubel ≈ 3 s länger. | – |
| **Prüfen am echten TV** | Lesbarkeit aus 3 m und 60 fps mit Kulisse auf dem Referenz-Laptop; Emoji-Beschriftungen (✊✋✌️) im Browser des TV-Laptops. | – |

## 0. Neu in v0.3

| Thema | Ergebnis | Zur Abstimmung |
|---|---|---|
| **Würfel** | 2 echte 3D-Würfel pro Zug: Standard + frei wählbarer 2. Würfel. 8 Charakterwürfel und 2 Würfel-Items (Risiko, Gold), alle mit Ø 3,5 Schritten, aber anderer Streuung. Negative Summe = rückwärts laufen. | Würfel-Items sind **Einmal-Items** (wie die anderen Items), keine dauerhafte Sammlung. |
| **Figuren** | 8 statt 4: neu sind Bruno (Bär), Hoppla (Hase), Schildi (Schildkröte) und Zippy (Eichhörnchen). Alle Figuren sind mit mehr Details neu modelliert. | Farben der neuen Figuren und Namen der Würfel. |
| **Maps** | Alle 3 Maps neu mit 61–73 Feldern und 4–5 Abzweigungen. Die Landschaft wird aus den Map-Daten gebaut (Höhen, Fluss/Lava/Kanal, Brücken, Steg, Gebäude an den Feldern, Vegetation). | Kokosnuss: Bei Flut sind Furt **und** Sandbank gesperrt. |
| **Stimme** | Neue deutsche Stimme „DiMario“. Sie spricht nur noch an Höhepunkten und die Würfelzahl, sonst gibt es nur Untertitel. Die Browser-Sprachausgabe ist entfernt. | Welche Momente vertont sind: `VOICE_LINES` in `packages/shared/src/i18n/voice.ts`. |
| **Ton** | Master-Kompressor, Equal-Power-Crossfades, Mini-Fades gegen Klicks bei allen Effekten, weiches Ducking unter der Stimme, Pause blendet den Ton ab, Würfel-Klacken bei jedem Aufprall. | – |
| **Ladezeit** | v0.3.1: Die Modelle sind meshopt-komprimiert, 7,3 MB → 1,95 MB (−73 %), optisch identisch. Der Decoder wird mit der App ausgeliefert. | ✅ Erledigt |


## 1. Erledigt in v0.2

| Thema | Spec | Ergebnis |
|---|---|---|
| **Suno (Musik)** | AUDIO-01 | 11 Loop-Tracks (Lobby, 3 Maps + je Finale-Variante, 3 Minispiel-Stimmungen, Siegerehrung) + 4 Jingles (Stern, Item, Ausbruch, Zug) mit Suno V6 erzeugt. Prompt-Leitfaden = `scripts/assets/music.mjs`. Streaming mit Crossfade-Loop. |
| **ElevenLabs (SFX, Moderator)** | AUDIO-02/03/04 | 177 Moderator-Sprachbausteine (deutsch, `eleven_v3`), 14 SFX, Gebrabbel je Figur. Sätze werden zur Laufzeit aus Bausteinen zusammengesetzt. Statt freier Nicknames sagt der Moderator den Figurennamen, im Untertitel steht weiter der Nickname. |
| **3D-Modelle + Blender** | ASSET-01..04, ART-02 | 4 Helden + Moderator + 14 Props/Wahrzeichen als GLB, per Blender-Skript gebaut (1,4–1,7 k Dreiecke je Figur). Abweichungen siehe [ASSETS_LICENSES.md](ASSETS_LICENSES.md#bewusste-abweichungen-von-der-asset-pipeline-der-spec). |
| **Bicep validiert** | OPS-01..04 | `az bicep build`/`lint` ohne Warnungen (Speicherkonto-Name korrigiert). **Nicht deployt** (Entscheidung: nur lokal validieren). |
| **Impressum/Datenschutz** | SEC-03 | Entwürfe unter `/impressum.html` und `/datenschutz.html` (verlinkt auf der Startseite). Sie beschreiben die tatsächliche Verarbeitung, inkl. Google-STUN und 7-Tage-Spielständen. Platzhalter für Name/Anschrift. |
| **Marken-Kurzrecherche** | 15 | Websuche nach „Würfel-Bande“/„Würfelbande“ als Spiel/Marke: kein Treffer (nur ähnlich: „Die Bar-Bolz-Bande“, „Würfelhelden“ von AMIGO). Ersetzt **keine** Registerrecherche, siehe unten. |
| Testansicht `/dev` | – | Simulierte Handys teilen sich keinen Session-Token mehr. |
| `npm run dev` / Bundle-Check unter Windows | – | `spawn npm` und Pfad in `check-bundle.mjs` korrigiert. |

## 2. Braucht weiterhin Menschen, Accounts oder Geld

| Thema | Spec | Was fehlt |
|---|---|---|
| **Nutzungsrechte Audio** | AUDIO-07 | ElevenLabs ✅ (v0.3.1): Alle Stimm- und SFX-Dateien sind im bezahlten Tarif erzeugt, kommerziell nutzbar. **Offen bleibt Suno:** Die Musik läuft über den inoffiziellen Drittanbieter sunoapi.org, die Rechtelage ist unklar. Vor öffentlicher Freigabe klären oder mit eigenem Suno-Pro-Konto neu erzeugen. Details: [ASSETS_LICENSES.md](ASSETS_LICENSES.md). |
| **Moderator-Stimme** | AUDIO-03 | ✅ Erledigt: deutsche Bibliotheksstimme „DiMario“, nur ganze Sätze. Lizenz geprüft (kommerziell erlaubt, keine Namensnennung, Kündigungsfrist 730 Tage), siehe [ASSETS_LICENSES.md](ASSETS_LICENSES.md#elevenlabs-stimme-dimario-geprüft-am-20102026). |
| **Azure-Deployment** | OPS-01..04, 12 | Subscription, Ressourcengruppe, Service Principal (OIDC), Budget-E-Mail. `infra/main.bicep` ist lokal valide, ein `what-if` gegen Azure steht aus. |
| **GitHub Container Registry** | 12 | Push-Rechte/Package-Sichtbarkeit |
| **Application Insights** | PRIV-02 | Connection-String (Weiterleitung ungetestet gegen Azure) |
| **Blob Storage für Assets** | PERF-02 | Die Assets (~19 MB, davon Musik 15 MB gestreamt) liegen derzeit in `public/media` und werden mit der Static Web App ausgeliefert. Ein Umzug in den Blob-Container `assets` ist optional. |
| **Impressum/Datenschutz** | SEC-03 | Platzhalter (Name, Anschrift, Region, Aufsichtsbehörde) ausfüllen und rechtlich prüfen lassen |
| **Markenrecherche** | 15 | Amtliche Prüfung in DPMAregister / TMview / EUIPO (Klassen 9, 28, 41) |
| **Echte KI-3D-Modelle** | ASSET-02 | optional: Meshy/Tripo-Zugang. Die Blender-Pipeline nimmt importierte Meshes auf. |

## 3. Nicht automatisiert prüfbar (Hardware/Geräte)

| Thema | Spec | Stand |
|---|---|---|
| 60 fps @1080p auf Referenz-Laptop | PERF-01, 17.6 | Referenzgerät nicht festgelegt. Automatische Qualitätsabsenkung eingebaut. Mit den GLB-Modellen insgesamt < 25 k Dreiecke je Szene, Draw Calls in der Größenordnung der Platzhalter. |
| iOS Safari / Android Chrome | PERF-04, CTRL-06 | Nur mit Desktop-Chromium (Touch-Emulation) getestet. Gyro-Freigabe braucht HTTPS (`HTTPS=1 npm run dev`). |
| Safari/Firefox/Edge als Host | PERF-03 | Nur Chromium getestet (Audio-Streaming per `MediaElementSource` in Safari prüfen). |
| P2P im echten Heim-WLAN, Latenz < 100 ms | NET-01/04 | Lokal getestet, kein TURN in v1 (laut Spec) |
| Beitritt per QR < 30 s | 16 | Messung mit echten Handys offen |

## 4. Bewusste Vereinfachungen / Design-Entscheidungen (zur Abstimmung)

- **Moderator spricht sparsam** (v0.3): Würfelzahl, Map-Intro, Gezeiten/Ausbruch/Zug, Stern, Duell, Minispiel,
  Finale, Bonus und Sieger (mit Figurennamen). Alles mit Spielernamen steht nur im Untertitel.
- **Minispiel-Physik** läuft deterministisch in eigener TypeScript-Simulation. Havok nutzen wir nur für visuelle Effekte.
- **Teamzuteilung** (Spec 17.7): nach Feldfarbe (blau/rot, neutrale Felder zufällig) oder „zufällig“.
- **3 Spieler ohne Bots**: Runden-Minispiele sind dann immer „Jeder gegen Jeden“.
- **Bahnticket** ist eine map-spezifische Ressource (nicht eines der 8 Items).
- **Kein Speichern mitten im Minispiel**: Nach Host-Reload startet ein laufendes Minispiel neu.
- **Balancing-Werte** per Bot-Simulation justiert ([BALANCING.md](BALANCING.md)), echter Playtest steht aus.
- **Mini-Würfel** lässt 1–3 Schritte frei wählen (ersetzt beide Würfel).
