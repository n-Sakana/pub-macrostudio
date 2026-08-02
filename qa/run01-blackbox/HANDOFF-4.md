> **【移送版・note 端末】** run01 の証跡一式は `qa\run01-blackbox\` にあります。
> 同梱物・未転送物・再生成の方法は [README.md](README.md) を読んでください。
> スクリーンショットのうち desktop 時代の `R2_*` `R3_*` は**未転送**です。
> 本セッションの `N_*` は実在します。

# 引き継ぎ書 その4 — MacroStudio 実機ブラックボックス試験（run01 続き・note 端末）

- 宛先: **まっさらな新規セッション**（前提知識ゼロで読める前提）
- 経緯: opus-qa-supervisor（`HANDOFF.md`）→ 2代目（`HANDOFF-2.md`）→ 3代目（`HANDOFF-3.md`）→ **本セッション（4代目・note 端末）** → あなた
- 対象: `<repo>`（このファイルから見て `..\..`）
- 証跡: `qa\run01-blackbox\`

`HANDOFF.md` の §6（ハーネスの使い方）・§7（安全境界）・§8（盲検AIの規律）は**そのまま有効**です。
ただし後述の §7 のとおり、**座標表だけは端末が違うので使えません**。

---

# 0. まず読む — この端末は desktop と違う

前任3代は 3840x2160@150% の desktop で作業していました。**ここは note で、実 1920x1080@125% です。**

1. **HANDOFF-2 §1 の座標表（1600x1050 前提）は 1 つも使えません。**
   1600x1050 で起動すると窓の下端が画面外に出て、**［戻る］［次へ］がタスクバーの下に隠れます**。
   `lib\fit-window.ps1` を新設したので、起動後に必ず これを実行してください（1920x1020 に合わせます）。
   note 用の確定座標表は `findings\FINDINGS.md` の **ENV-02** にあります。
2. **DPI に注意。** DPI 非対応のプロセスから画面を測ると 1536x864 と出ます。
   `gui.ps1` は per-monitor DPI aware なので**そちら（1920x1080）が正**。最初にこれで 1 度誤りました。
3. **一括 GUI スクリプトには必ず「進んだことの確認」を入れること。**
   本セッションの `route-to-screen7.ps1` は入力に失敗したのに最後まで走って
   **"reached screen 7" と嘘の成功を出しました**（`shots\N_p14_04`）。
   実測でわかった安全な形は「**新規プロセスで tap → type**」です（`lib\step.ps1` を 1 手ずつ叩く）。

---

# 1. いま動いているもの

| 対象 | 状態 |
|---|---|
| MacroStudio | **本セッションが起動した個体は停止済み**（psB テストのため）。必要なら `lib\launch-app.ps1` → `lib\fit-window.ps1` の順で起動する |
| Excel | 0 件 |
| GUI 自動操作 | 0 件 |
| blind-ai-orchestrator | **本セッションでは一度も使っていない**（3代目・4代目とも未使用） |

プロセスの数え方の**罠**（本セッションで 1 度誤った）:

```powershell
# これは自分自身にヒットする。問い合わせ用 powershell.exe の
# コマンドライン自体に 'macrostudio.ps1' が入っているため。
$me = $PID
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.ProcessId -ne $me -and
                 $_.CommandLine -like '*macrostudio.ps1*' -and
                 $_.CommandLine -notlike '*Get-CimInstance*' }
