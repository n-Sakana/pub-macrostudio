<!-- ppt-master-schema: design-spec/v1 -->
# manual-macrostudio-beta2 - Design Spec

## I. Project Information

| Item | Value |
| --- | --- |
| Project Name | manual-macrostudio-beta2 |
| Canvas Format | PPT 16:9 (1280×720) |
| Page Count | 22 |
| Primary Language | ja-JP |
| Target Audience | 業務で Excel マクロを引き継いだ担当者。VBA を書かないが、チャット AI は業務で使える |
| Communication Intent | βv2.00 の一本道フロー（4 手順・10 画面）を、実画面と同じ語で説明する。通しの作業事例を 1 件、パス置換と Win32 API 改修を 1 回の実行で行う形で示す |
| Desired Audience Outcome | 初回利用者が、自分のブックで 1 件を最後まで完了でき、アプリが検証する範囲と自分が確かめる範囲を区別して理解している |
| Core Message / Ask / Action | 何をするかは、マクロを見てから決める。MacroStudio は元のブックに書き込まず、AI の返答を機械的に検証してから、改修済みブックを別ファイルとして作る。改修後の動作確認は利用者が Excel で行う |
| Delivery Context | 配布資料として単独で読まれる。読み手の手元に画面がある前提 |
| Artifact Afterlife | 社内配布。印刷と画面閲覧の両方 |
| Reading Mode | text |
| Content Strategy | 素材（実装・実画面・製品自身の出力）に忠実。語りかけ・コピー調は使わず、事実・操作・判断できる条件だけを書く |
| Design Style | soft-rounded。製品 UI のライトテーマと調和させる |
| Formula Policy | text-only |
| AI Image Acquisition Path | not applicable |
| Generation Mode | continuous |
| Spec Refinement | disabled |
| Speaker Notes | disabled — 配布資料であり読み上げ用途がないため |
| Custom Animations | disabled — 印刷と画面閲覧の両方で読まれるため |
| Narration Audio | disabled — 明示の依頼がないため |
| Created Date | 2026-08-03 |

## II. Canvas Specification

| Property | Value |
| --- | --- |
| Format | PPT 16:9 |
| Dimensions | 1280 × 720 |
| viewBox | `0 0 1280 720` |
| Margins | 上下 44 / 左右 64 |
| Content Area | x 64–1216 (幅 1152) / y 44–676 (高 632) |

## III. Visual Theme

### Theme Style

- **Mode**: instructional
- **Visual style**: soft-rounded
- **Theme**: 製品画面と地続きの実務資料。飾りを足さず、画面の色と語をそのまま持ち込む
- **Tone**: 平明・中立・具体。断定できることだけを断定する

### Color Scheme

| Role | HEX | Purpose |
| --- | --- | --- |
| Background | #FFFFFF | ページ地。印刷でも沈まない |
| Secondary background | #F2F6FB | 手順カード・補足帯の地 |
| Primary | #24507F | 見出し・手順番号・強い区切り。製品 `variables.css` のライトテーマ由来 |
| Accent | #C05B21 | 注意・「ここで止まる」条件。ページに 1 か所まで |
| Secondary accent | #2B5C96 | 図中の第 2 系統・リンク的要素 |
| Body text | #1F2A37 | 本文 |
| Surface | #FAFBFC | スクリーンショットの台紙 |
| Grid | #E2E7EC | 表の罫・カード境界 |
| Divider | #CFD7DE | 区切り線 |
| Muted | #5D6B7A | 補足・キャプション |
| Positive | #3A7A47 | 完了・成立 |
| Diff removed | #C25560 | 差分の削除行。実装値 |
| Diff added | #4C9155 | 差分の追加行。実装値 |

## IV. Typography System

### Font Plan

| Role | Character (Reference) | Primary | English if non-English | Fallback tail |
| --- | --- | --- | --- | --- |
| Title | ゴシック / 中庸・字面が大きい | Yu Gothic UI | Segoe UI | sans-serif |
| Body | ゴシック / 可読優先 | Yu Gothic UI | Segoe UI | sans-serif |
| Code | 等幅 | Consolas | Consolas | monospace |

- **Title stack**: 'Yu Gothic UI','Segoe UI',sans-serif
- **Body stack**: 'Yu Gothic UI','Segoe UI',sans-serif
- **Code stack**: Consolas,monospace

