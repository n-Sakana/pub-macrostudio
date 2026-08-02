# MacroStudio 開発ガイド

仕様は [SPEC.md](SPEC.md) が正本。本書はビルド制約、リポジトリ規約、テストの走らせ方を
まとめたもの。仕様と本書が食い違ったら SPEC.md を優先する。

---

## 1. 言語・構文の制約（守らないと動かない）

MacroStudio は dotnet SDK を必要としない。ホストの C# は Windows PowerShell 5.1 の
`Add-Type` がコンパイルするため、使える構文に上限がある。

| 対象 | 制約 |
|---|---|
| `src/*.cs` | **C# 5.0 構文のみ**（PowerShell 5.1 の Add-Type が使うコンパイラの上限）。禁止: 文字列補間 `$"..."`、null 条件 `?.` `??=`、`nameof`、expression-bodied member、`out var`、パターンマッチング、タプル構文。**async/await は可**（C# 5.0 機能）。文字列連結は `+` か `string.Format` |
| `src/*.cs` | **ASCII のみ**（コメントも英語）。日本語の UI 文言はすべて `assets/` 側に置く。ホスト（C#）が直接表示する日本語文言は `assets/messages/*.txt` に置き、読み込んで表示する |
| `src/05〜08`（エンジン） | **WPF / WebView2 に依存させない**（`using System.Windows` 禁止。System.IO / System.Text / System.IO.Compression まで）。`tests/` からエンジンだけを Add-Type してヘッドレス検証するため |
| `*.ps1` | **Windows PowerShell 5.1 互換**（三項演算子・`??`・`pwsh` 前提機能は禁止） |
| `assets/*` | HTML/CSS/JS（フレームワーク・ビルドツール不使用。日本語 OK） |
| JSON | C# 側は `System.Web.Script.Serialization.JavaScriptSerializer`（参照アセンブリ `System.Web.Extensions`。`MaxJsonLength = int.MaxValue` を設定） |

## 2. リポジトリ規約

- `src/` は番号付きファイル名（`01_App.cs` …）。`macrostudio.ps1` が名前順に連結し、
  using を先頭へ集約して 1 回の `Add-Type` でコンパイルする。
- 名前空間は `MacroStudio`。WebView2 仮想ホスト名は `macrostudio.local`。
  この 1 つが唯一の信頼 origin で、値は `WebViewSecurity.TrustedHost` が持つ
  （SPEC §13.12.1）。新しい仮想ホストを足すと、そのページはホスト操作を
  呼べないまま画面にも出せない。
- ユーザーデータ: `%LOCALAPPDATA%\MacroStudio\WebView2Cache`、ログ: 同 `\logs`。
- `lib/` の WebView2 DLL 4 本は NuGet パッケージ `Microsoft.Web.WebView2`
  （SDK 1.0.3856.49）の再配布 DLL。差し替える場合は 4 本の版を揃えること。

### ファイル構成

```
macrostudio/
├── launch.vbs               # 本番起動（黒画面なし）
├── launch.bat               # 開発起動（コンソールあり）
├── macrostudio.ps1          # ホスト: src/*.cs を集約 → Add-Type → App.Run
├── src/                     # C#（ホスト + エンジン）
│   ├── 01_App.cs            # エントリ。AssemblyResolve、STA スレッド、WebView2 ランタイム確認
│   ├── 02_MainWindow.cs     # WPF 窓 + WebView2 + 仮想ホスト + D&D 受け
│   ├── 02_WebViewSecurity.cs # 信頼 origin の判定、遷移・新窓・frame の拒否、DevTools 無効化（SPEC §13.12.1）
│   ├── 03_MessageRouter.cs  # JS⇔C# の id 付き request/response IPC（信頼外 origin のメッセージは破棄）
│   ├── 04_HostServices.cs   # ダイアログ、クリップボード、explorer、実行フォルダと成果物の出力、template / presets 読み、ログ
│   ├── 05_Ole2.cs           # OLE2(CFB) リーダ/ライタ
│   ├── 06_VbaCompression.cs # MS-OVBA 2.4.1 展開・圧縮
│   ├── 07_VbaProject.cs     # dir の MODULE レコードを正本とするモジュール一覧・コード取得・コードページ・書き戻し計画
│   ├── 08_BookIO.cs         # xlsm/xlam/xlsb(zip) の入出力、コピー生成、ビルド、検証
│   └── 09_BookInventory.cs  # コードの外にある事実（参照設定・クエリ・外部リンク・ActiveX・フォント・署名・ハッシュ）
├── assets/                  # UI 実体
│   ├── fonts/               # Noto Sans JP / UDEV Gothic の TTF と OFL
│   ├── css/                 # variables / layout / flow / module-list / diff / path-map
│   └── js/                  # 画面・状態・契約・lexer・決定的 path mapping
├── environment/             # 想定動作環境のJSON正本と出典・改訂履歴
├── presets/                 # 01_診断（singleton）/ 02_改修（選択肢）の依頼正本
├── templates/               # 依頼文（チャット貼付用）の中立な組み立て枠
├── lib/                     # WebView2 DLL（4 本）
├── docs/                    # SPEC.md / DEVELOPMENT.md（本書）
└── tests/                   # ヘッドレス検証スクリプト
```