```

---

# 2. 本セッションで決着したこと

## 2.1 修正した不具合（3件。すべて実 GUI 再試験＋回帰済み）

| ID | 内容 | 状態 |
|---|---|---|
| **PROD-12** | 画面7が予約デバイス名を通し、ビルドが成功し、**開けない・改名できない・消せない**成果物ができる | **修正済み・実 GUI 確認済み** |
| **PROD-15**（新規） | 画面7が拒否の**理由を言わない**。唯一の補足文が「拡張子は…」固定で、予約名のときは**嘘**になる | **修正済み・実 GUI 確認済み** |
| **PROD-14** | 診断を飛ばした実行でも完了画面と `result.md` が「AIへ渡した／添付した」と名乗る | **修正済み・実 GUI 確認済み** |

### 変更したファイル（製品側）

| ファイル | 変更 |
|---|---|
| `assets/js/screens.js` | `RESERVED_DEVICE_NAME` / `isReservedDeviceName` / `hasControlCharacter` を追加し `isOutputNameValid` へ組み込み（PROD-12）。`getOutputNameProblem()` を追加し公開（PROD-15） |
| `assets/js/app.js` | 画面7の補足文を「原因の1文」に出し分け（PROD-15）。完了画面と `result.md` の第1依頼の名乗りと添付案内を経路で出し分け（PROD-14） |
| `assets/css/flow.css` | `.field-help--problem`（`--danger-text`）を追加 |
| `tests/test-output-name.js` | 「通る現状の固定」を**実測どおりの拒否**へ反転。理由文の検査も追加 |
| `tests/test-skipped-diagnosis-artifacts.js` | **新設**（PROD-14） |
| `docs/DEVELOPMENT.md` | 新設テストを登録（`test-contract-singleton.js` が一致を強制する） |

**PROD-12 は文書を信じず実測してから直しました。** `lib\probe-reserved-names.ps1` で TEMP に実ファイルを
作って測ったところ、文書の一覧（COM1〜9 / LPT1〜9）より広く **COM0・LPT0・CLOCK$ も同じ性質**でした。
逆に `CONTRACT` `CON1` `COM` `LPT` `NULL` `AUXILIARY` `backup.CON.xlsm` は普通のファイルなので、
**締めすぎ防止の must-keep** としてテストに入れてあります。

## 2.2 コーパスの実 GUI 投入 — **HANDOFF-3 §3.1 は完了**

未投入だった **40 本すべて**を投入しました。詳細は `corpus\note-RESULTS.md`。

- 受理 **37 本**（`exports\` に run フォルダが 37 個できたことで確認）
- 拒否 4 本（`G04` `G05` `G07` `G09`）— **拒否が正解**
- **G07・G09 は実機で `E-ATTACH-02`**。PROD-10 の修正が維持されている
- **A05 = 12,034 行 / 32 モジュール**を完読
- **形式3種（G01 `.xlam` / G02 `.xlsb` / G03 `.xls`）完了**

途中 1 度、**2連続失敗の関門が働いてバッチが自動停止**しました（`shots\N_INJ_STOP_B02`）。
原因は私の座標誤りで、拒否バナーが出ると［選び直す］が `y=397`→**`546`** へ下がることを見落としていました。
**止めて撮ったので 1 回で原因が判明**しています。前任が 30 冊叩き続けた事故の再発を実際に防いだ形です。

## 2.3 テスト

| 種別 | 結果 |
|---|---|
| node **50 本** | **50 PASS / 0 FAIL**（新設 1 本込み） |
| `test-design-system` | PASS |
| PowerShell 非UI系（psA）14 本 | **8 PASS / 6 FAIL** — 全て **fixture 欠落**が原因。§4 を読むこと |
| PowerShell UI系（psB）12 本 | **12 PASS / 0 FAIL** |

**psB は run01 で初めて実行されました。** `HANDOFF-3.md` §3.4 が
「未実行。デスクトップを占有してよい時間帯に単独で流すこと」と残していた項目です。
実 window と実クリップボードを奪うので、**自分の MacroStudio を停止してから単独で**流しました
（所要 約2分）。ログは `logs\note-tests-psB.log`。

## 2.4 画面2 へ到達し、3代目まで未操作だったアコーディオンを消化

画面2 は**診断結果の取り込みが要る**ため、ずっと未操作のまま残っていました。
`lib\replay-diagnosis.ps1` を新設して到達しました:

1. C1 が答えたのと**同じブック** `samples\input_win32_sleep.xlsm` を読み込む
2. 画面1 に着くと `run-manifest.json` に新しい `diagnosisRequestId` が書かれる
3. 保存済みの生回答 `ai-sessions\C1-DIAG-01.response.raw.txt` の**依頼IDだけ**を
   その値へ置換して実クリップボードへ載せる（99 か所置換・長さを検証してから投入）
4. ［クリップボードから診断結果を取り込む］→ **受理**

> **これは新規の盲検試行ではありません。** 新しく AI に何も尋ねていないので
> `HANDOFF.md` §8 の規律（新規個体・逐語・ツール無し）には触れません。
> `ai-sessions\` の生回答は**1バイトも変えていません**（クリップボード用の複製だけを書き換え）。
> 製品が依頼ID・bookSnapshot・environmentSnapshot の一致を要求するため、
> ID 差し替えと同一ブックの両方が必要でした。

消化した台帳項目: **S2-03（詳細4行すべて）/ S2-04（指摘の展開）/ S2-08 / S1-08**。
副産物として **PROD-08 の修正が維持**されていること（要約3文が完結している）と、
2代目の「7件の指摘 vs 3件」判定が正しいことを再確認しました。
詳細は `ledger\component-ledger.md` の末尾。

## 2.5 画面5 の NOCHANGE 3判断を消化

`H04_insufficient_info.xlsm` を「診断を飛ばす → ひな形04 自分で改修内容を書く」で通し、
改修依頼にわざと決められない文を入れて画面5 へ到達。
`lib\make-nochange-reply.ps1` で**手書きの protocol fixture** を作り、3判定を順に投入しました。

| 判定 | 本文の見出し | 右上 | ［次へ］ |
|---|---|---|---|
| UNCLEAR | 依頼の内容を決められないという回答です | 依頼の内容を決められません | **無効** |
| UNNECESSARY | 改修は不要という回答です | 改修は不要 | **無効** |
| IMPOSSIBLE | この方法では改修できないという回答です | この方法では改修できません | **無効** |

**3判定が互いに別の文言で、理由が逐語で出て、いずれも先へ進めない。** 期待どおりです。
台帳 **S5-04 / S5-06 / S5-07 / S4-04** を消化しました。

> `make-nochange-reply.ps1` の出力は **AI が書いたものではありません**。
> `response-package.js` の線条書き契約に手で合わせた protocol fixture です。
> **盲検の証跡として扱わないこと。** `ai-sessions\` に3判断を含む回答が無いため用意しました。

---

# 3. 新規の所見

| ID | 内容 | 状態 |
|---|---|---|
| **PROD-16** | 接続文字列の中の固定パスが**リテラル全体でしか置き換えられない**（F06） | **未修正・設計判断が要る**（§5） |
| **ENV-01** | psA 14 本は**まっさらな clone では緑にならない**。試験基盤の再現性欠陥 | 未修正（§4） |
| **ENV-02** | note 端末では desktop の座標表が使えない | 対処済み（`lib\fit-window.ps1`） |
| **HARNESS-02** | 自作 route スクリプトが失敗を成功と報告した | 回避策を確立（§0-3） |

すべて `findings\FINDINGS.md` に詳細があります。

---

# 4. ENV-01 — psA が緑にならない件（**次の人がまず困るところ**）

`docs\DEVELOPMENT.md` §4 のとおり `testdata/` は `.gitignore` 対象で、リポジトリにありません。
この端末で初回に回したら **2 PASS / 12 FAIL**、全部 fixture 欠落でした。

**復旧できたもの**（やっておいたので、次の人は再実行するだけ）:

```powershell
copy sample-book\sample_win32_sleep.xlsm            testdata\test_large.xlsm
copy qa\run01-blackbox\samples\input_win32_sleep.xlsm    testdata\
copy qa\run01-blackbox\samples\input_monthly_report.xlsm testdata\
powershell -NoProfile -ExecutionPolicy Bypass -File tests\make-guide-samples.ps1
```

**復旧できないもの（阻害条件）**: 残り 6 本は**テストが fixture の実測値を直値で持って**います。

| テスト | 期待する値 | `sample_win32_sleep` の実測 |
|---|---|---|
| `test-vbaproject` | モジュール **6** | 8（`Sheet2` `Sheet3` を含む） |
| `test-bookio` | `vbaProject.bin` **17,920 バイト** | 59,904 |
| `test-hostservices` | `totalLines` **19** | 536 |
| `test-extract` | 標準 4 本 | 同上 |
| `test-ole2` | `AppController` ほか 6 ストリーム | 名前は一致するが数が違う |
| `test-guide-samples` | S08 の ActiveX 数 **0** | 2（この端末の Excel が埋め込んだ） |

つまり本来の `test_large.xlsm` は「標準4本＋Sheet1＋ThisWorkbook・**全19行**・
vbaProject.bin **17,920 バイト**」の小さなブックで、
`git log --all --diff-filter=A -- testdata/` で調べても**一度も commit されていません**。
バイト数一致まで要求されるので、`docs\DEVELOPMENT.md` の「Excel で作成」だけでは再現不能です。

**これは製品の不具合ではなく、試験基盤の再現性の欠陥**です。DOC-01 / DOC-02 と同種。
筋の通る直し方は次のどちらか。**先生の判断を仰いでください**:

1. `tests\make-test-large.ps1` を作り、`test_large.xlsm` を**生成できるようにする**（他の `make-*` と同じ形）
2. テストの直値を**実測から導く**形に変える（fixture の中身に依存しない検査に落とす）

---

# 5. PROD-16 — 直せるが、**選ぶのは先生**

`F06_ace_connection_path.xlsm` の oracle には**受け入れ条件が事前登録**されていました:

> 候補として `S:\eigyo\shinsei\` が2か所出るのが期待。接続文字列全体を1リテラルとして扱って取りこぼすなら所見

実測（`shots\N_045`）: 製品は 2 か所とも**見つけている**が、候補は**接続文字列そのもの**:

```
Provider=Microsoft.ACE.OLEDB.12.0;Data Source=S:\eigyo\shinsei\master.accdb;Persist Security Info=False;
```

置換自体は正しく動きます（全文を打ち直したら `S:`→`E:` だけの差分になった）。
問題は**単位**です。フォルダを変えるだけなのに接続文字列を 1 文字も違わず打ち直す必要があり、
oracle の `mustPreserve`（`HDR=YES` など）が**利用者の打ち間違いで壊れうる**。

原因は**ひな形の表現力**で、**PROD-11 と同じ根**です。
規則は「名前 | 正規表現」で**1リテラル全体を分類**する形しか取れず、
リテラルの内側の一部分を取り出す書き方がありません。

**勝手に直しませんでした。** 置換単位を変えるのは置換エンジンの設計変更で、
すべてのパス候補の挙動に及ぶためです（PROD-11 を止めてあるのと同じ理由）。

案:
1. 規則に**捕獲グループ**を持たせ、グループ部分だけを置換単位にする（最も筋が通る）
2. 「連結された場所の一部」に当たったリテラルの内部パスを**副候補**として並べる
3. 直さない

なお `D09_concat`（`"S:\" & folder`）で**部分置換をしないのは意図的に正しい**設計です。
実行時に組み立てられるパスへ手を出さない判断は妥当で、F06 とは別物として扱ってください。

