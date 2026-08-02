# make-corpus-g06.ps1 - G06: a workbook whose VBA project is locked for viewing
# while the container itself stays perfectly readable.
#
# The VBIDE object model cannot set project protection, and driving the VBE's
# Protection dialog with SendKeys is not something to trust a fixture to. The
# state actually lives in the PROJECT stream of xl/vbaProject.bin as the
# CMG / DPB / GC lines (MS-OVBA). Those lines are present even in an
# unprotected project, and here they sit contiguously in the file, so the DPB
# payload can be rewritten IN PLACE at exactly the same byte length - no CFB
# restructuring, no FAT edits, no risk of inventing a broken container.
#
# Whether Excel then reports the project as locked (rather than refusing the
# file outright) is an empirical question, so this script measures it:
#   - does Excel open the workbook at all?
#   - what does VBProject.Protection say?  (0 = none, 1 = locked)
#   - can VBComponents still be enumerated?
# Whatever comes back is written into the oracle. Nothing is asserted blind.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -STA -File make-corpus-g06.ps1

$ErrorActionPreference = 'Stop'
# Portable bundle: this file lives in <repo>\qa\run01-blackbox\lib, so the run
# root is the folder above it and the product repo is two levels above that.
$RUN  = Split-Path -Parent $PSScriptRoot
$REPO = Split-Path -Parent (Split-Path -Parent $RUN)
$OUT = Join-Path $RUN 'corpus\books'
$ORA = Join-Path $RUN 'corpus\oracles'
$SRC = Join-Path $OUT 'A01_minimal.xlsm'
$DST = Join-Path $OUT 'G06_vba_project_password.xlsm'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

if (Test-Path $DST) { "SKIP: G06 は既にある"; exit 0 }
[System.IO.File]::Copy($SRC, $DST, $false)

# --- rewrite DPB in place, same length ------------------------------------
$zip = [IO.Compression.ZipFile]::Open($DST, 'Update')
try {
  $entry = $zip.Entries | Where-Object { $_.FullName -eq 'xl/vbaProject.bin' }
  if (-not $entry) { throw 'xl/vbaProject.bin が無い' }

  $ms = New-Object IO.MemoryStream
  $s = $entry.Open(); $s.CopyTo($ms); $s.Dispose()
  $bytes = $ms.ToArray()

  $ascii = [Text.Encoding]::ASCII.GetString($bytes)
  $at = $ascii.IndexOf('DPB="')
  if ($at -lt 0) { throw 'DPB= が見つからない' }
  $valueStart = $at + 5
  $valueEnd = $ascii.IndexOf('"', $valueStart)
  if ($valueEnd -lt 0) { throw 'DPB の閉じ引用符が見つからない' }
  $original = $ascii.Substring($valueStart, $valueEnd - $valueStart)

  # Same length, still valid hex, but no longer the blob that decrypts to
  # "this project has no password". Deterministic: shift every hex digit by
  # one so the result cannot accidentally equal the original.
  $map = '0123456789ABCDEF'
  $sb = New-Object Text.StringBuilder
  foreach ($ch in $original.ToCharArray()) {
    $i = $map.IndexOf([char]::ToUpper($ch))
    [void]$sb.Append($(if ($i -lt 0) { $ch } else { $map[($i + 1) % 16] }))
  }
  $mutated = $sb.ToString()
  if ($mutated.Length -ne $original.Length) { throw '長さが変わった' }

  $newBytes = [Text.Encoding]::ASCII.GetBytes($mutated)
  for ($i = 0; $i -lt $newBytes.Length; $i++) { $bytes[$valueStart + $i] = $newBytes[$i] }

  $w = $entry.Open()
  $w.SetLength(0)
  $w.Write($bytes, 0, $bytes.Length)
  $w.Dispose()

  "DPB 書き換え: $original -> $mutated  ($($original.Length) 文字のまま)"
} finally { $zip.Dispose() }

# --- measure what Excel actually does -------------------------------------
$opened = $false; $protection = 'n/a'; $components = 'n/a'; $err = ''
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.EnableEvents = $false
$xl.AutomationSecurity = 1
try {
  $wb = $xl.Workbooks.Open($DST, 0, $true)
  $opened = $true
  try { $protection = $wb.VBProject.Protection } catch { $protection = "取得不可: $($_.Exception.Message -replace "`r?`n",' ')" }
  try { $components = $wb.VBProject.VBComponents.Count } catch { $components = "列挙不可: $($_.Exception.Message -replace "`r?`n",' ')" }
  $wb.Close($false)
} catch {
  $err = $_.Exception.Message -replace "`r?`n", ' '
} finally {
  try { $xl.Quit() } catch {}
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}

"Excel で開けたか      : $opened $(if($err){"($err)"})"
"VBProject.Protection : $protection   (0=none / 1=locked)"
"VBComponents.Count   : $components"

$locked = ($protection -eq 1)
$oracle = [ordered]@{
  id = 'G06'; file = 'G06_vba_project_password.xlsm'; format = 'xlsm'
  expect = 'boundary'
  why = "VBA プロジェクトの閲覧保護。VBIDE では設定できないため PROJECT ストリームの DPB を" +
        "同じ長さで書き換えて作った。実測: Excel で開ける=$opened / VBProject.Protection=$protection / " +
        "VBComponents=$components"
  entryMacro = $(if ($locked) { $null } else { 'RunMin' })
  postRun = @()
  mustFix = @(); mustPreserve = @()
  mustReject = $null
  route = @('ai')
  howMade = @{
    method = 'PROJECT ストリームの DPB 値を同じ長さの別 hex へ置換（CFB 構造は無改変）'
    source = 'A01_minimal.xlsm'
  }
  measured = @{
    excelOpened = $opened
    vbProjectProtection = "$protection"
    vbComponents = "$components"
    error = $err
  }
  expectation = '容器は読める。SPEC §13.4 は「保護は VBE の閲覧ゲートでありモジュールストリーム自体は' +
                '暗号化されない」としているので、MacroStudio は抽出・書き戻しとも成功するはず（§15.2 の未検証項目）'
}
[System.IO.File]::WriteAllText(
  (Join-Path $ORA 'G06.json'),
  ($oracle | ConvertTo-Json -Depth 8),
  (New-Object System.Text.UTF8Encoding($true)))

''
if ($locked) { 'G06: 閲覧保護の現物ができた（Protection=1）' }
elseif ($opened) { 'G06: 開けたが Protection は 1 にならなかった。oracle に実測値を記録済み' }
else { 'G06: Excel が開けなかった。oracle に阻害条件を記録済み' }
