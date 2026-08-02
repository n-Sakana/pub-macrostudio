# probe-reserved-names.ps1 - measure which output file names Windows actually
# refuses, instead of trusting the documented reserved-device-name list.
#
# PROD-12 is about screen 7 accepting names that cannot exist as files. Before
# widening the product's validator we have to know where the real boundary is
# on this machine: a validator that rejects a name Windows would have accepted
# is its own defect.
#
# For each candidate we create the file with .NET, write a byte, then try to
# read it back by path and delete it. "created but unreachable" is the PROD-12
# shape: the directory entry appears, but Test-Path / open / delete all fail.
$RUN = Split-Path -Parent $PSScriptRoot
$log = Join-Path $RUN 'logs\note-probe-reserved-names.log'
$dir = Join-Path $env:TEMP ('ms-reserved-probe-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force $dir | Out-Null

$names = @(
  'CON.xlsm','PRN.xlsm','AUX.xlsm','NUL.xlsm',
  'COM0.xlsm','COM1.xlsm','COM5.xlsm','COM9.xlsm',
  'LPT0.xlsm','LPT1.xlsm','LPT5.xlsm','LPT9.xlsm',
  'con.xlsm','Con.xlsm','CON.backup.xlsm','CON .xlsm',
  'CONTRACT.xlsm','CON1.xlsm','COM.xlsm','LPT.xlsm','NULL.xlsm','AUXILIARY.xlsm',
  'CLOCK$.xlsm','ordinary.xlsm'
)
# a control character cannot go in a script literal safely - build it here
$names += ('book' + [char]1 + 'name.xlsm')

"=== probe-reserved-names $(Get-Date -Format 'HH:mm:ss') ===" |
  Out-File -FilePath $log -Encoding utf8
"dir = $dir" | Out-File -FilePath $log -Append -Encoding utf8
("{0,-22} {1,-9} {2,-9} {3,-9} {4}" -f 'name','create','testpath','readback','delete') |
  Tee-Object -FilePath $log -Append

foreach ($n in $names) {
  $p = Join-Path $dir $n
  $create = 'no'; $tp = '-'; $read = '-'; $del = '-'
  try {
    [IO.File]::WriteAllBytes($p, [byte[]](1, 2, 3))
    $create = 'yes'
  } catch {
    $create = 'refused'
  }
  if ($create -eq 'yes') {
    $tp = if (Test-Path -LiteralPath $p) { 'yes' } else { 'NO' }
    try { $b = [IO.File]::ReadAllBytes($p); $read = "$($b.Length)b" }
    catch { $read = 'FAIL' }
    try { [IO.File]::Delete($p); $del = if (Test-Path -LiteralPath $p) { 'STILL' } else { 'yes' } }
    catch { $del = 'FAIL' }
  }
  $shown = $n -replace [char]1, '<0x01>'
  ("{0,-22} {1,-9} {2,-9} {3,-9} {4}" -f $shown, $create, $tp, $read, $del) |
    Tee-Object -FilePath $log -Append
}

# whatever survived the loop is a file we made; clear the directory itself
try { Get-ChildItem -LiteralPath $dir -Force | ForEach-Object {
        try { [IO.File]::Delete($_.FullName) } catch {} } } catch {}
try { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction Stop }
catch { "left behind: $dir" | Tee-Object -FilePath $log -Append }
"=== done ===" | Tee-Object -FilePath $log -Append