---

# 6. 残件 — **ここから先が仕事です**

上から順に価値が高い。

## 6.1 実 GUI の未操作（`ledger\component-ledger.md` 末尾に一覧あり）

| # | やること | 阻害条件・手がかり |
|---|---|---|
| ~~1~~ | ~~画面2 アコーディオン~~ | **完了**（§2.4）。到達の仕方は `lib\replay-diagnosis.ps1` |
| ~~1~~ | ~~画面5 NOCHANGE 3判断~~ | **完了**（§2.5）。`lib\make-nochange-reply.ps1` |
| 1 | **画面5 質問返し（AIが質問を返してくる形）** | NOCHANGE とは別物。SPEC 上「質問返しは製品が拒否すべき」なので、`## 質問` を含む返答を作って**弾かれること**を確認する。`lib\make-nochange-reply.ps1` を土台にすればすぐ書ける |
| 2 | 画面1/5 分割受理・欠番・［最初から取り込み直す］ | 分割回答を作る必要がある。画面1の「モジュール単位で受け取る」を ON にしてから、`PART n/N` 付きの回答を分けて投入する |
| 3 | 画面6 ［この回答は採用しない］／採用しない理由／修正依頼文のコピー | AI 経路が要る |
| 4 | 画面2 の残り（S2-05「このコードを見る」・S2-06 補助 INFO・S2-07「この診断が前提にしている環境」） | 画面2 には到達済みなので、あとは開閉するだけ。C1 の回答には INFO が無いので S2-06 は別の回答が要る |
| 5 | 大量反復（同じ試料を順序・状態を変えて繰り返す） | 依然ほぼ未着手 |