## 3. アーキテクチャ上の要点

- **エンジンはホストと同じ Add-Type でコンパイルする C# クラス**として `src/` 内に持つ
  （子プロセスや別モジュールを作らない）。理由は SPEC §2.3。
- **エンジン（05〜08）は UI に依存しない**。この分離があるので、`tests/` は
  エンジンだけを Add-Type してヘッドレスに検証できる。
- **画面フローの正本は `assets/js/screens.js`**。0 `book` → 1 `diagnose` →
  2 `findings` → 3 `nextStep` → 4 `repairInput` → 5 `repair` → 6 `review` →
  7 `output` → 8 `build` → 9 `done` の 10 画面を持つ。依頼の受け渡しと返答の
  取り込みは同じ画面の 2 つの段であって別画面ではない。診断を読むことと次に
  することを選ぶことは別の決定なので、別画面である。
  `state.js` は現在地・履歴・2 段階の依頼状態、`app.js` は描画と操作を担当する。
  画面番号を literal で書かず、`screens.js` が公開する名前を使う。
- **見える入口はブック添付の 1 本だけ**。用途選択、相談、簡易モードの入口を戻さない。
  相談の自由記述は診断画面の「ほかに気になっていること」と改修入力の「追加の要望」へ
  移設済みである。分岐は改修入力の AI 改修／決定的置換と、改修画面の返答種別だけに置く。
- **第 1 AI と第 2 AI の状態を混ぜない**。`diagnoseRequestId` / `diagnosisPackage` と
  `repairRequestId` / `intakeRequestId` は別世代である。診断依頼の入力 snapshot が変われば
  診断以降を捨て、指摘選択・希望動作・追加要望・ひな形が変われば改修以降だけを捨てる。
  host 書き込みが成功する前に状態を確定しない（SPEC §2.6.1）。
- **ツールは判断を持たない**（SPEC §1.1）。SPEC に列挙のない正規化・意味解釈・
  自動選択を追加しない。置換経路も、検出するのは文字列トークンの位置と値
  だけで、良否と新しい値は人が決める。貼り付け正規化は SPEC §13.13 が全量。
- **アプリはフレームワークだけを持つ**。アプリが持つのは汎用の部品（自由記述の欄、
  「置換前 → 置換後」の対応表）と、アプリ自身が決めた構造（区分・分類・手順・画面の
  文言）。**改修の個別対象（Win32 API、固定パス、参照設定）はひな形が持つ**。
  ひな形が「この部品を使う」と宣言し、アプリはその部品を出すだけで、
  何を探すのか・何と呼ぶのかを知らない。`assets/js/` に「Win32」「固定パス」といった
  対象名を書かないこと。
- **想定動作環境の正本は `environment/target-environment.json`**。host は strict UTF-8
  で毎回読み、内容を解釈しない。schema 検証・並べ替え・プロンプト整形は
  `assets/js/target-environment.js` だけが持つ。key や title/detail を C#・JS・ひな形へ
  fallback として複製しない（`test-environment-not-embedded.js` が検査する）。
- **ひな形の解釈は `assets/js/preset-document.js` だけが持つ**（β2 SPEC §9.2）。
  ホスト（C#）は `presets/01_診断/*.md` と `presets/02_改修/*.md` の列挙・テキスト
  読み出しに徹し、H1 も節も解釈しない。段階はフォルダで決まり、`## 用途` は拒否する。
  改修指示・出力指示の文面を `templates/` や `src/` や `assets/js/` へ複製しないこと
  （`tests\test-preset-migration.js` が門番として検査する）。
  モジュール単位出力の文面も同じ扱いで、任意の `## 出力指示（モジュール単位）` 節が
  正本である。持たないひな形では画面に選択肢を出さず、代わりの文面を補わない
  （`tests\test-module-split.js` が門番として検査する）。
- **改修の返答は 2 つしかない**。指定の形で改修後コードを返すか、
  `NOCHANGE UNNECESSARY` / `IMPOSSIBLE` / `UNCLEAR` と理由を返すかである。
  **利用者へ質問を返す・選択肢を出して選ばせる返答は禁止**で、`DECISION` や
  `TEXT BEGIN QUESTION` を含む返答は R3（`questionNotAllowed`）で拒否する。
  情報が足りず決められない場合も対話を始めず `UNCLEAR` に理由を書いて返す。
  ひな形・パーサ・画面はこの二択に揃っていること（`tests\test-no-questions.js` が門番）。
