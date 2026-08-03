# capture-rig — βv2.00 の撮影・検証キット

実 UI をホストモック注入で駆動し、通しフローの各場面を撮影する。**製品コードは変更しない。**

- 対象コミット: `9e903100f4f0f2ed2db19736df0818dba0615b69`（`main`）
- 対象ブック: `../walkthrough-sample/sample_share_and_win32.xlsm`

## 仕組み

`assets/` を読み取り専用で HTTP 配信し、ページスクリプトより先に

1. `window.__MS_FIXTURES__`（`fixture.json`）
2. `mock.js`（WebView2 ホストのモック）

を注入する。画面遷移はすべて**実コントロールのクリック**で、状態を直接書き込む箇所は無い。

`mock.js` は `src/03_MessageRouter.cs` が dispatch する **14 アクション**をすべて実装する
（`getAppInfo` / `getTargetEnvironment` / `pickBook` / `pickLocation` / `attachBook` /
`readPreset` / `readRequestTemplate` / `writeRequestFiles` / `writeDiagnosisFile` /
`writeRunManifest` / `writeClipboard` / `readClipboard` / `buildBook` / `revealPath` /
`writeLog`）。返す形は `src/04_HostServices.cs` から採っている。
知らないアクションは実ホストと同じくエラーを返すので、到達できない画面は**黙って偽装されず
その場で失敗する**。

アプリがホストへ渡したもの（`diagnose-request.md` / `source-code.md` /
`source-code-for-ai.md` / `diagnosis.md` / `repair-request.md` / 差分 HTML /
`result.md` / `run-manifest.json`）は `out/` に保存される。マニュアルは
**製品自身の出力**を引用でき、書き写しをしない。

## 手順

```powershell
python fixtures_build.py   # fixture.json を repo の実物から組む
python shoot.py            # out/ へ撮影
```

要 Python + Playwright(Chromium)。`pip install playwright` と
`python -m playwright install chromium`。

## fixture.json の出どころ

| 中身 | 出どころ |
|---|---|
| ブック・モジュール | `../walkthrough-sample/modules.json`（**製品自身の読み手**が読んだもの） |
| モジュール種別ラベル | `assets/messages/module-type-*.txt`（ホストと同じ読み方） |
| ひな形 | `presets/01_診断` `presets/02_改修` の実ファイル |
| 依頼テンプレート | `templates/*.txt` |
| 想定動作環境 | `environment/target-environment.json` |
| 診断パッケージ | ここで組む（SPEC §4.4）。**行番号はモジュール本文から探して埋める**ので、サンプルを変えても指す先がずれない |
| 改修パッケージ | ここで組む（SPEC §13.9） |

診断・改修の 2 つは、**製品自身の検証器に通して受理されることを確認済み**
（`diagnosis-package.js` → 8 指摘、`response-package.js` → `TimerUtils(standard)`）。

## 仕様書との食い違い（実測）

`DIAG BEGIN <n>` の `n` は**指摘の件数**であって版番号ではない。
`docs/SPEC.md` 付録 B の記入例は `DIAG BEGIN 1` … `DIAG COMPLETE 2` と書いており、
この組み合わせは製品の検証器が **D29 / `beginCount`** で拒否する。
正本は `presets/01_診断/01_動作環境の事実監査.md` の記入例（`DIAG BEGIN 2` … `COMPLETE 2`）で、
SPEC 自身も「食い違ったらファイルが正しい」と書いている。付録 B は直したほうがよい。

## 実 UI の操作点（実測した属性）

| 対象 | セレクタ |
|---|---|
| 画面内の折りたたみ | `[data-action="toggle-workflow-disclosure"][data-disclosure-key="<key>"]` |
| シェル側の折りたたみ | `[data-action="toggle-disclosure"][data-disclosure="<key>"]` |
| 折りたたみのキー | `book-read-result` / `book-outside-code` / `diagnose-environment` / `diagnose-concern` / `extra-request` / `change-detail` / `remaining-work` |
| ひな形カード | `[data-action="select-repair-preset"][data-preset-file="<file>"]` |
| 対応表の入力 | `input[data-workflow-input="path-map-to"][data-group-key="<リテラル>"]` |
| 出力ファイル名 | `#output-name` |
| 診断を飛ばす | `#diagnosis-skip`（チェックボックス） |

