# manual-macrostudio-beta2

MacroStudio **βv2.00** の操作マニュアル。v1.00 版（`docs/manual-macrostudio-beta1-production-r2_ppt169_20260731/`、
22 ページ）を、現行の実装・画面・ワークフローへ合わせて作り直したもの。

- Canvas format: ppt169（1280×720）
- Created: 20260803
- 対象コミット: `9e903100f4f0f2ed2db19736df0818dba0615b69`（`main` == `origin/main`）
- 成果物: `exports/manual-macrostudio-beta2_20260803_123351.pptx`（22 枚）
- 編集元: `svg_output/`（1 ページ = 1 SVG）

**旧版は一切変更していない。** `manual-macrostudio-beta1-production-r2_ppt169_20260731/`（v1.00・22p）、
`manual-macrostudio-beta1-production_ppt169_20260730/`（r1・34p）、
`manual-macrostudio-beta1_ppt169_20260730/`（旧試作）はそのまま残してある。

## v1.00 版から変えたこと

β2.00 は入口を変えた版なので、章立てから作り直している。

| | v1.00 版（r2） | 本版 |
|---|---|---|
| 入口 | 「AIで改修 / AIで相談 / 簡易モード」の 3 択 | 無し。**読み込む → 診断する → 改修を決めて実行する → ブックを作る**の一本道 |
| 進捗 | 用途で段数が変わる | 常に 4 手順で固定 |
| 画面数 | 11 | **10**（受け渡しと取り込みが 1 画面に統合） |
| 第 1 段階 | 用途の選択 | **事実監査（AI 診断）**。この段階では直し方を決めない |
| ひな形 | 1 つだけ選ぶ | **複数選べる**。並んでいる順で 1 通の依頼にまとまる |
| 固定パス | 扱わない | **対応表による置換**。手元で完結し、AI へ渡さない |
| 通しの作業事例 | 改修 1 件 | **パス置換 ＋ Win32 API 改修を 1 回の実行で行う 1 件**（P06–P19） |

## ページ構成（22 枚）

| # | ページ | 節 |
|---|---|---|
| P01 | 表紙 | — |
| P02–P05 | この本の読み方／すること・しないこと／4 手順と 10 画面／用意するもの | このツールがすること |
| P06 | 例に使うブックと、この 1 回で行うこと | 通しの作業事例 |
| P07–P08 | ブックを読み込む／読み取った内容を確認する | 〃 |
| P09–P10 | 診断を依頼する／返答を取り込む | 〃 |
| P11–P12 | 診断結果を確認する／指摘の中身を見る | 〃 |
| P13 | 次にすることを選ぶ（ひな形は複数選べる） | 〃 |
| P14–P15 | **画面 4 上段＝置換の対応表／下段＝AI へ頼む内容** | 〃 |
| P16–P17 | 改修を依頼して取り込む／差分を確認する | 〃 |
| P18–P19 | 出力ファイル名／ビルドと完了 | 〃 |
| P20–P22 | Excel で動作を確認する／別の進め方／動作要件と仕組みの要点 | 確かめること・別の進め方 |

## 画面写真

`images/` の 24 枚はすべて 2026-08-03 に現行実装（`9e90310`）から撮影。撮影リグは
`sources/capture-rig/`。**製品コードは変更していない** — WebView2 ホストの IPC だけを
モックし、画面遷移はすべて実コントロールのクリックで到達している。

通し事例の対象は `sources/walkthrough-sample/sample_share_and_win32.xlsm`。
**固定パスと Win32 API の両方を持つブックが repo に無かったので、マニュアル用に 1 冊作った**
（`sources/walkthrough-sample/README.md` に理由と検証を記載）。`tests/`・`testdata/`・
製品コードには一切書き込んでいない。

## 再生成手順

ppt-master スキルのスクリプトを使用（リポジトリルートで実行）:

```
python <ppt-master>/scripts/finalize_svg.py docs/manual-macrostudio-beta2_ppt169_20260803
python <ppt-master>/scripts/svg_quality_checker.py docs/manual-macrostudio-beta2_ppt169_20260803 --stage final --json
python <ppt-master>/scripts/svg_to_pptx.py docs/manual-macrostudio-beta2_ppt169_20260803 --no-notes --no-merge
```