### Font Size Hierarchy

| Purpose | Anchor Size (px) |
| --- | ---: |
| Body | 22 |
| Title | 40 |
| Subtitle | 30 |
| Lead | 26 |
| Annotation | 18 |
| Note | 17 |
| Caption | 16 |
| Small | 15 |
| Footnote | 14 |
| Cover title | 54 |
| Code | 18 |

## V. Layout Principles

### Page Structure

- **Header area**: y 44–120。左にページ見出し（Title 40）、その下に 1 行のリード（Lead 26）。手順ページは見出しの左に手順番号のチップを置く
- **Content area**: y 132–648。左右 2 段またはスクリーンショット 1 枚 + 注釈カード。主結果を先に、証拠と技術詳細を淡い第二層に置く（製品 UI と同じ順序）
- **Footer area**: y 656–676。左にページ番号、右に節名。装飾は置かない

### Spacing Specification

| Element | Current Project |
| --- | --- |
| Safe margin | 上下 44 / 左右 64 |
| Content block gap | 24 |
| Icon-text gap | 10 |

## VI. Icon Usage Specification

- **Primary bundled library**: tabler-filled

| Purpose | Icon Path | Page |
| --- | --- | --- |
| ブックを読み込む | file-code | P04, P07 |
| 診断する | search | P04, P09 |
| 改修を決めて実行する | list-check | P04, P12 |
| ブックを作る | player-play | P04, P18 |
| チャット AI へ渡す | message-chatbot | P09, P15 |
| コピー | copy | P09, P15 |
| 取り込む | clipboard-check | P10, P15 |
| 確認する | eye | P08, P16 |
| フォルダを開く | folder-open | P10, P18 |
| 検証済み | shield-check | P03, P16 |
| 完了 | circle-check | P18, P22 |
| 次へ進む | circle-arrow-right | P04 |
| 注意 | alert-triangle | P13, P17, P21 |
| 人が確かめる | user | P19, P21 |
| 端末・環境 | device-desktop | P22 |
| 判断が要る | help-circle | P21 |
| 文書 | file-text | P18 |

## VIII. Image Resource List

