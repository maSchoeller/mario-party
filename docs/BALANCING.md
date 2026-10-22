# Balancing & unabhängiger Review

## v0.5: Bots gegen Menschen, Brett-Regeln

### Menschliches Referenzmodell (Minispiel-Bots)

Bots waren bisher gegeneinander abgestimmt, nicht gegen Menschen am TV. Seit v0.5 richten sie sich nach
`HUMAN_REF` in `packages/shared/src/minigames/types.ts`:

| Stufe | Vorbild | Reaktion (ohne TV-Latenz) | Tippen | Joystick-Fehler | Schätzen 10 s blind |
|---|---|---|---|---|---|
| Leicht | Kind / Erstspieler | 0,40 ± 0,08 s | 5,0/s | ±0,25 rad | ±1,5 s |
| Mittel | Gelegenheitsspieler | 0,28 ± 0,05 s | 6,3/s | ±0,15 rad | ±0,8 s |
| Schwer | geübter Erwachsener (Top ~20 %) | 0,23 ± 0,035 s | 7,5/s | ±0,09 rad | ±0,45 s |
| Obergrenze | bester Mensch – kein Bot darf besser sein | 0,18 s | 9,5/s | ±0,05 rad | ±0,25 s |

- **Wahrnehmung:** Bots sehen nur, was am TV sichtbar ist (kein versteckter Wind, keine exakte Tierzahl, keine
  Labyrinth-Suche), und das verzögert: +0,11 s bei Tasten mit Zeitstempel, +0,15 s bei Joystick/Neigen/Wischen/Auswahl.
- **Tagesform:** Jeder Bot spielt jedes Minispiel mit eigener Form (±10 %), zusätzlich zur Stufen-Tagesform des Hosts.
- **Gleiche Regeln für alle:** max. 10 Taps/s (gegen Zwei-Daumen-Trommeln), Schüttel-Impulse mit Mindestabstand,
  Tipp-Ersatz so stark wie echtes Schütteln. Tests laufen jetzt mit 60 Hz wie der Host.

### Ergebnisse je Minispiel (Bot gegen Bot, 200–400 Seeds)

„Schwer vs. Mittel“ = Anteil, in dem der schwere Bot vor dem mittleren landet (FFA) bzw. gewinnt (Duell/2v2).

| Spiel | Schwer vs. Mittel vorher → nachher | Gleichstand Platz 1 vorher → nachher |
|---|---|---|
| Kokos-Regen | 96–99 % → 61–66 % | 16 % → 0 % |
| Schubs-Scholle | 40 % (Schwer war schwächer!) → 54–62 % | ~1 % → 0 % |
| Wackel-Brücke | 100 % → 69–73 % | – |
| Strich-Künstler | 100 % → 85 % | ≤ 6 % → ≤ 5 % |
| Zehn Sekunden | 87 % → 76 % | 0–1 % → 0 % |
| Zähl-Zoo | 87 % → 77 % | 21–41 % → 0 % |
| Gipfel-Sprint | 100 % → 93 % | 0–14 % → 0 % |
| Lava-Seil | 65 % → 68 % | 1–14 % → 0 % |
| Gipfelsturm (Finale) | 98 % → 90–94 % | 0–1 % |
| Schnellzieher (Duell) | 100 % → 88 % | 0 % |
| Memo-Duell (Duell) | 85 % → 87 % | 0 % |
| Schnick-Schnack (Duell) | 51 % → 49 % | 0 % |
| Floß-Rumble (2v2) | 73 % → 70–74 % | 1 % → 1–4 % |
| Tandem-Tretboot (2v2) | 100 % → 68–74 % | – |
| Weichen-Chaos (2v2) | 91 % → 81–84 % | 0 % |
| Paket-Kette (2v2) | 81 % → 76 % | 2 % |
| Schatz-Tauziehen (2v2) | 100 % → 98 % | – |

- **Tandem-Tretboot:** Vorher kamen „Leicht + Leicht“ und „Schwer + Leicht“ nie ins Ziel. Jetzt schafft es jedes
  Team (Leicht + Leicht in 95 % der Fälle, Median 40 s).
- **Reine Geschicklichkeit bleibt über 75 %** (Tippen, Schnellzieher, Schatz-Tauziehen, Strich-Künstler): Der Abstand
  zwischen „Gelegenheitsspieler“ und „geübt“ ist dort größer als die Tagesform. Im echten Spiel spielt ein schwerer
  Bot zusätzlich in 40 % der Minispiele nur als mittel oder leicht (`minigameBotLevel`).

### 1 gegen 3: Siegquote des Solos (Ziel 35–45 %, bei 12 vs. 8 Münzen fair)

