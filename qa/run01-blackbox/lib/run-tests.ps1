# run-tests.ps1 - run the product test suites listed in docs\DEVELOPMENT.md and
# record pass/fail per runner. Split into sets because the webview/clipboard
# runners take over the real desktop and would fight the GUI automation.
#
#   -Set node     headless node tests
#   -Set psA      PowerShell tests that need no UI and no real clipboard
#   -Set psB      PowerShell tests that DO open windows / use the clipboard
#                 (run these only when nothing else is driving the desktop)
param([Parameter(Mandatory=$true)][ValidateSet('node','psA','psB')][string]$Set)

$ErrorActionPreference = 'Continue'
$PROD = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
# Portable bundle: this file lives in <repo>\qa\run01-blackbox\lib, so the run
# root is the folder above it and the product repo is two levels above that.
$RUN  = Split-Path -Parent $PSScriptRoot
$REPO = Split-Path -Parent (Split-Path -Parent $RUN)
$log  = Join-Path $RUN "logs\tests-$Set.log"

$nodeTests = @(
  'test-attach-blocked','test-audit-fixes','test-back-and-forth','test-both-route-preset',
  'test-build-payload','test-change-source','test-contract-singleton','test-diagnose-flow',
  'test-diagnosis-headline','test-diagnosis-package','test-diagnosis-preset-cardinality',
  'test-diagnosis-recovery','test-no-domain-knowledge','test-diagnosis-split',
  'test-diff-report-toggle','test-diff-report','test-diff-view','test-diff',
  'test-environment-not-embedded','test-file-drop','test-findings-view','test-handover',
  'test-flow-state','test-host-bridge','test-module-split','test-no-questions',
  'test-no-change','test-output-name','test-p6-state','test-p7-state','test-paste-edit',
  'test-paste-normalize','test-path-candidate-rules','test-path-map','test-preset-description',
  'test-preset-document','test-preset-migration','test-preset-value-migration',
  'test-prompt-template','test-read-report','test-real-diagnosis-reply','test-reject-answer',
  'test-repair-input','test-response-package','test-shortest-path',
  'test-skipped-diagnosis-artifacts','test-three-routes',
  'test-target-environment','test-vba-highlight','test-vba-lexer'
)

# No window, no clipboard. Safe to run while the GUI harness works.
$psA = @(
  'test-app-compile','test-design-system','test-compression','test-ole2','test-vbaproject',
  'test-extract','test-roundtrip','test-bookio','test-build','test-book-inventory',
  'test-guide-samples','test-guide-sample-flow','test-hostservices','test-encrypted-book'
)

# These open real windows or take the real clipboard.
$psB = @(
  'test-clipboard-retry','test-diagnose-webview','test-flow-webview','test-split-webview',
  'test-diff-report-webview','test-webview-security','test-window-icon','test-editor-focus',
  'test-no-change-webview','test-p9-distribution','test-path-map-webview',
  'test-shortest-path-webview'
)

switch ($Set) {
  'node' { $names = $nodeTests; $kind = 'node' }
  'psA'  { $names = $psA;       $kind = 'ps'   }
  'psB'  { $names = $psB;       $kind = 'ps'   }
}

"=== run-tests $Set started $(Get-Date -Format 'HH:mm:ss') ===" | Out-File -FilePath $log -Encoding utf8
$pass = 0; $fail = 0; $failed = @()

foreach ($n in $names) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  if ($kind -eq 'node') {
    $out = & node (Join-Path $PROD "tests\$n.js") 2>&1
  } else {
    $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PROD "tests\$n.ps1") 2>&1
  }
  $code = $LASTEXITCODE
  $sw.Stop()
  if ($code -eq 0) {
    $pass++
    "PASS  $n  ($([int]$sw.Elapsed.TotalSeconds)s)" | Tee-Object -FilePath $log -Append
  } else {
    $fail++; $failed += $n
    "FAIL  $n  exit=$code  ($([int]$sw.Elapsed.TotalSeconds)s)" | Tee-Object -FilePath $log -Append
    ($out | Select-Object -Last 25 | Out-String) | Out-File -FilePath $log -Append -Encoding utf8
  }
}

"" | Out-File -FilePath $log -Append -Encoding utf8
"=== $Set RESULT: $pass PASS / $fail FAIL of $($names.Count) ===" | Tee-Object -FilePath $log -Append
if ($fail -gt 0) { "FAILED: $($failed -join ', ')" | Tee-Object -FilePath $log -Append }