| Filename | Dimensions | Ratio | Purpose | Type | Layout pattern | Crop Policy | Acquire Via | Status | Reference | text_policy | page_role |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 21-done.png | 2732x1536 | 1.78 | 表紙の実画面パネル | screenshot | 右半分に大きく 1 枚、左に表題 | no-crop | user | Existing | 完了画面 | keep | cover |
| 01-book-empty.png | 2732x1536 | 1.78 | 読み込み前の画面 | screenshot | 左右 2 枚並置の左 | no-crop | user | Existing | 画面0 未読込 | keep | figure |
| 02-book-loaded.png | 2732x1536 | 1.78 | 読み込み後の画面 | screenshot | 左右 2 枚並置の右 | no-crop | user | Existing | 画面0 読込後 | keep | figure |
| 03-book-modules.png | 2732x1536 | 1.78 | 読み取ったコードの展開 | screenshot | 1 枚 + 右に注釈カード | no-crop | user | Existing | 画面0 折りたたみ展開 | keep | figure |
| 04-diagnose-request.png | 2732x1536 | 1.78 | 診断依頼の画面 | screenshot | 左右 2 枚並置の左 | no-crop | user | Existing | 画面1 | keep | figure |
| 05-diagnose-environment.png | 2732x1536 | 1.78 | 前提にしている環境の展開 | screenshot | 左右 2 枚並置の右 | no-crop | user | Existing | 画面1 折りたたみ展開 | keep | figure |
| 06-diagnose-handed-over.png | 2732x1536 | 1.78 | 渡し終えた状態 | screenshot | 左右 2 枚並置の左 | no-crop | user | Existing | 画面1 | keep | figure |
| 07-diagnose-imported.png | 2732x1536 | 1.78 | 取り込み後 | screenshot | 左右 2 枚並置の右 | no-crop | user | Existing | 画面1 | keep | figure |
| 08-findings.png | 2732x1536 | 1.78 | 診断結果の一覧 | screenshot | 1 枚 + 右に注釈カード | no-crop | user | Existing | 画面2 | keep | figure |
| 09-findings-open.png | 2732x1536 | 1.78 | 指摘を開いた第二層 | screenshot | 1 枚 + 下に語の対応表 | no-crop | user | Existing | 画面2 展開 | keep | figure |
| 10-nextstep.png | 2732x1536 | 1.78 | ひな形カード | screenshot | 左右 2 枚並置の左 | no-crop | user | Existing | 画面3 | keep | figure |
| 11-nextstep-both.png | 2732x1536 | 1.78 | 2 枚を選んだ状態 | screenshot | 左右 2 枚並置の右 | no-crop | user | Existing | 画面3 | keep | figure |
| 12-repairinput-table.png | 2732x1536 | 1.78 | 置換の対応表 | screenshot | 左右 2 枚並置の左 | no-crop | user | Existing | 画面4 上段 | keep | figure |
| 13-repairinput-filled.png | 2732x1536 | 1.78 | 置き換え後の値を入れた | screenshot | 左右 2 枚並置の右 | no-crop | user | Existing | 画面4 上段 | keep | figure |
| 14-repairinput-ai.png | 2732x1536 | 1.78 | 置換後に続く AI の段 | screenshot | 1 枚 + 右に注釈カード | no-crop | user | Existing | 画面4 下段 | keep | figure |
| 15-repair-request.png | 2732x1536 | 1.78 | 改修依頼の受け渡し | screenshot | 左右 2 枚並置の左 | no-crop | user | Existing | 画面5 | keep | figure |
| 16-repair-imported.png | 2732x1536 | 1.78 | 改修返答の取り込み後 | screenshot | 左右 2 枚並置の右 | no-crop | user | Existing | 画面5 | keep | figure |
| 17-review.png | 2732x1536 | 1.78 | 差分の確認 | screenshot | 1 枚 + 右に注釈カード | no-crop | user | Existing | 画面6 | keep | figure |
| 18-output.png | 2732x1536 | 1.78 | 出力ファイル名 | screenshot | 左右 2 枚並置の左 | no-crop | user | Existing | 画面7 | keep | figure |
| 19-output-reserved-name.png | 2732x1536 | 1.78 | 使えない名前を入れたとき | screenshot | 左右 2 枚並置の右 | no-crop | user | Existing | 画面7 | keep | figure |
| 20-build.png | 2732x1536 | 1.78 | ビルド中 | screenshot | 左右 2 枚並置の左 | no-crop | user | Existing | 画面8 | keep | figure |
| 22-done-followup.png | 2732x1536 | 1.78 | このあと人が確かめること | screenshot | 1 枚 + 右に手順カード | no-crop | user | Existing | 画面9 展開 | keep | figure |
| 23-back-after-done.png | 2732x1536 | 1.78 | 完了画面から戻った先 | screenshot | 左右 2 枚並置の右 | no-crop | user | Existing | 画面7（実行は完了したまま） | keep | figure |
| 30-diagnose-skip.png | 2732x1536 | 1.78 | 診断を飛ばす | screenshot | 左右 2 枚並置の左 | no-crop | user | Existing | 画面1 | keep | figure |

## IX. Content Outline

### Part 1: このツールがすること

#### Slide 01 - 表紙

- **Audience move**: 何の資料か分からない → βv2.00 の操作マニュアルで、通しの作業事例が 1 件載っていると分かる
- **Layout**: 左 45% に表題ブロック、右 55% に完了画面のパネル（21-done.png、no-crop）
- **Title**: MacroStudio βv2.00 操作マニュアル
- **Core message**: 何をするかは、マクロを見てから決める
- **Content**: 表題（Cover title 54）／副題「Excel マクロを新しい環境で動く形へ直す」／版と日付「beta 2.0.0・2026-08-03」／右パネルに完了画面。装飾線は 1 本まで

#### Slide 02 - この本の読み方

- **Audience move**: どこから読めばよいか分からない → 通しで読むか、必要な画面だけ引くかを選べる
- **Layout**: 左に 3 つの読み方カード、右に本書の約束 4 行
- **Title**: この本の読み方
- **Core message**: 引用した画面の見出し・ボタン名・案内文は、実際の表示と同一である
- **Content**: 読み方 3 枚（はじめて使う→ P04 から順に／画面で迷った→ 目次の画面番号から／何を確かめるか知りたい→ P19・P21）。約束: 画面写真はすべて現行版の実画面／ボタン名と案内文は実装の文字列と同一／このツールが検証する範囲と利用者が確かめる範囲を分けて書く／連絡先や運用規程は扱わない

