# _n03_screen0_accordions.ps1 - ledger S0-04 and S0-06, still unoperated after
# three sessions: the [読み取ったコード] and [コードの外にあるもの] folds on
# screen 0. Open, close, and open again, capturing each state.
$RUN = Split-Path -Parent $PSScriptRoot
. "$RUN\lib\act.ps1"

$CODE  = @(960, 588)   # 読み取ったコード
$OUTER = @(960, 655)   # コードの外にあるもの  (moves down once CODE is open)

Tap $CODE[0] $CODE[1] 'open 読み取ったコード' | Out-Null
Start-Sleep -Milliseconds 1200
Shot 'N_003a_S0_code_open'

Tap $CODE[0] $CODE[1] 'close 読み取ったコード' | Out-Null
Start-Sleep -Milliseconds 1200
Shot 'N_003b_S0_code_closed'

Tap $CODE[0] $CODE[1] 'reopen 読み取ったコード' | Out-Null
Start-Sleep -Milliseconds 1200
Shot 'N_003c_S0_code_reopen'

Tap $CODE[0] $CODE[1] 'close again' | Out-Null
Start-Sleep -Milliseconds 1200

Tap $OUTER[0] $OUTER[1] 'open コードの外にあるもの' | Out-Null
Start-Sleep -Milliseconds 1200
Shot 'N_003d_S0_outer_open'

Tap $OUTER[0] $OUTER[1] 'close コードの外にあるもの' | Out-Null
Start-Sleep -Milliseconds 1200
Shot 'N_003e_S0_outer_closed'