- **返答パッケージの解釈は `assets/js/response-package.js` だけが持つ**（SPEC §13.9）。
  区切り行の書式・依頼 ID の検証・拒否理由はここにまとめ、`app.js` は結果を
  画面へ出すだけにする。ホスト（C#）はクリップボードの文字列を渡すだけで、
  区切りを解釈しない。モジュール単位出力（SPEC §13.10）の `PART` 行、受け取り済みの
  照合、統合（`addPart` / `mergeParts`）も同じファイルが持つ。`app.js` は
  「全部そろったら統合結果をワンペーストと同じ経路へ流す」だけにする。
- **第 1 AI 診断の返答契約は `assets/js/diagnosis-package.js` だけが持つ**。
  D01〜D28、0 件結論、診断 `PART` の受理と構造統合を `app.js` や C# へ複製しない。
  診断ひな形の完全記入例をテストの文字列へ複製せず、実 Markdown から抽出して検査する。
- **字句解析は `assets/js/vba-lexer.js`、検出・集約・検証・適用は
  `assets/js/path-map.js` だけが持つ**。前者は UTF-16 座標で原文へ可逆な token を返し、
  後者は private brand を持つ検出結果だけを受け取る。適用直前に全 occurrence を再字句解析し、
  module / line / column / value が 1 件でも違えば E-MAP-02 で全件中止する。
  **検出と適用は同じ基準コードを読む**（SPEC §7.7.1）。検出したときのモジュール本文を
  `state.pathMapBasis` に記録し、`getPathMapBaseModules()` だけが適用へ渡す。
  前回の置換結果を基準にすると、値を直して置き換え直す操作が必ず E-MAP-02 になる。
  `app.js` に lexer、分類、置換の第 2 実装を置かず、任意文字列の全置換 API を公開しない。
  **何を候補として拾うかは `path-map.js` が決めない**。ひな形の
  `## 置換の候補`（`- 呼び方 | 正規表現 | 既定で選ぶ`）を `detect(modules, rules)` へ
  渡し、上から順に当てはめて最初に一致した行の呼び方になる。どの規則にも当たらない
  文字列は候補にしない。読み取りが安全でない行は規則を当てず一律に伏せる。
  置き換え後の値の「形」は検査しない（それは人の判断）。
- **1 回の実行は 3 経路のどれかになる**（SPEC §7.2）。AI だけ・対応表だけ・両方。
  両方のときは**機械的置換が先**で、画面 4 が 2 段になる（画面は増えない）。
  AI へ渡すのは置換後のコードで、依頼文に「置き換え済み・元へ戻さない」を書く。
  置換した事実は `state.appliedMapping` が持ち、後から来る返答では消えない。
  返答を捨てる操作（取り込み直し・`改修できません`・新しい依頼の書き出し）は
  返答だけを捨て、`restoreReplacedModules()` が置換結果を戻す。
  ここを `repairResultEngine` で判定し直さないこと。返答が名乗らなかった
  モジュールが原本へ戻り、最終ブックに古い値が残る
  （`tests\test-three-routes.js` が門番）。
- **取り込みの単位はパッケージ 1 つで、適用は必ず置き換え**（SPEC §5.3 / §10.2）。
  `importPackage` は先に `clearImportedModules` で前回分を取り消してから適用する。
  検証は `getBookModules()`（= ブック由来のモジュール）に対して行い、前回の返答が
  追加した新規モジュールを既存扱いしない。取り込み済み状態は `intakeRequestId` で
  依頼 ID に結び付け、`screens.isIntakeCurrent` が古い取り込みで先へ進むのを止める。
- **1 回の実行は必ず新規**。作業途中のセッションを読み戻す経路は持たない
  （状態不整合の温床になるため 2026-08-02 に撤去した）。記録は残す:
  `state.js` の `createRunManifest()` が確定済みの値だけを書き出し、`app.js` が
  host の成功後に `run-manifest.json` を原子的に置き換える。画面・ログ・`result.md`・
  この記録を別々の値から作らないこと。**読み戻す関数を足さないこと。**
- **成果物はブックの隣に置かない**。1 回の実行 = 1 案件で、
  `<macrostudio>/exports/<ブック名>_<yyyyMMdd_HHmmss>/` が最終成果物、
  `<macrostudio>/temp/<同じ名前>/` が AI へ実際に添付するファイルだけを置く場所。
  それぞれ一層で、入れ子にしない。`exports` の `source-code.md` は**常に読み取った
  時点のコード**で、置換済みコードになるのは `temp/source-code-for-ai.md` だけ。
  ［ファイルの場所を開く］は `temp` を、完了画面の［フォルダを開く］は `exports` を
  開く（表示文言と実際に開く場所を一致させる）。