#### Slide 03 - MacroStudio がすること・しないこと

- **Audience move**: AI にコードを渡す道具、という粗い理解 → 判断は AI、検証と書き戻しはツール、という役割分担が分かる
- **Layout**: 上に 1 行の要約、下に「する / しない」の 2 列表
- **Title**: このツールがすること、しないこと
- **Core message**: 判断はチャット AI、検証と書き戻しは MacroStudio、動作確認は利用者
- **Content**: する: ブックから VBA を読み取る／依頼文と添付ファイルを作る／返答を機械的に検証する／固定パスの候補を字句として検出する／差分を見せる／元のブックのコピーに書き戻す。しない: 直し方を決める／マクロを実行する／返答の文章から意味を推測して取り込む／元のブックのファイルに書き込む。注: チャット AI は利用者の操作で受け渡す外部サービス。MacroStudio 自体の処理は手元で完結する

#### Slide 04 - 全体の流れ

- **Audience move**: 画面がいくつあるか分からない → 4 手順・10 画面の地図を持てる
- **Layout**: 上段に 4 手順の帯（process_flow）、下段に 10 画面の一覧表
- **Title**: 4 つの手順と、10 の画面
- **Core message**: 進捗は常に 4 手順で固定される。用途によって変わらない
- **Content**: 帯: ①ブックを読み込む ②診断する ③改修を決めて実行する ④ブックを作る。表（画面番号・画面名・この画面で決めること）を 10 行。分岐は 2 か所だけで、どちらも画面は増えないことを 1 行で添える
- **Native-ready**: no

#### Slide 05 - 用意するもの・できるもの

- **Audience move**: 何を準備すればよいか不明 → 手元に要るものと、終わったときに増えるものが分かる
- **Layout**: 左に「用意するもの」、右に「作業のあとに増えるファイル」
- **Title**: 用意するものと、できるもの
- **Core message**: 元のブックのファイルには、どの作業でも書き込まない
- **Content**: 用意: 対象のブック（.xlsm / .xlam / .xlsb / .xls）／業務で使えるチャット AI／Excel（動作確認用）。増えるファイル: 改修済みブック（別名）／差分の確認レポート HTML／`result.md`／`diagnose-request.md`／`repair-request.md`／`source-code.md`／`diagnosis.md`／`run-manifest.json`。共通の事実として「元のブックは変更しない」を帯で 1 行

### Part 2: 通しの作業事例

#### Slide 06 - この事例で扱うブック

- **Audience move**: 事例が自分の状況と関係あるか不明 → 1 冊に 2 種類の作業が混じっている状況だと分かる
- **Layout**: 左にブックの構成表、右に「この 1 回で行うこと」2 枚
- **Title**: 例に使うブックと、この 1 回で行うこと
- **Core message**: ひな形は複数選べるので、種類の違う作業を 1 回の実行でまとめて行える
- **Content**: ブック `sample_share_and_win32.xlsm`（請求データの月次集計。3 モジュール・188 行）。表: `BillingReport` 69 行 = 入口 / `TimerUtils` 43 行 = Windows の関数を直接呼ぶ待機 / `ShareExport` 76 行 = 固定の保存先。この 1 回で行うこと: (1) 固定パスを新しい場所へ置き換える（手元で完結）(2) Win32 API を使わない形へ直す（チャット AI へ依頼）

#### Slide 07 - 手順1 ブックを読み込む

- **Audience move**: 最初の操作が分からない → ドラッグか選択で読み込めると分かる
- **Layout**: 左右 2 枚並置（01-book-empty.png / 02-book-loaded.png）、下に 2 行
- **Title**: ブックを読み込みます
- **Core message**: 読み込んでも、元のブックのファイルは変更されない
- **Content**: 左: 読み込み前。「Excelブックをここにドロップ」「またはクリックしてファイルを選ぶ」。右: 読み込み後。「3モジュール・188行を読み込みました。」対応形式は `.xlsm / .xlam / .xlsb / .xls`

