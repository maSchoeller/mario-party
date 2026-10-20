# Balancing & unabhängiger Review

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