- **ビルドだけは固定の client timeout を持たない**（SPEC §13.12.3）。
  `host-bridge.js` の既定 120 秒 reject は他の action のためのもので、`buildBook` は
  `timeoutMilliseconds: 0` + `onSlow` で送る。処理の正本は host の応答であり、
  120 秒経過は「まだ続いている」という表示にしかしない。ここへ client 側の
  失敗確定を戻さないこと（監査 P2-3 の再発になる）。
- **読み取り警告は「何が起きたか」を分けて持つ**（SPEC §13.6）。
  `HasReadWarnings` は約70か所から立つ1つの真偽値で、それだけでは原因も影響範囲も
  言えない。そこで `Ole2File.HasShortStreamRead`（ストリームが短く返った）、
  `VbaProjectData.PartialSourceModules` / `RecoveredOffsetModules` /
  `UnreadableModules` / `ContainerFallback` / `Salvaged` を別に記録し、
  `HasSourceDoubt()` が「コードに疑いがあるか」を判定する。`attachBook` は
  `read.level`（`clean` / `structureOnly` / `sourceDoubt`）として返し、文言の選択は
  `app.js` の `describeReadResult` だけが持つ。**新しい警告条件を足すときは、
  どちらの段階に属するかを必ず決めること**（増やして一括警告へ戻さない）。
  外部リンク等 VBA 以外のパートは読まないので、この記録には現れない。
- **差分 HTML は確認画面の閲覧専用版で、画面と同じ実装を同梱する**（SPEC §13.11）。
  `diff.js` / `vba-highlight.js` / `diff-view.js` と `variables.css` / `flow.css` /
  `module-list.css` / `diff.css` を無加工でインラインし（`@font-face` の除去だけが
  例外）、行生成・文脈行数・変更ブロック・`変更箇所のみ`・折り返し・前後移動はすべて
  画面側の実装が動く。`diff-report.js` は枠（モジュール一覧・ツールバー・テーマ・
  実行データ）だけを持ち、**diff の第 2 実装を置かない**
  （`tests\test-diff-report-toggle.js` が、同梱バンドルと画面の出力一致と、
  `expandRow` 等が `diff-report.js` に無いことを検査する）。
  同梱アセットは `app.js` の `loadReportAssets()` が同一オリジンから読み、
  `buildReport({assets})` へ渡す。アセットが無ければレポート生成はエラーにする
  （縮小版で代替しない）。**外部通信・CDN・編集操作は入れないこと。**
- **添付時点の VBA 内容署名をビルド直前に照合する**（SPEC §14.1-0）。
  `BookIO.CreateSourceSignature` が正本で、`HostServices` が添付時の値を保持し、
  `BookIO.BuildCopy` が自分で読み直した project と比較する。不一致は E-BUILD-04 で、
  出力を作らない。署名はハッシュではなく正規化テキストの完全一致で、engine を
  `System.IO` / `System.Text` / `System.IO.Compression` の範囲に保つ。
- **既存モジュールの種類はブックが正本**（SPEC §13.9 / §13.14）。返答の `<種類>` で
  既存モジュールの型を変えないこと。新規追加は標準モジュールのみで、これを
  広げる場合は writer・読み直し検証・ひな形の出力指示を同時に直す必要がある。

### 想定動作環境の保守

- `environment/target-environment.json` の `revision`、constraint、sourceId を更新したら、
  同じ変更で `environment/SOURCES.md` の出典・読取日・来歴も更新する。
- 対象端末で実測していない値を `observed` にしない。宣言資料なら `declared`、コードや
  設定からの推論なら `inferred` のままにし、`basis` と `sourceIds` を残す。
- key、title、detail、例を C#・JS・ひな形へ複製しない。表示順とプロンプト順も
  `target-environment.js` が JSON の axis/key 順から決める。
- 編集後は §5 の `test-target-environment.js` と `test-environment-not-embedded.js` を
  必ず実行する。診断ひな形まで変えた場合は `test-diagnosis-package.js` と
  `test-prompt-template.js` も実行する。

## 4. テストデータ（`testdata/`。git 管理外）

`.gitignore` で `testdata/` を除外している。ローカルに以下を用意する。

| 置き名 | 用意の仕方 | 用途 |
|---|---|---|
| `testdata\test_large.xlsm` | 複数モジュールを含むマクロ付きブックを Excel で作成 | 標準ケース |
| `testdata\synthetic_difat_v3.cfb` | `tests\test-ole2.ps1` が生成 | DIFAT 継続（ヘッダ 109 参照超の FAT）の読み・再構築検証 |
| `testdata\test.xlsb` / 保護付き `.xlsm` | Excel で作成（任意） | xlsb・プロジェクト保護の検証（SPEC §15 の未検証項目） |

`tests\test-extract.ps1` は、抽出結果を別途用意した期待値ディレクトリと突き合わせる
オラクル照合に対応している。`-OracleDir` を指定したときだけ有効になる（省略可）。