#### Slide 08 - 読み取った内容を確かめる

- **Audience move**: 何が読めたのか不明 → モジュール名と行数を自分で確かめられる
- **Layout**: 1 枚（03-book-modules.png）+ 右に注釈カード 2 枚
- **Title**: 読み取った内容を確認します
- **Core message**: 読み取りに疑いがある場合は、そのことが画面に出る
- **Content**: 「読み取ったコード」を開くとモジュール名と行数が並ぶ。注釈: (1) 読み取り結果は 2 段階で伝えられる。「マクロのコードは全モジュール読み取れています。」なら管理情報だけの話で、コードの読み取りには影響しない。(2)「コードの外にあるもの」は VBA に現れない事実（参照設定・署名・外部リンクなど）で、このツールは直さず、診断の依頼文へ自動で入れる

#### Slide 09 - 手順2 診断を依頼する

- **Audience move**: 何を AI に渡すのか不明 → コピーする文と添付するファイルが分かる
- **Layout**: 左右 2 枚並置（04-diagnose-request.png / 05-diagnose-environment.png）
- **Title**: AIに診断してもらいます
- **Core message**: この段階では直し方を決めない。事実を確かめるだけ
- **Content**: 「1. 依頼をAIへ渡す」で［依頼文をコピー］→ AI へ貼り付け →［ファイルの場所を開く］で開いたフォルダの `source-code-for-ai.md` を添付。右: 「この診断が前提にしている環境」を開くと、想定動作環境（版つき）が読める。依頼文にはこの環境が同じ形で入る

#### Slide 10 - 診断の返答を取り込む

- **Audience move**: 返答をどう戻すか不明 → コードブロック全体をコピーして 1 回で取り込むと分かる
- **Layout**: 左右 2 枚並置（06-diagnose-handed-over.png / 07-diagnose-imported.png）
- **Title**: 返答を取り込みます
- **Core message**: 形式が合わない返答は、部分的にも取り込まれない
- **Content**: 「2. 返答を取り込む」→「AIの返答にあるコードブロック全体をコピーして、下のボタンを押します。」→［クリップボードから診断結果を取り込む］。取り込めたら右肩が「8件の指摘を取り込み済み」になり、［次へ］が開く。取り込めなかったときは理由が 1 文で出て、状態は変わらない

#### Slide 11 - 手順3 診断結果を読む

- **Audience move**: 指摘の羅列に見える → 作業の種類 → 問題 → 該当箇所の 3 段だと分かる
- **Layout**: 1 枚（08-findings.png）+ 右に「読むときの語」の対応表
- **Title**: 診断結果を確認します
- **Core message**: 件数は問題の数で、該当箇所の数は括弧で添える
- **Content**: 上部に結論帯と件数チップ。作業の種類（Win32 API・外部プログラム・スクリプト / パス・ファイル・フォルダー操作 / 参照ライブラリ・古い部品 / 接続先・機器）で束ねる。分類チップ: 阻害・不具合・条件付き・前提・補助。補助は既定で畳まれている

#### Slide 12 - 指摘の中身を見る

- **Audience move**: チップの意味が分からない → 分類と確度が別のものだと分かる
- **Layout**: 1 枚（09-findings-open.png）+ 下に 2 段の語の表
- **Title**: 指摘の中身を見ます
- **Core message**: 分類は問題の種類、確度は AI がコードを読んだ結果の確からしさで、別のものである
- **Content**: 行を開くと 成立条件 / 影響 / 該当箇所 / 根拠 / 参照した環境制約 が出る。表 1: 分類（阻害・不具合・条件付き・前提・補助）。表 2: 確度（確認済み・可能性高・未確認）。注: 環境の前提が実測でない指摘には「この環境前提は実測ではありません。対象の端末で確かめるまでは、そうなると決まってはいません。」が添えられる

#### Slide 13 - 次にすることを選ぶ

- **Audience move**: ひな形を 1 つ選ぶものだと思っている → 複数選べて 1 回にまとまると分かる
- **Layout**: 左右 2 枚並置（10-nextstep.png / 11-nextstep-both.png）+ 下に 1 行
- **Title**: 次にすることを選びます
- **Core message**: ひな形は複数選べる。選んだ順ではなく、並んでいる順で 1 通の依頼にまとまる
- **Content**: 左: 4 枚のカード。診断が名指しした環境キーを `## 推奨条件` に持つひな形にだけ ★推奨 が出る（根拠のない推奨は出ない）。到達時点で推奨のカードは既に選ばれている。右: 「01 Win32 API を使わない形へ直す」と「02 固定パスを新環境へ置き換える」の両方を選んだ状態。右肩に両方の名前が並ぶ