## 6.2 未修正の不具合

| ID | 次にやること |
|---|---|
| **PROD-11** | 設計判断が要るので止めてある。`findings\FINDINGS.md` の PROD-11。まず must-keep / must-reject にこの形を足すこと |
| **PROD-16** | §5。PROD-11 と同時に決めるのが自然 |
| **DOC-02** | SPEC §15.2 が実装に無い `E-ATTACH-05` を参照。`docs/SPEC.md` は他参加者の dirty 差分が乗るので**先生に持ち主を確認してから**直す |
| **ENV-01** | §4 |

## 6.3 観察（不具合と断定していない）

- **拒否バナーが出ていても［次へ］が有効のまま**（`shots\N_INJ_STOP_B02`）。
  「拒否された本は読み込まれず、前の本が生きている」という意味では筋が通るが、
  利用者からは「赤い枠が出ているのに次へ進める」画面に見える。意図した設計か確認の価値がある
- 「連結された場所の一部」という分類名が、**連結されていない**接続文字列にも付く（PROD-16 の末尾）
- 画面9 から［戻る］連打で画面0まで戻り切る件（2代目の観察）— SPEC 判断待ちのまま

## 6.4 その他

- `G06` の**書き戻し後**に閲覧保護が残るか（読み取りは確認済み・ビルド後は未確認）
- **署名付きブックの Excel 実挙動**（SIG-01。`HANDOFF.md` §7 の境界事由。**変化なし**）
- **盲検AI** — 3代目・4代目とも未使用。§8 の規律は厳守（新規個体・逐語・ツール無し）