## 5. テストの走らせ方

Windows PowerShell 5.1 の fresh process で、各 runner を個別に実行する。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\test-app-compile.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\test-design-system.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\test-compression.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\test-ole2.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\test-vbaproject.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\test-extract.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\test-roundtrip.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\test-bookio.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\test-build.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\test-book-inventory.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\test-guide-samples.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\test-guide-sample-flow.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\test-hostservices.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\test-clipboard-retry.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\test-diagnose-webview.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\test-flow-webview.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\test-split-webview.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\test-diff-report-webview.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\test-webview-security.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\test-encrypted-book.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\test-window-icon.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\test-editor-focus.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\test-no-change-webview.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\test-p9-distribution.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\test-path-map-webview.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests\test-shortest-path-webview.ps1
```

Node test（UI ロジックの単体検証）:

```powershell
node tests\test-attach-blocked.js
node tests\test-audit-fixes.js
node tests\test-back-and-forth.js
node tests\test-both-route-preset.js
node tests\test-build-payload.js
node tests\test-change-source.js
node tests\test-contract-singleton.js
node tests\test-diagnose-flow.js
node tests\test-diagnosis-headline.js
node tests\test-diagnosis-package.js
node tests\test-diagnosis-preset-cardinality.js
node tests\test-diagnosis-recovery.js
node tests\test-no-domain-knowledge.js
node tests\test-diagnosis-split.js
node tests\test-diff-report-toggle.js
node tests\test-diff-report.js
node tests\test-diff-view.js
node tests\test-diff.js
node tests\test-environment-not-embedded.js
node tests\test-file-drop.js
node tests\test-findings-view.js
node tests\test-handover.js
node tests\test-flow-state.js
node tests\test-host-bridge.js
node tests\test-module-split.js
node tests\test-no-questions.js
node tests\test-no-change.js
node tests\test-output-name.js
node tests\test-p6-state.js
node tests\test-p7-state.js
node tests\test-paste-edit.js
node tests\test-paste-normalize.js
node tests\test-path-candidate-rules.js
node tests\test-path-map.js
node tests\test-preset-description.js
node tests\test-preset-document.js
node tests\test-preset-migration.js
node tests\test-preset-value-migration.js
node tests\test-prompt-template.js
node tests\test-read-report.js
node tests\test-real-diagnosis-reply.js
node tests\test-reject-answer.js
node tests\test-repair-input.js
node tests\test-response-package.js
node tests\test-shortest-path.js
node tests\test-skipped-diagnosis-artifacts.js
node tests\test-three-routes.js
node tests\test-target-environment.js
node tests\test-vba-highlight.js
node tests\test-vba-lexer.js
```

回帰の見張り番:

- `tests\test-diagnosis-package.js` … 同梱診断ひな形の実ファイルから完全記入例を
  抽出し、依頼 ID だけを差し込んで製品 parser へ通す。D01〜D28 は通る fixture と
  落ちる fixture の両方を持ち、失敗側の `validationId` まで固定する。
- `tests\test-diagnosis-split.js` … 診断 part の欠番、合計不一致、同番号の
  冪等再送／異内容拒否、part 00 の SECTION 所有、全体検証、0 件を検査し、統合結果が
  一括受理と同一の内部形式になることを固定する。
- `tests\test-diagnosis-preset-cardinality.js` … 診断ひな形の有効ファイルが
  0 件／2 件以上なら `E-PRESET-02`、1 件ならその 1 件だけを採用することを検査する。
- `tests\test-no-domain-knowledge.js` … `assets/js` に改修対象の名前
  （Win32・固定パス・参照設定・Power Query・ActiveX・バーコード等）が
  **入っていないこと**の門番。アプリが持つのは汎用部品と自分の区分だけで、
  何を探すかはひな形が決める。`detect(modules, rules)` が規則を受け取る形で
  あること、ひな形が実際にその規則を持っていることを併せて固定する。
  未解消の箇所は `KNOWN_DEBT` に列挙してあり、**減らすことはできても
  増やすことはできない**（消えたら一覧から外すことを強制する）。
- `tests\test-handover.js` … 改修ガイド §5 のテスト観点 4 区分と §6 の
  引渡し成果物を固定する。指摘は環境キーで 1 つの問題へまとまること、観点は
  その実行が触れた軸だけへ絞られること、コードの外にある作業（参照設定・
  Power Query・ActiveX・バーコード）が人へ渡されること、そして**実行して
  いない確認を実施済みと書かない**ことを検査する。
- `tests\test-diagnosis-recovery.js` … 第 1 段階の出力契約と取り込みを 1 つの
  テストで固定する。ひな形の `## 出力指示` が「ひとつだけのコードブロック」
  「区切りの行は 1 行に 1 つだけ」「ブロックの外に書かない」を述べていることと、
  フェンス有無・前置き付き・字下げ・空行・LF のみ・Markdown で改行が畳まれた
  返答のすべてが同じ診断へ到達することを検査する。畳まれた返答は `recovered` を
  立てて再構成したことを表に出し、別依頼 ID と途中で切れた返答は再構成しても
  受理しないことを固定する。
