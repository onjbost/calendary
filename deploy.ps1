# Copies the Calendary add-on to Home Assistant's "addons" Samba share.
# Only the add-on sources: node_modules, local test data and builds are skipped
# (Home Assistant rebuilds everything inside Docker).
#
# Usage:  powershell -ExecutionPolicy Bypass -File deploy.ps1
#         powershell -ExecutionPolicy Bypass -File deploy.ps1 -Target \\192.168.1.47\addons\calendary
#
# Note: the Home Assistant Samba add-on hides/blocks names matching its "veto_files"
# (default: ._*  .DS_Store  Thumbs.db  icon?) — never name a file or folder like "icons".

param(
  [string]$Target = '\\192.168.1.47\addons\Calendary\calendary'
)

$source = Join-Path $PSScriptRoot 'calendary'
$excludeDirs = @('node_modules', 'data', 'dist')
if (-not (Test-Path $Target)) { New-Item -ItemType Directory -Force $Target | Out-Null }

robocopy $source $Target /E /XD $excludeDirs /XF *.log /R:1 /W:1 /NP /NDL /NJH /NJS
if ($LASTEXITCODE -ge 8) { Write-Host "robocopy ha segnalato errori ($LASTEXITCODE)" -ForegroundColor Yellow }

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
Write-Host "`nCalendary $version copiato in $Target (tutti i file verificati)" -ForegroundColor Cyan
Write-Host "Home Assistant: Componenti aggiuntivi -> Calendary -> Aggiorna (o Ricostruisci)."
exit 0
