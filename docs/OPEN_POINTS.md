# Offene Punkte – was autonom nicht umsetzbar war

Diese Punkte brauchen externe Dienste, Accounts, Hardware oder menschliche Entscheidungen.
Alles andere ist lokal lauffähig und getestet (siehe [STATUS.md](STATUS.md)).

## 1. Fehlende Dienste / Accounts

| Thema | Spec | Was fehlt | Was vorbereitet ist |
|---|---|---|---|
| **Azure-Deployment** | OPS-01..04, 12 | Azure-Subscription, Ressourcengruppe, Service Principal (OIDC), Budget-E-Mail | `infra/main.bicep` (SWA Free, Container Apps 0–1 Replica 0,25 vCPU, Storage Blob+Table, App Insights, Budget-Alarm 10 €), `Dockerfile`, `.github/workflows/deploy.yml` (manueller Trigger). **Nicht deployt, Bicep nicht gegen Azure validiert.** |
| **GitHub Container Registry** | 12 | Push-Rechte/Package-Sichtbarkeit | Image-Build im Deploy-Workflow |
| **Application Insights** | PRIV-02 | Connection-String | Server leitet Events per HTTP-Ingestion weiter, wenn `APPLICATIONINSIGHTS_CONNECTION_STRING` gesetzt ist (ungetestet gegen Azure); lokal NDJSON-Log |
| **Azure Table Storage** | SAVE-01/02 | Storage-Account | Adapter fertig, **gegen Azurite getestet** |
| **Blob Storage für große Assets** | PERF-02, 12 | Assets existieren noch nicht | Container `assets` in Bicep; lazy Map-Laden ist trivial, solange Maps prozedural sind |
| **Suno (Musik)** | AUDIO-01/07 | Account/Tarif, Prompt-Leitfaden (Spec 17.5) | prozedurale WebAudio-Loops je Map + Finale-Variante, Lobby, 3 Minispiel-Stimmungen, Sieger |
| **ElevenLabs (SFX, Moderator-Stimme)** | AUDIO-02/03/07 | Account/Tarif, Stimmprofil | SFX synthetisiert; Moderator über Browser-Sprachsynthese (de-DE); alle Ansagen sind i18n-Keys und damit 1:1 vertonbar |
| **KI-3D-Modelle + Blender** | ASSET-01..04, ART-02 | Meshy/Tripo, Blender-Retopo/Rigging, CC0-Packs | prozedurale Low-Poly-Figuren mit allen geforderten Animationen (prozedural), Props; Engine kann GLB (Babylon-Loader) |
| **Marken-Kurzrecherche „Würfel-Bande“** | 15 | Rechtsrecherche | – |
| **Impressum/Datenschutz** | SEC-03 | Texte (vor öffentlicher Freigabe) | – |

## 2. Nicht automatisiert prüfbar (Hardware/Geräte)

| Thema | Spec | Stand |
|---|---|---|
| 60 fps @1080p auf Referenz-Laptop | PERF-01, 17.6 | Referenzgerät nicht festgelegt. Automatische Qualitätsabsenkung (Schatten/Glow/Auflösung) eingebaut; im Container nur Software-Rendering messbar. Draw Calls/Polygone deutlich unter Budget (prozedurale Low-Poly-Meshes). |
| iOS Safari / Android Chrome | PERF-04, CTRL-06 | Nur mit Desktop-Chromium (Touch-Emulation) getestet. Gyro-Freigabe (iOS) wird beim Beitritt angefragt; braucht HTTPS (`HTTPS=1 npm run dev`). |
| Safari/Firefox/Edge als Host | PERF-03 | Nur Chromium getestet. |
| P2P im echten Heim-WLAN, Latenz < 100 ms | NET-01/04 | P2P zwischen Browsern lokal getestet; kein TURN in v1 (laut Spec) – bei striktem NAT greift der Relay. |
| Beitritt per QR < 30 s | 16 | QR + Raumcode funktionieren; Messung mit echten Handys offen. |

## 3. Bewusste Vereinfachungen / Design-Entscheidungen (zur Abstimmung)

- **Minispiel-Physik** läuft deterministisch in eigener TypeScript-Simulation (testbar, bot-fähig, serialisierbar). Havok wird für visuelle Effekte (Münz-/Gesteinsregen) genutzt, nicht für spielentscheidende Physik.
- **Teamzuteilung** (Spec 17.7): Standard nach Feldfarbe (blau/rot, neutrale Felder zufällig), alternativ „zufällig“ in der Lobby wählbar.
- **3 Spieler ohne Bots**: Runden-Minispiele sind dann immer „Jeder gegen Jeden“ (Team-Formate brauchen 4).
- **Bahnticket** ist eine map-spezifische Ressource (nicht eines der 8 Items): Geschenk auf Ereignisfeldern oder am Bahnhof kaufen.
- **Kein Speichern mitten im Minispiel**: Nach einem Host-Reload startet ein laufendes Minispiel neu (Autosave nach jeder Runde und lokal nach jeder Aktion).
- **Balancing-Werte** wurden nach dem unabhängigen Review per Bot-Simulation nachjustiert (siehe [BALANCING.md](BALANCING.md), z. B. Minispiel-Belohnung 8/5/3/1 statt 10/5/2/0); echter Playtest mit Menschen steht aus.
- **Mini-Würfel** lässt 1–3 Schritte frei wählen (statt zufällig 1–3), sonst wäre das Item wirkungslos.