**ひな形ファイル名と対応表のグループキーは `\` を含むため、CSS 属性セレクタに直接書けない。**
`shoot.py` は位置を JS 側で解決してから `nth()` で操作する。

## いまの状態（2026-08-03）

**通しフローは画面 0 → 7 まで実 UI で到達できている**（撮影 01〜19 相当まで到達）。
`fixture.json` の組み立て、診断の受理、対応表の検出と入力、置換の実行、
出力名の検査（予約デバイス名を含む）まで動く。

### 解決済み — ひな形カードは「トグル」であり、到達時に 1 枚は既に選ばれている

当初「1 クリックで 2 回効いている（二重発火）」と見たが、**誤りだった。** 実測すると:

- 画面 3 に着いた時点で `readPreset` が **1 回すでに呼ばれている**。アプリが
  推奨のひな形を自動で 1 枚チェックした状態で画面が出る
- 合成クリック 1 回でも、Playwright の実クリック 1 回でも、`readPreset` の増分は
  **1 回だけ**。二重発火は起きていない
- カードは `role="checkbox"` のトグルなので、**既に選ばれているカードを押すと外れる**

つまり最初のクリックは選択ではなく**解除**だった。製品の不具合ではない。
リグ側は「まだ選ばれていないカードだけ押す」ように直した（`pick_preset` は
現在の `state.presetFiles` を見てから押す）。

### 解決済み — 画面 4 は 2 段。置換の［次へ］では画面番号が変わらない

**当初の症状**: 画面 4 の［次へ］で画面が変わらず、リグが失敗した。

**原因はリグの操作順**だった。両方経路の画面 4 は 2 段（先に置換、続けて AI の条件）で、
**置換の［次へ］は同じ画面 4 に留まるのが正しい挙動**である（SPEC §2.3）。
リグの `App.next()` は「画面番号が変わること」を待つ作りだったので、変わらないまま待ち続けた。
`App.apply_replacement()` を足し、置換の段だけは `state.appliedMapping` が立つのを待つようにした。

**実操作と state の一致（2026-08-03 実測）**

| 段階 | screen | engine | applied | pending | inputReady | canAdvance | nextIndex |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 画面3 到達時 | 3 | AI | false | false | true | true | 4 |
| 画面3 両方チェック後 | 3 | AI | false | **true** | false | true | 4 |
| 画面4 上段（未入力） | 4 | AI | false | true | false | **false** | 5 |
| 画面4 上段（3 行入力） | 4 | AI | false | true | **true** | true | 5 |
| 画面4 下段（置換後） | 4 | AI | **true** | **false** | true | true | 5 |
| ［次へ］の後 | **5** | AI | true | false | true | false | 6 |

DOM も一致していた。画面3 到達時点で `01 Win32` のカードが `aria-checked=true`（推奨の自動選択）、
`02 固定パス` を足して両方 `true`。画面4 上段の `[次へ]` は `disabled=true` で、
3 行を入力すると `disabled=false` に変わる。画面4 下段では指摘のチェックボックスが出て、
環境が阻害する指摘（`selectedFindings=["1","2"]`）が既にチェック済み。

**製品側に不具合は無い。** 直したのはリグだけ。

## 撮影結果（2026-08-03）

`python shoot.py` → **24 場面、失敗 0。**

| 場面 | 画面 |
| --- | --- |
| 01–03 | 画面0 ブック読み込み（未読込 / 読込後 / 読み取ったコード展開） |
| 04–07 | 画面1 診断（依頼 / 前提環境の展開 / 受け渡し済み / 取り込み後） |
| 08–09 | 画面2 診断結果（一覧 / 指摘を開いた第二層） |
| 10–11 | 画面3 次にすること（推奨の自動選択 / 両方チェック） |
| 12–14 | 画面4（対応表 / 入力済み / **置換後の AI 段**） |
| 15–16 | 画面5 改修の受け渡しと取り込み |
| 17 | 画面6 差分 |
| 18–19 | 画面7 出力名（正常 / 予約デバイス名の拒否） |
| 20–22 | 画面8 ビルド中 / 画面9 完了 / 完了の「このあと人が確かめること」 |
| 23 | 完了画面から戻った先（実行は完了したまま） |
| 30 | 診断を飛ばす |

アプリ自身がホストへ渡した成果物も `out/` に保存済み:
`diagnose-request.md` / `repair-request.md` / `source-code.md` / `source-code-for-ai.md` /
`diagnosis.md` / `diff-report.html` / `result.md` / `run-manifest.json`。

**置換と原本の分離を実測で確認**（SPEC §7.2 のとおり）:

- `source-code-for-ai.md`（チャットへ渡す方）… `D:\keiri_share\seikyu\` /
  `\\file01.example.local\keiri\hinagata\` / `D:\keiri_local\hikae\` に置換済み
- `source-code.md`（読み取った時点の記録）… `S:\keiri\seikyu\` のまま**原本**
