# Copies the Moveo add-on to Home Assistant's "addons" Samba share.
# Only the add-on sources: node_modules, local test data and builds are skipped
# (Home Assistant rebuilds everything inside Docker).
#
# Usage:  powershell -ExecutionPolicy Bypass -File deploy.ps1
#         powershell -ExecutionPolicy Bypass -File deploy.ps1 -Target \\192.168.1.47\addons\moveo
#
# Note: the Home Assistant Samba add-on hides/blocks names matching its "veto_files"
# (default: ._*  .DS_Store  Thumbs.db  icon?) — never name a file or folder like "icons".

param(
  [string]$Target = '\\192.168.1.47\addons\Moveo\moveo'
)

$source = Join-Path $PSScriptRoot 'moveo'

# The Samba share needs credentials (user/password of the Home Assistant "Samba share" add-on).
# If Windows has none saved for this server, ask once and save them for the next deploys.
$share = ($Target -split '\\' | Where-Object { $_ } | Select-Object -First 2) -join '\'
$share = "\\$share"
if (-not (Test-Path $share)) {
  Write-Host "Accesso a $share negato o credenziali mancanti." -ForegroundColor Yellow
  $cred = Get-Credential -Message "Utente e password dell'add-on Samba share di Home Assistant"
  if (-not $cred) { exit 1 }
  $server = ($share -split '\\' | Where-Object { $_ })[0]
  cmd /c "net use $share /delete /y" 2>$null | Out-Null
  cmdkey /add:$server /user:$($cred.UserName) /pass:$($cred.GetNetworkCredential().Password) | Out-Null
  net use $share /user:$($cred.UserName) $cred.GetNetworkCredential().Password /persistent:no | Out-Null
  if (-not (Test-Path $share)) {
    Write-Host "Ancora nessun accesso a $share: controlla utente e password nella configurazione dell'add-on Samba." -ForegroundColor Red
    exit 1
  }
  Write-Host "Credenziali salvate in Gestione credenziali di Windows." -ForegroundColor Green
}
$excludeDirs = @('node_modules', 'data', 'dist')
if (-not (Test-Path $Target)) { New-Item -ItemType Directory -Force $Target | Out-Null }

robocopy $source $Target /E /XD $excludeDirs /XF *.log /R:1 /W:1 /NP /NDL /NJH /NJS
if ($LASTEXITCODE -ge 8) { Write-Host "robocopy ha segnalato errori ($LASTEXITCODE)" -ForegroundColor Red; exit 1 }

# robocopy doesn't always fail when a folder is refused: verify every file actually arrived.
$skip = '\\(' + ($excludeDirs -join '|') + ')\\'
$missing = Get-ChildItem $source -Recurse -File -Force |
  Where-Object { $_.FullName -notmatch $skip -and $_.Name -notlike '*.log' } |
  ForEach-Object { $_.FullName.Substring($source.Length).TrimStart('\') } |
  Where-Object { -not (Test-Path -LiteralPath (Join-Path $Target $_)) }

if ($missing) {
  Write-Host "`nFile NON copiati sul server:" -ForegroundColor Red
  $missing | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
  exit 1
}

$version = (Select-String -Path (Join-Path $source 'config.yaml') -Pattern '^version:\s*"?([^"]+)"?').Matches[0].Groups[1].Value
Write-Host "`nMoveo $version copiato in $Target (tutti i file verificati)" -ForegroundColor Cyan
Write-Host "Home Assistant: Componenti aggiuntivi -> Moveo -> Aggiorna (o Ricostruisci)."
exit 0
