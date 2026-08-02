# verify-g06-readback.ps1 - close SPEC 15.2 item 2 with a real file.
#
# SPEC 13.4 says a VBA project locked for viewing is only a VBE gate: the
# module streams themselves are not encrypted (MS-OVBA), so extraction and
# write-back should be unaffected. SPEC 15.2 lists that as "実ファイルでの
# 確認は未実施" because no such file existed. G06 now exists, and Excel
# confirms it is locked (VBProject.Protection = 1, VBComponents = 0).
#
# This runs the PRODUCT's own reader over it, headless, and compares against
# the unprotected book it was made from. If the module set and every module
# body match, the spec's expectation holds on a real file.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -STA -File verify-g06-readback.ps1

$ErrorActionPreference = 'Stop'
# Portable bundle: this file lives in <repo>\qa\run01-blackbox\lib, so the run
# root is the folder above it and the product repo is two levels above that.
$RUN  = Split-Path -Parent $PSScriptRoot
$REPO = Split-Path -Parent (Split-Path -Parent $RUN)

$LOCKED = Join-Path $RUN 'corpus\books\G06_vba_project_password.xlsm'
$PLAIN = Join-Path $RUN 'corpus\books\A01_minimal.xlsm'

function Get-EngineSource {
    $names = @('05_Ole2.cs', '06_VbaCompression.cs', '07_VbaProject.cs', '08_BookIO.cs')
    $combined = ($names | ForEach-Object {
        [IO.File]::ReadAllText((Join-Path (Join-Path $REPO 'src') $_), [Text.Encoding]::UTF8)
    }) -join "`n"
    $usingPattern = '(?m)^\s*using\s+[\w][\w.]*\s*;'
    $usings = [regex]::Matches($combined, $usingPattern) |
        ForEach-Object { $_.Value.Trim() } | Sort-Object -Unique
    ($usings -join "`n") + "`n`n" + ($combined -replace $usingPattern, '')
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -TypeDefinition (Get-EngineSource) `
    -ReferencedAssemblies @('System.IO.Compression', 'System.IO.Compression.FileSystem') `
    -Language CSharp

function Describe([string]$path, [string]$label) {
    $r = [ordered]@{ label = $label }
    try {
        $content = [MacroStudio.BookIO]::ReadVbaProjectBytes($path)
        $r.attach = 'OK'
        $r.vbaBytes = $content.VbaProjectBytes.Length
        $r.warnings = $content.HasReadWarnings
        $r.salvaged = $content.Salvaged
    } catch { $r.attach = "拒否: $($_.Exception.Message)"; return $r }
    try {
        $p = [MacroStudio.BookIO]::ReadProject($path)
        $r.modules = @($p.Modules | ForEach-Object {
            [pscustomobject]@{ Name = $_.Name; Lines = ($_.Code -split "`r?`n").Count; Code = $_.Code }
        })
        $r.moduleCount = $r.modules.Count
    } catch { $r.modules = @(); $r.moduleCount = "読取失敗: $($_.Exception.Message)" }
    $r
}

$a = Describe $PLAIN  'A01（保護なし・元）'
$b = Describe $LOCKED 'G06（閲覧保護あり）'

foreach ($r in $a, $b) {
    ''
    "== $($r.label) =="
    "  attach       : $($r.attach)"
    "  vbaProject   : $($r.vbaBytes) bytes"
    "  読取警告     : $($r.warnings)   salvage経路: $($r.salvaged)"
    "  モジュール数 : $($r.moduleCount)"
    foreach ($m in $r.modules) { "      $($m.Name)  ($($m.Lines) 行)" }
}

''
'== 突合 =='
$problems = @()
if ($b.attach -ne 'OK') { $problems += "G06 が attach 段階で拒否された: $($b.attach)" }
if ($a.moduleCount -ne $b.moduleCount) { $problems += "モジュール数が違う: $($a.moduleCount) vs $($b.moduleCount)" }
else {
    $an = @($a.modules | ForEach-Object { $_.Name }) -join ','
    $bn = @($b.modules | ForEach-Object { $_.Name }) -join ','
    if ($an -ne $bn) { $problems += "モジュール名の集合が違う: [$an] vs [$bn]" }
    for ($i = 0; $i -lt $a.modules.Count; $i++) {
        if ($a.modules[$i].Code -ne $b.modules[$i].Code) {
            $problems += "本文が違う: $($a.modules[$i].Name)"
        }
    }
}
if ($b.salvaged) { $problems += 'G06 が salvage 経路（壊れたファイル用の退避読み）に落ちている' }
if ($b.warnings) { $problems += 'G06 の読取に警告が付いている（保護は警告の理由にならないはず）' }

if ($problems.Count -eq 0) {
    'PASS: 閲覧保護ありでも、保護なしの元ブックと 1 文字も違わずに読めた。'
    '      → SPEC §13.4 の「保護は VBE の閲覧ゲートに過ぎない」が実ファイルで成り立つ。'
    '      → Excel 側では VBIDE から 0 モジュールしか見えない（Protection=1）のに、'
    '         製品はバイト列から全モジュールを読めている、という対比が取れた。'
} else {
    "FAIL ($($problems.Count)):"
    $problems | ForEach-Object { "  $_" }
}