#### Slide 14 - 置き換えの対応表

- **Audience move**: パスをどう直すのか不明 → 候補が並び、自分が新しい値を入れると分かる
- **Layout**: 左右 2 枚並置（12-repairinput-table.png / 13-repairinput-filled.png）+ 下に注意 1 枚
- **Title**: 置き換える内容を確認します
- **Core message**: 候補として何を拾うかはひな形が決める。新しい値を決めるのは常に人である
- **Content**: 「置換の候補」に 6 種類・6 か所。呼び方（ドライブから始まる場所 / ネットワーク上の場所 / 環境変数を含む場所 / 連結された場所の一部 / 場所を含む文字列 / ファイル名）と件数が並ぶ。場所を指す候補には［選ぶ］が出る。［このコードを見る］でその行のコードが開く。注意: `CreateObject("Scripting.FileSystemObject")` の中の文字列は候補に出ない。ひな形が「この文脈では拾わない」と書いているため

#### Slide 15 - 置き換えたあと、続けて依頼を決める

- **Audience move**: 2 つの作業が別々の回になると思っている → 同じ画面が 2 段で続くと分かる
- **Layout**: 1 枚（14-repairinput-ai.png）+ 右に順序の説明カード
- **Title**: 続けて、AIへ頼む内容を決めます
- **Core message**: 機械的な置き換えを先に行い、その結果のコードを AI へ渡す
- **Content**: ［次へ］を押すと置き換えが実行され、「3種類の文字列を置き換えました。続けて、AIへ依頼する内容を決めます。」と出て、同じ画面が改修する指摘の確認に変わる。画面は増えず、順序も変わらない。理由: 置き換える予定の行を含んだコードを AI へ渡すと、返ってきたコードに古い値が残る。環境が阻害する指摘は最初からチェックが入っている。ここで確かめるのはチェックの状態で、書き直す欄は無い

#### Slide 16 - 改修を依頼して取り込む

- **Audience move**: 2 回目の受け渡しの手順が不明 → 診断と同じ形だと分かる
- **Layout**: 左右 2 枚並置（15-repair-request.png / 16-repair-imported.png）
- **Title**: AIに改修してもらいます
- **Core message**: 添付するコードは置き換え済みのもので、依頼文には「元の値へ戻さない」と書かれている
- **Content**: 診断と同じく「1. 依頼をAIへ渡す」「2. 返答を取り込む」。添付する `source-code-for-ai.md` は置き換え済み。`source-code.md` は読み取った時点のままで動かない。取り込めたら「1個のモジュールを取り込み済み」。AI が直せないと判断した場合は「改修できません」と理由が返り、ビルドへは進まない（改修は不要 / この方法では改修できません / 依頼の内容を決められません の 3 つ）

#### Slide 17 - 差分を確認する

- **Audience move**: 何が変わるのか不安 → 原本から最終形までの差分を 1 か所で見られると分かる
- **Layout**: 1 枚（17-review.png）+ 右に注釈カード 2 枚
- **Title**: 取り込んだ変更を確認します
- **Core message**: 差分は経路によらず、原本から最終形までを見せる
- **Content**: 左にモジュール一覧、右に差分。追加行と削除行は色で分かれる。［変更箇所のみ］［折り返し］［手動修正］。注釈: (1) 置き換えと AI の改修は 1 つの差分にまとまる。(2) 想定外の変更や不足があるときは［戻る］で依頼をやり直せる。取り込み直すと、それに基づく下流はすべて捨てられる

#### Slide 18 - 出力するファイル名を決める