---

# 7. 本セッションで足した道具（`qa\run01-blackbox\lib\`）

| ファイル | 役割 |
|---|---|
| `fit-window.ps1` | **起動後に必ず実行する。** 作業領域いっぱい（1920x1020）に合わせて `app-state.json` を書き直す |
| `step.ps1` | `-Do "tap:X,Y\|wait:MS\|type:TEXT\|key:K+MOD\|shot:NAME"` を 1 プロセスで実行する汎用ステッパ。**1 手ずつ別プロセスで叩くのが確実** |
| `inject-corpus-note.ps1` | note 座標版のコーパス投入。**2 連続失敗で停止して画面を撮る**。出力は `note-*` 名 |
| `probe-reserved-names.ps1` | 予約デバイス名の実測（PROD-12 の根拠） |
| `probe-fixture-shape.ps1` | 製品の読み手で候補ブックのモジュール数・行数・bin 長を測る（ENV-01 の根拠） |
| `route-to-screen7.ps1` | 置換のみ経路で画面7まで。**検証が甘いので過信しないこと**（§0-3） |
| `replay-diagnosis.ps1` | 保存済み診断回答の依頼IDを差し替えて実クリップボードへ。**画面2 への唯一の入口**（§2.4） |
| `make-nochange-reply.ps1` | NOCHANGE 3判定の protocol fixture を実クリップボードへ（§2.5）。**AI の回答ではない** |
| `_n01`〜`_n04` | 使い捨ての GUI 操作片 |

**新規スクリプトは UTF-8 BOM 付きで保存すること。** 後付けは `lib\add-bom.ps1 -Path <file>`。

---

# 8. 証跡の扱い（**壊さないために**）

