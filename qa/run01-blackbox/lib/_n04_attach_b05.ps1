# _n04_attach_b05.ps1 - attach the B05 long-name book without the path ever
# leaving PowerShell.
#
# B05's file name is 173 characters and the full path is 245. Handing that
# through another shell mangles it, so this script resolves it itself. B05 is
# the regression sample for PROD-13 (the layout that broke on a long name).
param([string]$Name = 'N_B05', [int]$X = 1434, [int]$Y = 397)
$RUN = Split-Path -Parent $PSScriptRoot
. "$RUN\lib\act.ps1"

$b05 = Get-ChildItem -LiteralPath (Join-Path $RUN 'corpus\books\b05') `
         -File -Filter '*.xlsm' | Select-Object -First 1
if (-not $b05) { throw 'B05 not found under corpus\books\b05' }
"name length = $($b05.Name.Length), full path = $($b05.FullName.Length)"

try { Tap 960 200 'warm-up' | Out-Null } catch {}
Start-Sleep -Milliseconds 700
Open-FileDialog $X $Y 'attach B05'
Answer-Dialog $b05.FullName
Start-Sleep -Seconds 3
Shot $Name