| Spiel | Leicht/Leicht vorher → nachher | Mittel/Mittel | Schwer/Schwer | Extremfall vorher → nachher |
|---|---|---|---|---|
| Laternen-Jagd | 44 → 48 % | 41 → 39 % | 39 → 43 % | 0 % / 100 % → 33 % / 65 % |
| Kokos-Kanonier | 87 → 33 % | 71 → 36 % | 45 → 42 % | 99 % → 64 % |
| Wand-Labyrinth | 49 → 44 % | 45 → 49 % | 47 → 49 % | – |
| Ballon-Bombardement | 89 → 40 % | 50 → 42 % | 66 → 45 % | 99 % → 73 % |

- Laternen-Jagd: Der Solo sieht seine Position jetzt als Radar am Handy (ohne Sucher). Vorher war ein menschlicher
  Solo praktisch blind.
- Wand-Labyrinth: Abklingzeit des Solos 0,8 → 0,6 s. Mittel/Mittel und Schwer/Schwer liegen mit 49 % knapp über dem Ziel.

### Brett (Regeln v0.5)

Gemessen mit `npx tsx packages/shared/scripts/balance.ts` (300 Partien je Map, 20 Runden, ±95 %-Intervalle).

| Kennzahl (Ziel) | Kokosnuss | Vulkan | Bimmelbahn |
|---|---|---|---|
| Letzter nach Runde 10 gewinnt (15–18 %) | 16 ± 4 % | 19 ± 4 % | 19 ± 4 % |
| Bonus-Sterne an Vorab-Führende (≤ 40 %) | 30 % | 32 % | 35 % |
| 2 harte gegen 2 leichte Bots: harte Sitze gewinnen | 82 ± 8 % | 84 ± 7 % | 85 ± 7 % |
| Ø Endmünzen | 55,5 | 67,0 | 31,1 |
| Gekaufte Sterne / Partie | 10,3 | 12,1 | 15,9 |

- Die frühere Messung „7–10 %“ für die Aufholjagd war Rauschen aus 60 Partien. Das Halbzeit-Rad dreht jetzt nach
  genau der Hälfte der Runden (vorher eine Runde früher), ein „Stern klauen“ wurde zu „+10 Münzen“.
- **Regelfehler behoben** (40 Partien je Map, vorher → nachher): Schritte in die Flut 285 → 0, zweiter Stern im selben
  Zug 49 → 0, Duelle mit Einsatz 0: 4 → 0.
- „Harte Sitze gewinnen“ ist mit 82–85 % über dem alten Ziel 70–80 %. Ursache sind die realistischeren Minispiel-Bots
  (leichte Bots spielen jetzt wirklich wie Kinder), nicht die Brett-Entscheidungen (dort 63–71 %).
- **Charakterwürfel** (300 Partien je Figur): alle Figuren zwischen 18,7 % und 29,3 %; nur Foxy (18,7 ± 4,4 %) liegt
  knapp außerhalb von 2σ, nach Korrektur für 8 Tests nicht signifikant. Keine Würfel geändert, Foxy bleibt unter Beobachtung.

## v0.3: Würfel und größere Maps

Gemessen mit `npx tsx packages/shared/scripts/dice-balance.ts 96`: 96 Partien je Map à 20 Runden,
4 gleich starke Bots (mittel), Figuren über alle Sitze rotiert. Der einzige systematische Unterschied
ist also der Charakterwürfel.

| Würfel | Flächen | Ø Schritte (+ Münzen × 0,4) | Siegquote (Soll 25 %) |
|---|---|---|---|
| Standard | 1 2 3 4 5 6 | 3,50 | – |
| Rocco – Glitzer | 1+2● 2+2● 3+2● 3 4 5+1● | 3,47 | 25,0 % |
| Quaki – Angeber | 0+2● 2 3 4 5 6 | 3,47 | 20,8 % |
| Pingo – Rutsch | 1 1 4 4 5 6 | 3,50 | 29,9 % |
| Foxy – Fuchs | −1 2 4 4 5 7 | 3,50 | 24,3 % |
| Bruno – Kraft | 0 0 5 5 5 6 | 3,50 | 18,1 % |
| Hoppla – Sprint | 1 1 1 6 6 6 | 3,50 | 24,3 % |
| Schildi – Sicher | 3 3 3 4 4 4 | 3,50 | 27,8 % |
| Zippy – Nuss | 0+4● 1+3● 3 4 5 5 | 3,47 | 29,9 % |
| Item: Risiko | −2 −1 3 6 7 8 | 3,50 | – |
| Item: Gold | 1+4● 2+3● 3+4● 1+4● 2+3● 3+4● | 3,47 | – |

- Bei 144 Partien je Figur liegt der Zufallsfehler bei ±3,6 Prozentpunkten. Alle Figuren liegen damit
  innerhalb von 2σ um 25 %. Bruno ist der Kandidat für den echten Playtest.
- Ein erster Lauf mit Münzwert 0,5 ergab schwächere Münzwürfel. Deshalb wurde der Münzwert auf 0,4 Schritte
  gesenkt und die Münzwürfel je um eine Münze ergänzt.
