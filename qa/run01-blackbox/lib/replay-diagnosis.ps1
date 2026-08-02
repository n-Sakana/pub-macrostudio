# replay-diagnosis.ps1 - put a previously recorded diagnosis answer on the real
# clipboard, with its request id rewritten to the run now on screen 1.
#
# WHAT THIS IS NOT: this is not a blind AI trial. Nothing new is asked of any
# model. HANDOFF section 8 governs *new* trials - fresh instance, verbatim
# input, no tools - and none of that is happening here. The stored raw answer
# in ai-sessions\ is left byte-for-byte alone; only the copy heading for the
# clipboard has its request id substituted.
#
# WHY IT IS NEEDED: screen 2 cannot be reached without an accepted diagnosis,
# and the product rejects an answer whose request id belongs to another run
# (isDiagnosisCurrent compares requestId, bookSnapshot and environmentSnapshot).
# So replaying a recorded answer needs the id swapped, and the SAME book
# attached - here samples\input_win32_sleep.xlsm, which is what C1 answered.
param(
  [string]$Source = 'C1-DIAG-01.response.raw.txt',
  [string]$OldId  = 'de337c53-d198-4686-92f3-d3f86be48074',
  [Parameter(Mandatory = $true)][string]$NewId
)
$RUN = Split-Path -Parent $PSScriptRoot
. "$RUN\lib\act.ps1"

$src = Join-Path $RUN "ai-sessions\$Source"
if (-not (Test-Path -LiteralPath $src)) { throw "no such recorded answer: $src" }

$text = [IO.File]::ReadAllText($src, [Text.Encoding]::UTF8)
$before = ([regex]::Matches($text, [regex]::Escape($OldId))).Count
if ($before -eq 0) { throw "the old request id $OldId does not appear in $Source" }

$replayed = $text.Replace($OldId, $NewId)
SetClip $replayed
Start-Sleep -Milliseconds 500

# Prove the clipboard really holds it: Set-RealClipboard can silently lose a
# large payload if another process owns the board.
$back = Clip
"source        : $Source"
"ids replaced  : $before"
"clipboard len : $($back.Length) (source $($text.Length))"
if ($back.Length -lt ($text.Length * 0.9)) {
  throw 'the clipboard does not hold the whole answer - do not import this'
}
if ($back.IndexOf($NewId) -lt 0) {
  throw 'the clipboard does not contain the new request id'
}
'clipboard verified'
