# Builds the server image in Azure (no local Docker needed) and deploys infra/main.bicep.
# Idempotent: run again after code changes to roll out a new image.
#   ./scripts/deploy-azure.ps1                    # deploy, one replica kept warm
#   ./scripts/deploy-azure.ps1 -MinReplicas 0     # after the event: scale to zero, costs almost nothing
param(
  [string]$Subscription = 'Visual Studio Enterprise-Abonnement',
  [string]$ResourceGroup = 'rg-wuerfelbande',
  [string]$Location = 'germanywestcentral',
  [ValidateSet(0, 1)][int]$MinReplicas = 1,
  [ValidateSet('0.5', '1')][string]$ServerCpu = '1',
  [string]$BudgetEmail = 'microsoft@marvinschoeller.de'
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

function Invoke-Az { az @args; if ($LASTEXITCODE) { throw "az $($args -join ' ') failed" } }

Invoke-Az account set --subscription $Subscription
Invoke-Az group create -n $ResourceGroup -l $Location -o none

# ACR name: globally unique, alphanumerics only, stable per resource group
$suffix = (Invoke-Az group show -n $ResourceGroup --query id -o tsv | ForEach-Object {
  [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($_))) }).Replace('-', '').Substring(0, 8).ToLower()
$acr = "wuerfelbande$suffix"
if (-not (az acr show -n $acr -g $ResourceGroup --query name -o tsv 2>$null)) {
  Invoke-Az acr create -n $acr -g $ResourceGroup -l $Location --sku Basic --admin-enabled true -o none
}

$tag = (git -C $root rev-parse --short HEAD) + '-' + (Get-Date -Format 'yyyyMMddHHmm')
$image = "$acr.azurecr.io/wuerfel-bande-server:$tag"
Invoke-Az acr build -r $acr -t "wuerfel-bande-server:$tag" $root --no-logs -o none

$out = Invoke-Az deployment group create -g $ResourceGroup -n "wuerfelbande-$tag" `
  -f "$root/infra/main.bicep" `
  -p serverImage=$image registryName=$acr minReplicas=$MinReplicas serverCpu=$ServerCpu budgetEmail=$BudgetEmail `
  --query properties.outputs.serverUrl.value -o tsv
Write-Host "Würfel-Bande läuft: $out/host  (Handys: $out/play)"
