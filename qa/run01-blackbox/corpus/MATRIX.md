# コーパス網羅行列（実務投入模擬）

- 置き場: `run01\corpus\books\<ID>_<name>.<ext>`（**新規生成のみ。既存ファイルを上書きしない**）
- oracle: `run01\corpus\oracles\<ID>.json`（machine-checkable）
- 生成器: `run01\lib\make-corpus.ps1`（実 Excel COM + VBIDE。製品 repo は触らない）
- 基準点: 製品 `testdata\guide-samples\` の 10 本（S01–S10、複製を `run01\books\` へ取得済み）
  → **上限ではない**。下表を加えて計 **63 本**（新規 53 + 基準 10）

## oracle スキーマ

```json
{
  "id": "D03",
  "file": "D03_unc_multi.xlsm",
  "format": "xlsm",
  "modules": [{"name":"...","type":"std|class|sheet|thisworkbook|form","lines":123}],
  "entryMacro": "Mod1.RunX",          // 実行安全なもののみ。null なら実行しない
  "mustFix":    [{"module":"M","line":12,"contains":"S:\\\\","why":"固定ドライブ"}],
  "mustPreserve":[{"module":"M","exact":"Const TAX = 0.1"}, {"kind":"moduleSet"}, {"kind":"sheetNames"}],
  "mustReject": null,                  // 非 null なら「製品が受理してはいけない」条件
  "postRun":    [{"sheet":"作業","cell":"B2","equals":"集計済み"}],
  "route":      ["ai","path","both"],
  "expect":     "normal|ambiguous|unfixable|boundary"
}
```

- `mustFix` … 直るべき箇所。最終 VBA で**変わっていなければ不合格**
- `mustPreserve` … 保持すべき箇所。**1 文字でも変わったら不合格**（全モジュール・シート・容器構造を含む）
- `mustReject` … 拒否/不成立になるべき条件。**受理したら製品の不合格**
- `postRun` … 生成ブックを Excel で開き、入口マクロ実行後の期待セル値

---

## A. 規模・モジュール構成（8 本）

| ID | 内容 | モジュール | 行数 | 経路 | 期待 |
|---|---|---|---|---|---|
| A01 | 最小 | 標準 1 | 8 | ai | normal |
| A02 | 小 | 標準 2 | 40 | ai | normal |
| A03 | 中 | 標準 6 | 520 | ai | normal |
| A04 | 大 | 標準 18 | 5,200 | ai | normal（分割返答へ誘導） |
| A05 | 超大 | 標準 30 | 12,000 | ai | normal（負荷・長時間ビルド） |
| A06 | 全種別混在 | 標準2+クラス2+シート2+ThisWorkbook+UserForm | 380 | ai | normal |
| A07 | クラスのみ | クラス 4 | 210 | ai | normal |
| A08 | 空モジュール混在 | 標準 3（うち 2 は空） | 26 | ai | normal |

## B. 命名・Unicode・長さ（6 本）

| ID | 内容 | 経路 | 期待 |
|---|---|---|---|
| B01 | 日本語モジュール名（`集計処理` `帳票出力`） | ai | normal |
| B02 | 日本語 + 全角記号のプロシージャ名・変数名 | ai | normal |
| B03 | VBA 識別子上限 31 文字ちょうどのモジュール名 | ai | normal |
| B04 | 日本語シート名 + 日本語セル参照 | ai | normal |
| B05 | 長いファイル名（200 文字級）+ 深いパス | ai | boundary |
| B06 | Unicode 文字列リテラル（絵文字・CJK拡張・結合文字） | both | normal |

## C. 構文境界（8 本）

| ID | 内容 | 経路 | 期待 |
|---|---|---|---|
| C01 | 行継続 `_` を多用（Declare・引数リスト・文字列連結） | ai | normal |
| C02 | 条件コンパイル `#If VBA7 / #Else / #End If` 入れ子 | ai | normal |
| C03 | 1 行 4,000 文字級の長大行 | ai | boundary |
| C04 | `Option Explicit` 無し + 暗黙変数 | ai | normal |
| C05 | イベント（`Workbook_Open` / `Worksheet_Change` / `UserForm_Initialize`） | ai | normal |
| C06 | エラー処理（`On Error GoTo` / `Resume Next` / `Err.Raise`） | ai | normal |
| C07 | `Attribute` 行を持つプロシージャ（VB_Description 等） | ai | normal |
| C08 | コメント内・文字列内に**紛らわしいパス風文字列**（置換してはいけない） | path | normal（`mustPreserve` 主） |

## D. パス置換（10 本）

