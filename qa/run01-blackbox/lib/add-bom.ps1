# add-bom.ps1 - prepend a UTF-8 BOM to files that lack one.
#
# Windows PowerShell 5.1 reads a BOM-less .ps1 as ANSI, so every Japanese
# literal in it turns to mojibake (HANDOFF section 6, trap 3). Editors that
# write UTF-8 without a BOM therefore silently break these scripts. Run this
# over any script or JSON written by such an editor before executing it.
param([Parameter(Mandatory = $true)][string[]]$Path)

foreach ($p in $Path) {
  $full = (Resolve-Path -LiteralPath $p).Path
  $bytes = [System.IO.File]::ReadAllBytes($full)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    Write-Output "SKIP (already BOM) $full"
    continue
  }
  $text = [System.Text.Encoding]::UTF8.GetString($bytes)
  [System.IO.File]::WriteAllText($full, $text, (New-Object System.Text.UTF8Encoding($true)))
  Write-Output "BOM added $full"
}
