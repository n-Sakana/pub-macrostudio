# run01 ブラックボックス試験 — 移送用一式

MacroStudio beta 2.0.0 に対する実機ブラックボックス試験（run01）の**続きを別端末で再開する**ための一式です。
`git pull` だけで作業を継続できるように、元の作業ディレクトリ
（`C:\repos\pub\_macrostudio_user_blackbox_20260802\run01`・git 管理外）から
**移送可能な部分だけ**をここへ複製しました。

**これは QA 専用のディレクトリです。製品の実行には一切関与しません。**
製品コードから参照されているファイルは1つもありません。

## まず読むもの

1. **[HANDOFF-3.md](HANDOFF-3.md)** — 現状と残件。**ここから読む**
2. [HANDOFF-2.md](HANDOFF-2.md) — 2代目。座標表・罠・コーパスの経緯（HANDOFF-3 が参照する）
3. [HANDOFF.md](HANDOFF.md) — 初代。**§6 ハーネスの使い方 / §7 安全境界 / §8 盲検AIの規律は今も有効**
4. [findings/FINDINGS.md](findings/FINDINGS.md) — PROD-01〜14・DOC-01/02・SIG-01 の全詳細
5. [ledger/component-ledger.md](ledger/component-ledger.md) — 画面部品ごとの操作台帳
6. [PLAN.md](PLAN.md) — 初代の計画（履歴として）

## 置き場所と相対パス

このディレクトリはリポジトリ直下の `qa/run01-blackbox/` です。
文書中の `qa\run01-blackbox\...` はすべてリポジトリ root からの相対パス、
`<repo>` はリポジトリ root（このファイルから見て `..\..`）を指します。

スクリプトは自分の位置から解決するので、**リポジトリをどこへ clone しても動きます**:

```powershell
$RUN  = Split-Path -Parent $PSScriptRoot                          # qa\run01-blackbox
$REPO = Split-Path -Parent (Split-Path -Parent $RUN)              # リポジトリ root
```

## 中身

| 場所 | 中身 |
|---|---|
| `lib/` | 再利用するハーネス 27 本（GUI 実操作・検証・コーパス生成・テスト一括実行） |
| `corpus/books/` | コーパス本体 58 ファイル（A01〜H04・G01〜G09・D11・F06） |
| `corpus/oracles/` | 各試料の期待値 JSON 57 本 |
| `corpus/MATRIX.md` `RESULTS.md` `inject-results.json` | 行列・投入結果 |
| `samples/` | 出荷見本 S01〜S10（PROD-11 の再現などで参照する） |
| `logs/` | 所見が引用しているテキストログ 14 本（下の注意を読むこと） |
| `ai-sessions/` | 盲検AIの依頼文・添付・**生回答の原文**と sha256（再生成できないので同梱） |

## 最初の一歩（別端末で）

```powershell
cd <repo>\qa\run01-blackbox

# 1. アプリを起動して window を記録する（これを先にやらないと GUI 系は動かない）
powershell -NoProfile -ExecutionPolicy Bypass -STA -File lib\launch-app.ps1

# 2. 画面を使わないテスト（ここが緑でないなら環境がおかしい）
powershell -NoProfile -ExecutionPolicy Bypass -File lib\run-tests.ps1 -Set node
powershell -NoProfile -ExecutionPolicy Bypass -File lib\run-tests.ps1 -Set psA

# 3. 残件の本丸 — コーパスの続きを実 GUI へ投入する
powershell -NoProfile -ExecutionPolicy Bypass -STA -File lib\inject-corpus.ps1 -WaitSec 30
```

**3 を流しっぱなしにしないこと。** `logs\inject-corpus.log` を随時見て、
`FAIL` が2連続したら止めて画面を撮ってください。理由は HANDOFF-3 §0 にあります
（前任は壊れた画面のまま30冊クリックし続けました）。

## 持ってきていないもの

| 未転送 | 理由 | 再生成の方法 |
|---|---|---|
| `shots/` … PNG 約200枚・**145 MB** | 巨大で、いつでも撮り直せる | `lib\act.ps1` を dot-source して `Shot '<名前>'`。FINDINGS が引用する `R2_*` `R3_*` は**その時点の画面**なので厳密な再現はできない。所見の判断根拠は各所見の本文に文章で書いてある |
| `artifacts/` | 空 | — |
| `logs\app-state.json` `app-state-2.json` | 別端末では無効な window ハンドル | `lib\launch-app.ps1` が書き直す |
| `lib\_g01`〜`_h34` ほか使い捨て 135 本 | 1回限りの GUI 操作片。座標も画面状態も当時のもの | 必要なら HANDOFF-2 §1 の座標表を見て書き直す。雛形は `lib\launch-app.ps1` と `lib\inject-corpus.ps1` |
| 元 run01 の `exports/` `temp/` の実行成果物 | 製品側 `.gitignore` の対象。試験を回せば作り直される | 経路を通せば `<repo>\exports\<試料>_<時刻>\` に再生成される |
| `audit-results/` `ファイルツリーマネージャー.xlsm` | **先生の実ファイル。HANDOFF §7 で触れることを禁じられている** | 転送しない |

### コーパスそのものも再生成できる

`corpus/books/` は同梱していますが、失われても作り直せます。
**既存ファイルは上書きせず skip する**設計なので、部分的な作り直しにも使えます。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -STA -File lib\make-corpus.ps1
powershell -NoProfile -ExecutionPolicy Bypass -STA -File lib\make-corpus-boundary.ps1
powershell -NoProfile -ExecutionPolicy Bypass -STA -File lib\make-corpus-d.ps1
powershell -NoProfile -ExecutionPolicy Bypass -STA -File lib\make-corpus-rest.ps1
powershell -NoProfile -ExecutionPolicy Bypass -STA -File lib\make-corpus-g06.ps1   # CFB 手術が要る G06
powershell -NoProfile -ExecutionPolicy Bypass -STA -File lib\make-corpus-h.ps1     # D11 と F06
powershell -NoProfile -ExecutionPolicy Bypass -STA -File lib\finalise-b05.ps1      # 長いファイル名の B05
```

生成には**実 Excel と VBIDE へのプログラム アクセス**が要ります。

## 注意

- **`corpus/books/b05/` のファイル名は 173 文字**あります。clone 先が深いと
  `MAX_PATH` に当たります。当たったら `git config --global core.longpaths true`、
  それでも駄目ならこの1ファイルを諦めて `lib\finalise-b05.ps1` で作り直してください。
  この試料は PROD-13（長いファイル名でレイアウトが破綻する）の回帰試料です
- 操作スクリプトを新規に書くときは **UTF-8 BOM 付き**で保存すること。
  BOM 無しだと PowerShell 5.1 が ANSI と解釈して日本語が壊れます。
  後付けするなら `lib\add-bom.ps1 -Path <file>`
- `lib\run-tests.ps1 -Set psB`（UI 系 12 本）は**実 window と実クリップボードを奪います**。
  GUI 作業と同時に走らせないこと
- **`logs/` の中身は run01 の記録そのものです。** リポジトリ直下の `.gitignore` が `*.log` を
  除外しているため `git add -f` で強制的に入れてあります。
  ここのスクリプトを再実行すると**同じファイル名へ上書きされます**。
  所見の裏を取りたいときは、先に `git diff -- qa/run01-blackbox/logs` を見るか、
  `git checkout -- qa/run01-blackbox/logs` で戻してください。
  新しく撮った結果を残す場合は別名にすること