- **Audience move**: 名前を自由に付けられると思っている → 使えない名前があると分かる
- **Layout**: 左右 2 枚並置（18-output.png / 19-output-reserved-name.png）+ 下に理由の表
- **Title**: 作成する改修済みブックを確認します
- **Core message**: 名前が使えないときは、赤枠と理由が必ず一緒に出る
- **Content**: 既定の名前が入っている。拡張子は元のまま。使えない名前の例: フォルダの区切りや `\ / : * ? " < > |`／制御文字／120 文字超／`CON` `PRN` `AUX` `NUL` `CLOCK$` `COM0`〜`COM9` `LPT0`〜`LPT9`（Windows が装置の名前として扱う。この名前ではファイルを作っても開けない）。`CONTRACT` や `backup.CON.xlsm` は通常のファイル名として受理される

#### Slide 19 - ブックを作る

- **Audience move**: ビルド中に何が起きているか不明 → 書き戻しのあと読み直して検証していると分かる
- **Layout**: 左右 2 枚並置（20-build.png / 21-done.png）+ 下にファイル一覧
- **Title**: 改修済みブックを作成します
- **Core message**: 書き戻したあとブックを読み直し、取り込んだコードがそのとおり入っていることを照合する
- **Content**: ビルド中「書き戻し後にブックを読み直して確認しています」。完了すると「作成したファイルは、すべてこのフォルダにまとまっています。」［出力フォルダをエクスプローラーで開く］。フォルダに残るもの: 改修済みブック／差分の確認レポート／`result.md`／`diagnose-request.md`／`repair-request.md`／`source-code.md`／`diagnosis.md`／`run-manifest.json`。AI へ添付したコードは `temp` フォルダーの `source-code-for-ai.md`

### Part 3: 確かめること・別の進め方

#### Slide 20 - このあと人が確かめること

- **Audience move**: ビルドが通れば終わりだと思っている → 動作確認は自分の仕事だと分かる
- **Layout**: 1 枚（22-done-followup.png）+ 右に 4 手順のカード
- **Title**: Excelで動作を確認します
- **Core message**: このツールはマクロを実行しない。照合するのは書き込みの正確さで、マクロの動作は確認しない
- **Content**: 完了画面の「このあと人が確かめること」を開くと、確認していないことが並ぶ。手順: (1) 出力フォルダの改修済みブックを Excel で開く (2) マクロを有効にする (3) いつも使う入口のマクロを実行する (4) 結果がこれまでと同じか確かめる。署名のあったブックからは署名が外れている（コードを書き換えたため）ので、配布前に署名し直す

#### Slide 21 - 別の進め方

- **Audience move**: 決まった 1 本道しかないと思っている → 診断を飛ばす道と、戻ってやり直す道があると分かる
- **Layout**: 左右 2 枚並置（30-diagnose-skip.png / 23-back-after-done.png）
- **Title**: 診断を飛ばす／戻ってやり直す
- **Core message**: 完了画面から戻っても、作成済みのファイルはそのまま残っている
- **Content**: 左: 直したいことが分かっている場合は「診断を飛ばして、直したいことを自分で書く」を選ぶ。診断結果のページを飛ばして、次にすることの選択へ進む。改修依頼は自由記述だけで成立する。右: 完了画面から［戻る］で戻った先。「この実行は完了しています／作成済みの改修済みブックと関連ファイルは、そのまま残っています／この画面から進めると、同じフォルダーへもう一度作成します」と出て、出力フォルダーのパスが添えられる

#### Slide 22 - 動作要件と、仕組みの要点

- **Audience move**: 導入や仕組みの前提が不明 → 動く条件と、手元で完結する範囲が分かる
- **Layout**: 3 列（動作要件 / 手元で完結すること / 仕組みの要点）
- **Title**: 動作要件と、仕組みの要点
- **Core message**: MacroStudio 自体の処理は手元で完結する。チャット AI は利用者の操作で受け渡す外部サービスである
- **Content**: 動作要件: Windows／WebView2 Runtime／Excel（動作確認用）／フォルダをコピーするだけで動く（外部依存なし）。手元で完結: ブックの読み取り・依頼文の作成・返答の検証・固定パスの検出と置き換え・差分の作成・書き戻しと読み直し検証。仕組みの要点: 依頼と返答は依頼 ID で対応付ける／別の依頼への返答は受理しない／前提が変わった結果は捨てる／出力は常に別名の新しいブックで、実行フォルダの中だけに作る

## X. Speaker Notes Requirements

- **Generation**: disabled
- **Filename**: match each SVG filename under `notes/`
