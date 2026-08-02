# probe-fixture-shape.ps1 - report what the product's own reader sees in each
# candidate for testdata\test_large.xlsm.
#
# docs\DEVELOPMENT.md only says "a macro book with several modules", but the
# psA tests hardcode exact numbers (6 modules, code page 932, a vbaProject.bin
# length, a total line count). Rather than guess which book the desktop used,
# measure every candidate and print the numbers the tests compare against.
param([string[]]$Books)

$RUN  = Split-Path -Parent $PSScriptRoot
$REPO = Split-Path -Parent (Split-Path -Parent $RUN)
$log  = Join-Path $RUN 'logs\note-probe-fixture-shape.log'

# Compile the same four sources the psA tests compile, the same way they do
# (tests\test-vbaproject.ps1 Get-EngineSource): concatenate, hoist the using
# directives to the top, and hand the result to Add-Type.
function Get-EngineSource {
  $names = @('05_Ole2.cs', '06_VbaCompression.cs', '07_VbaProject.cs',
             '08_BookIO.cs')
  $combined = ($names | ForEach-Object {
    [IO.File]::ReadAllText(
      (Resolve-Path -LiteralPath (Join-Path (Join-Path $REPO 'src') $_)),
      [Text.Encoding]::UTF8)
  }) -join "`n"
  $usingPattern = '(?m)^\s*using\s+[\w][\w.]*\s*;'
  $usings = [regex]::Matches($combined, $usingPattern) |
    ForEach-Object { $_.Value.Trim() } | Sort-Object -Unique
  return ($usings -join "`n") + "`n`n" + ($combined -replace $usingPattern, '')
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -TypeDefinition (Get-EngineSource) `
  -ReferencedAssemblies @('System.IO.Compression',
                          'System.IO.Compression.FileSystem') `
  -Language CSharp

if (-not $Books) {
  $Books = @(
    (Join-Path $REPO 'sample-book\sample_win32_sleep.xlsm'),
    (Join-Path $RUN  'samples\input_win32_sleep.xlsm'),
    (Join-Path $RUN  'samples\input_monthly_report.xlsm'),
    (Join-Path $RUN  'corpus\books\A04_large.xlsm'),
    (Join-Path $RUN  'corpus\books\A05_xlarge.xlsm')
  )
}

"=== probe-fixture-shape $(Get-Date -Format 'HH:mm:ss') ===" |
  Out-File -FilePath $log -Encoding utf8

foreach ($b in $Books) {
  if (-not (Test-Path -LiteralPath $b)) {
    "MISSING  $b" | Tee-Object -FilePath $log -Append
    continue
  }
  try {
    $p = [MacroStudio.BookIO]::ReadProject((Resolve-Path -LiteralPath $b))
    $names = @($p.Modules | ForEach-Object { $_.Name })
    $lines = 0
    foreach ($m in $p.Modules) {
      $lines += @(($m.FullCode -split "`r`n|`n")).Count
    }
    # the raw part the tests measure the length of
    $binLen = -1
    try {
      $z = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $b))
      $e = $z.Entries | Where-Object { $_.FullName -like '*vbaProject.bin' }
      if ($e) {
        $ms = New-Object IO.MemoryStream
        $s = $e.Open(); $s.CopyTo($ms); $s.Dispose()
        $binLen = $ms.Length
      }
      $z.Dispose()
    } catch {}

    "{0}`n  modules={1} codepage={2} binLen={3} lines={4}`n  names={5}" -f
      (Split-Path -Leaf $b), $p.Modules.Count, $p.CodePage, $binLen, $lines,
      ($names -join ',') | Tee-Object -FilePath $log -Append
  } catch {
    "ERROR    $(Split-Path -Leaf $b)  $($_.Exception.Message)" |
      Tee-Object -FilePath $log -Append
  }
}
"=== done ===" | Tee-Object -FilePath $log -Append