- `logs\` の中身は run01 の記録そのもの。**本セッションの分は `note-*` 名で保存**してあります。
  run01 のファイルを上書きしてしまったら `git checkout -- qa/run01-blackbox/logs/<file>` で戻せます
  （実際、本セッションでは `tests-node.log` と `tests-psA.log` を都度戻しています）
- **ログの文字コードの罠**: `Out-File -Encoding utf8` のヘッダに `Tee-Object -Append` が
  **UTF-16LE** で追記するため、1 ファイルに 2 つの符号化が混ざります。run01 の
  `inject-corpus.log` も同じ状態です。**集計するならログではなく
  `exports\` の run フォルダか JSON を数えること**
- `shots\N_*` が本セッションの画像です。desktop 時代の `R2_*` `R3_*` は未転送

---

# 9. commit / push について

作業中は commit も push もしていませんでしたが、**最後に先生が明示的に
「現在の修正を確定し、main へ merge して origin へ push する」ことを許可し、実行しました。**
（`HANDOFF-3.md` §7 のときと同じ形の、1 回限りの解除です。）

- 製品修正・テスト・移送可能な QA 資料を `qa/run01-blackbox-note` へ 1 コミットにまとめた
- それを母体の `main` へ **`--no-ff` で merge** し、`origin/main` へ push した
- 母体の未追跡 `audit-results/` は**最後まで触っていません**

**この解除は今回の指示に対するものです。後任は再度勝手に commit / push しないこと。**
必要になったらそのつど先生に確認してください。

## コミットに含めなかったもの（意図的な除外）

| 除外したもの | 理由 |
|---|---|
| `qa/run01-blackbox/logs/app-state.json` | **端末依存**。window handle と pid を持つので、別の機械では無効。`lib\launch-app.ps1` が書き直す |
| `qa/run01-blackbox/shots/` の PNG **182 枚** | **大量で、いつでも撮り直せる**。`lib\act.ps1` を dot-source して `Shot '<名前>'`。ローカルには残してある。所見の判断根拠は `findings\FINDINGS.md` の本文に文章で書いてあるので、画像が無くても読める |
| `testdata/` に復旧した fixture | `.gitignore` 対象。ENV-01（§4）の手順で作り直せる |
| `logs\note-*.log` | `.gitignore` の `*.log` 対象。集計結果は `corpus\note-RESULTS.md` に文章で残した |
| `audit-results/` | `HANDOFF.md` §7 で触ることを禁じられている先生の実ファイル |

なお 1 点だけ設定を足しています: 母体の `.git/config` に **`core.longpaths true`**（repo ローカル）。
B05 の 173 文字ファイル名が worktree の深いパスで `MAX_PATH` を越えて checkout に失敗したためです。
`--global` は触っていません。**この設定は commit されません**（`.git/config` は git 管理外）ので、
別の機械で同じ worktree 構成を作るときは各自で設定してください。

---

# 10. 申し送り

- **「テストが緑」と「実物が直っている」は別物。** 逆もまた真で、
  本セッションの psA 12 FAIL は**製品ではなく fixture の欠落**でした。
  赤を見たらまず「何が赤いのか」を測ること
- **文書の一覧を信じない。** PROD-12 は「COM1〜COM9」と書かれていたが、
  実測したら `COM0` `LPT0` `CLOCK$` も同じ性質だった
- **締めすぎも不具合。** 弾く側を直すときは、**must-keep を先に用意**してから直すこと。
  `CONTRACT.xlsm` を巻き込んでいたら、それは別の不具合になっていた
- **自分の oracle を疑う。** 本セッションの route スクリプトは
  **失敗を "reached screen 7" と報告**しました。一括処理には必ず進捗の確認を入れること
- **消すより、正しく書く。** PROD-14 で「AIへ渡した」を消してファイルごと一覧から外すこともできたが、
  ファイルは実在するので、外すと一覧が今度は不完全になる。**事実どおりの説明**に変えた
- 未完了は件数でごまかさず、**具体的な阻害条件**とともに残す（§4 の psA がその形）