- `tests\test-target-environment.js` … 実データのschema、全fail-fast条件、axis/key順の
  固定プロンプト形式、24件の初期 `basis` と examples 数を製品IIFEへ直接検査する。
- `tests\test-environment-not-embedded.js` … 環境keyと title/detail が src・assets・
  templates へ複製されず、実JSONが唯一の正本であることを検査する。
- `tests\test-response-package.js` … 返答パッケージの正準 `COMPLETE` 数、依頼 ID の
  secure/fallback 表示、新規モジュール種別制限を製品 IIFE へ直接検査する。
- `tests\test-clipboard-retry.ps1` … `0x800401D0` だけを最大 10 回まで再試行し、
  それ以外は即時失敗することを delegate 注入で決定的に検査する。実クリップボードの
  往復は補助検査とし、全形式を `finally` で復元する。競合時の占有者観測は
  プロセス名と PID だけを扱い、ウィンドウタイトルを取得しない。
- `tests\test-audit-fixes.js` … 2026-07-30 監査の UI 側 4 件（旧パッケージ混入、
  ［取り込み直す］の到達性、`resultError` の表示、長いビルドの扱い）。
- `tests\test-back-and-forth.js` … 2026-08-02 監査の［戻る］経路。入力を変えずに
  5→4→5 を歩いても改修依頼 ID と取り込み済み回答が残ること、入力を変えたときは
  新しい依頼を書き出した時点で（それまでではなく）下流が捨てられること、
  置換のやり直し（7→4→7 と値の訂正）が添付時コードから成立すること、
  取り込み拒否が検査番号付きでログへ出ること、成功文言に否定的な語が
  混ざらないこと、実行の記録が書かれ、それを読み戻す経路が無いことを固定する。
- `tests\test-real-diagnosis-reply.js` … 実際のチャットが S01 へ返した診断を
  そのまま持ち、受理されることを固定する。`DIAG BEGIN <件数>` を版番号として
  読んでいたために正しい回答が D03 で落ちた（2026-08-02）ので、契約が
  「読めばそう書く」形から離れていないことを実物で見張る。別依頼ID・件数の
  食い違い・非正準表記・知らないモジュール・途中で切れた回答は拒否のまま。
- `tests\test-reject-answer.js` … 構造検査を通った回答が意味として
  誤っている場合。成功表示が肯定文だけであること、変更が既定で開くこと、
  ［この回答は採用しない］→ 理由 → 修正依頼文のクリップボード投入、
  拒否が本文抜きでログへ残ること、1 万行の全面置換が同じ画面を通ることを固定する。
- `tests\test-module-split.js` … モジュール単位出力（SPEC §13.10）の区切り行・
  複数回の取り込み・統合・全拒否経路・ひな形が文面を持つこと・既定経路の非回帰。
- `tests\test-book-inventory.ps1` … 実ブックから、ファイルのハッシュ・サイズ・
  更新時刻、VBA の参照設定、接続名、Power Query の有無、ActiveX と外部リンクの
  件数、バーコードらしいフォントを読む。**接続文字列とライブラリのパスは持ち出さない**
  こと、パッケージが開けない場合と project が無い場合に「読めなかった」と
  申告することを固定する。