- Tempo: Ø 7,2–7,5 Felder pro Zug. Gekaufte Sterne pro Partie: Kokosnuss 11, Vulkan 12,5, Bimmelbahn 16
  (vorher je Map ähnlich, bei kleineren Maps).
- Rückwärtslaufen (Summe < 0) ist selten (< 0,1 % der Züge) und kommt praktisch nur mit dem Risiko-Würfel vor.

## v0.1/v0.2

Ein unabhängiger Review-Subagent hat Spiel und Spielmechanik geprüft (Fuzz-Test mit 900 Partien
ohne Absturz/Softlock, Bot-Simulationen, Screenshots). Die Befunde wurden umgesetzt; gemessen wird
mit `npx tsx packages/shared/scripts/balance.ts 60` (60 Bot-Partien je Map, 20 Runden).

## Kennzahlen vorher → nachher

| Kennzahl (Ziel) | vorher | nachher |
|---|---|---|
| Letzter nach Runde 10 gewinnt (Aufholjagd, Ziel 12–15 %+) | 5–9 % | **15–18 %** |
| Anteil Bonus-Sterne an den Vorab-Führenden (Ziel ≤ 40 %) | 33–49 % („Kauflaune“ 74–80 %) | **32–38 %** |
| 2 harte gegen 2 leichte Bots: harte Sitze gewinnen | 85–92 % | **70–75 %** |
| Runden-Minispiele: Anteil 1v3 | ~50 % | **~25 %** (FFA am häufigsten) |
| Minispiel-Dauer (Median ≥ 25 s, MINI-03) | 6 Spiele zu kurz | **alle im Rahmen** (Tests) |
| Unentschieden Paket-Kette / Weichen-Chaos | 9–13 % | **< 1 %** |
| Ø Endmünzen Kokosnuss / Vulkan / Bimmelbahn | 76 / 72 / 21 | 62 / 57 / 23 |
| „Stern zu teuer“ pro Partie (Bimmelbahn) | 21 | 16 |

## Umgesetzte Änderungen (Auszug)

- **Bonus-Sterne:** Sternkäufe zählen nicht mehr für „Kauflaune“; neue Kategorie „Item-Fan“;
  eine der drei Kategorien stammt immer aus dem Aufhol-Pool (Pechvogel, Wandervogel, Item-Fan).
- **Aufhol-Momente:** Halbzeit-Rad für den Letzten (Stern vom Führenden, +1 Stern, Münzen tauschen …),
  Finale-Rad mit „+1 Stern“, Zwischenstand-Einblendung zu Halbzeit und Finale.
- **Minispiel-Dominanz:** Belohnung 8/5/3/1 (statt 10/5/2/0), Team 8, Solo 12; Bot-Stärken näher
  beieinander und „Tagesform“ (Bots spielen jedes Minispiel mit variierender Stärke); Bots in
  Timing-Spielen bekommen 100 ms „Display-Lag“ (TV-/Touch-Latenz der Menschen).
- **Mini-Würfel:** 1, 2 oder 3 Schritte frei wählbar (vorher zufällig 1–3 und damit nutzlos).
- **Teamfarben:** „Team Rot“ = Spieler von roten Feldern; 1:3-Split nur zu 50 % als 1v3.
- **Maps:** Gezeiten alle 2 Runden; Lava vertreibt den Stern; Zug kostet 5 Münzen; Bimmelbahn 1 Shop.
- **Bots:** halten Münzen für den nächsten Stern zurück, Warp/Falle nur wenn sinnvoll, Mini-Würfel-Planung.
- **Regeln:** Schutzschirm nur verbraucht, wenn es etwas zu verlieren gibt; Duell-Einsatz ≤ eigene Münzen;
  Marathon-Teamspiele: Sieger 3 / Solo-Sieg 5 / Verlierer 0 Punkte.
- **UX:** AFK-Timeout (Hinweis nach 25 s, Computer entscheidet nach 35 s), Stern-Entfernung an
  Abzweigungen, beschriftetes Glücksrad am Handy, zweistufiges Ersetzen im Shop, Erklär-Karte als
  Seitenleiste mit Steuerungs-Piktogramm (Übung bleibt sichtbar), gut lesbare Minispiel-Meldungen.

## Offen für den Playtest mit Menschen

- Bimmelbahn ist bewusst münzknapp (Sterne oft „zu teuer“) – im Playtest prüfen, ob sich das gut anfühlt.
- Kokosnuss/Vulkan: Münzen sind spät im Spiel wenig wert (Ø ~60 am Ende).
- Laternen-Jagd: Sucher werden gegen Ende schneller als der Solo – mit Menschen testen.
- Reaktionszeiten der Bots gegen echte Menschen am TV kalibrieren (aktuell Annahme ~100 ms Latenz).
