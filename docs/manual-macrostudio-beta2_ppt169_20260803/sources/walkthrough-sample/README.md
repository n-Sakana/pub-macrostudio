# 通し事例の撮影用ブック

マニュアルの通し作業事例（**固定パス置換 ＋ Win32 API 改修を 1 回の実行で行う**）に使うブック。

`sample_share_and_win32.xlsm` — 経理課の請求データ月次集計マクロ、という想定。

## なぜ作ったか

**両方を持つブックが repo に無い。**

| ブック | 固定パス | Win32 Declare |
|---|---|---|
| `sample-book\sample_win32_sleep.xlsm`（= `testdata\input_win32_sleep.xlsm`） | 無し | 有り |
| `testdata\input_monthly_report.xlsm` | 無し | 無し |
| `testdata\guide-samples\S01_fixed_drive.xlsm` | 有り | 無し |
| `testdata\guide-samples\S04_win32_bitness.xlsm` | 無し | 有り |

`sample_win32_sleep.xlsm` に固定パスが無いことは製品自身が記録している
（`presets\02_改修\02_固定パスを新環境へ置き換える.md` の 49–52 行:
「実際に `input_win32_sleep.xlsm` では固定パスが 1 つも無いのに 6 か所が候補として並びました」）。

S01 と S04 は別のブックなので、1 回の実行で両方を見せられない。よってマニュアル側で 1 冊作る。
**`tests\`・`testdata\`・製品コードには一切書き込まない。**

## 中身

入口は `BillingReport.RunBilling`。**シートの中だけで完結する。**
ファイル・共有・ネットワーク・レジストリへ触れる手続きは入口から呼ばれない
（診断はコードを**読んで**見つけるものなので、実行して再現する必要がない）。

| モジュール | 行数 | 何を持っているか |
|---|---|---|
| `BillingReport` | 69 | 入口。明細を集計して作業シートへ書く |
| `TimerUtils` | 43 | `#If VBA7` 分岐の `Declare … Sleep Lib "kernel32"`。`Sleep` の直呼び **6 か所**（共通ラッパー無し） |
| `ShareExport` | 76 | 固定パス。`Dir` / `MkDir` / `Open For Output` / `FileSystemObject`。入口からは呼ばれない |

シートは `作業` / `設定` / `明細`（請求明細 12 行、うち返品 2 行）。

## この本で対応表がどう出るか（実測）

製品の `path-map.js` に、同梱ひな形 `02_固定パスを新環境へ置き換える.md` の規則を渡した結果。
**6 種類・6 か所**、すべて `ShareExport`。

| # | 呼び方 | 置換前 | 既定 | 場所を選ぶ |
|---|---|---|---|---|
| 1 | ドライブから始まる場所 | `S:\keiri\seikyu\` | 選択済み | ○ |
| 2 | ネットワーク上の場所 | `\\fileserver\keiri\hinagata\` | 選択済み | ○ |
| 3 | 環境変数を含む場所 | `%USERPROFILE%\Documents\keiri\` | 選択済み | ○ |
| 4 | 連結された場所の一部 | `\backup\` | — | — |
| 5 | 場所を含む文字列 | `control\`（連結の断片） | — | — |
| 6 | ファイル名 | `seikyu_hinagata.xlsx` | — | — |

`CreateObject("Scripting.FileSystemObject")` の `"Scripting.FileSystemObject"` は
**候補に出ない**。ひな形の `拾わない文脈` が `CreateObject(` の直後を除外しているため
（`docs\SPEC.md` §7.2）。マニュアルでこの挙動を説明できる。

## 作り直す

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File make-walkthrough-sample.ps1
```

要 Excel（`HKCU:\Software\Microsoft\Office\16.0\Excel\Security\AccessVBOM = 1`）。
`.ps1` は ASCII のみ（日本語は `sample.json` と `.bas` にある）ので BOM 無しで動く。

スクリプトは次を行う。

1. シートを作り、`sample.json` の値を入れる
2. `.bas` を VBIDE へ流し込み、**編集器が書き足した余剰行を取り除いて、格納された本文が
   ソースと一字一句一致することを確かめる**（一致しなければビルドを失敗させる）
3. 作成者などのドキュメントプロパティを消す（ブックはスクリーンショットに写るため）
4. 保存し、入口マクロを実行して `作業!B2` = `集計済み`、`B3` = `10`、`B4` = `1184500` を確認する

## 検証実績（2026-08-03・この端末）

- ビルド: OK。入口マクロ実行 → `作業!B2` = 集計済み / `B3` = 10 / `B4` = 1184500
- **製品自身の読み手**（`MacroStudio.BookIO.ReadProject`）で読み直し:
  7 モジュール・188 行、`hasReadWarnings=False`、`sourceDoubt=False`、`codePage=932`
- 3 つのコードモジュールすべて、読み出した本文が `.bas` と一致
- 検出の実測: 上表のとおり 6 種類 6 か所

## 注意（作るときにはまった点）

**局所変数の名前が `value` や `count` だと、VBA 編集器が同じ綴りの識別子を
プロジェクト全体で小文字へ書き換える。** 最初の版は `Dim value As String` を置いたため、
`.Value` が全モジュールで `.value` になり、読み直しがソースと一致しなくなった。
`monthText` / `billed` / `filePath` などへ改名して解消している。