- `tests\test-guide-samples.ps1` … 改修ガイド §3 の分類から起こしたサンプル
  10 本（`tests\make-guide-samples.ps1` が実 Excel で生成、`testdata\guide-samples\`）を
  製品自身の読み手で読み直す。静的検索で引ける構文がコード側に実在すること、
  参照設定・クエリ・外部リンク・ActiveX・バーコードフォント・署名の有無が
  棚卸しへ出ること、公開した入口マクロが実在することを固定する。
  **この端末で作れなかった部分は `UNBUILT` として明示し、期待を満たしたことに
  しない**（生成側が理由を記録していなければ失敗する）。対応表は
  `docs\beta2\guide-sample-map.md`。
- `tests\test-guide-sample-flow.ps1` … 上の 10 本を**実 WebView2 ホスト**で
  端から端まで通す。添付・診断依頼・返答取り込み・分類表示・指摘の選択・
  改修依頼・返答取り込み・再生成・読み直し・成果物までを 1 本ずつ歩き、
  毎回 `source=unchanged`（元ブックが書き換わっていないこと）を確かめる。
  診断はサンプルが宣言した環境キーを名乗るので、そのサンプルが属する分類を
  通る。既定の 1366×768 に加え、`MACROSTUDIO_SMOKE_WINDOW=4x3` で
  製品が実際に開く 1120×840 でも同じ歩きができる。証跡は
  `docs\beta2\evidence\e2e\`。実クリップボードを借りるため、サンプル間に
  短い待ちを入れている。
- `tests\test-hostservices.ps1` … 添付後に元ブックが変わった場合の E-BUILD-04 と、
  同一 run の再ビルドが自分の成果物だけを世代交換すること。
- `tests\test-host-bridge.js` … `buildBook` が client の時計で失敗確定しないこと。
- `tests\test-read-report.js` … 読み取り結果の 2 段階（SPEC §13.6）。
  管理情報だけの不整合に「コードを確認してください」を出さないこと、
  内訳が無いときは控えめな文言へ落ちること。
- `tests\test-vba-lexer.js` … 置換経路が使う lexer の REM・角括弧・文字列・
  条件付きコンパイル・行継続・未終端構文と UTF-16 座標を検査する。monthly-report の
  全 `.bas` と、`BookIO.ReadProject` で抽出して SHA-256 を固定した
  `test_large.xlsm` の全モジュールで、トークン再連結が原文と完全一致することを見る。
- `tests\test-path-map.js` … 8 分類、値だけによる集約、M01〜M04、既定 `applied=false`、
  lexer スパン由来の根拠表示、引用符退避、同一行複数置換、E-MAP-02 の全件中止、
  private brand、任意文字列置換 API が無いことを製品 IIFE へ直接検査する。
- `tests\test-diff-report-toggle.js` … レポートが同梱したバンドルを取り出して実行し、
  画面側と同じ文脈行数・同じ行・同じ変更ブロックになることを突き合わせる。
  併せて `diff-report.js` に diff の第 2 実装が無いことを検査する。
- `tests\test-diff-report-webview.ps1` … 書き出した実ファイルを WebView2 で開き、
  前／次・変更箇所のみ・折り返し・テーマ・モジュール切替を実クリックし、
  高さ制限が無いこと・編集要素が 0 であることを確認。
- `tests\test-hostservices.ps1` … 正常ブックが `clean`、EOCD を壊したブックが
  `structureOnly`、vbaProject.bin を切り詰めたブックが `sourceDoubt` になること。
  併せてカードの並びがファイル名の数値順であること（`10_` が `2_` の後ろ）。
- `tests\test-encrypted-book.ps1` … ファイル全体が暗号化されたブック（SPEC §2.5.1）。
  製品自前の OLE2 ライタで容器を組み立てるので Excel は要らない。`EncryptionInfo` と
  `EncryptedPackage` の両方がある場合だけ E-ATTACH-04 になること、片方だけ・VBA
  プロジェクトのロック（DPB/CMG）・破損ファイル・ヘッダだけの OLE2 が暗号化と
  判定されないことを見る。`-EncryptedBookPath` を渡すと Excel が実際に作った
  暗号化ファイルにも同じ検査を掛ける。
- `tests\test-shortest-path.js` と `tests\test-shortest-path-webview.ps1` …
  β1.10 の簡易モード入口と自動ひな形選択が戻っていないこと、および一本道の最短経路を
  固定する。実 WebView2 側は診断、指摘選択、希望動作、改修、差分、読み直し検証済みの
  出力までを通し、原本の SHA-256 が変わらないことを確認する。
- `tests\test-editor-focus.ps1` … 入力中の画面（SPEC §3.7）。実 WebView2 で
  画面 4 の希望動作欄と追加の要望欄、および置換経路の置き換え後の値欄へ打ち込み、
  **値ではなく欄そのもの**を見る。1 打鍵ごとに同じ DOM 要素のままか、フォーカスと
  カーソル位置が保たれるかを記録し、通常入力、IME 変換中の Enter（画面遷移しない）、
  貼り付け、範囲選択からの置換を検査する。1366×768 では本文・横方向のスクロールが
  発生せず、フッターが見えることも固定する。
- `tests\test-no-change.js` と `tests\test-no-change-webview.ps1` …
  診断 0 件の `SCOPE_CLEAR` / `INSUFFICIENT` と、改修 0 件の `UNNECESSARY` /
  `IMPOSSIBLE` / `NEEDDECISION` を検査する。実 WebView2 では前二者から第 2 AI へ
  進み、後三者では画面 6 に留まって［次へ］が閉じること、NEEDDECISION の文脈を
  画面 4 へ引用して差し戻せることを確認する。その後、新しい改修依頼と通常返答で
  ビルドまで回復できることも固定する。
- `tests\test-window-icon.ps1` … ウィンドウが自前のアイコンを持つこと。
  アプリと同じ手順で窓を作り、そのアイコンを 32px へラスタライズして
  画素を数える（角丸・起動画面と同じ地の色・文字が出ていること）。
  設定を外すと落ちる。
- `tests\test-attach-blocked.js` … 暗号化ブックが画面上のカードで止まり、
  「全モジュール読み取れています」を出さないこと。
- `tests\test-webview-security.ps1` … WebView2 の境界（SPEC §13.12.1）。信頼 origin の
  判定表に加えて、実動する窓で「別 origin のページが同じ bridge へ投げても
  ホスト操作が動かない」「https / file / data / about / 別ホストへ遷移できない」
  「新しいウィンドウが開かない」「frame が読み込まれない」「DevTools・
  ブラウザキー・既定コンテキストメニューが無効」を確認する。
  いずれも結果を見る検査で、`e.Cancel` / `e.Handled` を外すと落ちる。
- `tests\test-preset-description.js` と `tests\test-flow-webview.ps1` …
  目的カードの 1 行が、ひな形の `## 説明` そのものであること（SPEC §5.2.1）。
  改修指示から作り直す実装に戻すと両方が落ちる。同梱ひな形のファイル名が
  H1 と一致していることも見張る。

