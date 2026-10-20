# Liest API-Tokens verdeckt ein und legt sie außerhalb des Repos ab
# (%USERPROFILE%\.wuerfel-bande\secrets.env). Die Asset-Generatoren in
# scripts/assets/ lesen sie von dort – die Werte erscheinen nie in Ausgaben.
#
#   pwsh scripts/set-secrets.ps1            # fragt SUNO_API_KEY und ELEVENLABS_API_KEY ab
#   pwsh scripts/set-secrets.ps1 SUNO_API_KEY

param([string[]]$Names = @('SUNO_API_KEY', 'ELEVENLABS_API_KEY'))

$dir = Join-Path $env:USERPROFILE '.wuerfel-bande'
$file = Join-Path $dir 'secrets.env'
New-Item -ItemType Directory -Force $dir | Out-Null

$values = [ordered]@{}
if (Test-Path $file) {
  foreach ($line in Get-Content $file) {
    if ($line -match '^\s*([A-Z0-9_]+)=(.*)$') { $values[$Matches[1]] = $Matches[2] }
  }
}

foreach ($name in $Names) {
  $secure = Read-Host "$name (leer = unverändert)" -AsSecureString
  $plain = [System.Net.NetworkCredential]::new('', $secure).Password
  if ($plain) { $values[$name] = $plain.Trim() }
}

$values.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" } | Set-Content -Encoding utf8 $file
# Nur der aktuelle Benutzer darf die Datei lesen.
icacls $file /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
Write-Host "Gespeichert in $file :" (($values.Keys | ForEach-Object { "$_ ✓" }) -join ', ')
