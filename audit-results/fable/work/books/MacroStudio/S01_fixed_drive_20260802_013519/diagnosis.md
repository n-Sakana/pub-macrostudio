# 診断結果

## PURPOSE

シート「作業」の申請件数を集計し、共有ドライブの年度別フォルダへ CSV を書き出すマクロです。

## FLOW

ExportSummary.RunSummary が入口で、シート内の集計だけを行います。
ExportSummary.ExportToShare は担当者が月末に手動で実行し、S: ドライブの
共有フォルダへ CSV を書き出します。

## DEPENDENCY

S: ドライブに割り当てられた共有フォルダ S:\eigyo\shinsei\ に依存します。
外部の参照ライブラリ、Win32 API、外部プログラムは使っていません。

## ENVIRONMENT

提示された環境では、ブックが SharePoint / OneDrive 上へ移り、S: ドライブの
割り当てが保証されないため、書き出し先の解決と存在確認が成立しなくなる可能性があります。
シート内の集計は環境に依存しません。

## #1 保存先の共有フォルダが S: ドライブ前提で直書きされており、割り当てが無い端末では書き出せません。

- META: CLASS=CONDITIONAL CONFIDENCE=CONFIRMED MODULE=ExportSummary PROC=- LINES=15 ENVKEY=FIXED_DRIVE_LETTER
- CONDITION: 新しい端末に S: ドライブの割り当てが無い場合、または割り当て先が変わった場合に起きます。
- IMPACT: ExportToShare が実行時エラーで止まり、CSV は作成されません。シートの集計結果は残ります。
- EVIDENCE: ExportSummary の 15 行目で EXPORT_ROOT に "S:\eigyo\shinsei\" を直書きしています。

## #2 フォルダの存在確認と作成が Dir と MkDir で行われており、URL の保存先では機能しません。

- META: CLASS=CONDITIONAL CONFIDENCE=CONFIRMED MODULE=ExportSummary PROC=ExportToShare LINES=53-56 ENVKEY=DIR_EXISTENCE_CHECK
- CONDITION: 保存先が https:// で始まる場所へ変わった場合に起きます。ドライブ文字のままなら従来どおり動きます。
- IMPACT: 存在確認が常に「無い」と判定され、MkDir が失敗して処理が止まります。
- EVIDENCE: ExportToShare の 53 行目から 56 行目で、連結した folder を Dir で確認し MkDir で作成しています。

## #3 保存先のパスを「\」の文字列連結で組み立てており、起点が URL になると成立しません。

- META: CLASS=CONDITIONAL CONFIDENCE=CONFIRMED MODULE=ExportSummary PROC=ExportToShare LINES=53,58 ENVKEY=PATH_CONCATENATION
- CONDITION: 保存先の起点がドライブ形式でなくなった場合に起きます。
- IMPACT: 組み立てたパスが正しい場所を指さず、書き出しが失敗するか、意図しない場所に作られます。
- EVIDENCE: 53 行目と 58 行目で、年度と日付を「\」区切りで連結してパスを組み立てています。