**`--no-merge` は必須**（この日本語デッキでは）。既定の段落マージでは dy で改行した各行が
空白でつながれて 1 段落になり、テキストボックス幅が和文の平均字幅による推定で決まる。
漢字の多い行は実測幅がその推定を超えるため、PowerPoint が独自に再折り返ししてカードや表と
重なる。ブラウザ表示や品質ゲートではこの差は出ない。

`--no-notes` はスピーカーノートを作らない設定（`design_spec.md §I` の Speaker Notes: disabled）。

チェッカーは `--json` を付けたときだけ `validation/svg_quality_report.json` を更新する。
省くとエクスポート時の postflight が `quality_gate=stale` になる。

## 検証状態（2026-08-03）

- SVG 品質ゲート（final）: **22 ページ 0 エラー**（警告 2 件は助言レベル・非ブロック）
- PPTX postflight: `passed-with-warnings` / `quality_gate=passed` / 22 slides
- **PowerPoint COM で全 22 スライドを PNG 書き出しして目視**（`Slide.Export`。ファイルが
  開けることの確認だけでは描画崩れは検出できない）

目視で検出し、修正した欠陥 4 件:

| ページ | 欠陥 | 直し方 |
|---|---|---|
| P20 | 「署名は外れます」の最終行がカード枠の外へ出ていた | カードを 14px 上へ伸ばし、本文を 17→16px・行送り 26→24 に |
| P22 | 「仕組みの要点」の最終行がカード枠の外へ出ていた | カードを 272→288 に伸ばし、行送りを詰めた |
| P16 | 注記の 2 行目がカード右端を越えていた／キャプションの件数が実画面と違っていた（1 個 → **2 個**） | 2 行に割り、件数を実画面に合わせた |
| P12 | キャプションが「行を開くと…」と書いていたが、写真は指摘の行ではなく「このマクロの詳細」を開いた状態だった | キャプションを写真の事実に合わせ、開いたときに何が出るかは右段へ移した |

いずれも **SVG 品質ゲートは通っていた**。カード枠と本文の関係、キャプションと写真の一致は、
実描画を見るまで分からない。

- 記載文言は実装（`assets/js/screens.js`・`screens/workflow.js`・`app.js`・`state.js`）と
  実画面から採取。出典は `sources/macrostudio-beta2-manual-facts.md` に `file:line` で記録

## 未確認点

- **P16 の「2個のモジュールを取り込み済み」は、対応表で置き換えた `ShareExport` を含む数である。**
  AI が返したのは `TimerUtils` の 1 つだけ。画面の数え方（`countImported`）が置換済みモジュールも
  数えることは実測で確認したが、製品仕様書にこの数え方の明文はまだ見つけていない
- 本書は `9e90310` 時点の実装から作った。以降の変更は反映していない
- `docs/SPEC.md` §12「未検証事項の引き継ぎ」と §15「既知の制限・未検証事項」の全項目は
  取り込んでいない。画面の折りたたみ「このあと人が確かめること」に出る内容を P20 で扱うに留めた
- `docs/SPEC.md` 付録 B の診断記入例は、製品の検証器が D29（`beginCount`）で拒否する。
  `DIAG BEGIN <n>` の `n` は版番号ではなく指摘の件数で、正本は
  `presets/01_診断/01_動作環境の事実監査.md` の記入例。**製品側の判断事項として報告済み、
  当方では変更していない**

## Directories

- `svg_output/`: 編集元の SVG（ここを直して上記手順で再生成）
- `svg_final/`: 自己完結の SVG プレビュー
- `images/`: 撮影した実画面 24 枚
- `icons/`: プロジェクトのアイコン（本版は未使用）
- `notes/`: スピーカーノート（本版は無し）
- `sources/capture-rig/`: 撮影リグ（`mock.js` / `fixtures_build.py` / `shoot.py`）と生成物 `out/`
- `sources/walkthrough-sample/`: 通し事例の撮影用ブックと、その生成・検証キット
- `sources/macrostudio-beta2-manual-facts.md`: 事実台帳（出典付き）
- `analysis/`: 画像の機械抽出情報（`image_analysis.csv`）
- `validation/`: SVG 品質レポートと PPTX postflight
- `exports/`: 最終成果物 PPTX
- `backup/<timestamp>/`: `svg_output/` の書き出し時アーカイブ
