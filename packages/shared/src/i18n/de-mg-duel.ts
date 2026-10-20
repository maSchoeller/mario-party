/** German texts for the duel minigames and the final minigame Gipfelsturm (merged into de.ts). */
export const deMgDuel: Record<string, string> = {
  // controller labels
  'ctrl.rock': 'Stein',
  'ctrl.paper': 'Papier',
  'ctrl.scissors': 'Schere',
  'ctrl.memoFail': 'Daneben! Warte auf die nächste Runde.',
  'ctrl.memoDone': 'Geschafft! Kurz warten …',
  'ctrl.red': 'Rot',
  'ctrl.blue': 'Blau',
  'ctrl.green': 'Grün',
  'ctrl.yellow': 'Gelb',
  'ctrl.stumble': 'Hoppla, falscher Weg! Gleich geht’s weiter …',
  'ctrl.summit': 'Gipfel erreicht! Feuere die anderen an!',

  // Schnick-Schnack-Schnuck Deluxe
  'mg.schnickSchnack.name': 'Schnick-Schnack-Schnuck Deluxe',
  'mg.schnickSchnack.desc': 'Wähle heimlich Stein, Schere oder Papier – dann wird aufgedeckt! Wer zuerst 3 Punkte hat, gewinnt.',
  'mg.schnickSchnack.controls': 'Auswahl: Stein, Schere oder Papier antippen',
  'mg.schnickSchnack.choose': 'Wähle jetzt!',
  'mg.schnickSchnack.shake': 'Schnick … Schnack … Schnuck!',
  'mg.schnickSchnack.point': 'Punkt!',
  'mg.schnickSchnack.tie': 'Gleich! Nochmal!',
  'mg.schnickSchnack.sudden': 'Entscheidungsrunde!',
  'mg.schnickSchnack.lot': 'Gleichstand – das Los entscheidet!',

  // Schnellzieher (reference game, other texts in de.ts – this key overrides the old
  // "Zwei Siege" text there since the duel is now best of 5)
  'mg.schnellzieher.desc': 'Warte auf „JETZT!“ und tippe als Erster. Frühstart verliert die Runde! Drei Siege gewinnen.',

  // Memo-Duell
  'mg.memoDuell.name': 'Memo-Duell',
  'mg.memoDuell.desc': 'Merke dir, welche Farben nacheinander aufleuchten, und tippe sie genauso nach. Jeder Fehler kostet ein Herz – wer beide Herzen verliert, hat verloren!',
  'mg.memoDuell.controls': 'Farb-Pads: Reihenfolge nachtippen',
  'mg.memoDuell.watch': 'Gut aufpassen!',
  'mg.memoDuell.go': 'Jetzt nachtippen!',
  'mg.memoDuell.longer': 'Beide richtig – länger!',
  'mg.memoDuell.life': 'Fehler – ein Herz weg!',
  'mg.memoDuell.retry': 'Beide daneben – nochmal!',
  'mg.memoDuell.decided': 'Entschieden!',
  'mg.memoDuell.time': 'Zeit um – Tempo entscheidet!',

  // Gipfelsturm (Finale)
  'mg.gipfelsturm.name': 'Gipfelsturm',
  'mg.gipfelsturm.desc': 'Das große Finale: Renn den Hang hoch, spring über die Lava und nimm den richtigen Weg. Wer zuerst auf dem Gipfel ist, gewinnt!',
  'mg.gipfelsturm.controls': 'Schnell tippen, rechtzeitig springen, richtige Farbe wählen',
  'mg.gipfelsturm.start': 'Finale – auf zum Gipfel!',
};