補助 runner:

- `tests\test-diagnose-webview.ps1` は一本道の前半（実ブック → 診断依頼 → 診断返答 →
  指摘選択と希望動作 → 改修依頼）だけを実 WebView2 で通す。診断と改修の依頼 ID、
  4 成果物、原本非破壊、クリップボード再試行回数を検査する。
- `tests\test-flow-webview.ps1` が β2 の 11 画面通し（診断 → 改修 → 差分 →
  読み直し検証済み出力 → 差分レポート）を担う。2 段階の依頼 ID と 7 成果物を検査し、
  旧 P3〜P8 の個別スモークはこの 1 本へ統合した。
- `tests\test-split-webview.ps1` は同じ WebView2 実動経路で、モジュール単位出力の
  チェックボックス、`diagnose-request.md` と `repair-request.md`、診断 part の欠番・
  冪等重複・統合、改修 part の衝突拒否・統合・取り込み直しを検証する。
- `tests\test-path-map-webview.ps1` は実 monthly-report fixture と置換の候補を宣言したひな形で、
  候補集約、既定未適用、ロック行の明示選択、新しい値、preview diff、ビルド、
  再読一致、原本非破壊を検査する。AI 改修依頼を作らず改修入力から差分確認へ進む。
- `tests\test-p9-preset.ps1` と `tests\test-flow-webview.ps1` は
  `test-p9-distribution.ps1` からも呼ばれ、配布物のコピーへ同じ検証を回す。
- `tests\test-excel-macro.ps1` は Excel 実機確認用。`WorkbookPath` と `MacroName` の
  明示指定が必要。

注意:

- `test-flow-webview.ps1` と `test-p9-distribution.ps1` は MacroStudio のウィンドウを
  一時的に表示し、通常の製品ログを `%LOCALAPPDATA%\MacroStudio\logs` に書く。
  途中で中断した場合は、MacroStudio 以外のプロセスを巻き込まないよう対象 PID を確認すること。
- テストは production と同じ `src/*.cs` を Add-Type する。エンジンの検証は
  UI を起動せずに行える。

## 6. リリースゲート

書き戻しエンジンは出力ブックを壊す可能性がある唯一の箇所であり、次の 3 点を
満たすまでリリースしない（SPEC §9.2）。

1. **ラウンドトリップ試験**（`test-roundtrip.ps1`）: 無変更で再構築 → 全ストリーム
   byte 一致・木構造等の論理情報一致。毎ビルドが同じ経路を通るため、この試験が
   本番経路そのものを検証する。
2. **ビルド後の読み直し検証**（SPEC §9.1-6。全ストリーム対象）。
3. **Excel 実機確認**: 再構築した出力を Excel で開き、マクロ動作を確認する。

## 7. リスクと対応

| リスク | 影響 | 対応 |
|---|---|---|
| CFB シリアライザの作り込み不足 | 出力ブック破損 | 上記リリースゲート 3 点 + all-or-nothing（検証を通らない出力は必ず破棄） |
| MS-OVBA 圧縮器の不具合 | ビルド不能/破損 | 圧縮・展開のラウンドトリップ試験を必須。非圧縮チャンク格納の代替経路は要実機確認 |
| xlsb 未検証 | 読み取れるモジュールが限定される可能性 | 解析警告を表示し、読める範囲のモジュールを返す |
| 容器（ZIP / CFB）の破損 | 解析不能で添付できない | SPEC §5.1.1 の 6 経路で読み直し、最後は生バイト走査で復元する。読めたソースは必ず保持し、警告は一度だけ |
| D&D でパスが取れない | UX 低下のみ | ファイル選択ボタン（方式C）を常設 |
| Add-Type の C# 5.0 制約違反の混入 | 起動不能 | §1 を各ファイル着手前に再確認。`tests\test-app-compile.ps1` で検出できる |