| ID | 内容 | 経路 | 期待 |
|---|---|---|---|
| D01 | 固定ドライブ 1 種 × 12 か所 | path | normal |
| D02 | 固定ドライブ 3 種混在（`S:` `T:` `U:`） | path | normal |
| D03 | UNC `\\server\share` 複数 | path | normal |
| D04 | 相対パス（`..\data\`）— **制限対象**、根拠を開いて明示的に含める | path | normal |
| D05 | URL（`https://…`）— 制限対象 | path | normal |
| D06 | ワイルドカード（`*.csv`）— 制限対象 | path | normal |
| D07 | 固定ドライブ + UNC + 相対 + URL の全混在 | path | normal |
| D08 | 同一値が 40 か所（集約表示・大量行スクロール） | path | normal |
| D09 | パスの一部（連結）`"S:\" & folder & "\x.csv"` — 部分置換しないこと | path | normal（`mustPreserve` 主） |
| D10 | 長大パス（260 文字級）+ Unicode パス | path | boundary |

## E. WinAPI・ビット数（4 本）

| ID | 内容 | 経路 | 期待 |
|---|---|---|---|
| E01 | `PtrSafe` 無し `Declare`（64bit で落ちる） | ai | normal |
| E02 | `PtrSafe` あり + ハンドルを `Long` で受ける | ai | normal |
| E03 | `#If VBA7` で 32/64 両方の `Declare` を持つ | ai | normal |
| E04 | Win32 + 固定パスの複合 | both | normal |

## F. 外部依存・接続（5 本）

| ID | 内容 | 経路 | 期待 |
|---|---|---|---|
| F01 | 早期バインド `Scripting.Dictionary` + 参照設定 | ai | normal |
| F02 | 早期バインド `ADODB.Connection` + 接続文字列 | both | normal |
| F03 | 外部ブックリンク（数式）1 件以上 | ai | normal |
| F04 | `WScript.Shell` / `Shell.Application` / `Shell` 起動 | ai | normal |
| F05 | ActiveX を触るコード（この端末では現物 0 件） | ai | normal |

## G. 形式・境界／異常（8 本）

| ID | 内容 | 経路 | 期待 |
|---|---|---|---|
| G01 | `.xlam` アドイン | ai | normal |
| G02 | `.xlsb` バイナリブック | ai | normal |
| G03 | `.xls` 旧形式（OLE2 直） | ai | normal |
| G04 | `.xlsx`（マクロ無し）— **受理してはいけない** | — | mustReject: マクロがありません |
| G05 | ブック全体をパスワード暗号化 — 受理してはいけない | — | mustReject: 暗号化 |
| G06 | VBA プロジェクト閲覧パスワード（容器は読める） | ai | boundary |
| G07 | 拡張子だけ `.xlsm` の中身が別物（偽装） | — | mustReject |
| G08 | 0 バイト / 途中切れファイル | — | mustReject |

## H. 意味的曖昧・不成立（4 本）

| ID | 内容 | 経路 | 期待 |
|---|---|---|---|
| H01 | 直し方が設計判断に依存（ローカル/同期/URL/API の区別） | ai | ambiguous → `NOCHANGE <判断>` が妥当 |
| H02 | 依頼が矛盾（「動作を変えずに」と「別 API へ移行」を同時要求） | ai | ambiguous |
| H03 | 直す対象が存在しない（既に対策済みコード） | ai | unfixable → 改修不要 |
| H04 | 情報不足（外部仕様が無いと決められない） | ai | ambiguous（**質問を返したら製品が拒否すべき**） |

---

## 反復・組合せの規律

数合わせにしない。各パターンに対し次を変えて**複数変種**を回す。

1. **経路**: AI のみ / 置換のみ / 両方（両方では置換後コードが AI へ渡ることを毎回検査）
2. **順序**: ひな形の選択順、指摘の選択順、置換→AI と AI→戻る→置換
3. **反復**: 依頼作り直し ×N、取り込み直し ×N、戻る→やり直し ×N
4. **状態遷移との組合せ**: 台帳の `⇄` 操作を挟んでから同じ試料を通す
5. **異常混入**: 別依頼 ID / 途中切れ / 欠番 / 質問返し / 崩れ回答 を各経路で最低 1 回

## 進め方

- まず A/B/C/D の生成と oracle 検査（生成物が oracle どおりか）を通す
- 生成が通ったものから**実 GUI 導線へ順次投入**（生成完了を待って一括にしない）
- 時間都合で 10 本へ縮退しない。縮退が避けられない場合は**その事実と残件を報告**する
