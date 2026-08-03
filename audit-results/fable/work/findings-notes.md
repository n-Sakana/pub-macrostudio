# 監査メモ（作業用・随時追記）

## F-01 決定的置換のやり直しが必ず E-MAP-02 になる（SPEC §7.7.1 違反）
- 実装: `assets/js/screens/workflow.js:2252` `apply(state.pathMap, store.getCurrentModules())`
- `state.js:935 getCurrentModules()` は `pastedCode` があればそれを返す。
  1 回目の置換で `setDeterministicResult` → `importPackageItems` が `pastedCode` を
  置換後コードにするため、2 回目の preflight は「記録した値と一致しない」で全件中止。
- SPEC §7.7.1「候補の検出と適用は常に添付時のコード（attachBook が返した module.code）から
  計算する。前回の置換結果や手動修正を入力にしない。そうしないと、旧い値がすでに
  消えているために E-MAP-02 が必ず起きる」に真正面から反する。
- 再現: S01 → 診断取込 → 固定パスひな形 → `D:\shinsei\` で［次へ］（成功）→［戻る］→
  値を `E:\shinsei\` に変更 →［次へ］→ E-MAP-02。
- 証拠: evidence/46_redo_emap02.png、37/38/39 も同じ現象。
- トーストは「ブックを読み込み直して、もう一度やり直してください」と案内するが、
  実際にブックを読み込み直すと診断（AI往復の成果）を失う。
- 回復の裏道: 画面3へ戻ってひな形を選び直すと `detect(getBookModules(), ...)` が
  添付時コードから再検出し、`pastedCode` も入れ替わるので成功する（evidence/47）。
  ただし画面のどこにも案内がなく、初心者は到達できない。
- 置換結果自体は正しい（D: を経由せず S:\eigyo\shinsei\ → E:\shinsei\）。

## F-02 診断／改修の取り込み拒否がログに残らない
- SPEC §8.4「診断パッケージの受理・拒否（拒否は検査番号 D01 等）」を要求。
- 実測: 5 種の不正診断・5 種の不正改修返答を GUI で拒否させたあと
  `%LOCALAPPDATA%\MacroStudio\logs\macrostudio_20260802.log` に該当行なし。
- `workflow.js:545 handleIntakeFailure` は toast のみで writeLog を呼ばない。
  `validationId` は `diagnosis-package.js` が返しているのに捨てている。

## F-03 モジュール種別の読み替え警告が画面に出ない
- SPEC §13.9「返答の <種類> が食い違ってもブックの種類のまま取り込み、
  画面 6 に常時表示の警告として何を読み替えたかを出す」。
- 実測: `BEGIN class TimerUtils`（実体は標準モジュール）を取り込むと
  「2個のモジュールを取り込みました」と成功表示のみ。画面 6 にも警告なし
  （evidence/16, 17。`document.body.innerText` に「読み替え」「種類」なし）。

## F-04 BLOCKER × basis!=observed の注記が出ない
- SPEC §4.4.2「CLASS=BLOCKER かつ basis が observed でない指摘には、
  第二層に『この環境前提は実測ではありません』の 1 行を添える」。
- 実測: WIN32API_BLOCKED（basis=declared）の BLOCKER 指摘を開いても
  該当文言なし（evidence/10、`innerText.includes('実測') === false`）。
  同梱環境の basis は全 24 件が declared/inferred なので、常に出ないことになる。

## F-05 画面4→5 の往復で改修依頼IDが再発行され、取り込み済みのAI回答が消える
- 実装: `workflow.js:2293 handleNext` → `prepareRepairRequest()` が無条件に
  `createIdentity()` で新 ID を発行し `commitRepairRequest` する。
  診断側 `prepareDiagnosisRequest` は `state.diagnosisRequestId && force !== true` で
  再作成を防いでいるのに、改修側には同じ門番が無い。
- 再現（S07 実行, evidence/52→53→54）:
  改修返答を取り込み成功（intake=true, changed=[RefreshData], id=361683bc…）
  →［戻る］（画面4。intake はまだ true）→［次へ］（入力は 1 文字も変えていない）
  → id=adca6ae6…、intake=false、changed=[] へ。取り込み済みが黙って消える。
- SPEC §2.6 の無効化規則は「画面 4 の入力を変えた」ときだけ改修依頼・改修パッケージを
  捨てると定めている。入力不変での破棄は規則外。
- 確認ダイアログも警告も出ない（ブック読み込み直しには discard-modal があるのに）。
- 利用者影響: AI とのやり取り 1 往復がまるごと無効になる。既に受け取った回答を
  貼り直しても「別の依頼への返答のようです」で拒否される（実測）。

## F-06 「自分で改修内容を書く」に、書く場所と名前が一致する欄が無い
- ひな形の `## 説明` は「どう直してほしいかを、この後の画面で自分の言葉で書きます」。
- 実際の画面 4 は「改修する指摘」（0 件なら空）＋「追加の要望を書く（任意）」の
  畳まれた欄だけ（evidence/51）。書けと言われた場所が「追加」「任意」を名乗る。
- 依頼文の【改修指示】には、ひな形の人間向け記入例
  「ここに、AI へ改修してほしい内容を書いてください。」がそのまま AI へ渡る。
  利用者の文は別の【追加の要望】に入るため、依頼文だけ読むと未記入に見える。

## F-07 SPEC §5.2 の希望動作入力・候補チップ・維持することが UI に無い
- `state.behaviorCandidates` / `state.preserveItems` は解析・保持されるが
  描画側に参照が 1 つも無い（grep 済み）。`screens.js:74 areAllSelectedFindingsSpecified`
  も定義・export されているだけで `isAiRepairInputReady` から呼ばれていない。
- `tests/test-repair-input.js` は「per-finding form が無いこと」を固定しており、
  commit f5303e1 の意図的な削除。ただし SPEC.md（正本）§2.4/§5.2/§5.3.2 と
  README「指摘ごとの希望動作を選ぶか自分で書く」は旧仕様のまま。
  DEVELOPMENT.md は「仕様と本書が食い違ったら SPEC.md を優先する」と述べているので、
  現状は製品が自分の正本と矛盾している。

## 良かった点（記録）
- 元ブック SHA-256 が全工程で不変（006E0EB0…4485）。
- 出力名に `..\evil\sample.xlsx` を入れると即座に［次へ］が閉じ、赤枠＋
  「拡張子は .xlsm のままにします」を表示（evidence/20）。
- 取り込み失敗時に「言い直す文」をクリップボードへ入れ、2 回連続失敗で
  「別の AI に渡してください」へ切り替える（実装 workflow.js:513/545）。
- 分割取り込みで欠番・合計不一致・同番号異内容をすべて拒否し、冪等再送は受理。
- 差分レポート HTML: http 参照 0、input/textarea/contenteditable 0、noscript あり。
