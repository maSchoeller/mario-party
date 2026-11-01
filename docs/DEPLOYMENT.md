# Deployment (Azure)

Seit 01.11.2026 läuft die Würfel-Bande in Azure, erstmals für den Feldtest mit dem Jugendkreis.

| | |
|---|---|
| **TV** | https://wuerfelbande-server.ashysand-bcef909c.germanywestcentral.azurecontainerapps.io/host |
| **Handys** | https://wuerfelbande-server.ashysand-bcef909c.germanywestcentral.azurecontainerapps.io/play (oder QR-Code am TV) |
| Subscription | Visual Studio Enterprise-Abonnement |
| Ressourcengruppe | `rg-wuerfelbande` (Germany West Central / Frankfurt) |

## Aufbau

Ein einziger Container in **Azure Container Apps** (Consumption) liefert Web-Client, WebSocket-Relay
und Save-API vom selben Host aus. Dadurch gibt es kein CORS und keine zweite Domain, und der QR-Code
zeigt automatisch auf die öffentliche Adresse. Die Static Web App aus `infra/main.bicep` ist optional
(`deployStaticWeb`) und derzeit nicht angelegt.

- **Container App** `wuerfelbande-server`: 1 vCPU / 2 GiB, genau 1 Replica (In-Memory-Lobbys, OPS-04).
  `minReplicas=1` hält sie warm, also kein Kaltstart.
- **Container Registry** `wuerfelbande<hash>` (Basic): das Image wird per `az acr build` in Azure gebaut,
  lokal ist kein Docker nötig.
- **Storage**: Table `saves` für Spielstände (7 Tage), Blob-Container `assets` (ungenutzt).
- **Log Analytics + Application Insights**: Logs und anonyme Telemetrie.
- **Budget** `wuerfelbande-budget`: 15 €/Monat, Mail bei 10 € Ist-Kosten und bei 15 € Prognose.

## Ausrollen

```powershell
./scripts/deploy-azure.ps1
```

Das Skript baut das Image aus dem aktuellen Arbeitsstand und deployt die Bicep-Vorlage. Es lässt sich
beliebig oft ausführen (~3 min). Laufende Lobbys gehen dabei verloren, also nicht während einer Partie
ausführen.

## Kosten

Grobe Schätzung (Consumption-Preise, Stand 11/2026; die Freikontingente sind nicht eingerechnet):

| Zustand | Kosten |
|---|---|
| Warm, ohne Spieler (`minReplicas=1`) | ca. 0,70 €/Tag |
| Spielabend (4 h aktiv) | zusätzlich ca. 0,50 € |
| Nach dem Test schlafen gelegt (`-MinReplicas 0`) | ca. 5 €/Monat, vor allem die Registry |

Nach dem Feldtest herunterskalieren. Der erste Aufruf dauert dann einige Sekunden; der Client zeigt
„Server wird geweckt …“ und verbindet sich selbst neu:

```powershell
./scripts/deploy-azure.ps1 -MinReplicas 0
```

Alles entfernen: `az group delete -n rg-wuerfelbande --subscription "Visual Studio Enterprise-Abonnement"`.

## GitHub-Workflow

`.github/workflows/deploy.yml` beschreibt noch den älteren Plan (Image in GHCR, Client in der
Static Web App, OIDC-Login) und ist nicht eingerichtet. Bis dahin wird mit dem Skript oben ausgerollt.
