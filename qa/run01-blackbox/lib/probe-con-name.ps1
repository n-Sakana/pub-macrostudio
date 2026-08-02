# probe-con-name.ps1 - PROD-12. The build wrote a workbook called CON.xlsm and
# the completion screen listed it as created. CON is a reserved DOS device
# name, so the question is whether the file that exists in the directory can be
# opened again by its own path, or whether Win32 redirects the name to the
# console device.
#   -Dir <path>  the export folder that contains a CON.xlsm build. Without it,
#                the newest export folder that has one.
param([string]$Dir)

$ErrorActionPreference = 'Continue'
$REPO = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
if (-not $Dir) {
  $Dir = (Get-ChildItem -LiteralPath (Join-Path $REPO 'exports') -Directory -ErrorAction SilentlyContinue |
          Where-Object { Get-ChildItem -LiteralPath $_.FullName -Filter 'CON.xlsm' -Force -ErrorAction SilentlyContinue } |
          Sort-Object CreationTime -Descending | Select-Object -First 1).FullName
  if (-not $Dir) { throw 'no export folder with a CON.xlsm - reproduce PROD-12 through the GUI first' }
}
$dir = $Dir
$plain = Join-Path $dir 'CON.xlsm'
$unc   = '\\?\' + $plain
$good  = Join-Path $dir 'A05P_xlarge_with_path-Modified-20260802.xlsm'

"== directory entry =="
Get-ChildItem -LiteralPath $dir -Filter 'CON.xlsm' -Force |
  Select-Object Name, Length, Mode | Format-List | Out-String | Write-Output

"== Test-Path =="
"plain      : $(Test-Path -LiteralPath $plain)"
"extended   : $(Test-Path -LiteralPath $unc)"

"== .NET read by plain path =="
try {
  $b = [System.IO.File]::ReadAllBytes($plain)
  "plain read OK, $($b.Length) bytes, first2=$([char]$b[0])$([char]$b[1])"
} catch { "plain read FAILED: $($_.Exception.GetType().Name): $($_.Exception.Message)" }

"== .NET read by extended path =="
try {
  $b2 = [System.IO.File]::ReadAllBytes($unc)
  "extended read OK, $($b2.Length) bytes, first2=$([char]$b2[0])$([char]$b2[1])"
} catch { "extended read FAILED: $($_.Exception.GetType().Name): $($_.Exception.Message)" }

"== is it the same bytes as the normally named build? =="
try {
  $h1 = (Get-FileHash -LiteralPath $unc -Algorithm SHA256).Hash
  $h2 = (Get-FileHash -LiteralPath $good -Algorithm SHA256).Hash
  "CON.xlsm  sha256 = $h1"
  "Modified  sha256 = $h2"
  "identical = $($h1 -eq $h2)"
} catch { "hash compare FAILED: $($_.Exception.Message)" }

"== Excel Workbooks.Open by plain path =="
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.EnableEvents = $false
$xl.AutomationSecurity = 3   # msoAutomationSecurityForceDisable, this instance only
try {
  $wb = $xl.Workbooks.Open($plain, 0, $true)
  "Excel open OK: $($wb.Name)"
  $wb.Close($false)
} catch { "Excel open FAILED: $($_.Exception.Message)" }
finally {
  try { $xl.Quit() } catch {}
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}
