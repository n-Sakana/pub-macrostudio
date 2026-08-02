# make-nochange-reply.ps1 - put a NOCHANGE repair answer on the real clipboard.
#
# WHAT THIS IS: a protocol fixture, written by hand to the wire contract in
# assets\js\response-package.js. It exercises screen 5's three refusal verdicts
# (UNNECESSARY / IMPOSSIBLE / UNCLEAR), which no recorded answer in
# ai-sessions\ happens to contain.
#
# WHAT THIS IS NOT: an AI answer. Nothing here was produced by a model and it
# must never be filed as blind-trial evidence. HANDOFF section 8 governs new
# blind trials; this is a hand-written message testing how the product reads a
# verdict, in the same spirit as the crafted rejects the first session used.
#
# The contract (response-package.js, top of file) requires all four lines:
#   '@MACROSTUDIO <id> SUMMARY BEGIN
#   ...why, and what was looked at...
#   '@MACROSTUDIO <id> SUMMARY END
#   '@MACROSTUDIO <id> NOCHANGE <VERDICT>
#   '@MACROSTUDIO <id> COMPLETE 0
param(
  [Parameter(Mandatory = $true)][string]$RequestId,
  [ValidateSet('UNNECESSARY', 'IMPOSSIBLE', 'UNCLEAR')][string]$Verdict = 'UNCLEAR',
  [string]$Reason = ''
)
$RUN = Split-Path -Parent $PSScriptRoot
. "$RUN\lib\act.ps1"

if (-not $Reason) {
  switch ($Verdict) {
    'UNNECESSARY' { $Reason = 'このマクロは依頼された内容を既に満たしています。読み取った3モジュールを通して確認しましたが、書き換えるべき箇所がありません。' }
    'IMPOSSIBLE'  { $Reason = '依頼の内容は、このブックのVBAモジュールを書き換えるだけでは実現できません。ブックの外にある設定を変える必要があります。' }
    'UNCLEAR'     { $Reason = '依頼が「いい感じに直す」とだけ書かれており、どの動きをどう変えたいのかが決められません。対象の手続きと、変更後に期待する結果を書いてください。' }
  }
}

$M = "'@MACROSTUDIO"
$lines = @(
  '```',
  "$M $RequestId SUMMARY BEGIN",
  $Reason,
  "$M $RequestId SUMMARY END",
  "$M $RequestId NOCHANGE $Verdict",
  "$M $RequestId COMPLETE 0",
  '```'
)
$text = ($lines -join "`r`n")

SetClip $text
Start-Sleep -Milliseconds 400
$back = Clip
if ($back.IndexOf("NOCHANGE $Verdict") -lt 0) {
  throw 'the clipboard does not hold the NOCHANGE line'
}
"verdict       : $Verdict"
"request id    : $RequestId"
"clipboard len : $($back.Length)"
'clipboard verified'
